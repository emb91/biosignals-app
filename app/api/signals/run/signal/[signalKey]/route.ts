import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { READINESS_SIGNAL_CATALOG_BY_KEY } from '@/lib/signals/readiness-catalog';
import type { SignalKey } from '@/lib/signals/readiness-types';
import { runExternalCompanyMonitor } from '@/lib/signals/run-external-company-monitor';
import { runExternalContactMonitor } from '@/lib/signals/run-external-contact-monitor';

type RunSignalBody = {
  company_ids?: string[];
  contact_ids?: string[];
  limit?: number;
  run_all?: boolean;
  batch_size?: number;
};

type PersistRunHistoryInput = {
  userId: string;
  signalKey: string;
  runner: 'external_contact' | 'external_company';
  scope: 'company' | 'contact';
  status: 'success' | 'failed';
  processed?: number;
  failed?: number;
  skippedRunning?: number;
  emittedSignalTypes?: string[];
  recomputedCompanies?: string[];
  failures?: Array<Record<string, unknown>>;
  companyIds?: string[];
  contactIds?: string[];
  limitValue?: number;
};

const CLINICAL_SIGNAL_KEYS = new Set<SignalKey>([
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

const FDA_SIGNAL_KEYS = new Set<SignalKey>([
  'fda_approval',
  'breakthrough_designation',
  'fast_track_designation',
  'priority_review',
  'orphan_designation',
  'complete_response_letter',
  'indication_expansion',
]);

const PATENT_SIGNAL_KEYS = new Set<SignalKey>([
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
    skipped_running: input.skippedRunning ?? null,
    emitted_signal_types: input.emittedSignalTypes ?? [],
    recomputed_companies: input.recomputedCompanies ?? [],
    failures: input.failures ?? [],
    company_ids: input.companyIds ?? [],
    contact_ids: input.contactIds ?? [],
    limit_value: input.limitValue ?? null,
  });
  if (error) {
    console.error('[signals/run/signal/[signalKey]] persist run history failed:', error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ signalKey: string }> },
) {
  try {
    const authClient = await createClient();
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { signalKey: rawSignalKey } = await context.params;
    const signalKey = rawSignalKey as SignalKey;
    if (!READINESS_SIGNAL_CATALOG_BY_KEY[signalKey]) {
      return NextResponse.json({ error: `Unknown signal key: ${rawSignalKey}` }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as RunSignalBody;
    const companyIds = Array.isArray(body.company_ids)
      ? body.company_ids.filter((value): value is string => typeof value === 'string' && Boolean(value))
      : [];
    const contactIds = Array.isArray(body.contact_ids)
      ? body.contact_ids.filter((value): value is string => typeof value === 'string' && Boolean(value))
      : [];
    const limitValue = typeof body.limit === 'number' && Number.isFinite(body.limit) ? body.limit : undefined;
    const runAll = body.run_all === true;
    const batchSize = Math.min(500, Math.max(1, Number(body.batch_size) || 200));

    if (CLINICAL_SIGNAL_KEYS.has(signalKey)) {
      return NextResponse.json(
        { error: 'Single clinical signal runs are disabled. Use /api/signals/run/clinical-trials.' },
        { status: 400 },
      );
    }
    if (FDA_SIGNAL_KEYS.has(signalKey)) {
      return NextResponse.json(
        { error: 'Single FDA signal runs are disabled. Use /api/signals/run/fda-regulatory.' },
        { status: 400 },
      );
    }
    if (PATENT_SIGNAL_KEYS.has(signalKey)) {
      return NextResponse.json(
        { error: 'Single patent signal runs are disabled. Use /api/signals/run/patents.' },
        { status: 400 },
      );
    }

    const catalogEntry = READINESS_SIGNAL_CATALOG_BY_KEY[signalKey];

    if (catalogEntry.scope === 'contact') {
      let result: Awaited<ReturnType<typeof runExternalContactMonitor>>;
      if (runAll && contactIds.length === 0) {
        const contactQuery = authClient
          .from('contacts')
          .select('id')
          .eq('user_id', user.id)
          .is('archived_at', null)
          .order('id', { ascending: true });
        if (typeof limitValue === 'number') {
          contactQuery.limit(Math.max(1, limitValue));
        }
        const { data: allContacts, error: allContactsError } = await contactQuery;
        if (allContactsError) {
          throw new Error(allContactsError.message);
        }

        const allIds = (allContacts ?? [])
          .map((row: { id?: unknown }) => (typeof row.id === 'string' ? row.id : null))
          .filter((value): value is string => Boolean(value));

        let totalProcessed = 0;
        let totalSkippedRunning = 0;
        let totalFailed = 0;
        const emittedSignalTypes = new Set<string>();
        const recomputedCompanies = new Set<string>();
        const failures: Array<{ contact_id: string; error: string }> = [];

        for (let i = 0; i < allIds.length; i += batchSize) {
          const chunk = allIds.slice(i, i + batchSize);
          const chunkResult = await runExternalContactMonitor({
            userId: user.id,
            contactIds: chunk,
          });
          totalProcessed += chunkResult.processed;
          totalSkippedRunning += chunkResult.skipped_running;
          totalFailed += chunkResult.failed;
          for (const signalType of chunkResult.emitted_signal_types) emittedSignalTypes.add(signalType);
          for (const companyId of chunkResult.recomputed_companies) recomputedCompanies.add(companyId);
          failures.push(...chunkResult.failures);
        }

        result = {
          processed: totalProcessed,
          skipped_running: totalSkippedRunning,
          failed: totalFailed,
          emitted_signal_types: [...emittedSignalTypes],
          recomputed_companies: [...recomputedCompanies],
          failures,
        };
      } else {
        result = await runExternalContactMonitor({
          userId: user.id,
          contactIds,
          limit: body.limit,
        });
      }
      await persistRunHistory(authClient, {
        userId: user.id,
        signalKey,
        runner: 'external_contact',
        scope: 'contact',
        status: result.failed > 0 ? 'failed' : 'success',
        processed: result.processed,
        failed: result.failed,
        skippedRunning: result.skipped_running,
        emittedSignalTypes: result.emitted_signal_types,
        recomputedCompanies: result.recomputed_companies,
        failures: result.failures.map((failure) => ({
          entity_type: 'contact',
          entity_id: failure.contact_id,
          error: failure.error,
        })),
        contactIds,
        limitValue,
      });

      return NextResponse.json({
        success: true,
        runner: 'external_contact',
        signal_key: signalKey,
        run_all: runAll,
        batch_size: runAll ? batchSize : null,
        result: {
          processed: result.processed,
          skipped_running: result.skipped_running,
          failed: result.failed,
          emitted_signal_types: result.emitted_signal_types,
          recomputed_companies: result.recomputed_companies,
          failures: result.failures.map((failure) => ({
            entity_type: 'contact',
            entity_id: failure.contact_id,
            error: failure.error,
          })),
        },
      });
    }

    if (catalogEntry.scope === 'company') {
      let result: Awaited<ReturnType<typeof runExternalCompanyMonitor>>;
      if (runAll && companyIds.length === 0) {
        const companyQuery = authClient
          .from('companies')
          .select('id')
          .eq('user_id', user.id)
          .is('archived_at', null)
          .order('id', { ascending: true });
        if (typeof limitValue === 'number') {
          companyQuery.limit(Math.max(1, limitValue));
        }
        const { data: allCompanies, error: allCompaniesError } = await companyQuery;
        if (allCompaniesError) {
          throw new Error(allCompaniesError.message);
        }
        const allIds = (allCompanies ?? [])
          .map((row: { id?: unknown }) => (typeof row.id === 'string' ? row.id : null))
          .filter((value): value is string => Boolean(value));

        let totalProcessed = 0;
        let totalFailed = 0;
        const emittedSignalTypes = new Set<string>();
        const recomputedCompanies = new Set<string>();
        const failures: Array<{ company_id: string; error: string }> = [];

        for (let i = 0; i < allIds.length; i += batchSize) {
          const chunk = allIds.slice(i, i + batchSize);
          const chunkResult = await runExternalCompanyMonitor({
            userId: user.id,
            companyIds: chunk,
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
        result = await runExternalCompanyMonitor({
          userId: user.id,
          companyIds,
          limit: body.limit,
        });
      }
      await persistRunHistory(authClient, {
        userId: user.id,
        signalKey,
        runner: 'external_company',
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
        companyIds,
        limitValue,
      });

      return NextResponse.json({
        success: true,
        runner: 'external_company',
        signal_key: signalKey,
        run_all: runAll,
        batch_size: runAll ? batchSize : null,
        result: {
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
    }

    return NextResponse.json({ error: `Unsupported signal scope for ${signalKey}.` }, { status: 400 });
  } catch (error) {
    console.error('[signals/run/signal/[signalKey]] error:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
