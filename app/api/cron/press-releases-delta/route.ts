/**
 * Press-release delta sync + per-user monitor — Vercel cron entrypoint.
 *
 * Step 1: Pull fresh articles from GlobeNewswire (biotech + pharma RSS) and
 *         PR Newswire (general feed with biotech keyword pre-filter) into the
 *         press_release_articles mirror and classify them with Haiku 4.5.
 *
 * Step 2: Walk every user with non-archived companies and run
 *         runPressReleaseMonitor so press-release signals land in their feeds
 *         without requiring any manual action.
 *
 * Auth: CRON_SECRET bearer token (same pattern as all other cron routes).
 * Per-user monitor failures are isolated — one user's failure doesn't block others.
 *
 * Suggested schedule: every 6 hours (GNW + PRN update continuously; 6h is a
 * reasonable freshness vs. cost trade-off for the Haiku classification budget).
 */
import { NextResponse } from 'next/server';
import { observeCron } from '@/lib/cron-observability';
import { createAdminClient } from '@/lib/supabase-admin';
import { syncPressReleaseDelta } from '@/lib/signals/sync-press-release-delta';
import { runPressReleaseMonitor } from '@/lib/signals/run-press-release-monitor';
import { persistRunHistory } from '@/lib/signals/run-history';
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

    const cutoffDaysRaw = searchParams.get('cutoffDays');
    const lookbackDaysRaw = searchParams.get('lookbackDays');

    const admin = createAdminClient();
    const dispatcherLimit = Math.max(1, Number(process.env.PRESS_RELEASE_MONITOR_DISPATCH_LIMIT ?? '2500'));
    const targets = await listDueAccountSweepTargets({ source: 'press_releases', limit: dispatcherLimit });
    const subscribers = await accountSweepSubscribersForTargets({
      companyIds: targets.map((target) => target.companyId),
      runner: 'press_releases',
    });

    // ── Acquisition gate ──────────────────────────────────────────────────────
    // RSS pull + Haiku classification is a shared cost, so refresh the mirror at
    // the fastest cadence demanded by due shared source targets. The pull window
    // scales with the gap so a monthly refresh doesn't miss the weeks in between.
    const acquisitionCadence = subscribers.length
      ? Math.min(...subscribers.map((subscriber) => subscriber.cadenceDays))
      : 30;
    // Default pull window: weekly gap + buffer, or a full month when monthly.
    const cutoffDays = cutoffDaysRaw
      ? Math.max(1, Math.trunc(Number(cutoffDaysRaw) || 9))
      : acquisitionCadence <= 7
        ? 9
        : 33;

    // ── Step 1: Sync press release delta ──────────────────────────────────────
    const syncResult = subscribers.length > 0
      ? await syncPressReleaseDelta({ admin, cutoffDays })
      : { skipped: true as const, reason: 'cadence', targets_due: targets.length, subscribers_due: 0 };

    // ── Step 2: Per-user monitor ──────────────────────────────────────────────
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
        const cadenceLookback = Math.max(1, ...items.map((item) => item.lookbackDays));
        // Manual override via ?lookbackDays wins; otherwise size to the customer's cadence.
        const lookbackDays = lookbackDaysRaw
          ? Math.max(1, Math.trunc(Number(lookbackDaysRaw) || cadenceLookback))
          : cadenceLookback;
        const result = await runPressReleaseMonitor({
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
            console.error('[cron/press-releases-delta] subscriber source mark failed:', failure);
          },
        });
        for (const companyId of unmarked) unmarkedCompanies.add(companyId);
        await persistRunHistory(admin, {
          userId,
          signalKey: 'press_release_all',
          runner: 'press_releases',
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
        for (const item of items) failedCompanies.add(item.companyId);
        const errMsg = messageFromUnknown(error);
        failures.push({ user_id: userId, error: errMsg });
        console.error(`[cron/press-releases-delta] monitor failed for user ${userId}:`, error);
        for (const item of items) failedCompanies.add(item.companyId);
        const unmarked = await markAccountSubscriberSweeps({
          items,
          statusForItem: () => 'failed',
          onFailure: (failure) => {
            failures.push(failure);
            console.error('[cron/press-releases-delta] subscriber source mark failed:', failure);
          },
        });
        for (const companyId of unmarked) unmarkedCompanies.add(companyId);
        await persistRunHistory(admin, {
          userId,
          signalKey: 'press_release_all',
          runner: 'press_releases',
          scope: 'company',
          status: 'failed',
          failures: [{ error: errMsg }],
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
      source: 'press_releases',
      cadenceDays: target.cadenceDays,
      status: failedCompanies.has(target.companyId) ? 'failed' : 'succeeded',
      resultCount: resultCountsByCompany.get(target.companyId) ?? 0,
      providerCostUsd: 0,
    })));
    const { count: overdue } = await admin.from('account_source_sweep_targets')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'press_releases').eq('status', 'active').lte('next_sweep_at', new Date().toISOString());

    return NextResponse.json({
      success: true,
      cutoff_days: cutoffDays,
      acquisition_cadence_days: acquisitionCadence,
      sync: syncResult,
      targets_due: targets.length,
      subscribers_due: subscribers.length,
      overdue: overdue ?? 0,
      unmarked_targets: unmarkedCompanies.size,
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

export const GET = observeCron('press-releases-delta', runCron);
