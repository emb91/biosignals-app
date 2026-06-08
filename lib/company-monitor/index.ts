/**
 * Company monitor — orchestrator.
 *
 * Runs all available monitoring modules for a given company and writes
 * results back to the `companies` table. Each module is independent:
 * a failure in one does not block the others.
 *
 * Current modules:
 *   - funding: resolves funding stage from Apollo + web search
 *   - taxonomy: maps company evidence into Arcova's canonical company taxonomy
 *   - narrative: resolves products_services, services, technologies via Claude web_search
 *
 * Planned modules (slot in here when ready):
 *   - clinical_trials: polls ClinicalTrials.gov for pipeline changes
 *   - edgar: watches SEC EDGAR for filings (public companies)
 *   - nih: checks NIH Reporter for grant activity
 */

import { resolveFundingStage, type FundingInput } from './funding';
import { resolveCompanyTaxonomy, type CompanyTaxonomyInput } from './taxonomy';
import { resolveCompanyNarrative, type CompanyNarrativeInput } from './narrative';

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

function isMissingColumnError(error: unknown): boolean {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : '';

  return message.includes('column') && message.includes('does not exist');
}

export type CompanyMonitorInput = {
  company_id: string;
  company_name: string;
  domain?: string | null;
  website?: string | null;
  apollo_funding_stage?: string | null;
  apollo_total_funding_usd?: number | null;
  apollo_latest_funding_date?: string | null;
  apify_company_firmographics?: Record<string, unknown> | null;
  apollo_company_firmographics?: Record<string, unknown> | null;
  apollo_organization_raw?: Record<string, unknown> | null;
};

