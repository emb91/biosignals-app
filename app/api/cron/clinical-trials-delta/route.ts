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
    const overlapDays = overlapDaysRaw
      ? Math.min(8, Math.max(1, Math.trunc(Number(overlapDaysRaw) || 2)))
      : undefined;
    const admin = createAdminClient();
    const syncResult = await syncCtDelta({ admin, overlapDays });

    const userIds = await loadActiveUserIds(admin);
    let monitorOk = 0;
    let monitorFailed = 0;
    let monitorSkipped = 0;
    const failures: Array<{ user_id: string; error: string }> = [];
    for (const userId of userIds) {
      try {
        const { due, lookbackDays } = await attributionDueForUser(admin, { userId, runner: 'clinical_trials' });
        if (!due) {
          monitorSkipped += 1;
          continue;
        }
        const result = await runClinicalTrialsMonitor({ userId, lookbackDays });
        monitorOk += 1;
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

    return NextResponse.json({
      success: true,
      overlap_days: overlapDays ?? 2,
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

export const GET = observeCron('clinical-trials-delta', runCron);
