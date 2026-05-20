import {
  COMPANY_SIZE_OPTIONS,
  DEVELOPMENT_STAGE_OPTIONS,
  canonicalizeCompanyType,
  canonicalizeFundingStage,
  canonicalizeModality,
  canonicalizeTherapeuticArea,
  employeeCountToSizeBucket,
  expandModalitiesWithParents,
  type CompanySize,
  type DevelopmentStage,
  type FundingStage,
  type Modality,
  type TherapeuticArea,
} from '@/lib/arcova-taxonomy';
import { normalizePlatformCategoryForStorage } from '@/lib/platform-category';
import { createAdminClient } from '@/lib/supabase-admin';

const SCORE_VERSION = 'company_fit_v1';

const COMPONENT_WEIGHTS = {
  companyType: 20,
  platformCategory: 10,
  therapeuticAreas: 15,
  modalities: 20,
  developmentStages: 20,
  companySize: 10,
  funding: 5,
} as const;

const COMPANY_TYPE_CAPS = {
  exact: 1,
  unknown: 0.7,
  mismatch: 0.35,
  not_applicable: 1,
} as const;

type MinimalSupabase = {
  from: (table: string) => any;
};

type CompanyTypeMatchStatus = keyof typeof COMPANY_TYPE_CAPS;

type CompanyScoreRow = {
  id: string;
  user_id: string;
  company_name: string | null;
  domain: string | null;
  company_type: string | null;
  platform_category: string | null;
  therapeutic_areas: string[] | null;
  modalities: string[] | null;
  development_stages: string[] | null;
  clinical_stage: string | null;
  company_size_bucket: string | null;
  employee_count: number | null;
  employee_range: string | null;
  funding_stage: string | null;
  funding_status_label: string | null;
  total_funding_usd: number | null;
};

type IcpScoreRow = {
  id: string;
  name: string | null;
  company_type: string | null;
  platform_category: string | null;
  therapeutic_areas: string[] | null;
  modalities: string[] | null;
  development_stages: string[] | null;
  company_sizes: string[] | null;
  funding_stages: string[] | null;
  example_company_enrichment: Record<string, unknown> | null;
};

type BreakdownComponent = {
  label: string;
  active: boolean;
  available: boolean;
  weight: number;
  earned: number;
  score01: number;
  detail: string;
  matchedCount?: number;
  totalSelected?: number;
  matchStatus?: string;
  matchedValues?: string[];
  unmatchedValues?: string[];
};

type ScoreBreakdown = {
  score_version: string;
  matched_on: string[];
  gaps: string[];
  summary: {
    raw_score01: number;
    final_score01: number;
    raw_score_pct: number;
    final_score_pct: number;
    score_cap01: number;
    coverage01: number;
    reasoning: string;
  };
  components: {
    company_type: BreakdownComponent;
    platform_category: BreakdownComponent;
    therapeutic_areas: BreakdownComponent;
    modalities: BreakdownComponent;
    development_stages: BreakdownComponent;
    company_size: BreakdownComponent;
    funding: BreakdownComponent;
  };
};

type CompanyIcpScoreResult = {
  icpId: string;
  icpName: string | null;
  rawScore01: number;
  finalScore01: number;
  scoreCap01: number;
  coverage01: number;
  companyTypeMatchStatus: CompanyTypeMatchStatus;
  breakdown: ScoreBreakdown;
};

export type CompanyFitSyncResult = {
  companiesScored: number;
  contactsSynced: number;
  failed: number;
  skipped: number;
};

type ExistingScoreRow = {
  company_id: string;
  icp_id: string;
};

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/[$,]/g, '').trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupe<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function canonicalizeDevelopmentStage(value: unknown): DevelopmentStage | null {
  if (typeof value !== 'string') return null;

  const normalized = normalizeText(value);
  const aliases: Record<string, DevelopmentStage> = {
    preclinical: 'Preclinical',
    'phase 1': 'Phase I',
    'phase i': 'Phase I',
    'phase 2': 'Phase II',
    'phase ii': 'Phase II',
    'phase 3': 'Phase III',
    'phase iii': 'Phase III',
    commercial: 'Commercial',
    approved: 'Commercial',
    marketed: 'Commercial',
    'all stages': 'All stages',
  };

  return (
    aliases[normalized] ??
    DEVELOPMENT_STAGE_OPTIONS.find((option) => normalizeText(option) === normalized) ??
    null
  );
}

