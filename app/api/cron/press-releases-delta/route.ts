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

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function loadActiveUserIds(admin: ReturnType<typeof createAdminClient>): Promise<string[]> {
  const { data, error } = await admin
    .from('user_companies')
    .select('user_id')
    .is('archived_at', null);
  if (error) throw new Error(`load active users: ${error.message}`);
  const ids = new Set<string>();
  for (const row of (data ?? []) as Array<{ user_id?: unknown }>) {
    if (typeof row.user_id === 'string' && row.user_id) ids.add(row.user_id);
  }
  return [...ids];
}

async function runCron(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);

    // How many days back to pull from RSS feeds. Default 3 — overlaps safely
    // with the prior cron run even if a run is delayed or skipped.
    const cutoffDaysRaw = searchParams.get('cutoffDays');
    const cutoffDays = cutoffDaysRaw
      ? Math.max(1, Math.trunc(Number(cutoffDaysRaw) || 3))
      : 3;

    // How many days back the per-user monitor looks for matching articles.
    // Slightly longer than the feed window so freshly-classified articles
    // from the previous run are still eligible.
    const lookbackDaysRaw = searchParams.get('lookbackDays');
    const lookbackDays = lookbackDaysRaw
      ? Math.max(1, Math.trunc(Number(lookbackDaysRaw) || 7))
      : 7;

    const admin = createAdminClient();

    // ── Step 1: Sync press release delta ──────────────────────────────────────
    const syncResult = await syncPressReleaseDelta({ admin, cutoffDays });

    // ── Step 2: Per-user monitor ──────────────────────────────────────────────
    const userIds = await loadActiveUserIds(admin);
    let monitorOk = 0;
    let monitorFailed = 0;
    const failures: Array<{ user_id: string; error: string }> = [];

    for (const userId of userIds) {
      try {
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
      lookback_days: lookbackDays,
      sync: syncResult,
      monitor: {
        users_total: userIds.length,
        users_succeeded: monitorOk,
        users_failed: monitorFailed,
        failures,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}

export const GET = observeCron('press-releases-delta', runCron);
