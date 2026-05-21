/**
 * Daily contact job-change cron — Vercel cron entrypoint.
 *
 * For every active user, scrapes LinkedIn profiles for their contacts
 * (oldest-checked-first, 20 per user) and emits signals when a job or
 * company change is detected.
 *
 * Cron cadence: daily at 07:00 UTC (staggered after the hiring-signal run).
 *   { "path": "/api/cron/contact-job-change", "schedule": "0 7 * * *" }
 *
 * Cost envelope: HarvestAPI profile scrape = $4/1k profiles.
 * At 20 contacts/user/day × 1 user = 20 profiles/day ≈ $0.08/day.
 * Scale the batch size in JOB_CHANGE_BATCH via env if needed.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { runJobChangeMonitor } from '@/lib/signals/run-job-change-monitor';
import { persistRunHistory } from '@/lib/signals/run-history';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function messageFromUnknown(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function loadActiveUserIds(
  admin: ReturnType<typeof createAdminClient>
): Promise<string[]> {
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

    let usersOk = 0;
    let usersFailed = 0;
    const userFailures: Array<{ user_id: string; error: string }> = [];

    for (const userId of userIds) {
      try {
        const result = await runJobChangeMonitor({
          userId,
          limit: Number(process.env.JOB_CHANGE_BATCH ?? '20'),
        });

        usersOk++;

        await persistRunHistory(admin, {
          userId,
          signalKey: 'job_change_all',
          runner: 'job_change',
          scope: 'contact',
          status: result.failed > 0 ? 'failed' : 'success',
          processed: result.processed,
          failed: result.failed,
          emittedSignalTypes: result.emitted_signal_types,
          recomputedCompanies: [],
          failures: result.failures.map((f) => ({
            contact_id: f.contact_id,
            error: f.error,
          })),
          trigger: 'cron',
        });
      } catch (err) {
        usersFailed++;
        const msg = messageFromUnknown(err);
        userFailures.push({ user_id: userId, error: msg });
        console.error(`[cron/contact-job-change] failed for user ${userId}:`, err);

        await persistRunHistory(admin, {
          userId,
          signalKey: 'job_change_all',
          runner: 'job_change',
          scope: 'contact',
          status: 'failed',
          failures: [{ error: msg }],
          trigger: 'cron',
        }).catch(() => null);
      }
    }

    return NextResponse.json({
      success: true,
      monitor: {
        users_total: userIds.length,
        users_succeeded: usersOk,
        users_failed: usersFailed,
        failures: userFailures,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: messageFromUnknown(err) }, { status: 500 });
  }
}
