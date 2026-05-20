import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { runExternalContactMonitor } from '@/lib/signals/run-external-contact-monitor';
import { runExternalCompanyMonitor } from '@/lib/signals/run-external-company-monitor';
import { runClinicalTrialsMonitor } from '@/lib/signals/run-clinical-trials-monitor';
import type { SignalKey } from '@/lib/signals/readiness-types';

type RunSignalsBody = {
  contact_ids?: string[];
  company_ids?: string[];
  limit?: number;
  include_clinical_trials?: boolean;
  include_external_contact?: boolean;
  include_external_company?: boolean;
  only_signal_key?: string;
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

    const body = (await request.json().catch(() => ({}))) as RunSignalsBody;
    const onlySignalKey = typeof body.only_signal_key === 'string' ? (body.only_signal_key as SignalKey) : undefined;
    const clinicalOnly = Boolean(onlySignalKey && CLINICAL_ONLY_KEYS.has(onlySignalKey));
    const [contactResult, companyResult, clinicalTrialsResult] = await Promise.all([
      clinicalOnly || body.include_external_contact === false
        ? Promise.resolve({
            processed: 0,
            skipped_running: 0,
            failed: 0,
            emitted_signal_types: [] as string[],
            recomputed_companies: [] as string[],
            failures: [] as Array<{ contact_id: string; error: string }>,
          })
        : runExternalContactMonitor({
            userId: user.id,
            contactIds: body.contact_ids,
            limit: body.limit,
          }),
      clinicalOnly || body.include_external_company === false
        ? Promise.resolve({
            processed: 0,
            failed: 0,
            emitted_signal_types: [] as string[],
            recomputed_companies: [] as string[],
            failures: [] as Array<{ company_id: string; error: string }>,
          })
        : runExternalCompanyMonitor({
            userId: user.id,
            companyIds: body.company_ids,
            limit: body.limit,
          }),
      body.include_clinical_trials === false
        ? Promise.resolve({
            processed: 0,
            failed: 0,
            emitted_signal_types: [] as string[],
            recomputed_companies: [] as string[],
            failures: [] as Array<{ company_id: string; error: string }>,
          })
        : runClinicalTrialsMonitor({
            userId: user.id,
            companyIds: body.company_ids,
            limit: body.limit,
            onlySignalKey: onlySignalKey && CLINICAL_ONLY_KEYS.has(onlySignalKey) ? onlySignalKey : undefined,
          }),
    ]);

    const result = {
      contact_processed: contactResult.processed,
      contact_skipped_running: contactResult.skipped_running,
      company_processed: companyResult.processed,
      clinical_trials_processed: clinicalTrialsResult.processed,
      processed: contactResult.processed + companyResult.processed + clinicalTrialsResult.processed,
      skipped_running: contactResult.skipped_running,
      failed: contactResult.failed + companyResult.failed + clinicalTrialsResult.failed,
      emitted_signal_types: [
        ...new Set([
          ...contactResult.emitted_signal_types,
          ...companyResult.emitted_signal_types,
          ...clinicalTrialsResult.emitted_signal_types,
        ]),
      ],
      recomputed_companies: [
        ...new Set([
          ...contactResult.recomputed_companies,
          ...companyResult.recomputed_companies,
          ...clinicalTrialsResult.recomputed_companies,
        ]),
      ],
      failures: [
        ...contactResult.failures.map((failure) => ({
          entity_type: 'contact',
          entity_id: failure.contact_id,
          error: failure.error,
        })),
        ...companyResult.failures.map((failure) => ({
          entity_type: 'company',
          entity_id: failure.company_id,
          error: failure.error,
        })),
        ...clinicalTrialsResult.failures.map((failure) => ({
          entity_type: 'company',
          entity_id: failure.company_id,
          error: failure.error,
        })),
      ],
    };

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('[signals/run] error:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
