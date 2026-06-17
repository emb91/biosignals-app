/**
 * Manual trigger for the hiring signal monitor.
 * POST /api/signals/run/hiring
 *
 * Body (all optional):
 *   company_ids      string[]  — scope to specific companies (default: all user's)
 *   limit            number    — max companies to process
 *   only_signal_key  string    — cmc_hiring | clinical_ops_hiring | regulatory_hiring | ...
 *   run_all          boolean   — process all companies in batches (ignores limit)
 *   batch_size       number    — chunk size when run_all=true (default 200)
 *
 * Scraping is done inline by runHiringMonitor — one ATS batch call per run.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { persistRunHistory } from '@/lib/signals/run-history';
import { runHiringMonitor } from '@/lib/signals/run-hiring-monitor';
import { isCompanySweepEligible } from '@/lib/signals/sweep-fit-gate';
import type { SignalKey } from '@/lib/signals/readiness-types';

type RunHiringBody = {
  company_ids?: string[];
  limit?: number;
  only_signal_key?: string;
  run_all?: boolean;
  batch_size?: number;
};

const HIRING_SIGNAL_KEYS = new Set<SignalKey>([
  'cmc_hiring',
  'clinical_ops_hiring',
  'regulatory_hiring',
  'research_hiring',
  'quality_hiring',
  'medical_hiring',
  'bd_hiring',
  'commercial_hiring',
  'data_informatics_hiring',
  'executive_hiring',
  'hiring_expansion',
]);

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const o = error as Record<string, unknown>;
    if (typeof o.message === 'string') return o.message;
  }
  return 'Internal server error';
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

    const body = (await request.json().catch(() => ({}))) as RunHiringBody;
    const runAll = body.run_all === true;
    const batchSize = Math.min(500, Math.max(1, Number(body.batch_size) || 200));
    const onlySignalKey =
      typeof body.only_signal_key === 'string' && HIRING_SIGNAL_KEYS.has(body.only_signal_key as SignalKey)
        ? (body.only_signal_key as SignalKey)
        : undefined;
    const requestedCompanyIds = Array.isArray(body.company_ids)
      ? body.company_ids.filter((v): v is string => typeof v === 'string' && Boolean(v))
      : [];
    const limitValue = typeof body.limit === 'number' && Number.isFinite(body.limit) ? body.limit : undefined;

    // Load all user company IDs if run_all
    let executedCompanyIds: string[] = requestedCompanyIds;
    let result: Awaited<ReturnType<typeof runHiringMonitor>>;

    if (runAll && requestedCompanyIds.length === 0) {
      const { data: linkRows } = await authClient
        .from('user_companies')
        .select('company_id, company_fit_score')
        .eq('user_id', user.id)
        .is('archived_at', null);
      // run_all still respects the routine-sweep fit gate — good-fit
      // companies only (guardrail #2). Targeting specific company_ids
      // (the else-branch) bypasses the gate for deliberate one-offs.
      const allIds = (linkRows ?? [])
        .map((r) => r as { company_id?: unknown; company_fit_score?: unknown })
        .filter((r): r is { company_id: string; company_fit_score: number | null } =>
          typeof r.company_id === 'string' && Boolean(r.company_id))
        .filter((r) => isCompanySweepEligible(r.company_fit_score))
        .map((r) => r.company_id);
      executedCompanyIds = allIds;

      let totalProcessed = 0, totalFailed = 0, totalScanned = 0;
      let totalCandidates = 0, totalDupes = 0;
      const emittedTypes = new Set<string>();
      const recomputedIds = new Set<string>();
      const failures: Array<{ company_id: string; error: string }> = [];
      const allDetails: Awaited<ReturnType<typeof runHiringMonitor>>['details'] = [];

      for (let i = 0; i < allIds.length; i += batchSize) {
        const chunk = allIds.slice(i, i + batchSize);
        try {
          const chunkResult = await runHiringMonitor({
            userId: user.id,
            companyIds: chunk,
            onlySignalKey,
          });
          totalProcessed += chunkResult.processed;
          totalFailed += chunkResult.failed;
          totalScanned += chunkResult.postings_scanned;
          totalCandidates += chunkResult.candidate_events_before_dedupe;
          totalDupes += chunkResult.events_skipped_as_duplicates;
          for (const t of chunkResult.emitted_signal_types) emittedTypes.add(t);
          for (const id of chunkResult.recomputed_companies) recomputedIds.add(id);
          failures.push(...chunkResult.failures);
          allDetails.push(...chunkResult.details);
        } catch (error) {
          totalFailed += chunk.length;
          failures.push(...chunk.map((id) => ({ company_id: id, error: messageFromUnknown(error) })));
        }
      }

      result = {
        processed: totalProcessed,
        failed: totalFailed,
        postings_scanned: totalScanned,
        candidate_events_before_dedupe: totalCandidates,
        events_skipped_as_duplicates: totalDupes,
        emitted_signal_types: [...emittedTypes],
        recomputed_companies: [...recomputedIds],
        failures,
        details: allDetails,
      };
    } else {
      result = await runHiringMonitor({
        userId: user.id,
        companyIds: requestedCompanyIds,
        limit: limitValue,
        onlySignalKey,
      });
    }

    await persistRunHistory(createAdminClient(), {
      userId: user.id,
      signalKey: onlySignalKey ?? 'hiring_all',
      runner: 'hiring',
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
      companyIds: executedCompanyIds,
      limitValue,
      trigger: 'button',
    });

    return NextResponse.json({
      success: true,
      run_all: runAll,
      result: {
        processed: result.processed,
        failed: result.failed,
        postings_scanned: result.postings_scanned,
        candidate_events_before_dedupe: result.candidate_events_before_dedupe,
        events_skipped_as_duplicates: result.events_skipped_as_duplicates,
        emitted_signal_types: result.emitted_signal_types,
        recomputed_companies: result.recomputed_companies,
        failures: result.failures,
        details: result.details,
      },
    });
  } catch (error) {
    console.error('[signals/run/hiring] error:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
