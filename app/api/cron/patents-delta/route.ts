/**
 * Weekly patent-events delta sync + per-user monitor — Vercel cron entrypoint.
 *
 * Step 1: pull a week of new patent publications from BigQuery into the local
 *         patent_events mirror.
 * Step 2: walk every user with non-archived companies and run runPatentsMonitor
 *         against the fresh mirror, so signals land in their feeds without
 *         them having to press the admin test button.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { persistRunHistory } from '@/lib/signals/run-history';
import { runPatentsMonitor } from '@/lib/signals/run-patents-monitor';
import { syncPatentsDelta } from '@/lib/signals/sync-patents-delta';
import { observeCron } from '@/lib/cron-observability';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function loadActiveUserIds(admin: ReturnType<typeof createAdminClient>): Promise<string[]> {
  // Read from user_companies — the per-user ownership/archive source of truth.
  // Falls back gracefully via the dual-write pattern: companies.user_id stays
  // in sync until reads everywhere are migrated.
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
    const admin = createAdminClient();
    const syncResult = await syncPatentsDelta({ admin });

    const userIds = await loadActiveUserIds(admin);
    let monitorOk = 0;
    let monitorFailed = 0;
    const failures: Array<{ user_id: string; error: string }> = [];
    for (const userId of userIds) {
      try {
        const result = await runPatentsMonitor({ userId });
        monitorOk += 1;
        await persistRunHistory(admin, {
          userId,
          signalKey: 'patents_all',
          runner: 'patents',
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
        console.error(`[cron/patents-delta] monitor failed for user ${userId}:`, error);
        await persistRunHistory(admin, {
          userId,
          signalKey: 'patents_all',
          runner: 'patents',
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
        failures,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}

export const GET = observeCron('patents-delta', runCron);
