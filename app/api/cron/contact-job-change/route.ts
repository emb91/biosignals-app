import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import {
  runJobChangeMonitor,
  scrapeLinkedInProfiles,
  type JobChangeContactRecord,
} from '@/lib/signals/run-job-change-monitor';
import { maybeRefreshMonitoringUniverses } from '@/lib/cron/monitoring-refresh';
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
const CONTACT_READ_CHUNK_SIZE = 500;

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function runCron(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { searchParams } = new URL(request.url);
  const dispatcherLimit = Math.max(1, Number(process.env.CONTACT_MONITOR_DISPATCH_LIMIT ?? '1500'));
  let processed = 0;
  let failed = 0;
  const failures: Array<{ org_id?: string; user_id?: string; contact_ids?: string[]; error: string }> = [];
  const monitoringRefresh = await maybeRefreshMonitoringUniverses({
    searchParams,
    envName: 'CONTACT_JOB_CHANGE_REFRESH_MONITORING_UNIVERSE',
  });

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
  const subscriberContactIds = [...new Set(subscribers.map((item) => item.contactId))];
  const frozenContactRows: JobChangeContactRecord[] = [];
  for (const ids of chunked(subscriberContactIds, CONTACT_READ_CHUNK_SIZE)) {
    const { data, error } = await admin
      .from('contacts')
      .select(
        'id, user_id, person_id, company_id, full_name, linkedin_url, email, ' +
        'resolved_current_company_name, resolved_current_company_domain, ' +
        'resolved_current_job_title, seniority_level, business_area, profile_enrichment_status'
      )
      .in('id', ids)
      .is('archived_at', null);
    if (error) throw new Error(`[cron/contact-job-change] contact snapshot read failed: ${error.message}`);
    frozenContactRows.push(...((data ?? []) as unknown as JobChangeContactRecord[]));
  }
  const frozenContactById = new Map(frozenContactRows.map((row) => [row.id, row]));
  const hasLinkedInByPerson = new Map<string, boolean>();
  for (const item of subscribers) {
    const row = frozenContactById.get(item.contactId);
    hasLinkedInByPerson.set(item.personId, hasLinkedInByPerson.get(item.personId) === true || Boolean(row?.linkedin_url));
  }
  const profilesByLinkedInUrl = await scrapeLinkedInProfiles(frozenContactRows, {
    orgId: null,
    userId: null,
  });
  for (const [userId, items] of byUser) {
    for (let index = 0; index < items.length; index += CHUNK_SIZE) {
      const chunk = items.slice(index, index + CHUNK_SIZE);
      const contactIds = chunk.map((item) => item.contactId);
      const contactRows = chunk
        .map((item) => frozenContactById.get(item.contactId))
        .filter((row): row is JobChangeContactRecord => Boolean(row));
      const missingContactIds = new Set(
        chunk
          .filter((item) => !frozenContactById.has(item.contactId))
          .map((item) => item.contactId),
      );
      for (const contactId of missingContactIds) {
        failures.push({ user_id: userId, contact_ids: [contactId], error: 'contact snapshot missing' });
      }
      try {
        const result = await runJobChangeMonitor({
          userId,
          contactIds,
          contactRows,
          profilesByLinkedInUrl,
          limit: CHUNK_SIZE,
        });
        const failedIds = new Set([...missingContactIds, ...result.failures.map((item) => item.contact_id)]);
        const unmarked = await markContactSubscriberSweeps({
          items: chunk,
          statusForItem: (item) => failedIds.has(item.contactId) ? 'failed' : 'succeeded',
          providerCostUsdForItem: () => 0,
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
    providerCostUsd: hasLinkedInByPerson.get(target.personId) ? 0.004 : 0,
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
    refresh_monitoring_universe: monitoringRefresh,
    failures,
  });
}

export const GET = observeCron('contact-job-change', runCron);