function canonicalizeCompanySize(value: unknown): CompanySize | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeText(value);
  return (
    COMPANY_SIZE_OPTIONS.find((option) => normalizeText(option) === normalized) ??
    null
  );
}

function canonicalizeStringList<T extends string>(
  values: unknown,
  canonicalize: (value: unknown) => T | null,
): T[] {
  return dedupe(
    (Array.isArray(values) ? values : [])
      .map((value) => canonicalize(value))
      .filter((value): value is T => Boolean(value)),
  );
}

function getCompanyDevelopmentStages(company: CompanyScoreRow): DevelopmentStage[] {
  const fromArray = canonicalizeStringList(company.development_stages, canonicalizeDevelopmentStage);
  const fromClinical = canonicalizeDevelopmentStage(company.clinical_stage);

  return dedupe(fromClinical ? [...fromArray, fromClinical] : fromArray);
}

function getCompanySizeBucket(company: CompanyScoreRow): CompanySize | null {
  const canonical = canonicalizeCompanySize(company.company_size_bucket);
  if (canonical) return canonical;

  return canonicalizeCompanySize(
    employeeCountToSizeBucket(company.employee_count, company.employee_range)[0] ?? null,
  );
}

function getIcpReferenceSizeBuckets(icp: IcpScoreRow): CompanySize[] {
  const explicit = canonicalizeStringList(icp.company_sizes, canonicalizeCompanySize);
  if (explicit.length > 0) return explicit;

  const enrichment = icp.example_company_enrichment ?? null;
  const fallback = employeeCountToSizeBucket(
    normalizeNumber(enrichment?.employee_count ?? null),
    normalizeString(enrichment?.employee_range ?? null) || null,
  )[0] ?? null;

  return fallback ? [fallback as CompanySize] : [];
}

