import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { runHiringMonitor } from '@/lib/signals/run-hiring-monitor';
import {
  accountSweepSubscribersForTargets,
  listDueAccountSweepTargets,
  markAccountSubscriberSourceSweep,
  markAccountSourceSweep,
  markAccountSweep,
  refreshMonitoringUniverse,
} from '@/lib/billing/monitoring';
import { observeCron } from '@/lib/cron-observability';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function runCron(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: orgRows, error } = await admin.from('organizations').select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const dispatcherLimit = Math.max(1, Number(process.env.ACCOUNT_MONITOR_DISPATCH_LIMIT ?? '2500'));
  let processed = 0;
  let failed = 0;
  const failures: Array<{ org_id: string; error: string }> = [];

  for (const org of orgRows ?? []) {
    const orgId = org.id as string;
    try {
      await refreshMonitoringUniverse(orgId);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      failures.push({ org_id: orgId, error: message });
      console.error(`[cron/jobs-delta] org ${orgId} failed:`, caught);
    }
  }

  const targets = await listDueAccountSweepTargets({ source: 'hiring', limit: dispatcherLimit });
  const subscribers = await accountSweepSubscribersForTargets({
    companyIds: targets.map((target) => target.companyId),
    runner: 'hiring',
  });
  const byUser = new Map<string, typeof subscribers>();
  for (const item of subscribers) {
    const list = byUser.get(item.userId) ?? [];
    list.push(item);
    byUser.set(item.userId, list);
  }
  const failedCompanies = new Set<string>();
  const resultCountsByCompany = new Map<string, number>();
  const subscriberCompanyIds = new Set(subscribers.map((item) => item.companyId));
  for (const [userId, items] of byUser) {
    const result = await runHiringMonitor({
      userId,
      companyIds: [...new Set(items.map((item) => item.companyId))],
    });
    const failedIds = new Set(result.failures.map((item) => item.company_id));
    const resultCounts = new Map(result.details.map((item) => [item.company_id, item.postings_scraped]));
    await Promise.all(items.map(async (item) => {
      const didFail = failedIds.has(item.companyId);
      const resultCount = resultCounts.get(item.companyId) ?? 0;
      resultCountsByCompany.set(
        item.companyId,
        Math.max(resultCountsByCompany.get(item.companyId) ?? 0, resultCount),
      );
      if (didFail) failedCompanies.add(item.companyId);
      if (item.monitorId) {
        await markAccountSweep({
          monitorId: item.monitorId,
          cadenceDays: item.cadenceDays,
          status: didFail ? 'failed' : 'succeeded',
          resultCount,
          providerCostUsd: resultCount * 0.001,
          markSharedTarget: false,
        });
      }
      await markAccountSubscriberSourceSweep({
        orgId: item.orgId,
        companyId: item.companyId,
        source: item.source,
        cadenceDays: item.cadenceDays,
        status: didFail ? 'failed' : 'succeeded',
        resultCount,
        providerCostUsd: resultCount * 0.001,
      });
      if (didFail) failed += 1;
      else processed += 1;
    }));
  }
  await Promise.all(targets.filter((target) => subscriberCompanyIds.has(target.companyId)).map((target) => markAccountSourceSweep({
    companyId: target.companyId,
    source: 'hiring',
    cadenceDays: target.cadenceDays,
    status: failedCompanies.has(target.companyId) ? 'failed' : 'succeeded',
    resultCount: resultCountsByCompany.get(target.companyId) ?? 0,
    providerCostUsd: (resultCountsByCompany.get(target.companyId) ?? 0) * 0.001,
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
    failures,
  });
}

export const GET = observeCron('jobs-delta', runCron);
