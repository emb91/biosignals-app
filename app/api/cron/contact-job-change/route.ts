import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { runJobChangeMonitor } from '@/lib/signals/run-job-change-monitor';
import {
  markContactSweep,
  monitoringRepresentativeContacts,
  refreshMonitoringUniverse,
} from '@/lib/billing/monitoring';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CHUNK_SIZE = 100;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: orgRows, error } = await admin.from('organizations').select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const dispatcherLimit = Math.max(1, Number(process.env.CONTACT_MONITOR_DISPATCH_LIMIT ?? '1500'));
  let remaining = dispatcherLimit;
  let processed = 0;
  let failed = 0;
  const failures: Array<{ org_id: string; error: string }> = [];

  for (const org of orgRows ?? []) {
    if (remaining <= 0) break;
    const orgId = org.id as string;
    try {
      await refreshMonitoringUniverse(orgId);
      const due = await monitoringRepresentativeContacts(orgId, remaining);
      remaining -= due.length;
      const byUser = new Map<string, typeof due>();
      for (const item of due) {
        const list = byUser.get(item.userId) ?? [];
        list.push(item);
        byUser.set(item.userId, list);
      }

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
            await markContactSweep({
              monitorId: item.monitorId,
              cadenceDays: item.cadenceDays,
              status: didFail ? 'failed' : 'succeeded',
              providerCostUsd: 0.004,
            });
            if (didFail) failed += 1;
            else processed += 1;
          }));
        }
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      failures.push({ org_id: orgId, error: message });
      console.error(`[cron/contact-job-change] org ${orgId} failed:`, caught);
    }
  }

  const { count: overdue } = await admin.from('org_monitored_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active').lte('next_sweep_at', new Date().toISOString());
  return NextResponse.json({
    success: true,
    processed,
    failed,
    overdue: overdue ?? 0,
    dispatcherLimit,
    failures,
  });
}