function roundScore01(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function scoreToPercent(value01: number): number {
  return Math.round(value01 * 100);
}

/**
 * Binary funding stage match: 1 if the company's stage is in the ICP's selected stages, 0 otherwise.
 * ICP funding stages are buckets — adjacent stages don't earn partial credit. Series A is not
 * "almost Public"; either it matches the criteria or it doesn't.
 */
function fundingStageSimilarity(
  companyStage: FundingStage | null,
  targetStages: FundingStage[],
): number | null {
  if (!companyStage || targetStages.length === 0) return null;
  return targetStages.includes(companyStage) ? 1 : 0;
}

/**
 * Binary company size match: 1 if the company's size band is in the ICP's selected bands, 0 otherwise.
 * ICP criteria are buckets — there's no "near miss" credit; either the company falls in a chosen
 * bucket or it doesn't.
 */
function sizeSimilarity(companySize: CompanySize | null, targetSizes: CompanySize[]): number | null {
  if (!companySize || targetSizes.length === 0) return null;
  return targetSizes.includes(companySize) ? 1 : 0;
}

function makeComponent(params: {
  label: string;
  active: boolean;
  available: boolean;
  weight: number;
  earned: number;
  detail: string;
  matchedCount?: number;
  totalSelected?: number;
  matchStatus?: string;
  matchedValues?: string[];
  unmatchedValues?: string[];
}): BreakdownComponent {
  const earned = Math.max(0, Math.min(params.weight, params.earned));
  return {
    label: params.label,
    active: params.active,
    available: params.available,
    weight: params.weight,
    earned,
    score01: params.weight > 0 ? roundScore01(earned / params.weight) : 0,
    detail: params.detail,
    matchedCount: params.matchedCount,
    totalSelected: params.totalSelected,
    matchStatus: params.matchStatus,
    matchedValues: params.matchedValues,
    unmatchedValues: params.unmatchedValues,
  };
}

function computeCompanyIcpScore(company: CompanyScoreRow, icp: IcpScoreRow): CompanyIcpScoreResult {
  const icpCompanyType = canonicalizeCompanyType(icp.company_type);
  const companyType = canonicalizeCompanyType(company.company_type);

  const companyTypeMatchStatus: CompanyTypeMatchStatus =
    !icpCompanyType
      ? 'not_applicable'
      : !companyType
        ? 'unknown'
        : companyType === icpCompanyType
          ? 'exact'
          : 'mismatch';

  const companyTypeComponent = makeComponent({
    label: 'Company type',
    active: Boolean(icpCompanyType),
    available: Boolean(companyType),
    weight: COMPONENT_WEIGHTS.companyType,
    earned: companyTypeMatchStatus === 'exact' ? COMPONENT_WEIGHTS.companyType : 0,
    detail:
      companyTypeMatchStatus === 'exact'
        ? `Matches ${icpCompanyType}.`
        : companyTypeMatchStatus === 'unknown'
          ? `Company type not enriched yet; ICP expects ${icpCompanyType}.`
          : icpCompanyType
            ? `ICP expects ${icpCompanyType}; company is ${companyType ?? 'unknown'}.`
            : 'No company-type gate on this ICP.',
    matchStatus: companyTypeMatchStatus,
    matchedValues: companyTypeMatchStatus === 'exact' && icpCompanyType ? [icpCompanyType] : [],
    unmatchedValues: companyTypeMatchStatus === 'mismatch' && icpCompanyType ? [icpCompanyType] : [],
  });

  const icpPlatformCategory = normalizePlatformCategoryForStorage(icp.platform_category);
  const companyPlatformCategory = normalizePlatformCategoryForStorage(company.platform_category);
  const platformCategoryMatched =
    Boolean(icpPlatformCategory) &&
    Boolean(companyPlatformCategory) &&
    normalizeText(companyPlatformCategory!) === normalizeText(icpPlatformCategory!);
  const platformCategoryComponent = makeComponent({
    label: 'Platform category',
    active: Boolean(icpPlatformCategory),
    available: Boolean(companyPlatformCategory),
    weight: COMPONENT_WEIGHTS.platformCategory,
    earned: platformCategoryMatched ? COMPONENT_WEIGHTS.platformCategory : 0,
    detail:
      !icpPlatformCategory
        ? 'No platform-category criterion.'
        : !companyPlatformCategory
          ? `Platform category not enriched yet; ICP expects ${icpPlatformCategory}.`
          : platformCategoryMatched
            ? `Matches ${icpPlatformCategory}.`
            : `ICP expects ${icpPlatformCategory}; company is ${companyPlatformCategory}.`,
    matchStatus: platformCategoryMatched ? 'exact' : companyPlatformCategory ? 'mismatch' : 'unknown',
  });

  const icpTherapeuticAreas = canonicalizeStringList(icp.therapeutic_areas, canonicalizeTherapeuticArea);
  const companyTherapeuticAreas = new Set(
    canonicalizeStringList(company.therapeutic_areas, canonicalizeTherapeuticArea),
  );
  const matchedTAValues = icpTherapeuticAreas.filter((value) => companyTherapeuticAreas.has(value));
  const unmatchedTAValues = icpTherapeuticAreas.filter((value) => !companyTherapeuticAreas.has(value));
  const matchedTherapeuticAreas = matchedTAValues.length;
  // Any-match scoring: a company that does even one of our target therapeutic areas is a fit —
  // they may have a portfolio across multiple TAs, but selling them on the one we cover still works.
  const therapeuticAreasComponent = makeComponent({
    label: 'Therapeutic areas',
    active: icpTherapeuticAreas.length > 0,
    available: companyTherapeuticAreas.size > 0,
    weight: COMPONENT_WEIGHTS.therapeuticAreas,
    earned:
      icpTherapeuticAreas.length > 0 && matchedTherapeuticAreas > 0
        ? COMPONENT_WEIGHTS.therapeuticAreas
        : 0,
    detail:
      icpTherapeuticAreas.length === 0
        ? 'No therapeutic-area criterion.'
        : companyTherapeuticAreas.size === 0
          ? `Therapeutic areas not enriched yet; ICP expects ${icpTherapeuticAreas.join(', ')}.`
          : matchedTherapeuticAreas > 0
            ? `Matches on ${matchedTAValues.join(', ')}.`
            : `No overlap with ICP target ${icpTherapeuticAreas.join(', ')}.`,
    matchedCount: matchedTherapeuticAreas,
    totalSelected: icpTherapeuticAreas.length,
    matchedValues: matchedTAValues,
    unmatchedValues: unmatchedTAValues,
  });

  const icpModalities = canonicalizeStringList(icp.modalities, canonicalizeModality);
  const companyModalities = canonicalizeStringList(company.modalities, canonicalizeModality);
  const expandedCompanyModalities = new Set(expandModalitiesWithParents(companyModalities));
  const matchedModalityValues = icpModalities.filter((value) => expandedCompanyModalities.has(value));
  const unmatchedModalityValues = icpModalities.filter((value) => !expandedCompanyModalities.has(value));
  const matchedModalities = matchedModalityValues.length;
  // Any-match scoring: a company that develops even one of our target modalities is a fit —
  // we can sell them the product covering that modality regardless of what else they do.
  const modalitiesComponent = makeComponent({
    label: 'Modalities',
    active: icpModalities.length > 0,
    available: companyModalities.length > 0,
    weight: COMPONENT_WEIGHTS.modalities,
    earned:
      icpModalities.length > 0 && matchedModalities > 0
        ? COMPONENT_WEIGHTS.modalities
        : 0,
    matchedValues: matchedModalityValues,
    unmatchedValues: unmatchedModalityValues,
    detail:
      icpModalities.length === 0
        ? 'No modality criterion.'
        : companyModalities.length === 0
          ? `Modalities not enriched yet; ICP expects ${icpModalities.join(', ')}.`
          : matchedModalities > 0
            ? `Matches on ${matchedModalityValues.join(', ')}.`
            : `No overlap with ICP target ${icpModalities.join(', ')}.`,
    matchedCount: matchedModalities,
    totalSelected: icpModalities.length,
  });

  const icpStages = canonicalizeStringList(icp.development_stages, canonicalizeDevelopmentStage);
  const companyStages = getCompanyDevelopmentStages(company);
  const hasAllStages = icpStages.includes('All stages') || companyStages.includes('All stages');
  const matchedStageValues = hasAllStages ? icpStages : icpStages.filter((value) => companyStages.includes(value));
  const unmatchedStageValues = hasAllStages ? [] : icpStages.filter((value) => !companyStages.includes(value));
  const matchedStages = matchedStageValues.length;
  // Any-match scoring: a company in any of our target development stages is a fit —
  // a Phase II company isn't penalised for not also being in Phase I.
  const developmentStagesComponent = makeComponent({
    label: 'Development stages',
    active: icpStages.length > 0,
    available: companyStages.length > 0,
    weight: COMPONENT_WEIGHTS.developmentStages,
    earned:
      icpStages.length > 0 && (hasAllStages || matchedStages > 0)
        ? COMPONENT_WEIGHTS.developmentStages
        : 0,
    matchedValues: matchedStageValues,
    unmatchedValues: unmatchedStageValues,
    detail:
      icpStages.length === 0
        ? 'No development-stage criterion.'
        : companyStages.length === 0
          ? `Development stage not enriched yet; ICP expects ${icpStages.join(', ')}.`
          : hasAllStages
            ? 'Wildcard all-stages match.'
            : matchedStages > 0
              ? `Matches on ${matchedStageValues.join(', ')}.`
              : `No overlap with ICP target ${icpStages.join(', ')}.`,
    matchedCount: matchedStages,
    totalSelected: icpStages.length,
  });

  const icpSizeBuckets = getIcpReferenceSizeBuckets(icp);
  const companySize = getCompanySizeBucket(company);
  const sizeScore = sizeSimilarity(companySize, icpSizeBuckets);
  const companySizeComponent = makeComponent({
    label: 'Company size',
    active: icpSizeBuckets.length > 0,
    available: Boolean(companySize),
    weight: COMPONENT_WEIGHTS.companySize,
    earned:
      icpSizeBuckets.length > 0 && sizeScore != null
        ? COMPONENT_WEIGHTS.companySize * sizeScore
        : 0,
    matchedValues:
      companySize && sizeScore != null && sizeScore > 0
        ? [companySize]
        : [],
    detail:
      icpSizeBuckets.length === 0
        ? 'No company-size criterion.'
        : !companySize
          ? `Company size not enriched yet; ICP expects ${icpSizeBuckets.join(', ')}.`
          : icpSizeBuckets.includes(companySize)
            ? `Size-band match on ${companySize}.`
            : `Size ${companySize} not in ICP target ${icpSizeBuckets.join(', ')}.`,
    matchStatus:
      !companySize
        ? 'unknown'
        : sizeScore === 1
          ? 'exact'
          : 'mismatch',
  });

  const icpFundingStages = dedupe(
    (Array.isArray(icp.funding_stages) ? icp.funding_stages : [])
      .map((value) =>
        canonicalizeFundingStage(
          typeof value === 'string' ? value : null,
          null,
        ),
      )
      .filter((value): value is FundingStage => Boolean(value)),
  );
  const companyFundingStage = canonicalizeFundingStage(
    company.funding_stage,
    company.total_funding_usd,
    company.funding_status_label,
  );
  const stageSimilarity = fundingStageSimilarity(companyFundingStage, icpFundingStages);
  const fundingStageActive = icpFundingStages.length > 0;
  const fundingAvailable = fundingStageActive && companyFundingStage != null;
  const fundingComponent = makeComponent({
    label: 'Funding',
    active: fundingStageActive,
    available: fundingAvailable,
    weight: COMPONENT_WEIGHTS.funding,
    earned: fundingStageActive ? COMPONENT_WEIGHTS.funding * (stageSimilarity ?? 0) : 0,
    matchedValues:
      companyFundingStage && stageSimilarity === 1 ? [companyFundingStage] : [],
    detail:
      !fundingStageActive
        ? 'No funding criterion.'
        : !fundingAvailable
          ? 'Funding maturity is not enriched yet.'
          : companyFundingStage
            ? `Funding stage ${companyFundingStage} compared with ICP target ${icpFundingStages.join(', ')}.`
            : `Funding stage missing; ICP target ${icpFundingStages.join(', ')}.`,
    matchStatus:
      !fundingAvailable
        ? 'unknown'
        : stageSimilarity === 1
          ? 'exact'
          : 'mismatch',
  });

  const components = {
    company_type: companyTypeComponent,
    platform_category: platformCategoryComponent,
    therapeutic_areas: therapeuticAreasComponent,
    modalities: modalitiesComponent,
    development_stages: developmentStagesComponent,
    company_size: companySizeComponent,
    funding: fundingComponent,
  };

  const componentList = Object.values(components);
  const activeWeight = componentList.filter((component) => component.active).reduce((sum, component) => sum + component.weight, 0);
  const availableWeight = componentList
    .filter((component) => component.active && component.available)
    .reduce((sum, component) => sum + component.weight, 0);
  const earnedWeight = componentList.reduce((sum, component) => sum + component.earned, 0);
  const rawScore01 = activeWeight > 0 ? roundScore01(earnedWeight / activeWeight) : 0;
  const coverage01 = activeWeight > 0 ? roundScore01(availableWeight / activeWeight) : 0;
  const scoreCap01 = COMPANY_TYPE_CAPS[companyTypeMatchStatus];
  const finalScore01 = roundScore01(Math.min(rawScore01, scoreCap01));
  const matchedOn = componentList
    .filter((component) => component.active && component.earned > 0)
    .map((component) => component.label);
  const gaps = componentList
    .filter((component) => component.active && component.earned < component.weight)
    .map((component) => component.label);

  const reasoning = [
    icp.name
      ? `Best match against ${icp.name} scores ${scoreToPercent(finalScore01)}%.`
      : `Best ICP match scores ${scoreToPercent(finalScore01)}%.`,
    matchedOn.length > 0
      ? `Matched on ${matchedOn.join(', ')}.`
      : 'No strong company-level matches yet.',
    gaps.length > 0
      ? `Still weaker or unresolved on ${gaps.join(', ')}.`
      : 'All active company criteria align cleanly.',
  ].join(' ');

  return {
    icpId: icp.id,
    icpName: icp.name,
    rawScore01,
    finalScore01,
    scoreCap01,
    coverage01,
    companyTypeMatchStatus,
    breakdown: {
      score_version: SCORE_VERSION,
      matched_on: matchedOn,
      gaps,
      summary: {
        raw_score01: rawScore01,
        final_score01: finalScore01,
        raw_score_pct: scoreToPercent(rawScore01),
        final_score_pct: scoreToPercent(finalScore01),
        score_cap01: scoreCap01,
        coverage01,
        reasoning,
      },
      components,
    },
  };
}

function pickWinner(scores: CompanyIcpScoreResult[]): CompanyIcpScoreResult | null {
  if (scores.length === 0) return null;

  return [...scores].sort((left, right) => {
    if (right.finalScore01 !== left.finalScore01) {
      return right.finalScore01 - left.finalScore01;
    }
    if (right.coverage01 !== left.coverage01) {
      return right.coverage01 - left.coverage01;
    }
    if (right.rawScore01 !== left.rawScore01) {
      return right.rawScore01 - left.rawScore01;
    }
    return (left.icpName || left.icpId).localeCompare(right.icpName || right.icpId);
  })[0];
}

function buildContactFitFields(winner: CompanyIcpScoreResult | null): {
  fit_score: number;
  fit_score_reasoning: string;
  fit_score_matched_on: string[];
  fit_score_gaps: string | null;
} {
  if (!winner) {
    return {
      fit_score: 0,
      fit_score_reasoning: 'No ICPs defined yet.',
      fit_score_matched_on: [],
      fit_score_gaps: 'No ICPs to score against.',
    };
  }

  return {
    fit_score: winner.finalScore01,
    fit_score_reasoning: winner.breakdown.summary.reasoning,
    fit_score_matched_on: winner.breakdown.matched_on,
    fit_score_gaps: winner.breakdown.gaps.length > 0 ? winner.breakdown.gaps.join(', ') : null,
  };
}

async function loadIcpsForUser(supabase: MinimalSupabase, userId: string): Promise<IcpScoreRow[]> {
  const { data, error } = await supabase
    .from('icps')
    .select(
      'id, name, company_type, platform_category, therapeutic_areas, modalities, development_stages, company_sizes, funding_stages, example_company_enrichment',
    )
    .eq('user_id', userId);

  if (error) {
    throw error;
  }

  return ((data || []) as IcpScoreRow[]).map((row) => ({
    ...row,
    example_company_enrichment:
      row.example_company_enrichment &&
      typeof row.example_company_enrichment === 'object' &&
      !Array.isArray(row.example_company_enrichment)
        ? (row.example_company_enrichment as Record<string, unknown>)
        : null,
  }));
}

async function loadCompaniesById(
  supabase: MinimalSupabase,
  userId: string,
  companyIds: string[],
): Promise<CompanyScoreRow[]> {
  const { data, error } = await supabase
    .from('companies')
    .select(
      'id, user_id, company_name, domain, company_type, platform_category, therapeutic_areas, modalities, development_stages, clinical_stage, company_size_bucket, employee_count, employee_range, funding_stage, funding_status_label, total_funding_usd',
    )
    .eq('user_id', userId)
    .in('id', companyIds);

  if (error) {
    throw error;
  }

  return (data || []) as CompanyScoreRow[];
}

async function loadExistingScores(
  supabase: MinimalSupabase,
  userId: string,
  companyIds: string[],
): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from('company_icp_scores')
    .select('company_id, icp_id')
    .eq('user_id', userId)
    .in('company_id', companyIds);

  if (error) {
    throw error;
  }

  const map = new Map<string, string[]>();
  for (const row of (data || []) as ExistingScoreRow[]) {
    const current = map.get(row.company_id) || [];
    current.push(row.icp_id);
    map.set(row.company_id, current);
  }
  return map;
}

