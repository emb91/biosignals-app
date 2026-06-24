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
import { listUserIdsWithActiveCompanyState } from '@/lib/org-company-state';
import {
  attributionDueForUser,
  dueForCadence,
  fastestActiveAcquisitionCadence,
} from '@/lib/signals/monitor-cadence';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function loadActiveUserIds(admin: ReturnType<typeof createAdminClient>): Promise<string[]> {
  return listUserIdsWithActiveCompanyState(admin);
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
    const userIds = await loadActiveUserIds(admin);

    // ── Acquisition gate ──────────────────────────────────────────────────────
    // RSS pull + Haiku classification is a shared cost, so refresh the mirror at
    // the fastest cadence any active customer demands (weekly if a growth
    // customer is active, else monthly). The pull window scales with the gap so
    // a monthly refresh doesn't miss the weeks in between.
    const acquisitionCadence = await fastestActiveAcquisitionCadence(admin, userIds);
    const syncDue = dueForCadence(acquisitionCadence);
    // Default pull window: weekly gap + buffer, or a full month when monthly.
    const cutoffDays = cutoffDaysRaw
      ? Math.max(1, Math.trunc(Number(cutoffDaysRaw) || 9))
      : acquisitionCadence <= 7
        ? 9
        : 33;

    // ── Step 1: Sync press release delta ──────────────────────────────────────
    const syncResult = syncDue
      ? await syncPressReleaseDelta({ admin, cutoffDays })
      : { skipped: true as const, reason: 'cadence', acquisition_cadence_days: acquisitionCadence };

    // ── Step 2: Per-user monitor ──────────────────────────────────────────────
    let monitorOk = 0;
    let monitorFailed = 0;
    let monitorSkipped = 0;
    const failures: Array<{ user_id: string; error: string }> = [];

    for (const userId of userIds) {
      try {
        const { due, lookbackDays: cadenceLookback } = await attributionDueForUser(admin, { userId, runner: 'press_releases' });
        if (!due) {
          monitorSkipped += 1;
          continue;
        }
        // Manual override via ?lookbackDays wins; otherwise size to the customer's cadence.
        const lookbackDays = lookbackDaysRaw
          ? Math.max(1, Math.trunc(Number(lookbackDaysRaw) || cadenceLookback))
          : cadenceLookback;
        const result = await runPressReleaseMonitor({ userId, lookbackDays });
        monitorOk += 1;
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
        const errMsg = messageFromUnknown(error);
        failures.push({ user_id: userId, error: errMsg });
        console.error(`[cron/press-releases-delta] monitor failed for user ${userId}:`, error);
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

    return NextResponse.json({
      success: true,
      cutoff_days: cutoffDays,
      acquisition_cadence_days: acquisitionCadence,
      sync: syncResult,
      monitor: {
        users_total: userIds.length,
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
