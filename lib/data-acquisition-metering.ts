import type { PipelineDataRequestType } from '@/lib/pipeline-icp-health';

type MinimalSupabase = {
  from: (table: string) => {
    insert: (values: Record<string, unknown> | Record<string, unknown>[]) => {
      select: (columns?: string) => {
        single: () => PromiseLike<{
          data: Record<string, unknown> | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

export type DataAcquisitionUsageEventType =
  | 'job_requested'
  | 'apollo_company_search_result'
  | 'apollo_company_enrichment'
  | 'apollo_people_search_result'
  | 'apollo_person_enrichment'
  | 'apify_profile_scrape'
  | 'apify_company_scrape'
  | 'llm_fit_screen'
  | 'qualified_company'
  | 'imported_company'
  | 'imported_contact'
  | 'duplicate_company_skipped'
  | 'duplicate_contact_skipped'
  | 'low_fit_company_rejected';

export type DataAcquisitionSourceStrategy = 'apollo_first';

export const DEFAULT_ACQUISITION_TARGET_COMPANIES = 50;
export const DEFAULT_CONTACTS_PER_COMPANY = 2;
export const DEFAULT_SCREENING_MULTIPLIER_MIN = 3;
export const DEFAULT_SCREENING_MULTIPLIER_MAX = 6;

const CREDIT_WEIGHTS: Record<DataAcquisitionUsageEventType, number> = {
  job_requested: 0,
  apollo_company_search_result: 0.1,
  apollo_company_enrichment: 1,
  apollo_people_search_result: 0.05,
  apollo_person_enrichment: 1,
  apify_profile_scrape: 1.5,
  apify_company_scrape: 1.5,
  llm_fit_screen: 0.02,
  qualified_company: 0,
  imported_company: 0,
  imported_contact: 0,
  duplicate_company_skipped: 0,
  duplicate_contact_skipped: 0,
  low_fit_company_rejected: 0,
};

export function normalizePositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

export function estimateDataAcquisitionUsage(params: {
  requestType: PipelineDataRequestType;
  targetCompanyCount: number;
  targetContactCount?: number | null;
}) {
  const targetCompanyCount = Math.max(0, Math.floor(params.targetCompanyCount));
  const targetContactCount =
    params.targetContactCount != null
      ? Math.max(0, Math.floor(params.targetContactCount))
      : targetCompanyCount * DEFAULT_CONTACTS_PER_COMPANY;

  const screenedCompaniesMin = targetCompanyCount * DEFAULT_SCREENING_MULTIPLIER_MIN;
  const screenedCompaniesMax = targetCompanyCount * DEFAULT_SCREENING_MULTIPLIER_MAX;
  const companyEnrichmentsMin = Math.ceil(targetCompanyCount * 1.5);
  const companyEnrichmentsMax = Math.ceil(targetCompanyCount * 3);

  const minCredits =
    screenedCompaniesMin * CREDIT_WEIGHTS.apollo_company_search_result +
    companyEnrichmentsMin * CREDIT_WEIGHTS.apollo_company_enrichment +
    screenedCompaniesMin * CREDIT_WEIGHTS.llm_fit_screen +
    targetContactCount * CREDIT_WEIGHTS.apollo_person_enrichment;

  const maxCredits =
    screenedCompaniesMax * CREDIT_WEIGHTS.apollo_company_search_result +
    companyEnrichmentsMax * CREDIT_WEIGHTS.apollo_company_enrichment +
    screenedCompaniesMax * CREDIT_WEIGHTS.llm_fit_screen +
    targetContactCount * CREDIT_WEIGHTS.apollo_person_enrichment;

  return {
    screenedCompaniesMin,
    screenedCompaniesMax,
    companyEnrichmentsMin,
    companyEnrichmentsMax,
    targetContactCount,
    estimatedMinCreditUnits: Math.round(minCredits * 100) / 100,
    estimatedMaxCreditUnits: Math.round(maxCredits * 100) / 100,
  };
}

export async function recordDataAcquisitionUsageEvent(
  supabase: MinimalSupabase,
  params: {
    jobId: string;
    userId: string;
    eventType: DataAcquisitionUsageEventType;
    quantity?: number;
    provider?: string | null;
    providerCostUnits?: number;
    internalCreditUnits?: number;
    metadata?: Record<string, unknown>;
  },
) {
  const quantity = normalizePositiveInt(params.quantity ?? 1, 1);
  const internalCreditUnits =
    params.internalCreditUnits ?? Math.round(quantity * CREDIT_WEIGHTS[params.eventType] * 100) / 100;

  const { error } = await supabase
    .from('data_acquisition_usage_events')
    .insert({
      job_id: params.jobId,
      user_id: params.userId,
      event_type: params.eventType,
      provider: params.provider ?? null,
      quantity,
      provider_cost_units: params.providerCostUnits ?? 0,
      internal_credit_units: internalCreditUnits,
      metadata: params.metadata ?? {},
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message || 'Failed to record data acquisition usage event');
}