async function clearCompanyFit(
  supabase: MinimalSupabase,
  userId: string,
  companyId: string,
): Promise<number> {
  const now = new Date().toISOString();

  const deleteResult = await supabase
    .from('company_icp_scores')
    .delete()
    .eq('user_id', userId)
    .eq('company_id', companyId);

  if (deleteResult.error) {
    throw deleteResult.error;
  }

  const companyUpdateResult = await supabase
    .from('companies')
    .update({
      matched_icp_id: null,
      company_fit_score: 0,
      company_fit_breakdown: null,
      company_fit_coverage: null,
      company_fit_scored_at: now,
      company_fit_version: SCORE_VERSION,
      updated_at: now,
    })
    .eq('user_id', userId)
    .eq('id', companyId);

  if (companyUpdateResult.error) {
    throw companyUpdateResult.error;
  }

  // Dual-write: per-user scoring state lives in user_companies going forward.
  await supabase
    .from('user_companies')
    .upsert(
      {
        user_id: userId,
        company_id: companyId,
        matched_icp_id: null,
        company_fit_score: 0,
        company_fit_breakdown: null,
        company_fit_coverage: null,
        company_fit_scored_at: now,
        company_fit_version: SCORE_VERSION,
        updated_at: now,
      },
      { onConflict: 'user_id,company_id' },
    );

  const { data: contacts, error: contactUpdateError } = await supabase
    .from('contacts')
    .update({
      fit_score: 0,
      fit_score_reasoning: 'No ICPs defined yet.',
      fit_score_matched_on: [],
      fit_score_gaps: 'No ICPs to score against.',
      updated_at: now,
    })
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .select('id');

  if (contactUpdateError) {
    throw contactUpdateError;
  }

  return (contacts || []).length;
}

