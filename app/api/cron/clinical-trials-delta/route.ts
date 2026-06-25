/**
 * Daily clinical-trials delta sync + per-user monitor — Vercel cron entrypoint.
 *
 * Pulls recently-updated trials into the local clinical_trials mirror, then
 * runs runClinicalTrialsMonitor for every user with non-archived companies.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { persistRunHistory } from '@/lib/signals/run-history';
import { runClinicalTrialsMonitor } from '@/lib/signals/run-clinical-trials-monitor';
import { syncCtDelta } from '@/lib/signals/sync-ct-delta';
import { observeCron } from '@/lib/cron-observability';
import { maybeRefreshMonitoringUniverses } from '@/lib/cron/monitoring-refresh';
import { markAccountSubscriberSweeps } from '@/lib/signals/cron-sweep-marking';
import {
  accountSweepSubscribersForTargets,
  listDueAccountSweepTargets,
  markAccountSourceSweep,
} from '@/lib/billing/monitoring';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function runCron(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const overlapDaysRaw = searchParams.get('overlapDays');
    const overlapDays = overlapDaysRaw
      ? Math.min(8, Math.max(1, Math.trunc(Number(overlapDaysRaw) || 2)))
      : undefined;
    const admin = createAdminClient();
    const dispatcherLimit = Math.max(1, Number(process.env.CLINICAL_TRIALS_MONITOR_DISPATCH_LIMIT ?? '2500'));
    const monitoringRefresh = await maybeRefreshMonitoringUniverses({
      searchParams,
      envName: 'CLINICAL_TRIALS_REFRESH_MONITORING_UNIVERSE',
    });
    const targets = await listDueAccountSweepTargets({ source: 'clinical_trials', limit: dispatcherLimit });
    const subscribers = await accountSweepSubscribersForTargets({
      companyIds: targets.map((target) => target.companyId),
      runner: 'clinical_trials',
    });
    const syncResult = subscribers.length > 0
      ? await syncCtDelta({ admin, overlapDays })
      : { skipped: true as const, reason: 'cadence', targets_due: targets.length, subscribers_due: 0 };

    let monitorOk = 0;
    let monitorFailed = 0;
    let monitorSkipped = 0;
    const failures: Array<{ user_id: string; error: string }> = [];
    const byUser = new Map<string, typeof subscribers>();
    for (const item of subscribers) {
      const list = byUser.get(item.userId) ?? [];
      list.push(item);
      byUser.set(item.userId, list);
    }
    const failedCompanies = new Set<string>();
    const unmarkedCompanies = new Set<string>();
    const resultCountsByCompany = new Map<string, number>();
    for (const [userId, items] of byUser) {
      try {
        const lookbackDays = Math.max(1, ...items.map((item) => item.lookbackDays));
        const result = await runClinicalTrialsMonitor({
          userId,
          companyIds: [...new Set(items.map((item) => item.companyId))],
          lookbackDays,
        });
        monitorOk += 1;
        for (const failure of result.failures) failedCompanies.add(failure.company_id);
        for (const companyId of new Set(items.map((item) => item.companyId))) {
          resultCountsByCompany.set(companyId, result.processed);
        }
        const failedIds = new Set(result.failures.map((item) => item.company_id));
        const unmarked = await markAccountSubscriberSweeps({
          items,
          statusForItem: (item) => failedIds.has(item.companyId) ? 'failed' : 'succeeded',
          resultCountForItem: (item) => resultCountsByCompany.get(item.companyId) ?? 0,
          onFailure: (failure) => {
            failures.push(failure);
            console.error('[cron/clinical-trials-delta] subscriber source mark failed:', failure);
          },
        });
        for (const companyId of unmarked) unmarkedCompanies.add(companyId);
        await persistRunHistory(admin, {
          userId,
          signalKey: 'clinical_trials_all',
          runner: 'clinical_trials',
          scope: 'company',
          status: result.failed > 0 ? 'failed' : 'success',
          processed: result.processed,
          failed: result.failed,
          emittedSignalTypes: result.emitted_signal_types,
          recomputedCompanies: result.recomputed_companies,
          failures: result.failures.map((f) => ({
            entity_type: 'company',
            entity_id: f.company_id,
            error: f.error,
          })),
          trigger: 'cron',
        });
      } catch (error) {
        monitorFailed += 1;
        failures.push({ user_id: userId, error: messageFromUnknown(error) });
        console.error(`[cron/clinical-trials-delta] monitor failed for user ${userId}:`, error);
        for (const item of items) failedCompanies.add(item.companyId);
        const unmarked = await markAccountSubscriberSweeps({
          items,
          statusForItem: () => 'failed',
          onFailure: (failure) => {
            failures.push(failure);
            console.error('[cron/clinical-trials-delta] subscriber source mark failed:', failure);
          },
        });
        for (const companyId of unmarked) unmarkedCompanies.add(companyId);
        await persistRunHistory(admin, {
          userId,
          signalKey: 'clinical_trials_all',
          runner: 'clinical_trials',
          scope: 'company',
          status: 'failed',
          failures: [{ error: messageFromUnknown(error) }],
          trigger: 'cron',
        });
      }
    }
    if (byUser.size === 0) monitorSkipped = targets.length;
    const subscriberCompanyIds = new Set(subscribers.map((item) => item.companyId));
    await Promise.all(targets.filter((target) => (
      subscriberCompanyIds.has(target.companyId) && !unmarkedCompanies.has(target.companyId)
    )).map((target) => markAccountSourceSweep({
      companyId: target.companyId,
      source: 'clinical_trials',
      cadenceDays: target.cadenceDays,
      status: failedCompanies.has(target.companyId) ? 'failed' : 'succeeded',
      resultCount: resultCountsByCompany.get(target.companyId) ?? 0,
      providerCostUsd: 0,
    })));
    const { count: overdue } = await admin.from('account_source_sweep_targets')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'clinical_trials').eq('status', 'active').lte('next_sweep_at', new Date().toISOString());

    return NextResponse.json({
      success: true,
      overlap_days: overlapDays ?? 2,
      sync: syncResult,
      targets_due: targets.length,
      subscribers_due: subscribers.length,
      overdue: overdue ?? 0,
      unmarked_targets: unmarkedCompanies.size,
      refresh_monitoring_universe: monitoringRefresh,
      monitor: {
        users_total: byUser.size,
        users_succeeded: monitorOk,
        users_failed: monitorFailed,
        users_skipped: monitorSkipped,
        failures,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}

export const GET = observeCron('clinical-trials-delta', runCron);
