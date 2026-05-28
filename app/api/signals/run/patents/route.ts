import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { runPatentsMonitor } from '@/lib/signals/run-patents-monitor';
import { syncPatentsDelta, type SyncPatentsDeltaResult } from '@/lib/signals/sync-patents-delta';
import type { SignalKey } from '@/lib/signals/readiness-types';

type RunPatentsBody = {
  company_ids?: string[];
  limit?: number;
  only_signal_key?: string;
  run_all?: boolean;
  batch_size?: number;
  sync_first?: boolean;
};

type SyncSummary = {
  ran: boolean;
  ok: boolean;
  result: SyncPatentsDeltaResult | null;
  error: string | null;
};

type PersistRunHistoryInput = {
  userId: string;
  signalKey: string;
  runner: 'patents';
  scope: 'company';
  status: 'success' | 'failed';
  processed?: number;
  failed?: number;
  emittedSignalTypes?: string[];
  recomputedCompanies?: string[];
  failures?: Array<Record<string, unknown>>;
  companyIds?: string[];
  limitValue?: number;
};

const PATENT_ONLY_KEYS = new Set<SignalKey>([
  'patent_filed_or_granted',
  'patent_application_published',
  'patent_granted',
  'new_therapeutic_area_patent',
  'assignee_portfolio_acceleration',
]);

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (typeof obj.details === 'string' && obj.details) return obj.details;
  }
  return 'Internal server error';
}

async function persistRunHistory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: PersistRunHistoryInput,
): Promise<void> {
  const { error } = await supabase.from('signals_run_history').insert({
    user_id: input.userId,
    signal_key: input.signalKey,
    runner: input.runner,
    scope: input.scope,
    status: input.status,
    processed: input.processed ?? null,
    failed: input.failed ?? null,
    emitted_signal_types: input.emittedSignalTypes ?? [],
    recomputed_companies: input.recomputedCompanies ?? [],
    failures: input.failures ?? [],
    company_ids: input.companyIds ?? [],
    contact_ids: [],
    limit_value: input.limitValue ?? null,
  });
  if (error) {
    console.error('[signals/run/patents] persist run history failed:', error);
  }
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

    const body = (await request.json().catch(() => ({}))) as RunPatentsBody;
    const runAll = body.run_all === true;
    const batchSize = Math.min(500, Math.max(1, Number(body.batch_size) || 500));
    const onlySignalKey = typeof body.only_signal_key === 'string' ? (body.only_signal_key as SignalKey) : undefined;
    const requestedCompanyIds = Array.isArray(body.company_ids)
      ? body.company_ids.filter((value): value is string => typeof value === 'string' && Boolean(value))
      : [];

    // Optional: pull fresh patents from BigQuery into the local mirror before
    // matching. Used by the admin "patents-all" button so manual testing
    // doesn't have to wait for tomorrow's cron. Failure to sync is logged but
    // doesn't abort the run — monitor still emits signals from whatever's in
    // the local table.
    const syncSummary: SyncSummary = { ran: false, ok: false, result: null, error: null };
    if (body.sync_first === true) {
      syncSummary.ran = true;
      try {
        syncSummary.result = await syncPatentsDelta({ admin: createAdminClient() });
        syncSummary.ok = true;
      } catch (error) {
        syncSummary.ok = false;
        syncSummary.error = messageFromUnknown(error);
        console.error('[signals/run/patents] sync_first failed (continuing with stale data):', error);
      }
    }

    let result: Awaited<ReturnType<typeof runPatentsMonitor>>;
    let executedCompanyIds: string[] = requestedCompanyIds;
    if (runAll && requestedCompanyIds.length === 0) {
      const companyQuery = authClient
        .from('user_companies')
        .select('company_id')
        .eq('user_id', user.id)
        .is('archived_at', null)
        .order('company_id', { ascending: true });
      if (typeof body.limit === 'number' && Number.isFinite(body.limit)) {
        companyQuery.limit(Math.max(1, body.limit));
      }
      const { data: allCompanies, error: allCompaniesError } = await companyQuery;
      if (allCompaniesError) throw new Error(allCompaniesError.message);
      const allIds = (allCompanies ?? [])
        .map((row: { company_id?: unknown }) => (typeof row.company_id === 'string' ? row.company_id : null))
        .filter((value): value is string => Boolean(value));
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
          const chunkResult = await runPatentsMonitor({
            userId: user.id,
            companyIds: chunk,
            onlySignalKey: onlySignalKey && PATENT_ONLY_KEYS.has(onlySignalKey) ? onlySignalKey : undefined,
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
          failures.push(
            ...chunk.map((companyId) => ({ company_id: companyId, error: message })),
          );
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
      result = await runPatentsMonitor({
        userId: user.id,
        companyIds: requestedCompanyIds,
        limit: body.limit,
        onlySignalKey: onlySignalKey && PATENT_ONLY_KEYS.has(onlySignalKey) ? onlySignalKey : undefined,
      });
    }

    await persistRunHistory(authClient, {
      userId: user.id,
      signalKey: onlySignalKey && PATENT_ONLY_KEYS.has(onlySignalKey) ? onlySignalKey : 'patents_all',
      runner: 'patents',
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
      limitValue: typeof body.limit === 'number' && Number.isFinite(body.limit) ? body.limit : undefined,
    });

    return NextResponse.json({
      success: true,
      run_all: runAll,
      batch_size: runAll ? batchSize : null,
      sync: syncSummary,
      result: {
        patents_processed: result.processed,
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
    console.error('[signals/run/patents] error:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
