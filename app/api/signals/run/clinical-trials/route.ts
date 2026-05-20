import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { runClinicalTrialsMonitor } from '@/lib/signals/run-clinical-trials-monitor';
import type { SignalKey } from '@/lib/signals/readiness-types';

type RunClinicalTrialsBody = {
  company_ids?: string[];
  limit?: number;
  only_signal_key?: string;
  run_all?: boolean;
  batch_size?: number;
};

type PersistRunHistoryInput = {
  userId: string;
  signalKey: string;
  runner: 'clinical_trials';
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

const CLINICAL_ONLY_KEYS = new Set<SignalKey>([
  'clinical_trial_registered',
  'clinical_trial_recruiting',
  'clinical_trial_completed',
  'clinical_trial_sponsor_change',
  'phase_transition',
  'trial_site_expansion',
  'indication_expansion',
  'trial_failure_or_halt',
  'program_discontinuation',
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
    console.error('[signals/run/clinical-trials] persist run history failed:', error);
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

    const body = (await request.json().catch(() => ({}))) as RunClinicalTrialsBody;
    const runAll = body.run_all === true;
    const batchSize = Math.min(500, Math.max(1, Number(body.batch_size) || 200));
    const onlySignalKey = typeof body.only_signal_key === 'string' ? (body.only_signal_key as SignalKey) : undefined;
    const requestedCompanyIds = Array.isArray(body.company_ids)
      ? body.company_ids.filter((value): value is string => typeof value === 'string' && Boolean(value))
      : [];

    let result: Awaited<ReturnType<typeof runClinicalTrialsMonitor>>;
    let executedCompanyIds: string[] = requestedCompanyIds;
    if (runAll && requestedCompanyIds.length === 0) {
      const companyQuery = authClient
        .from('companies')
        .select('id')
        .eq('user_id', user.id)
        .is('archived_at', null)
        .order('id', { ascending: true });
      if (typeof body.limit === 'number' && Number.isFinite(body.limit)) {
        companyQuery.limit(Math.max(1, body.limit));
      }
      const { data: allCompanies, error: allCompaniesError } = await companyQuery;
      if (allCompaniesError) {
        throw new Error(allCompaniesError.message);
      }
      const allIds = (allCompanies ?? [])
        .map((row: { id?: unknown }) => (typeof row.id === 'string' ? row.id : null))
        .filter((value): value is string => Boolean(value));
      executedCompanyIds = allIds;

      let totalProcessed = 0;
      let totalFailed = 0;
      const emittedSignalTypes = new Set<string>();
      const recomputedCompanies = new Set<string>();
      const failures: Array<{ company_id: string; error: string }> = [];

      for (let i = 0; i < allIds.length; i += batchSize) {
        const chunk = allIds.slice(i, i + batchSize);
        const chunkResult = await runClinicalTrialsMonitor({
          userId: user.id,
          companyIds: chunk,
          onlySignalKey: onlySignalKey && CLINICAL_ONLY_KEYS.has(onlySignalKey) ? onlySignalKey : undefined,
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
      result = await runClinicalTrialsMonitor({
        userId: user.id,
        companyIds: requestedCompanyIds,
        limit: body.limit,
        onlySignalKey: onlySignalKey && CLINICAL_ONLY_KEYS.has(onlySignalKey) ? onlySignalKey : undefined,
      });
    }

    await persistRunHistory(authClient, {
      userId: user.id,
      signalKey: onlySignalKey && CLINICAL_ONLY_KEYS.has(onlySignalKey) ? onlySignalKey : 'clinical_trials_all',
      runner: 'clinical_trials',
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
      result: {
        clinical_trials_processed: result.processed,
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
    console.error('[signals/run/clinical-trials] error:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
