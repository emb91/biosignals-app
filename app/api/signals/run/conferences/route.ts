import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { persistRunHistory } from '@/lib/signals/run-history';
import { runConferencesMonitor } from '@/lib/signals/run-conferences-monitor';
import type { SignalKey } from '@/lib/signals/readiness-types';

type RunConferencesBody = {
  company_ids?: string[];
  limit?: number;
  only_signal_key?: string;
  run_all?: boolean;
  batch_size?: number;
  force_refresh?: boolean;
};

const CONFERENCES_ONLY_KEYS = new Set<SignalKey>(['conference_presentation', 'conference_speaker']);

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
  const query = authClient
    .from('user_companies')
    .select('company_id')
    .eq('user_id', userId)
    .is('archived_at', null);
  if (typeof limitValue === 'number') {
    query.limit(Math.max(1, limitValue));
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const ids = new Set<string>();
  for (const row of (data ?? []) as Array<{ company_id?: unknown }>) {
    if (typeof row.company_id === 'string' && row.company_id) ids.add(row.company_id);
  }
  return [...ids];
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

    const body = (await request.json().catch(() => ({}))) as RunConferencesBody;
    const runAll = body.run_all === true;
    const batchSize = Math.min(500, Math.max(1, Number(body.batch_size) || 50));
    const onlySignalKey = typeof body.only_signal_key === 'string' ? (body.only_signal_key as SignalKey) : undefined;
    const requestedCompanyIds = Array.isArray(body.company_ids)
      ? body.company_ids.filter((value): value is string => typeof value === 'string' && Boolean(value))
      : [];
    const limitValue = typeof body.limit === 'number' && Number.isFinite(body.limit) ? body.limit : undefined;
    const forceRefresh = body.force_refresh === true;

    let result: Awaited<ReturnType<typeof runConferencesMonitor>>;
    let executedCompanyIds: string[] = requestedCompanyIds;

    if (runAll && requestedCompanyIds.length === 0) {
      const allIds = await loadUserCompanyIds(authClient, user.id, limitValue);
      executedCompanyIds = allIds;

      let totalProcessed = 0;
      let totalFailed = 0;
      let totalRecordsScanned = 0;
      let totalCandidateEventsMatched = 0;
      let totalSkippedAsDuplicates = 0;
      let totalLlmCalls = 0;
      const emittedSignalTypes = new Set<string>();
      const recomputedCompanies = new Set<string>();
      const failures: Array<{ company_id: string; error: string }> = [];

      for (let i = 0; i < allIds.length; i += batchSize) {
        const chunk = allIds.slice(i, i + batchSize);
        try {
          const chunkResult = await runConferencesMonitor({
            userId: user.id,
            companyIds: chunk,
            onlySignalKey: onlySignalKey && CONFERENCES_ONLY_KEYS.has(onlySignalKey) ? onlySignalKey : undefined,
            forceRefresh,
          });
          totalProcessed += chunkResult.processed;
          totalFailed += chunkResult.failed;
          totalRecordsScanned += chunkResult.records_scanned;
          totalCandidateEventsMatched += chunkResult.candidate_events_matched_before_dedupe;
          totalSkippedAsDuplicates += chunkResult.events_skipped_as_duplicates;
          totalLlmCalls += chunkResult.llm_calls;
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
        llm_calls: totalLlmCalls,
        emitted_signal_types: [...emittedSignalTypes],
        recomputed_companies: [...recomputedCompanies],
        failures,
      };
    } else {
      result = await runConferencesMonitor({
        userId: user.id,
        companyIds: requestedCompanyIds,
        limit: body.limit,
        onlySignalKey: onlySignalKey && CONFERENCES_ONLY_KEYS.has(onlySignalKey) ? onlySignalKey : undefined,
        forceRefresh,
      });
    }

    await persistRunHistory(createAdminClient(), {
      userId: user.id,
      signalKey: onlySignalKey && CONFERENCES_ONLY_KEYS.has(onlySignalKey) ? onlySignalKey : 'conferences_all',
      runner: 'conferences',
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
      force_refresh: forceRefresh,
      result: {
        processed: result.processed,
        failed: result.failed,
        records_scanned: result.records_scanned,
        candidate_events_matched_before_dedupe: result.candidate_events_matched_before_dedupe,
        events_skipped_as_duplicates: result.events_skipped_as_duplicates,
        llm_calls: result.llm_calls,
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
    console.error('[signals/run/conferences] error:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
