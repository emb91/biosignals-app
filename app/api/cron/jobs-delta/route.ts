import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { runHiringMonitor } from '@/lib/signals/run-hiring-monitor';
import {
  markAccountSweep,
  monitoringRepresentativeAccounts,
  refreshMonitoringUniverse,
} from '@/lib/billing/monitoring';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: orgRows, error } = await admin.from('organizations').select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const dispatcherLimit = Math.max(1, Number(process.env.ACCOUNT_MONITOR_DISPATCH_LIMIT ?? '2500'));
  let remaining = dispatcherLimit;
  let processed = 0;
  let failed = 0;
  const failures: Array<{ org_id: string; error: string }> = [];

  for (const org of orgRows ?? []) {
    if (remaining <= 0) break;
    const orgId = org.id as string;
    try {
      await refreshMonitoringUniverse(orgId);
      const due = await monitoringRepresentativeAccounts(orgId, remaining);
      remaining -= due.length;
      const byUser = new Map<string, typeof due>();
      for (const item of due) {
        const list = byUser.get(item.userId) ?? [];
        list.push(item);
        byUser.set(item.userId, list);
      }
      for (const [userId, items] of byUser) {
        const result = await runHiringMonitor({
          userId,
          companyIds: items.map((item) => item.companyId),
        });
        const failedIds = new Set(result.failures.map((item) => item.company_id));
        const resultCounts = new Map(result.details.map((item) => [item.company_id, item.postings_scraped]));
        await Promise.all(items.map(async (item) => {
          const didFail = failedIds.has(item.companyId);
          const resultCount = resultCounts.get(item.companyId) ?? 0;
          await markAccountSweep({
            monitorId: item.monitorId,
            cadenceDays: item.cadenceDays,
            status: didFail ? 'failed' : 'succeeded',
            resultCount,
            providerCostUsd: resultCount * 0.001,
          });
          if (didFail) failed += 1;
          else processed += 1;
        }));
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      failures.push({ org_id: orgId, error: message });
      console.error(`[cron/jobs-delta] org ${orgId} failed:`, caught);
    }
  }

  const { count: overdue } = await admin.from('org_monitored_accounts')
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