async function persistScoresForCompany(
  supabase: MinimalSupabase,
  userId: string,
  companyId: string,
  scores: CompanyIcpScoreResult[],
  staleIcpIds: string[],
): Promise<number> {
  const now = new Date().toISOString();
  const winner = pickWinner(scores);

  if (scores.length > 0) {
    const rows = scores.map((score) => ({
      user_id: userId,
      company_id: companyId,
      icp_id: score.icpId,
      final_score: score.finalScore01,
      raw_score: score.rawScore01,
      score_cap: score.scoreCap01,
      company_type_match_status: score.companyTypeMatchStatus,
      breakdown: score.breakdown,
      coverage: score.coverage01,
      scored_at: now,
      score_version: SCORE_VERSION,
    }));

    const upsertResult = await supabase
      .from('company_icp_scores')
      .upsert(rows, { onConflict: 'company_id,icp_id' });

    if (upsertResult.error) {
      throw upsertResult.error;
    }
  }

  if (staleIcpIds.length > 0) {
    const deleteResult = await supabase
      .from('company_icp_scores')
      .delete()
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .in('icp_id', staleIcpIds);

    if (deleteResult.error) {
      throw deleteResult.error;
    }
  }

  const companyUpdate = await supabase
    .from('companies')
    .update({
      matched_icp_id: winner?.icpId ?? null,
      company_fit_score: winner?.finalScore01 ?? 0,
      company_fit_breakdown: winner?.breakdown ?? null,
      company_fit_coverage: winner?.coverage01 ?? null,
      company_fit_scored_at: now,
      company_fit_version: SCORE_VERSION,
      updated_at: now,
    })
    .eq('user_id', userId)
    .eq('id', companyId);

  if (companyUpdate.error) {
    throw companyUpdate.error;
  }

  // Dual-write to user_companies (per-user scoring source of truth going forward).
  await supabase
    .from('user_companies')
    .upsert(
      {
        user_id: userId,
        company_id: companyId,
        matched_icp_id: winner?.icpId ?? null,
        company_fit_score: winner?.finalScore01 ?? 0,
        company_fit_breakdown: winner?.breakdown ?? null,
        company_fit_coverage: winner?.coverage01 ?? null,
        company_fit_scored_at: now,
        company_fit_version: SCORE_VERSION,
        updated_at: now,
      },
      { onConflict: 'user_id,company_id' },
    );

  const fitFields = buildContactFitFields(winner);
  const contactUpdate = await supabase
    .from('contacts')
    .update({
      fit_score: fitFields.fit_score,
      fit_score_reasoning: fitFields.fit_score_reasoning,
      fit_score_matched_on: fitFields.fit_score_matched_on,
      fit_score_gaps: fitFields.fit_score_gaps,
      updated_at: now,
    })
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .select('id');

  if (contactUpdate.error) {
    throw contactUpdate.error;
  }

  return (contactUpdate.data || []).length;
}

