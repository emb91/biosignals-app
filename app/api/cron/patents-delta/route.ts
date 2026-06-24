/**
 * Weekly patent-events delta sync + per-user monitor — Vercel cron entrypoint.
 *
 * Step 1: pull a week of new patent publications from BigQuery into the local
 *         patent_events mirror.
 * Step 2: walk every user with non-archived companies and run runPatentsMonitor
 *         against the fresh mirror, so signals land in their feeds without
 *         them having to press the admin test button.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { persistRunHistory } from '@/lib/signals/run-history';
import { runPatentsMonitor } from '@/lib/signals/run-patents-monitor';
import { syncPatentsDelta } from '@/lib/signals/sync-patents-delta';
import { observeCron } from '@/lib/cron-observability';
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

function positiveNumberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeNumberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function runCron(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const admin = createAdminClient();
    const dispatcherLimit = Math.max(1, Number(process.env.PATENTS_MONITOR_DISPATCH_LIMIT ?? '2500'));
    const syncReuseSeconds = nonNegativeNumberFromEnv('PATENTS_SYNC_REUSE_SECONDS', 7 * 24 * 60 * 60);
    const maxScanGb = positiveNumberFromEnv('PATENTS_BIGQUERY_MAX_SCAN_GB', 250);
    const targets = await listDueAccountSweepTargets({ source: 'patents', limit: dispatcherLimit });
    const subscribers = await accountSweepSubscribersForTargets({
      companyIds: targets.map((target) => target.companyId),
      runner: 'patents',
    });

    // Acquisition gate: the BigQuery scrape is a real shared cost, and the
    // source target table is already reconciled to the fastest subscriber
    // cadence for each canonical company.
    const syncResult = subscribers.length > 0
      ? await syncPatentsDelta({
        admin,
        reuseRecentSuccessSeconds: syncReuseSeconds,
        maxScanBytes: maxScanGb * 1e9,
      })
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
        const result = await runPatentsMonitor({
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
          signalKey: 'patents_all',
          runner: 'patents',
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
        console.error(`[cron/patents-delta] monitor failed for user ${userId}:`, error);
        await persistRunHistory(admin, {
          userId,
          signalKey: 'patents_all',
          runner: 'patents',
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
      source: 'patents',
      cadenceDays: target.cadenceDays,
      status: failedCompanies.has(target.companyId) ? 'failed' : 'succeeded',
      resultCount: resultCountsByCompany.get(target.companyId) ?? 0,
      providerCostUsd: 0,
    })));
    const { count: overdue } = await admin.from('account_source_sweep_targets')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'patents').eq('status', 'active').lte('next_sweep_at', new Date().toISOString());

    return NextResponse.json({
      success: true,
      sync: syncResult,
      targets_due: targets.length,
      subscribers_due: subscribers.length,
      overdue: overdue ?? 0,
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

export const GET = observeCron('patents-delta', runCron);
