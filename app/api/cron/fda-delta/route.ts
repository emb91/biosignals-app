/**
 * Weekly FDA delta sync + per-user monitor — Vercel cron entrypoint.
 *
 * Same pattern as patents-delta: pulls fresh drugsfda / 510k / PMA into the
 * local mirrors, then runs runFdaRegulatoryMonitor for every user with
 * non-archived companies.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { persistRunHistory } from '@/lib/signals/run-history';
import { runFdaRegulatoryMonitor } from '@/lib/signals/run-fda-regulatory-monitor';
import { syncFdaDelta } from '@/lib/signals/sync-fda-delta';
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
    const admin = createAdminClient();
    const syncResult = await syncFdaDelta({ admin });

    const userIds = await loadActiveUserIds(admin);
    let monitorOk = 0;
    let monitorFailed = 0;
    let monitorSkipped = 0;
    const failures: Array<{ user_id: string; error: string }> = [];
    for (const userId of userIds) {
      try {
        const { due, lookbackDays } = await attributionDueForUser(admin, { userId, runner: 'fda_regulatory' });
        if (!due) {
          monitorSkipped += 1;
          continue;
        }
        const result = await runFdaRegulatoryMonitor({ userId, lookbackDays });
        monitorOk += 1;
        await persistRunHistory(admin, {
          userId,
          signalKey: 'fda_regulatory_all',
          runner: 'fda_regulatory',
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
        console.error(`[cron/fda-delta] monitor failed for user ${userId}:`, error);
        await persistRunHistory(admin, {
          userId,
          signalKey: 'fda_regulatory_all',
          runner: 'fda_regulatory',
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

export const GET = observeCron('fda-delta', runCron);
