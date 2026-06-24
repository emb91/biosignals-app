/**
 * Daily SEC filings delta sync + per-user funding monitor — Vercel cron entrypoint.
 *
 * Step 1: pull Form D / 8-K / 424B filings from EDGAR's daily-index files for
 *         the last N days into the local sec_filings_local mirror.
 * Step 2: walk every user with non-archived companies and run runFundingMonitor
 *         against the fresh mirror so signals land in their feeds without
 *         them having to press the admin test button.
 *
 * Halts gracefully on SEC rate-limit errors (logged via sec_delta_sync_runs).
 * Per-user monitor failures are isolated — one user's failure doesn't block
 * the others.
 */
import { NextResponse } from 'next/server';
import { observeCron } from '@/lib/cron-observability';
import { createAdminClient } from '@/lib/supabase-admin';
import { ensureTrackedCompanyCiks } from '@/lib/signals/company-cik';
import { persistRunHistory } from '@/lib/signals/run-history';
import { runFundingMonitor } from '@/lib/signals/run-funding-monitor';
import { syncSecDelta } from '@/lib/signals/sync-sec-delta';
import { listUserIdsWithActiveCompanyState } from '@/lib/org-company-state';
import { attributionDueForUser } from '@/lib/signals/monitor-cadence';

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
    const overlapDaysRaw = searchParams.get('overlapDays');
    const overlapDays = overlapDaysRaw ? Math.max(1, Math.trunc(Number(overlapDaysRaw) || 2)) : 2;
    const admin = createAdminClient();
    const cikPriming = await ensureTrackedCompanyCiks(admin);
    const syncResult = await syncSecDelta({ admin, overlapDays });

    const userIds = await loadActiveUserIds(admin);
    let monitorOk = 0;
    let monitorFailed = 0;
    let monitorSkipped = 0;
    const failures: Array<{ user_id: string; error: string }> = [];
    for (const userId of userIds) {
      try {
        const { due, lookbackDays } = await attributionDueForUser(admin, { userId, runner: 'funding' });
        if (!due) {
          monitorSkipped += 1;
          continue;
        }
        const result = await runFundingMonitor({ userId, lookbackDays });
        monitorOk += 1;
        await persistRunHistory(admin, {
          userId,
          signalKey: 'funding_all',
          runner: 'funding',
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
        console.error(`[cron/funding-delta] monitor failed for user ${userId}:`, error);
        await persistRunHistory(admin, {
          userId,
          signalKey: 'funding_all',
          runner: 'funding',
          scope: 'company',
          status: 'failed',
          failures: [{ error: messageFromUnknown(error) }],
          trigger: 'cron',
        });
      }
    }

    return NextResponse.json({
      success: true,
      overlap_days: overlapDays,
      cik_priming: cikPriming,
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

export const GET = observeCron('funding-delta', runCron);
