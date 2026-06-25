import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { runHiringMonitor, syncLinkedInJobsForCompanies } from '@/lib/signals/run-hiring-monitor';
import { maybeRefreshMonitoringUniverses } from '@/lib/cron/monitoring-refresh';
import { markAccountSubscriberSweeps } from '@/lib/signals/cron-sweep-marking';
import {
  accountSweepSubscribersForTargets,
  listDueAccountSweepTargets,
  markAccountSourceSweep,
} from '@/lib/billing/monitoring';
import { observeCron } from '@/lib/cron-observability';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function runCron(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const admin = createAdminClient();
  const { searchParams } = new URL(request.url);

  const dispatcherLimit = Math.max(1, Number(process.env.ACCOUNT_MONITOR_DISPATCH_LIMIT ?? '2500'));
  let processed = 0;
  let failed = 0;
  const failures: Array<{ org_id: string; error: string }> = [];
  const monitoringRefresh = await maybeRefreshMonitoringUniverses({
    searchParams,
    envName: 'JOBS_REFRESH_MONITORING_UNIVERSE',
  });

  const targets = await listDueAccountSweepTargets({ source: 'hiring', limit: dispatcherLimit });
  const subscribers = await accountSweepSubscribersForTargets({
    companyIds: targets.map((target) => target.companyId),
    runner: 'hiring',
  });
  const subscriberCompanyIds = new Set(subscribers.map((item) => item.companyId));
  const syncResult = await syncLinkedInJobsForCompanies({
    companyIds: [...subscriberCompanyIds],
    orgId: null,
    userId: null,
  });
  const syncFailedCompanies = new Set(syncResult.failures.map((item) => item.company_id));
  const syncJobsByCompany = new Map(syncResult.details.map((item) => [item.company_id, item.jobs_seen]));
  const byUser = new Map<string, typeof subscribers>();
  for (const item of subscribers) {
    const list = byUser.get(item.userId) ?? [];
    list.push(item);
    byUser.set(item.userId, list);
  }
  const failedCompanies = new Set<string>();
  const unmarkedCompanies = new Set<string>();
  const resultCountsByCompany = new Map<string, number>();
  for (const failure of syncResult.failures) {
    failedCompanies.add(failure.company_id);
    failures.push({ org_id: failure.company_id, error: failure.error });
  }
  for (const [companyId, count] of syncJobsByCompany) {
    resultCountsByCompany.set(companyId, count);
  }
  for (const [userId, items] of byUser) {
    try {
      const cadenceLookback = Math.max(1, ...items.map((item) => item.lookbackDays));
      const runnableItems = items.filter((item) => !syncFailedCompanies.has(item.companyId));
      if (!runnableItems.length) {
        const unmarked = await markAccountSubscriberSweeps({
          items,
          statusForItem: () => 'failed',
          resultCountForItem: (item) => syncJobsByCompany.get(item.companyId) ?? 0,
          providerCostUsdForItem: () => 0,
          onFailure: (failure) => {
            failures.push({ org_id: failure.company_id, error: failure.error });
            console.error('[cron/jobs-delta] subscriber source mark failed:', failure);
          },
        });
        for (const companyId of unmarked) unmarkedCompanies.add(companyId);
        failed += items.length;
        continue;
      }
      const result = await runHiringMonitor({
        userId,
        companyIds: [...new Set(runnableItems.map((item) => item.companyId))],
        lookbackDays: cadenceLookback,
      });
      const failedIds = new Set(result.failures.map((item) => item.company_id));
      const resultCounts = new Map(result.details.map((item) => [item.company_id, item.postings_scraped]));
      const unmarked = await markAccountSubscriberSweeps({
        items,
        statusForItem: (item) => (
          syncFailedCompanies.has(item.companyId) || failedIds.has(item.companyId)
            ? 'failed'
            : 'succeeded'
        ),
        resultCountForItem: (item) => resultCounts.get(item.companyId) ?? syncJobsByCompany.get(item.companyId) ?? 0,
        providerCostUsdForItem: () => 0,
        onFailure: (failure) => {
          failures.push({ org_id: failure.company_id, error: failure.error });
          console.error('[cron/jobs-delta] subscriber source mark failed:', failure);
        },
      });
      for (const companyId of unmarked) unmarkedCompanies.add(companyId);
      for (const item of items) {
        const didFail = failedIds.has(item.companyId);
        const resultCount = resultCounts.get(item.companyId) ?? 0;
        resultCountsByCompany.set(
          item.companyId,
          Math.max(resultCountsByCompany.get(item.companyId) ?? 0, syncJobsByCompany.get(item.companyId) ?? resultCount),
        );
        if (syncFailedCompanies.has(item.companyId) || didFail || unmarked.has(item.companyId)) {
          failedCompanies.add(item.companyId);
          failed += 1;
        } else {
          processed += 1;
        }
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      failures.push({ org_id: userId, error: message });
      console.error(`[cron/jobs-delta] monitor failed for user ${userId}:`, caught);
      for (const item of items) failedCompanies.add(item.companyId);
      const unmarked = await markAccountSubscriberSweeps({
        items,
        statusForItem: () => 'failed',
        providerCostUsdForItem: () => 0,
        onFailure: (failure) => {
          failures.push({ org_id: failure.company_id, error: failure.error });
          console.error('[cron/jobs-delta] subscriber source mark failed:', failure);
        },
      });
      for (const companyId of unmarked) unmarkedCompanies.add(companyId);
      failed += items.length;
    }
  }
  await Promise.all(targets.filter((target) => (
    subscriberCompanyIds.has(target.companyId) && !unmarkedCompanies.has(target.companyId)
  )).map((target) => markAccountSourceSweep({
    companyId: target.companyId,
    source: 'hiring',
    cadenceDays: target.cadenceDays,
    status: failedCompanies.has(target.companyId) ? 'failed' : 'succeeded',
    resultCount: resultCountsByCompany.get(target.companyId) ?? 0,
    providerCostUsd: (syncJobsByCompany.get(target.companyId) ?? 0) * 0.001,
  })));

  const { count: overdue } = await admin.from('account_source_sweep_targets')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'hiring').eq('status', 'active').lte('next_sweep_at', new Date().toISOString());
  return NextResponse.json({
    success: true,
    processed,
    failed,
    targets_due: targets.length,
    subscribers_due: subscribers.length,
    overdue: overdue ?? 0,
    dispatcherLimit,
    unmarked_targets: unmarkedCompanies.size,
    jobs_sync: syncResult,
    refresh_monitoring_universe: monitoringRefresh,
    failures,
  });
}

export const GET = observeCron('jobs-delta', runCron);
