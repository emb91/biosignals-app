/**
 * Shared helper for writing a row to signals_run_history. Used by both the
 * user-triggered API routes (button-press) and the cron-driven per-user
 * monitor loops, so admin observability sees both.
 */
import type { createAdminClient } from '@/lib/supabase-admin';

type RunHistoryRunner = 'patents' | 'clinical_trials' | 'fda_regulatory' | 'funding' | 'hiring' | 'grants' | 'job_change' | 'press_releases' | 'publications' | 'conferences';

export type PersistRunHistoryInput = {
  userId: string;
  signalKey: string;
  runner: RunHistoryRunner;
  scope: 'company' | 'contact';
  status: 'success' | 'failed';
  processed?: number;
  failed?: number;
  emittedSignalTypes?: string[];
  recomputedCompanies?: string[];
  failures?: Array<Record<string, unknown>>;
  companyIds?: string[];
  contactIds?: string[];
  limitValue?: number;
  /**
   * Optional tag so we can tell at-a-glance whether a row came from the user
   * clicking the test button or from a scheduled cron-driven run. Stored in
   * the failures jsonb column as a sentinel since signals_run_history doesn't
   * have a dedicated field. Cheap; doesn't break anything that reads failures.
   */
  trigger?: 'button' | 'cron';
};

export async function persistRunHistory(
  admin: ReturnType<typeof createAdminClient>,
  input: PersistRunHistoryInput,
): Promise<void> {
  const failures = input.failures ?? [];
  const failuresWithTrigger = input.trigger
    ? [{ _trigger: input.trigger }, ...failures]
    : failures;
  const { error } = await admin.from('signals_run_history').insert({
    user_id: input.userId,
    signal_key: input.signalKey,
    runner: input.runner,
    scope: input.scope,
    status: input.status,
    processed: input.processed ?? null,
    failed: input.failed ?? null,
    emitted_signal_types: input.emittedSignalTypes ?? [],
    recomputed_companies: input.recomputedCompanies ?? [],
    failures: failuresWithTrigger,
    company_ids: input.companyIds ?? [],
    contact_ids: input.contactIds ?? [],
    limit_value: input.limitValue ?? null,
  });
  if (error) {
    console.error(`[run-history] insert failed for ${input.runner}/${input.userId}:`, error);
  }
}
