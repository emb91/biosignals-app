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
import { persistRunHistory } from '@/lib/signals/run-history';
import { runConferenceMonitor } from '@/lib/signals/conference/run-conference-monitor';
import { syncConferenceDelta } from '@/lib/signals/conference/sync-conference-delta';
import { listUserIdsWithActiveCompanyState } from '@/lib/org-company-state';
import { monitorDueForUser } from '@/lib/signals/monitor-cadence';

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
    const admin = createAdminClient();
    const syncResult = await syncConferenceDelta({ admin });

    const userIds = await listUserIdsWithActiveCompanyState(admin);
    let monitorOk = 0;
    let monitorFailed = 0;
    let monitorSkipped = 0;
    const failures: Array<{ user_id: string; error: string }> = [];
    for (const userId of userIds) {
      try {
        const { due } = await monitorDueForUser(admin, { userId, runner: 'conferences' });
        if (!due) {
          monitorSkipped += 1;
          continue;
        }
        const result = await runConferenceMonitor({ userId });
        monitorOk += 1;
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

    return NextResponse.json({
      success: true,
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

export const GET = observeCron('conference-delta', runCron);
