/**
 * Company monitor — orchestrator.
 *
 * Runs all available monitoring modules for a given company and writes
 * results back to the `companies` table. Each module is independent:
 * a failure in one does not block the others.
 *
 * Current modules:
 *   - funding: resolves funding stage from Apollo + web search
 *
 * Planned modules (slot in here when ready):
 *   - clinical_trials: polls ClinicalTrials.gov for pipeline changes
 *   - edgar: watches SEC EDGAR for filings (public companies)
 *   - nih: checks NIH Reporter for grant activity
 */

import { resolveFundingStage, type FundingInput } from './funding';

type MinimalSupabase = {
  from: (table: string) => any;
};

function formatSupabaseErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;

  const candidate = error as {
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };

  const parts = [candidate.message, candidate.details, candidate.hint]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);

  return parts.length > 0 ? parts.join(' | ') : null;
}

export type CompanyMonitorInput = {
  company_id: string;
  company_name: string;
  domain?: string | null;
  apollo_funding_stage?: string | null;
  apollo_total_funding_usd?: number | null;
  apollo_latest_funding_date?: string | null;
};

export type CompanyMonitorResult = {
  company_id: string;
  funding?: {
    updated: boolean;
    previous: string | null;
    current: string | null;
    status_label: string | null;
    source: string | null;
    confidence: string;
    summary: string | null;
    total_funding_usd: number | null;
    latest_funding_date: string | null;
  };
  errors: string[];
};

export async function runCompanyMonitor(
  supabase: MinimalSupabase,
  input: CompanyMonitorInput
): Promise<CompanyMonitorResult> {
  const result: CompanyMonitorResult = {
    company_id: input.company_id,
    errors: [],
  };

  // ── Funding module ──────────────────────────────────────────────────────────
  const fundingCheckedAt = new Date().toISOString();
  try {
    const fundingInput: FundingInput = {
      company_name: input.company_name,
      domain: input.domain,
      apollo_funding_stage: input.apollo_funding_stage,
      apollo_total_funding_usd: input.apollo_total_funding_usd,
      apollo_latest_funding_date: input.apollo_latest_funding_date,
    };

    const funding = await resolveFundingStage(fundingInput);

    // Fetch current value to detect changes
    const currentResult = await supabase
      .from('companies')
      .select(
        'funding_stage, funding_status_label, total_funding_usd, latest_funding_date, funding_data_source'
      )
      .eq('id', input.company_id)
      .maybeSingle();

    const currentError = formatSupabaseErrorMessage(currentResult?.error);
    if (currentError) {
      throw new Error(
        `[company-monitor] Failed to load canonical funding state for company ${input.company_id}: ${currentError}`
      );
    }

    const current = currentResult?.data;

    const previousStage = current?.funding_stage ?? null;
    const nextFundingStage = funding.funding_stage ?? previousStage;
    const nextFundingStatusLabel =
      funding.funding_status_label ??
      nextFundingStage ??
      current?.funding_status_label ??
      null;
    const nextTotalFundingUsd =
      funding.total_funding_usd ??
      input.apollo_total_funding_usd ??
      current?.total_funding_usd ??
      null;
    const nextLatestFundingDate =
      funding.latest_funding_date ??
      input.apollo_latest_funding_date ??
      current?.latest_funding_date ??
      null;
    const changed = nextFundingStage !== previousStage;

    const fundingUpdate: Record<string, unknown> = {
      funding_checked_at: funding.checked_at,
      funding_resolution_confidence: funding.confidence,
      funding_resolution_summary: funding.raw_finding,
      funding_resolution_last_error: null,
      funding_status_label: nextFundingStatusLabel,
      updated_at: new Date().toISOString(),
      total_funding_usd: nextTotalFundingUsd,
      latest_funding_date: nextLatestFundingDate,
    };

    if (nextFundingStage) {
      fundingUpdate.funding_stage = nextFundingStage;
    }

    if (funding.source) {
      fundingUpdate.funding_data_source = funding.source;
    }

    const updateResult = await supabase
      .from('companies')
      .update(fundingUpdate)
      .eq('id', input.company_id);

    const updateError = formatSupabaseErrorMessage(updateResult?.error);
    if (updateError) {
      throw new Error(
        `[company-monitor] Failed to persist canonical funding state for company ${input.company_id}: ${updateError}`
      );
    }

    result.funding = {
      updated: changed && !!funding.funding_stage,
      previous: previousStage,
      current: nextFundingStage,
      status_label: nextFundingStatusLabel,
      source: funding.source,
      confidence: funding.confidence,
      summary: funding.raw_finding,
      total_funding_usd: nextTotalFundingUsd,
      latest_funding_date: nextLatestFundingDate,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[company-monitor] funding module failed for ${input.company_name}:`, msg);

    const errorUpdate = await supabase
      .from('companies')
      .update({
        funding_checked_at: fundingCheckedAt,
        funding_resolution_last_error: msg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.company_id);

    const errorUpdateMessage = formatSupabaseErrorMessage(errorUpdate?.error);
    if (errorUpdateMessage) {
      console.warn(
        `[company-monitor] Failed to persist funding error state for ${input.company_id}:`,
        errorUpdateMessage
      );
    }

    result.errors.push(`funding: ${msg}`);
  }

  // ── Future modules slot in here ─────────────────────────────────────────────
  // try { const ct = await runClinicalTrialsModule(input); ... } catch { ... }
  // try { const edgar = await runEdgarModule(input); ... } catch { ... }
  // try { const nih = await runNihModule(input); ... } catch { ... }

  return result;
}
