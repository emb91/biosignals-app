/**
 * Weekly hiring signal cron — Vercel cron entrypoint.
 *
 * Runs runHiringMonitor for every active user. The monitor calls the
 * curious_coder/linkedin-jobs-scraper Apify actor in one batch call per
 * invocation, passing all company search URLs at once — no local DB mirror,
 * no separate sync step.
 *
 * Cron cadence: weekly (Mondays 06:00 UTC). Increase to daily if the
 * company list grows and you want fresher signals.
 *   { "path": "/api/cron/jobs-delta", "schedule": "0 6 * * 1" }
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { persistRunHistory } from '@/lib/signals/run-history';
import { runHiringMonitor } from '@/lib/signals/run-hiring-monitor';

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

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const userIds = await loadActiveUserIds(admin);
    let monitorOk = 0;
    let monitorFailed = 0;
    const monitorFailures: Array<{ user_id: string; error: string }> = [];

    for (const userId of userIds) {
      try {
        const result = await runHiringMonitor({ userId });
        monitorOk += 1;
        await persistRunHistory(admin, {
          userId,
          signalKey: 'hiring_all',
          runner: 'hiring',
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
        monitorFailures.push({ user_id: userId, error: messageFromUnknown(error) });
        console.error(`[cron/jobs-delta] monitor failed for user ${userId}:`, error);
        await persistRunHistory(admin, {
          userId,
          signalKey: 'hiring_all',
          runner: 'hiring',
          scope: 'company',
          status: 'failed',
          failures: [{ error: messageFromUnknown(error) }],
          trigger: 'cron',
        });
      }
    }

    return NextResponse.json({
      success: true,
      monitor: {
        users_total: userIds.length,
        users_succeeded: monitorOk,
        users_failed: monitorFailed,
        failures: monitorFailures,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
