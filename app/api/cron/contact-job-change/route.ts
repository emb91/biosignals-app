import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { runJobChangeMonitor } from '@/lib/signals/run-job-change-monitor';
import {
  contactSweepSubscribersForTargets,
  listDueContactSweepTargets,
  markContactSourceSweep,
  markContactSweep,
  refreshMonitoringUniverse,
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
  const { data: orgRows, error } = await admin.from('organizations').select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const dispatcherLimit = Math.max(1, Number(process.env.CONTACT_MONITOR_DISPATCH_LIMIT ?? '1500'));
  let processed = 0;
  let failed = 0;
  const failures: Array<{ org_id: string; error: string }> = [];

  for (const org of orgRows ?? []) {
    const orgId = org.id as string;
    try {
      await refreshMonitoringUniverse(orgId);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      failures.push({ org_id: orgId, error: message });
      console.error(`[cron/contact-job-change] org ${orgId} failed:`, caught);
    }
  }

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
  const subscriberPersonIds = new Set(subscribers.map((item) => item.personId));
  for (const [userId, items] of byUser) {
    for (let index = 0; index < items.length; index += CHUNK_SIZE) {
      const chunk = items.slice(index, index + CHUNK_SIZE);
      const result = await runJobChangeMonitor({
        userId,
        contactIds: chunk.map((item) => item.contactId),
        limit: CHUNK_SIZE,
      });
      const failedIds = new Set(result.failures.map((item) => item.contact_id));
      await Promise.all(chunk.map(async (item) => {
        const didFail = failedIds.has(item.contactId);
        if (didFail) failedPersons.add(item.personId);
        if (item.monitorId) {
          await markContactSweep({
            monitorId: item.monitorId,
            cadenceDays: item.cadenceDays,
            status: didFail ? 'failed' : 'succeeded',
            providerCostUsd: 0.004,
            markSharedTarget: false,
          });
        }
        if (didFail) failed += 1;
        else processed += 1;
      }));
    }
  }
  await Promise.all(targets.filter((target) => subscriberPersonIds.has(target.personId)).map((target) => markContactSourceSweep({
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
    failures,
  });
}

export const GET = observeCron('contact-job-change', runCron);