export async function syncCompanyFitForCompanies(
  supabase: MinimalSupabase,
  userId: string,
  companyIds: string[],
): Promise<CompanyFitSyncResult> {
  const uniqueCompanyIds = [...new Set(companyIds.filter(Boolean))];
  if (uniqueCompanyIds.length === 0) {
    return { companiesScored: 0, contactsSynced: 0, failed: 0, skipped: 0 };
  }

  const [icps, companies, existingScores] = await Promise.all([
    loadIcpsForUser(supabase, userId),
    loadCompaniesById(supabase, userId, uniqueCompanyIds),
    loadExistingScores(supabase, userId, uniqueCompanyIds),
  ]);

  const result: CompanyFitSyncResult = {
    companiesScored: 0,
    contactsSynced: 0,
    failed: 0,
    skipped: 0,
  };

  for (const companyId of uniqueCompanyIds) {
    const company = companies.find((candidate) => candidate.id === companyId);
    if (!company) {
      result.skipped += 1;
      continue;
    }

    try {
      if (icps.length === 0) {
        result.contactsSynced += await clearCompanyFit(supabase, userId, companyId);
        result.companiesScored += 1;
        continue;
      }

      const scores = icps.map((icp) => computeCompanyIcpScore(company, icp));
      const expectedIcpIds = new Set(scores.map((score) => score.icpId));
      const staleIcpIds = (existingScores.get(companyId) || []).filter(
        (icpId) => !expectedIcpIds.has(icpId),
      );

      result.contactsSynced += await persistScoresForCompany(
        supabase,
        userId,
        companyId,
        scores,
        staleIcpIds,
      );
      result.companiesScored += 1;
    } catch (error) {
      result.failed += 1;
      console.error('[company-fit] Failed scoring company', companyId, error);
    }
  }

  return result;
}

export async function syncCompanyFitForCompany(
  supabase: MinimalSupabase,
  userId: string,
  companyId: string,
): Promise<CompanyFitSyncResult> {
  return syncCompanyFitForCompanies(supabase, userId, [companyId]);
}

export async function rescoreAllCompanyFitForUser(userId: string): Promise<CompanyFitSyncResult> {
  const supabase = createAdminClient();

  const { data: companies, error } = await supabase
    .from('companies')
    .select('id')
    .eq('user_id', userId);

  if (error) {
    throw error;
  }

  const result = await syncCompanyFitForCompanies(
    supabase,
    userId,
    ((companies || []) as Array<{ id: string }>).map((row) => row.id),
  );

  const unlinkedContactUpdate = await supabase
    .from('contacts')
    .update({
      fit_score: 0,
      fit_score_reasoning: 'No linked company to score yet.',
      fit_score_matched_on: [],
      fit_score_gaps: 'No linked company to score against your ICPs.',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .is('company_id', null);

  if (unlinkedContactUpdate.error) {
    throw unlinkedContactUpdate.error;
  }

  return result;
}
