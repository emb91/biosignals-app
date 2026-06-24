/**
 * Conference social-intent sync + per-user social monitor — Vercel cron.
 *
 * Step 1: sweep each in-window conference's LinkedIn hashtag(s) into
 *         conference_social_attendees_local (syncConferenceSocialDelta) — windowed,
 *         confidence-filtered, cost-capped. Standalone from profile enrichment.
 * Step 2: walk every active user and, when due (monitorDueForUser, runner
 *         'conference-social'), run the contact-scoped runConferenceSocialMonitor.
 *
 * Mirrors app/api/cron/conference-delta/route.ts. Per-user failures isolated.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { observeCron } from '@/lib/cron-observability';
import { persistRunHistory } from '@/lib/signals/run-history';
import { runConferenceSocialMonitor } from '@/lib/signals/conference/social/run-social-monitor';
import { syncConferenceSocialDelta } from '@/lib/signals/conference/social/sync-social-delta';
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
    const syncResult = await syncConferenceSocialDelta({ admin });

    const userIds = await listUserIdsWithActiveCompanyState(admin);
    let monitorOk = 0;
    let monitorFailed = 0;
    let monitorSkipped = 0;
    const failures: Array<{ user_id: string; error: string }> = [];
    for (const userId of userIds) {
      try {
        const { due } = await monitorDueForUser(admin, { userId, runner: 'conference-social' });
        if (!due) {
          monitorSkipped += 1;
          continue;
        }
        const result = await runConferenceSocialMonitor({ userId });
        monitorOk += 1;
        await persistRunHistory(admin, {
          userId,
          signalKey: 'conference_social_all',
          runner: 'conference-social',
          scope: 'contact',
          status: result.failed_conferences > 0 ? 'failed' : 'success',
          processed: result.processed_conferences,
          failed: result.failed_conferences,
          emittedSignalTypes: result.emitted_signal_types,
          recomputedCompanies: result.recomputed_contacts,
          failures: result.failures.map((f) => ({
            entity_type: 'contact',
            entity_id: f.conference_id,
            error: f.error,
          })),
          trigger: 'cron',
        });
      } catch (error) {
        monitorFailed += 1;
        failures.push({ user_id: userId, error: messageFromUnknown(error) });
        console.error(`[cron/conference-social-delta] monitor failed for user ${userId}:`, error);
        await persistRunHistory(admin, {
          userId,
          signalKey: 'conference_social_all',
          runner: 'conference-social',
          scope: 'contact',
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

export const GET = observeCron('conference-social-delta', runCron);
