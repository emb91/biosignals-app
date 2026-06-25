/**
 * Conference presenter delta sync + per-user presenter monitor — Vercel cron.
 *
 * Step 1: refresh conference_appearances_local from each active conference's
 *         agenda adapter (syncPresentersDelta), resolving speakers to canonical
 *         person + company once.
 * Step 2: walk every active user and, when their plan cadence is due
 *         (monitorDueForUser, runner 'conference-presenters'), run the
 *         contact-scoped runPresenterMonitor against the mirror.
 *
 * Mirrors app/api/cron/conference-delta/route.ts. Per-user failures isolated.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { observeCron } from '@/lib/cron-observability';
import { persistRunHistory } from '@/lib/signals/run-history';
import { runPresenterMonitor } from '@/lib/signals/conference/presenters/run-presenter-monitor';
import { syncPresentersDelta } from '@/lib/signals/conference/presenters/sync-presenters-delta';
import {
  contactSweepSubscribersForTargets,
  listDueContactSweepTargets,
  markContactSubscriberSourceSweep,
  markContactSourceSweep,
  refreshAllMonitoringUniverses,
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
    const admin = createAdminClient();
    const dispatcherLimit = Math.max(1, Number(process.env.CONFERENCE_PRESENTERS_MONITOR_DISPATCH_LIMIT ?? '2500'));
    const refreshFailures = await refreshAllMonitoringUniverses();
    const targets = await listDueContactSweepTargets({ source: 'conference_presenters', limit: dispatcherLimit });
    const subscribers = await contactSweepSubscribersForTargets({
      personIds: targets.map((target) => target.personId),
      runner: 'conference-presenters',
    });
    const syncResult = subscribers.length > 0
      ? await syncPresentersDelta({ admin })
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
    for (const [userId, items] of byUser) {
      try {
        const result = await runPresenterMonitor({
          userId,
          contactIds: [...new Set(items.map((item) => item.contactId))],
        });
        monitorOk += 1;
        if (result.failed_conferences > 0) {
          for (const item of items) failedPersons.add(item.personId);
        }
        await persistRunHistory(admin, {
          userId,
          signalKey: 'conference_presenters_all',
          runner: 'conference-presenters',
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
        for (const item of items) failedPersons.add(item.personId);
        failures.push({ user_id: userId, error: messageFromUnknown(error) });
        console.error(`[cron/conference-presenters-delta] monitor failed for user ${userId}:`, error);
        await persistRunHistory(admin, {
          userId,
          signalKey: 'conference_presenters_all',
          runner: 'conference-presenters',
          scope: 'contact',
          status: 'failed',
          failures: [{ error: messageFromUnknown(error) }],
          trigger: 'cron',
        });
      }
    }
    if (byUser.size === 0) monitorSkipped = targets.length;
    await Promise.all(subscribers.map((item) => markContactSubscriberSourceSweep({
      orgId: item.orgId,
      personId: item.personId,
      source: item.source,
      cadenceDays: item.cadenceDays,
      status: failedPersons.has(item.personId) ? 'failed' : 'succeeded',
      providerCostUsd: 0,
    })));
    const subscriberPersonIds = new Set(subscribers.map((item) => item.personId));
    await Promise.all(targets.filter((target) => subscriberPersonIds.has(target.personId)).map((target) => markContactSourceSweep({
      personId: target.personId,
      source: 'conference_presenters',
      cadenceDays: target.cadenceDays,
      status: failedPersons.has(target.personId) ? 'failed' : 'succeeded',
      providerCostUsd: 0,
    })));
    const { count: overdue } = await admin.from('contact_source_sweep_targets')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'conference_presenters').eq('status', 'active').lte('next_sweep_at', new Date().toISOString());

    return NextResponse.json({
      success: true,
      sync: syncResult,
      targets_due: targets.length,
      subscribers_due: subscribers.length,
      overdue: overdue ?? 0,
      refresh_failures: refreshFailures,
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

export const GET = observeCron('conference-presenters-delta', runCron);
