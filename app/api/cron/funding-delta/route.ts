/**
 * Daily SEC filings delta sync + per-user funding monitor — Vercel cron entrypoint.
 *
 * Step 1: pull Form D / 8-K / 424B filings from EDGAR's daily-index files for
 *         the last N days into the local sec_filings_local mirror.
 * Step 2: walk every user with non-archived companies and run runFundingMonitor
 *         against the fresh mirror so signals land in their feeds without
 *         them having to press the admin test button.
 *
 * Halts gracefully on SEC rate-limit errors (logged via sec_delta_sync_runs).
 * Per-user monitor failures are isolated — one user's failure doesn't block
 * the others.
 */
import { NextResponse } from 'next/server';
import { observeCron } from '@/lib/cron-observability';
import { createAdminClient } from '@/lib/supabase-admin';
import { ensureTrackedCompanyCiks } from '@/lib/signals/company-cik';
import { persistRunHistory } from '@/lib/signals/run-history';
import { runFundingMonitor } from '@/lib/signals/run-funding-monitor';
import { syncSecDelta } from '@/lib/signals/sync-sec-delta';
import {
  accountSweepSubscribersForTargets,
  listDueAccountSweepTargets,
  markAccountSourceSweep,
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
    const { searchParams } = new URL(request.url);
    const overlapDaysRaw = searchParams.get('overlapDays');
    const overlapDays = overlapDaysRaw ? Math.max(1, Math.trunc(Number(overlapDaysRaw) || 2)) : 2;
    const admin = createAdminClient();
    const dispatcherLimit = Math.max(1, Number(process.env.FUNDING_MONITOR_DISPATCH_LIMIT ?? '2500'));
    const refreshFailures = await refreshAllMonitoringUniverses();
    const targets = await listDueAccountSweepTargets({ source: 'funding', limit: dispatcherLimit });
    const subscribers = await accountSweepSubscribersForTargets({
      companyIds: targets.map((target) => target.companyId),
      runner: 'funding',
    });
    const cikPriming = subscribers.length > 0
      ? await ensureTrackedCompanyCiks(admin)
      : { skipped: true as const, reason: 'cadence', targets_due: targets.length, subscribers_due: 0 };
    const syncResult = subscribers.length > 0
      ? await syncSecDelta({ admin, overlapDays })
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
    const failedCompanies = new Set<string>();
    const resultCountsByCompany = new Map<string, number>();
    for (const [userId, items] of byUser) {
      try {
        const lookbackDays = Math.max(1, ...items.map((item) => item.lookbackDays));
        const result = await runFundingMonitor({
          userId,
          companyIds: [...new Set(items.map((item) => item.companyId))],
          lookbackDays,
        });
        monitorOk += 1;
        for (const failure of result.failures) failedCompanies.add(failure.company_id);
        for (const companyId of new Set(items.map((item) => item.companyId))) {
          resultCountsByCompany.set(companyId, result.processed);
        }
        await persistRunHistory(admin, {
          userId,
          signalKey: 'funding_all',
          runner: 'funding',
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
        failures.push({ user_id: userId, error: messageFromUnknown(error) });
        console.error(`[cron/funding-delta] monitor failed for user ${userId}:`, error);
        await persistRunHistory(admin, {
          userId,
          signalKey: 'funding_all',
          runner: 'funding',
          scope: 'company',
          status: 'failed',
          failures: [{ error: messageFromUnknown(error) }],
          trigger: 'cron',
        });
      }
    }
    if (byUser.size === 0) monitorSkipped = targets.length;
    const subscriberCompanyIds = new Set(subscribers.map((item) => item.companyId));
    await Promise.all(targets.filter((target) => subscriberCompanyIds.has(target.companyId)).map((target) => markAccountSourceSweep({
      companyId: target.companyId,
      source: 'funding',
      cadenceDays: target.cadenceDays,
      status: failedCompanies.has(target.companyId) ? 'failed' : 'succeeded',
      resultCount: resultCountsByCompany.get(target.companyId) ?? 0,
      providerCostUsd: 0,
    })));
    const { count: overdue } = await admin.from('account_source_sweep_targets')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'funding').eq('status', 'active').lte('next_sweep_at', new Date().toISOString());

    return NextResponse.json({
      success: true,
      overlap_days: overlapDays,
      cik_priming: cikPriming,
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

export const GET = observeCron('funding-delta', runCron);
