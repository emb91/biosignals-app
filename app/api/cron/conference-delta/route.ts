/**
 * Conference exhibitor delta sync + per-user conference monitor — Vercel cron.
 *
 * Step 1: refresh the shared conference_exhibitors_local mirror from each active
 *         conference's platform adapter (syncConferenceDelta), resolving
 *         exhibitor names to canonical companies once.
 * Step 2: walk every user with active companies and, when their plan cadence is
 *         due (monitorDueForUser, runner 'conferences' — growth weekly /
 *         starter+free monthly), run runConferenceMonitor against the mirror.
 *
 * Per-user failures are isolated. Mirrors app/api/cron/grants-delta/route.ts.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { observeCron } from '@/lib/cron-observability';
import { maybeRefreshMonitoringUniverses } from '@/lib/cron/monitoring-refresh';
import { persistRunHistory } from '@/lib/signals/run-history';
import { runConferenceMonitor } from '@/lib/signals/conference/run-conference-monitor';
import { syncConferenceDelta } from '@/lib/signals/conference/sync-conference-delta';
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
    const admin = createAdminClient();
    const dispatcherLimit = Math.max(1, Number(process.env.CONFERENCE_MONITOR_DISPATCH_LIMIT ?? '2500'));
    const monitoringRefresh = await maybeRefreshMonitoringUniverses({
      searchParams,
      envName: 'CONFERENCE_REFRESH_MONITORING_UNIVERSE',
    });
    const targets = await listDueAccountSweepTargets({ source: 'conferences', limit: dispatcherLimit });
    const subscribers = await accountSweepSubscribersForTargets({
      companyIds: targets.map((target) => target.companyId),
      runner: 'conferences',
    });
    const syncResult = subscribers.length > 0
      ? await syncConferenceDelta({ admin })
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
        const result = await runConferenceMonitor({
          userId,
          companyIds: [...new Set(items.map((item) => item.companyId))],
        });
        monitorOk += 1;
        const failedCompaniesForUser = new Set<string>();
        if (result.failed_conferences > 0) {
          for (const item of items) {
            failedCompanies.add(item.companyId);
            failedCompaniesForUser.add(item.companyId);
          }
        }
        for (const companyId of new Set(items.map((item) => item.companyId))) {
          resultCountsByCompany.set(companyId, result.processed_conferences);
        }
        const unmarked = await markAccountSubscriberSweeps({
          items,
          statusForItem: (item) => failedCompaniesForUser.has(item.companyId) ? 'failed' : 'succeeded',
          resultCountForItem: (item) => resultCountsByCompany.get(item.companyId) ?? 0,
          onFailure: (failure) => {
            failures.push(failure);
            console.error('[cron/conference-delta] subscriber source mark failed:', failure);
          },
        });
        for (const companyId of unmarked) unmarkedCompanies.add(companyId);
        await persistRunHistory(admin, {
          userId,
          signalKey: 'conferences_all',
          runner: 'conferences',
          scope: 'company',
          status: result.failed_conferences > 0 ? 'failed' : 'success',
          processed: result.processed_conferences,
          failed: result.failed_conferences,
          emittedSignalTypes: result.emitted_signal_types,
          recomputedCompanies: result.recomputed_companies,
          failures: result.failures.map((f) => ({
            entity_type: 'company',
            entity_id: f.conference_id,
            error: f.error,
          })),
          trigger: 'cron',
        });
      } catch (error) {
        monitorFailed += 1;
        failures.push({ user_id: userId, error: messageFromUnknown(error) });
        console.error(`[cron/conference-delta] monitor failed for user ${userId}:`, error);
        for (const item of items) failedCompanies.add(item.companyId);
        const unmarked = await markAccountSubscriberSweeps({
          items,
          statusForItem: () => 'failed',
          onFailure: (failure) => {
            failures.push(failure);
            console.error('[cron/conference-delta] subscriber source mark failed:', failure);
          },
        });
        for (const companyId of unmarked) unmarkedCompanies.add(companyId);
        await persistRunHistory(admin, {
          userId,
          signalKey: 'conferences_all',
          runner: 'conferences',
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
      source: 'conferences',
      cadenceDays: target.cadenceDays,
      status: failedCompanies.has(target.companyId) ? 'failed' : 'succeeded',
      resultCount: resultCountsByCompany.get(target.companyId) ?? 0,
      providerCostUsd: 0,
    })));
    const { count: overdue } = await admin.from('account_source_sweep_targets')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'conferences').eq('status', 'active').lte('next_sweep_at', new Date().toISOString());

    return NextResponse.json({
      success: true,
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

export const GET = observeCron('conference-delta', runCron);
