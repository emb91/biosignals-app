import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { runFdaRegulatoryMonitor } from '@/lib/signals/run-fda-regulatory-monitor';
import { syncFdaDelta, type SyncFdaDeltaResult } from '@/lib/signals/sync-fda-delta';
import type { SignalKey } from '@/lib/signals/readiness-types';
import { listActiveCompanyStateForUser } from '@/lib/org-company-state';

type RunFdaRegulatoryBody = {
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
  result: SyncFdaDeltaResult | null;
  error: string | null;
};

type PersistRunHistoryInput = {
  userId: string;
  signalKey: string;
  runner: 'fda_regulatory';
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

const FDA_ONLY_KEYS = new Set<SignalKey>([
  'fda_approval',
  'breakthrough_designation',
  'fast_track_designation',
  'priority_review',
  'orphan_designation',
  'complete_response_letter',
  'indication_expansion',
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
    console.error('[signals/run/fda-regulatory] persist run history failed:', error);
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

    const body = (await request.json().catch(() => ({}))) as RunFdaRegulatoryBody;
    const runAll = body.run_all === true;
    const batchSize = Math.min(500, Math.max(1, Number(body.batch_size) || 200));
    const onlySignalKey = typeof body.only_signal_key === 'string' ? (body.only_signal_key as SignalKey) : undefined;
    const requestedCompanyIds = Array.isArray(body.company_ids)
      ? body.company_ids.filter((value): value is string => typeof value === 'string' && Boolean(value))
      : [];

    // Optional: pull fresh FDA data from OpenFDA into local mirror before
    // running monitor. Same sync_first pattern as patents — used by admin
    // button so manual testing doesn't have to wait for the weekly cron.
    const syncSummary: SyncSummary = { ran: false, ok: false, result: null, error: null };
    if (body.sync_first === true) {
      syncSummary.ran = true;
      try {
        syncSummary.result = await syncFdaDelta({ admin: createAdminClient() });
        syncSummary.ok = true;
      } catch (error) {
        syncSummary.ok = false;
        syncSummary.error = messageFromUnknown(error);
        console.error('[signals/run/fda-regulatory] sync_first failed (continuing with stale data):', error);
      }
    }

    let result: Awaited<ReturnType<typeof runFdaRegulatoryMonitor>>;
    let executedCompanyIds: string[] = requestedCompanyIds;
    if (runAll && requestedCompanyIds.length === 0) {
      const companyRows = await listActiveCompanyStateForUser(authClient, user.id, 'company_id');
      const ids = companyRows.map((row) => row.company_id).sort();
      const allIds =
        typeof body.limit === 'number' && Number.isFinite(body.limit)
          ? ids.slice(0, Math.max(1, body.limit))
          : ids;
      executedCompanyIds = allIds;

      let totalProcessed = 0;
      let totalFailed = 0;
      const emittedSignalTypes = new Set<string>();
      const recomputedCompanies = new Set<string>();
      const failures: Array<{ company_id: string; error: string }> = [];

      for (let i = 0; i < allIds.length; i += batchSize) {
        const chunk = allIds.slice(i, i + batchSize);
        const chunkResult = await runFdaRegulatoryMonitor({
          userId: user.id,
          companyIds: chunk,
          onlySignalKey: onlySignalKey && FDA_ONLY_KEYS.has(onlySignalKey) ? onlySignalKey : undefined,
        });
        totalProcessed += chunkResult.processed;
        totalFailed += chunkResult.failed;
        for (const signalType of chunkResult.emitted_signal_types) emittedSignalTypes.add(signalType);
        for (const companyId of chunkResult.recomputed_companies) recomputedCompanies.add(companyId);
        failures.push(...chunkResult.failures);
      }

      result = {
        processed: totalProcessed,
        failed: totalFailed,
        emitted_signal_types: [...emittedSignalTypes],
        recomputed_companies: [...recomputedCompanies],
        failures,
      };
    } else {
      result = await runFdaRegulatoryMonitor({
        userId: user.id,
        companyIds: requestedCompanyIds,
        limit: body.limit,
        onlySignalKey: onlySignalKey && FDA_ONLY_KEYS.has(onlySignalKey) ? onlySignalKey : undefined,
      });
    }

    await persistRunHistory(authClient, {
      userId: user.id,
      signalKey: onlySignalKey && FDA_ONLY_KEYS.has(onlySignalKey) ? onlySignalKey : 'fda_regulatory_all',
      runner: 'fda_regulatory',
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
        fda_regulatory_processed: result.processed,
        processed: result.processed,
        failed: result.failed,
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
    console.error('[signals/run/fda-regulatory] error:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
