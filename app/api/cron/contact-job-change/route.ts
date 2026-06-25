import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { runJobChangeMonitor } from '@/lib/signals/run-job-change-monitor';
import { markContactSubscriberSweeps } from '@/lib/signals/cron-sweep-marking';
import {
  contactSweepSubscribersForTargets,
  listDueContactSweepTargets,
  markContactSourceSweep,
} from '@/lib/billing/monitoring';
import { observeCron } from '@/lib/cron-observability';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CHUNK_SIZE = 100;

async function runCron(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const dispatcherLimit = Math.max(1, Number(process.env.CONTACT_MONITOR_DISPATCH_LIMIT ?? '1500'));
  let processed = 0;
  let failed = 0;
  const failures: Array<{ org_id?: string; user_id?: string; contact_ids?: string[]; error: string }> = [];

  const targets = await listDueContactSweepTargets({ source: 'job_change', limit: dispatcherLimit });
  const subscribers = await contactSweepSubscribersForTargets({
    personIds: targets.map((target) => target.personId),
    runner: 'job_change',
  });
  const byUser = new Map<string, typeof subscribers>();
  for (const item of subscribers) {
    const list = byUser.get(item.userId) ?? [];
    list.push(item);
    byUser.set(item.userId, list);
  }

  const failedPersons = new Set<string>();
  const unmarkedPersons = new Set<string>();
  const subscriberPersonIds = new Set(subscribers.map((item) => item.personId));
  for (const [userId, items] of byUser) {
    for (let index = 0; index < items.length; index += CHUNK_SIZE) {
      const chunk = items.slice(index, index + CHUNK_SIZE);
      const contactIds = chunk.map((item) => item.contactId);
      try {
        const result = await runJobChangeMonitor({
          userId,
          contactIds,
          limit: CHUNK_SIZE,
        });
        const failedIds = new Set(result.failures.map((item) => item.contact_id));
        const unmarked = await markContactSubscriberSweeps({
          items: chunk,
          statusForItem: (item) => failedIds.has(item.contactId) ? 'failed' : 'succeeded',
          providerCostUsdForItem: () => 0.004,
          onFailure: (failure) => {
            failures.push({ user_id: failure.user_id, contact_ids: [failure.contact_id], error: failure.error });
            console.error('[cron/contact-job-change] subscriber source mark failed:', failure);
          },
        });
        for (const personId of unmarked) unmarkedPersons.add(personId);
        for (const item of chunk) {
          const didFail = failedIds.has(item.contactId);
          if (didFail || unmarked.has(item.personId)) {
            failedPersons.add(item.personId);
            failed += 1;
          } else {
            processed += 1;
          }
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        failures.push({ user_id: userId, contact_ids: contactIds, error: message });
        console.error(`[cron/contact-job-change] monitor failed for user ${userId}:`, caught);
        for (const item of chunk) failedPersons.add(item.personId);
        const unmarked = await markContactSubscriberSweeps({
          items: chunk,
          statusForItem: () => 'failed',
          onFailure: (failure) => {
            failures.push({ user_id: failure.user_id, contact_ids: [failure.contact_id], error: failure.error });
            console.error('[cron/contact-job-change] subscriber source mark failed:', failure);
          },
        });
        for (const personId of unmarked) unmarkedPersons.add(personId);
        failed += chunk.length;
      }
    }
  }
  await Promise.all(targets.filter((target) => (
    subscriberPersonIds.has(target.personId) && !unmarkedPersons.has(target.personId)
  )).map((target) => markContactSourceSweep({
    personId: target.personId,
    source: 'job_change',
    cadenceDays: target.cadenceDays,
    status: failedPersons.has(target.personId) ? 'failed' : 'succeeded',
    providerCostUsd: 0.004,
  })));

  const { count: overdue } = await admin.from('contact_source_sweep_targets')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'job_change').eq('status', 'active').lte('next_sweep_at', new Date().toISOString());
  return NextResponse.json({
    success: true,
    processed,
    failed,
    targets_due: targets.length,
    subscribers_due: subscribers.length,
    overdue: overdue ?? 0,
    dispatcherLimit,
    unmarked_targets: unmarkedPersons.size,
    failures,
  });
}

export const GET = observeCron('contact-job-change', runCron);