export type CompanyMonitorResult = {
  company_id: string;
  funding?: {
    updated: boolean;
    previous: string | null;
    previous_status_label: string | null;
    current: string | null;
    status_label: string | null;
    source: string | null;
    confidence: string;
    summary: string | null;
    previous_total_funding_usd: number | null;
    total_funding_usd: number | null;
    previous_latest_funding_date: string | null;
    latest_funding_date: string | null;
  };
  taxonomy?: {
    updated: boolean;
    company_type: string | null;
    platform_category: string | null;
    therapeutic_areas: string[];
    modalities: string[];
    previous_development_stages: string[];
    development_stages: string[];
    confidence: string;
    summary: string | null;
  };
  errors: string[];
};

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export async function runCompanyMonitor(
  supabase: MinimalSupabase,
  input: CompanyMonitorInput
): Promise<CompanyMonitorResult> {
  const result: CompanyMonitorResult = {
    company_id: input.company_id,
    errors: [],
  };

  // ── Funding module ──────────────────────────────────────────────────────────
  const runFundingModule = async () => {
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
      previous_status_label: current?.funding_status_label ?? null,
      current: nextFundingStage,
      status_label: nextFundingStatusLabel,
      source: funding.source,
      confidence: funding.confidence,
      summary: funding.raw_finding,
      previous_total_funding_usd: current?.total_funding_usd ?? null,
      total_funding_usd: nextTotalFundingUsd,
      previous_latest_funding_date: current?.latest_funding_date ?? null,
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
  };

  // ── Taxonomy module ────────────────────────────────────────────────────────
  const runTaxonomyModule = async () => {
  try {
    const taxonomyInput: CompanyTaxonomyInput = {
      company_name: input.company_name,
      domain: input.domain,
      apify_company_firmographics: input.apify_company_firmographics,
      apollo_company_firmographics: input.apollo_company_firmographics,
      apollo_organization_raw: input.apollo_organization_raw,
    };

    const taxonomy = await resolveCompanyTaxonomy(taxonomyInput);

    let currentResult = await supabase
      .from('companies')
      .select(
        'company_type, company_type_display, platform_category, therapeutic_areas, modalities, development_stages, customer_therapeutic_areas, customer_modalities, customer_development_stages',
      )
      .eq('id', input.company_id)
      .maybeSingle();

    if (currentResult?.error && isMissingColumnError(currentResult.error)) {
      currentResult = await supabase
        .from('companies')
        .select('company_type, therapeutic_areas:therapeutic_area, modalities:modality')
        .eq('id', input.company_id)
        .maybeSingle();
    }

    const currentError = formatSupabaseErrorMessage(currentResult?.error);
    if (currentError) {
      throw new Error(
        `[company-monitor] Failed to load canonical taxonomy state for company ${input.company_id}: ${currentError}`
      );
    }

    const current = currentResult?.data;
    const previousCompanyType = typeof current?.company_type === 'string' ? current.company_type : null;
    const previousCompanyTypeDisplay = typeof current?.company_type_display === 'string' ? current.company_type_display : null;
    const previousPlatformCategory = typeof current?.platform_category === 'string' ? current.platform_category : null;
    const previousTherapeuticAreas = normalizeStringArray(current?.therapeutic_areas);
    const previousModalities = normalizeStringArray(current?.modalities);
    const previousDevelopmentStages = normalizeStringArray(current?.development_stages);
    const previousCustomerTa = normalizeStringArray(
      (current as Record<string, unknown>)?.customer_therapeutic_areas
    );
    const previousCustomerMo = normalizeStringArray((current as Record<string, unknown>)?.customer_modalities);
    const previousCustomerDs = normalizeStringArray(
      (current as Record<string, unknown>)?.customer_development_stages
    );
    const canOverwrite = taxonomy.confidence !== 'low';

    const nextCompanyType =
      canOverwrite && taxonomy.company_type ? taxonomy.company_type : previousCompanyType;
    const nextCompanyTypeDisplay =
      canOverwrite && taxonomy.company_type_display ? taxonomy.company_type_display : previousCompanyTypeDisplay;
    const nextPlatformCategory =
      canOverwrite ? taxonomy.platform_category : previousPlatformCategory;
    const nextTherapeuticAreas = canOverwrite ? taxonomy.therapeutic_areas : previousTherapeuticAreas;
    const nextModalities = canOverwrite ? taxonomy.modalities : previousModalities;
    const nextDevelopmentStages =
      canOverwrite ? taxonomy.development_stages : previousDevelopmentStages;
    const nextCustomerTa = canOverwrite ? taxonomy.customer_therapeutic_areas : previousCustomerTa;
    const nextCustomerMo = canOverwrite ? taxonomy.customer_modalities : previousCustomerMo;
    const nextCustomerDs = canOverwrite ? taxonomy.customer_development_stages : previousCustomerDs;

    const changed =
      nextCompanyType !== previousCompanyType ||
      nextCompanyTypeDisplay !== previousCompanyTypeDisplay ||
      nextPlatformCategory !== previousPlatformCategory ||
      !arraysEqual(nextTherapeuticAreas, previousTherapeuticAreas) ||
      !arraysEqual(nextModalities, previousModalities) ||
      !arraysEqual(nextDevelopmentStages, previousDevelopmentStages) ||
      !arraysEqual(nextCustomerTa, previousCustomerTa) ||
      !arraysEqual(nextCustomerMo, previousCustomerMo) ||
      !arraysEqual(nextCustomerDs, previousCustomerDs);

    if (changed) {
      let updateResult = await supabase
        .from('companies')
        .update({
          company_type: nextCompanyType,
          company_type_display: nextCompanyTypeDisplay,
          platform_category: nextPlatformCategory,
          therapeutic_areas: nextTherapeuticAreas,
          modalities: nextModalities,
          development_stages: nextDevelopmentStages,
          customer_therapeutic_areas: nextCustomerTa,
          customer_modalities: nextCustomerMo,
          customer_development_stages: nextCustomerDs,
          taxonomy_evidence_summary: taxonomy.evidence_summary,
          updated_at: new Date().toISOString(),
        })
        .eq('id', input.company_id);

      if (updateResult?.error && isMissingColumnError(updateResult.error)) {
        updateResult = await supabase
          .from('companies')
          .update({
            company_type: nextCompanyType,
            company_type_display: nextCompanyTypeDisplay,
            therapeutic_area: nextTherapeuticAreas,
            modality: nextModalities,
            development_stages: nextDevelopmentStages,
            taxonomy_evidence_summary: taxonomy.evidence_summary,
            updated_at: new Date().toISOString(),
          })
          .eq('id', input.company_id);
      }

      const updateError = formatSupabaseErrorMessage(updateResult?.error);
      if (updateError) {
        throw new Error(
          `[company-monitor] Failed to persist canonical taxonomy state for company ${input.company_id}: ${updateError}`
        );
      }
    }

    result.taxonomy = {
      updated: changed,
      company_type: nextCompanyType,
      platform_category: nextPlatformCategory,
      therapeutic_areas: nextTherapeuticAreas,
      modalities: nextModalities,
      previous_development_stages: previousDevelopmentStages,
      development_stages: nextDevelopmentStages,
      confidence: taxonomy.confidence,
      summary: taxonomy.evidence_summary,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[company-monitor] taxonomy module failed for ${input.company_name}:`, msg);
    result.errors.push(`taxonomy: ${msg}`);
  }
  };

  // ── Narrative module (products_services, services, technologies) ───────────
  const runNarrativeModule = async () => {
  try {
    const websiteForNarrative =
      input.website ||
      (typeof input.apify_company_firmographics?.website === 'string'
        ? input.apify_company_firmographics.website
        : null);

    const narrativeInput: CompanyNarrativeInput = {
      company_id: input.company_id,
      company_name: input.company_name,
      domain: input.domain,
      website: websiteForNarrative,
    };

    // Fetch existing values to skip if already populated
    const existingNarrative = await supabase
      .from('companies')
      .select('products_services, services, technologies')
      .eq('id', input.company_id)
      .maybeSingle();

    const existingNarrativeData = existingNarrative?.data ?? null;

    const narrative = await resolveCompanyNarrative(narrativeInput, existingNarrativeData);

    if (!narrative.skipped) {
      const narrativeUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (narrative.products_services) narrativeUpdate.products_services = narrative.products_services;
      if (narrative.services) narrativeUpdate.services = narrative.services;
      if (narrative.technologies) narrativeUpdate.technologies = narrative.technologies;

      const updateResult = await supabase
        .from('companies')
        .update(narrativeUpdate)
        .eq('id', input.company_id);

      const updateError = formatSupabaseErrorMessage(updateResult?.error);
      if (updateError) {
        throw new Error(
          `[company-monitor] Failed to persist narrative for company ${input.company_id}: ${updateError}`
        );
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[company-monitor] narrative module failed for ${input.company_name}:`, msg);
    result.errors.push(`narrative: ${msg}`);
  }
  };

  // Run the independent modules in PARALLEL. Each writes a DISJOINT set of
  // companies columns (funding_* / taxonomy fields / products_services etc.;
  // only updated_at overlaps, harmlessly) and has its own try/catch, so one
  // failing never aborts the others. This cuts wall-clock ~3x vs sequential —
  // important because the whole thing runs inside an after() job under a
  // serverless maxDuration budget (see the enrich route's maxDuration).
  await Promise.all([runFundingModule(), runTaxonomyModule(), runNarrativeModule()]);

  // ── Future modules slot in here ─────────────────────────────────────────────
  // Add as additional entries in the Promise.all above (clinical trials, EDGAR, NIH…).

  return result;
}
