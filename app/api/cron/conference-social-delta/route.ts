/**
 * Conference social-intent sync + shared-target social monitor — Vercel cron.
 *
 * Step 1: sweep each in-window conference's LinkedIn hashtag(s) into
 *         conference_social_attendees_local (syncConferenceSocialDelta) — windowed,
 *         confidence-filtered, cost-capped. Standalone from profile enrichment.
 * Step 2: dispatch due contact subscribers from the shared sweep-target cadence
 *         tables and run the contact-scoped runConferenceSocialMonitor against
 *         the mirror for one representative member per org/person.
 *
 * Mirrors app/api/cron/conference-delta/route.ts. Per-user failures isolated.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { observeCron } from '@/lib/cron-observability';
import { maybeRefreshMonitoringUniverses } from '@/lib/cron/monitoring-refresh';
import { persistRunHistory } from '@/lib/signals/run-history';
import { runConferenceSocialMonitor } from '@/lib/signals/conference/social/run-social-monitor';
import { syncConferenceSocialDelta } from '@/lib/signals/conference/social/sync-social-delta';
import { markContactSubscriberSweeps } from '@/lib/signals/cron-sweep-marking';
import {
  contactSweepSubscribersForTargets,
  listDueContactSweepTargets,
  markContactSourceSweep,
} from '@/lib/billing/monitoring';

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
    const { searchParams } = new URL(request.url);
    const admin = createAdminClient();
    const dispatcherLimit = Math.max(1, Number(process.env.CONFERENCE_SOCIAL_MONITOR_DISPATCH_LIMIT ?? '2500'));
    const monitoringRefresh = await maybeRefreshMonitoringUniverses({
      searchParams,
      envName: 'CONFERENCE_SOCIAL_REFRESH_MONITORING_UNIVERSE',
    });
    const targets = await listDueContactSweepTargets({ source: 'conference_social', limit: dispatcherLimit });
    const subscribers = await contactSweepSubscribersForTargets({
      personIds: targets.map((target) => target.personId),
      runner: 'conference-social',
    });
    const syncResult = subscribers.length > 0
      ? await syncConferenceSocialDelta({ admin })
      : { skipped: true as const, reason: 'cadence', targets_due: targets.length, subscribers_due: 0 };

    let monitorOk = 0;
    let monitorFailed = 0;
    let monitorSkipped = 0;
    const failures: Array<{ user_id: string; error: string }> = [];
    const byUser = new Map<string, typeof subscribers>();
    for (const item of subscribers) {
      const list = byUser.get(item.userId) ?? [];
      list.push(item);
      byUser.set(item.userId, list);
    }
    const failedPersons = new Set<string>();
    const unmarkedPersons = new Set<string>();
    for (const [userId, items] of byUser) {
      try {
        const result = await runConferenceSocialMonitor({
          userId,
          contactIds: [...new Set(items.map((item) => item.contactId))],
        });
        monitorOk += 1;
        const failedPersonsForUser = new Set<string>();
        if (result.failed_conferences > 0) {
          for (const item of items) {
            failedPersons.add(item.personId);
            failedPersonsForUser.add(item.personId);
          }
        }
        const unmarked = await markContactSubscriberSweeps({
          items,
          statusForItem: (item) => failedPersonsForUser.has(item.personId) ? 'failed' : 'succeeded',
          onFailure: (failure) => {
            failures.push({ user_id: failure.user_id, error: failure.error });
            console.error('[cron/conference-social-delta] subscriber source mark failed:', failure);
          },
        });
        for (const personId of unmarked) unmarkedPersons.add(personId);
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
        for (const item of items) failedPersons.add(item.personId);
        const unmarked = await markContactSubscriberSweeps({
          items,
          statusForItem: () => 'failed',
          onFailure: (failure) => {
            failures.push({ user_id: failure.user_id, error: failure.error });
            console.error('[cron/conference-social-delta] subscriber source mark failed:', failure);
          },
        });
        for (const personId of unmarked) unmarkedPersons.add(personId);
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
    if (byUser.size === 0) monitorSkipped = targets.length;
    const subscriberPersonIds = new Set(subscribers.map((item) => item.personId));
    await Promise.all(targets.filter((target) => (
      subscriberPersonIds.has(target.personId) && !unmarkedPersons.has(target.personId)
    )).map((target) => markContactSourceSweep({
      personId: target.personId,
      source: 'conference_social',
      cadenceDays: target.cadenceDays,
      status: failedPersons.has(target.personId) ? 'failed' : 'succeeded',
      providerCostUsd: 0,
    })));
    const { count: overdue } = await admin.from('contact_source_sweep_targets')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'conference_social').eq('status', 'active').lte('next_sweep_at', new Date().toISOString());

    return NextResponse.json({
      success: true,
      sync: syncResult,
      targets_due: targets.length,
      subscribers_due: subscribers.length,
      overdue: overdue ?? 0,
      unmarked_targets: unmarkedPersons.size,
      refresh_monitoring_universe: monitoringRefresh,
      monitor: {
        users_total: byUser.size,
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
