import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { ensureTrackedCompanyCiks } from '@/lib/signals/company-cik';
import { persistRunHistory } from '@/lib/signals/run-history';
import { runFundingMonitor } from '@/lib/signals/run-funding-monitor';
import { syncSecDelta, type SyncSecDeltaResult } from '@/lib/signals/sync-sec-delta';
import type { SignalKey } from '@/lib/signals/readiness-types';
import { listActiveCompanyStateForUser } from '@/lib/org-company-state';

type RunFundingBody = {
  company_ids?: string[];
  limit?: number;
  only_signal_key?: string;
  run_all?: boolean;
  batch_size?: number;
  sync_first?: boolean;
  sync_overlap_days?: number;
};

type SyncSummary = {
  ran: boolean;
  ok: boolean;
  cik_priming_processed: number;
  cik_priming_failed: number;
  result: SyncSecDeltaResult | null;
  error: string | null;
};

const FUNDING_ONLY_KEYS = new Set<SignalKey>(['funding_round', 'ipo_or_follow_on']);

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (typeof obj.details === 'string' && obj.details) return obj.details;
  }
  return 'Internal server error';
}

async function loadUserCompanyIds(
  authClient: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  limitValue?: number,
): Promise<string[]> {
  const rows = await listActiveCompanyStateForUser(authClient, userId, 'company_id');
  const ids = [...new Set(rows.map((row) => row.company_id))];
  return typeof limitValue === 'number' ? ids.slice(0, Math.max(1, limitValue)) : ids;
}

export async function POST(request: Request) {
  try {
    const authClient = await createClient();
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as RunFundingBody;
    const runAll = body.run_all === true;
    const batchSize = Math.min(500, Math.max(1, Number(body.batch_size) || 200));
    const onlySignalKey = typeof body.only_signal_key === 'string' ? (body.only_signal_key as SignalKey) : undefined;
    const requestedCompanyIds = Array.isArray(body.company_ids)
      ? body.company_ids.filter((value): value is string => typeof value === 'string' && Boolean(value))
      : [];
    const limitValue = typeof body.limit === 'number' && Number.isFinite(body.limit) ? body.limit : undefined;
    const syncOverlapDays =
      typeof body.sync_overlap_days === 'number' && Number.isFinite(body.sync_overlap_days)
        ? Math.max(1, Math.trunc(body.sync_overlap_days))
        : 90;

    const syncSummary: SyncSummary = {
      ran: false,
      ok: false,
      cik_priming_processed: 0,
      cik_priming_failed: 0,
      result: null,
      error: null,
    };

    if (body.sync_first === true) {
      syncSummary.ran = true;
      try {
        const admin = createAdminClient();
        const cikPriming = await ensureTrackedCompanyCiks(admin);
        syncSummary.cik_priming_processed = cikPriming.processed;
        syncSummary.cik_priming_failed = cikPriming.failed;
        syncSummary.result = await syncSecDelta({ admin, overlapDays: syncOverlapDays });
        syncSummary.ok = true;
      } catch (error) {
        syncSummary.ok = false;
        syncSummary.error = messageFromUnknown(error);
        console.error('[signals/run/funding] sync_first failed (continuing with stale data):', error);
      }
    }

    let result: Awaited<ReturnType<typeof runFundingMonitor>>;
    let executedCompanyIds: string[] = requestedCompanyIds;

    if (runAll && requestedCompanyIds.length === 0) {
      const allIds = await loadUserCompanyIds(authClient, user.id, limitValue);
      executedCompanyIds = allIds;

      let totalProcessed = 0;
      let totalFailed = 0;
      let totalRecordsScanned = 0;
      let totalCandidateEventsMatched = 0;
      let totalSkippedAsDuplicates = 0;
      const emittedSignalTypes = new Set<string>();
      const recomputedCompanies = new Set<string>();
      const failures: Array<{ company_id: string; error: string }> = [];

      for (let i = 0; i < allIds.length; i += batchSize) {
        const chunk = allIds.slice(i, i + batchSize);
        try {
          const chunkResult = await runFundingMonitor({
            userId: user.id,
            companyIds: chunk,
            onlySignalKey: onlySignalKey && FUNDING_ONLY_KEYS.has(onlySignalKey) ? onlySignalKey : undefined,
          });
          totalProcessed += chunkResult.processed;
          totalFailed += chunkResult.failed;
          totalRecordsScanned += chunkResult.records_scanned;
          totalCandidateEventsMatched += chunkResult.candidate_events_matched_before_dedupe;
          totalSkippedAsDuplicates += chunkResult.events_skipped_as_duplicates;
          for (const signalType of chunkResult.emitted_signal_types) emittedSignalTypes.add(signalType);
          for (const companyId of chunkResult.recomputed_companies) recomputedCompanies.add(companyId);
          failures.push(...chunkResult.failures);
        } catch (error) {
          totalFailed += chunk.length;
          const message = error instanceof Error ? error.message : 'Chunk run failed';
          failures.push(...chunk.map((companyId) => ({ company_id: companyId, error: message })));
        }
      }

      result = {
        processed: totalProcessed,
        failed: totalFailed,
        records_scanned: totalRecordsScanned,
        candidate_events_matched_before_dedupe: totalCandidateEventsMatched,
        events_skipped_as_duplicates: totalSkippedAsDuplicates,
        emitted_signal_types: [...emittedSignalTypes],
        recomputed_companies: [...recomputedCompanies],
        failures,
      };
    } else {
      result = await runFundingMonitor({
        userId: user.id,
        companyIds: requestedCompanyIds,
        limit: body.limit,
        onlySignalKey: onlySignalKey && FUNDING_ONLY_KEYS.has(onlySignalKey) ? onlySignalKey : undefined,
      });
    }

    await persistRunHistory(createAdminClient(), {
      userId: user.id,
      signalKey: onlySignalKey && FUNDING_ONLY_KEYS.has(onlySignalKey) ? onlySignalKey : 'funding_all',
      runner: 'funding',
      scope: 'company',
      status: result.failed > 0 ? 'failed' : 'success',
      processed: result.processed,
      failed: result.failed,
      emittedSignalTypes: result.emitted_signal_types,
      recomputedCompanies: result.recomputed_companies,
      failures: result.failures.map((failure) => ({
        entity_type: 'company',
        entity_id: failure.company_id,
        error: failure.error,
      })),
      companyIds: executedCompanyIds,
      limitValue,
      trigger: 'button',
    });

    return NextResponse.json({
      success: true,
      run_all: runAll,
      batch_size: runAll ? batchSize : null,
      sync: syncSummary,
      result: {
        processed: result.processed,
        failed: result.failed,
        records_scanned: result.records_scanned,
        candidate_events_matched_before_dedupe: result.candidate_events_matched_before_dedupe,
        events_skipped_as_duplicates: result.events_skipped_as_duplicates,
        emitted_signal_types: result.emitted_signal_types,
        recomputed_companies: result.recomputed_companies,
        failures: result.failures.map((failure) => ({
          entity_type: 'company',
          entity_id: failure.company_id,
          error: failure.error,
        })),
      },
    });
  } catch (error) {
    console.error('[signals/run/funding] error:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
