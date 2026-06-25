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
import * as Sentry from '@sentry/nextjs';
import { observeCron } from '@/lib/cron-observability';
import { maybeRefreshMonitoringUniverses } from '@/lib/cron/monitoring-refresh';
import { createAdminClient } from '@/lib/supabase-admin';
import { ensureTrackedCompanyCiks } from '@/lib/signals/company-cik';
import { persistRunHistory } from '@/lib/signals/run-history';
import { runFundingMonitor } from '@/lib/signals/run-funding-monitor';
import { syncSecDelta, type SyncSecDeltaResult } from '@/lib/signals/sync-sec-delta';
import { markAccountSubscriberSweeps } from '@/lib/signals/cron-sweep-marking';
import {
  accountSweepSubscribersForTargets,
  listDueAccountSweepTargets,
  markAccountSourceSweep,
} from '@/lib/billing/monitoring';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function nonNegFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type FundingSyncOutcome =
  | SyncSecDeltaResult
  | { skipped: true; reason: string; targets_due: number; subscribers_due: number; last_success_at?: string | null };

async function runCron(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const requestStartedAt = Date.now();
  try {
    const { searchParams } = new URL(request.url);
    const overlapDaysRaw = searchParams.get('overlapDays');
    const overlapDays = overlapDaysRaw ? Math.max(1, Math.trunc(Number(overlapDaysRaw) || 2)) : 2;
    const admin = createAdminClient();
    const dispatcherLimit = Math.max(1, Number(process.env.FUNDING_MONITOR_DISPATCH_LIMIT ?? '2500'));
    const monitoringRefresh = await maybeRefreshMonitoringUniverses({
      searchParams,
      envName: 'FUNDING_REFRESH_MONITORING_UNIVERSE',
    });
    const targets = await listDueAccountSweepTargets({ source: 'funding', limit: dispatcherLimit });
    const subscribers = await accountSweepSubscribersForTargets({
      companyIds: targets.map((target) => target.companyId),
      runner: 'funding',
    });
    const cikPriming = subscribers.length > 0
      ? await ensureTrackedCompanyCiks(admin)
      : { skipped: true as const, reason: 'cadence', targets_due: targets.length, subscribers_due: 0 };

    // Decide the sync plan from the most recent run:
    //  - a prior partial / rate-limit-halted run leaves a resume_date → resume there;
    //  - a recent SUCCESS within the reuse window → skip the heavy pull (the
    //    per-user monitor still runs against the existing mirror);
    //  - otherwise pull the standard overlap window.
    // A soft deadline keeps each invocation under the serverless timeout.
    const reuseSeconds = nonNegFromEnv('FUNDING_SYNC_REUSE_SECONDS', 6 * 24 * 60 * 60);
    // Budget the sync against time ALREADY spent this request (refreshAll + CIK
    // priming) and reserve headroom for the per-user monitor that runs after it,
    // so the whole handler stays under the serverless function limit (300s).
    const requestBudgetMs = Math.max(60_000, Number(process.env.FUNDING_REQUEST_BUDGET_MS) || 270_000);
    const monitorReserveMs = Math.max(0, Number(process.env.FUNDING_MONITOR_RESERVE_MS) || 30_000);
    const hardCapMs = Number(process.env.FUNDING_SYNC_DEADLINE_MS) || Infinity;
    const softDeadlineMs = Math.max(
      30_000,
      Math.min(hardCapMs, requestBudgetMs - (Date.now() - requestStartedAt) - monitorReserveMs),
    );
    let syncResult: FundingSyncOutcome;
    if (subscribers.length === 0) {
      syncResult = { skipped: true, reason: 'cadence', targets_due: targets.length, subscribers_due: 0 };
    } else {
      const { data: lastRun } = await admin
        .from('sec_delta_sync_runs')
        .select('status, resume_date, finished_at')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ status: string; resume_date: string | null; finished_at: string | null }>();
      const resumeFrom = (lastRun?.status === 'partial' || lastRun?.status === 'halted_rate_limit')
        ? lastRun.resume_date
        : null;
      const recentSuccess = lastRun?.status === 'success' && lastRun.finished_at
        && Date.now() - new Date(lastRun.finished_at).getTime() < reuseSeconds * 1000;
      if (recentSuccess && !resumeFrom) {
        syncResult = {
          skipped: true,
          reason: 'reuse',
          targets_due: targets.length,
          subscribers_due: subscribers.length,
          last_success_at: lastRun?.finished_at ?? null,
        };
      } else {
        syncResult = resumeFrom
          ? await syncSecDelta({ admin, startDate: resumeFrom, endDate: todayIso(), softDeadlineMs })
          : await syncSecDelta({ admin, overlapDays, softDeadlineMs });
      }
    }

    // Surface a non-success live sync to Sentry. (observeCron only alerts on
    // HTTP/logical failures of the whole cron; a partial or failed sync still
    // returns success:true so the per-user monitor can run on prior data.)
    if ('status' in syncResult && syncResult.status !== 'success') {
      Sentry.captureMessage(`SEC funding sync ${syncResult.status}`, {
        level: syncResult.status === 'partial' ? 'warning' : 'error',
        tags: { job: 'funding-delta', sync_status: syncResult.status },
        extra: {
          resume_date: syncResult.resume_date,
          error: syncResult.error,
          days_processed: syncResult.days_processed,
          filings_upserted: syncResult.filings_upserted,
        },
      });
    }

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
    const unmarkedCompanies = new Set<string>();
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
        const failedIds = new Set(result.failures.map((item) => item.company_id));
        const unmarked = await markAccountSubscriberSweeps({
          items,
          statusForItem: (item) => failedIds.has(item.companyId) ? 'failed' : 'succeeded',
          resultCountForItem: (item) => resultCountsByCompany.get(item.companyId) ?? 0,
          onFailure: (failure) => {
            failures.push(failure);
            console.error('[cron/funding-delta] subscriber source mark failed:', failure);
          },
        });
        for (const companyId of unmarked) unmarkedCompanies.add(companyId);
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
        for (const item of items) failedCompanies.add(item.companyId);
        const unmarked = await markAccountSubscriberSweeps({
          items,
          statusForItem: () => 'failed',
          onFailure: (failure) => {
            failures.push(failure);
            console.error('[cron/funding-delta] subscriber source mark failed:', failure);
          },
        });
        for (const companyId of unmarked) unmarkedCompanies.add(companyId);
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
    await Promise.all(targets.filter((target) => (
      subscriberCompanyIds.has(target.companyId) && !unmarkedCompanies.has(target.companyId)
    )).map((target) => markAccountSourceSweep({
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
      unmarked_targets: unmarkedCompanies.size,
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

export const GET = observeCron('funding-delta', runCron);
