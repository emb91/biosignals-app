import { employeeCountToSizeBucket } from '@/lib/arcova-taxonomy';
import { createAdminClient } from '@/lib/supabase-admin';
import { orgIdForUser, scopeIcpsToUser } from '@/lib/org-context';
import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';

const SCORE_VERSION = 'company_fit_llm_v3';

// UI component weights. The LLM supplies each component's score; these weights
// only keep the persisted breakdown compatible with the existing account views.
const COMPONENT_WEIGHTS = {
  companyType: 45,
  offering: 25,
  developmentStages: 10,
  funding: 10,
  companySize: 10,
} as const;

type MinimalSupabase = {
  from: (table: string) => any;
};

type CompanyTypeMatchStatus = 'exact' | 'unknown' | 'mismatch' | 'not_applicable';

type CompanyScoreRow = {
  id: string;
  company_name: string | null;
  domain: string | null;
  website?: string | null;
  description?: string | null;
  bio_summary?: string | null;
  tagline?: string | null;
  industry?: string | null;
  sub_industry?: string | null;
  company_type: string | null;
  company_type_display?: string | null;
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
  specialties?: string[] | null;
  products_services?: string[] | null;
  services?: string[] | null;
  technologies?: string[] | null;
};

type IcpScoreRow = {
  id: string;
  name: string | null;
  icpIndex: number | null;
  company_type: string | null;
  platform_category: string | null;
  therapeutic_areas: string[] | null;
  modalities: string[] | null;
  development_stages: string[] | null;
  company_sizes: string[] | null;
  funding_stages: string[] | null;
  target_customers?: string[] | null;
  buyer_types?: string[] | null;
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
    // "offering" merges modalities + therapeutic_areas + platform_category into
    // one archetype-agnostic "what they work on" check (hit on any = full).
    offering: BreakdownComponent;
    development_stages: BreakdownComponent;
    company_size: BreakdownComponent;
    funding: BreakdownComponent;
  };
};

type CompanyIcpScoreResult = {
  icpId: string;
  icpName: string | null;
  icpIndex: number | null;
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

function roundScore01(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function scoreToPercent(value01: number): number {
  return Math.round(value01 * 100);
}

function cleanTextList(values: unknown, limit = 12): string[] {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean),
  )].slice(0, limit);
}

function fmtList(values: unknown, fallback = 'Not specified'): string {
  const list = cleanTextList(values);
  return list.length > 0 ? list.join(', ') : fallback;
}

function formatCompanyForLlm(company: CompanyScoreRow): string {
  return [
    `Company id: ${company.id}`,
    `Name: ${company.company_name || 'Unknown'}`,
    `Domain: ${company.domain || company.website || 'Unknown'}`,
    `Tagline: ${company.tagline || 'Unknown'}`,
    `Description: ${company.bio_summary || company.description || 'Unknown'}`,
    `Industry: ${[company.industry, company.sub_industry].filter(Boolean).join(' / ') || 'Unknown'}`,
    `Enriched company type: ${company.company_type_display || company.company_type || 'Unknown'}`,
    `Platform category: ${company.platform_category || 'Unknown'}`,
    `Therapeutic areas: ${fmtList(company.therapeutic_areas, 'Unknown')}`,
    `Modalities: ${fmtList(company.modalities, 'Unknown')}`,
    `Development stages: ${fmtList(company.development_stages, company.clinical_stage || 'Unknown')}`,
    `Company size: ${company.company_size_bucket || employeeCountToSizeBucket(company.employee_count, company.employee_range)[0] || company.employee_range || 'Unknown'}`,
    `Funding: ${[company.funding_stage, company.funding_status_label, company.total_funding_usd != null ? `$${company.total_funding_usd}` : null].filter(Boolean).join(' / ') || 'Unknown'}`,
    `Specialties: ${fmtList(company.specialties, 'Unknown')}`,
    `Products/services: ${fmtList([...(company.products_services || []), ...(company.services || []), ...(company.technologies || [])], 'Unknown')}`,
  ].join('\n');
}

function formatIcpForLlm(icp: IcpScoreRow): string {
  const example = icp.example_company_enrichment ?? {};
  const exampleDescription = Array.isArray(example.description)
    ? example.description.filter((value): value is string => typeof value === 'string').slice(0, 2).join(' ')
    : typeof example.description === 'string'
      ? example.description
      : '';

  return [
    `ICP id: ${icp.id}`,
    `ICP name: ${icp.name || 'Unnamed ICP'}`,
    `Company type: ${icp.company_type || 'Not specified'}`,
    `Platform category: ${icp.platform_category || 'Not specified'}`,
    `Therapeutic areas: ${fmtList(icp.therapeutic_areas)}`,
    `Modalities: ${fmtList(icp.modalities)}`,
    `Development stages: ${fmtList(icp.development_stages)}`,
    `Company sizes: ${fmtList(icp.company_sizes)}`,
    `Funding stages: ${fmtList(icp.funding_stages)}`,
    `Target customers: ${fmtList(icp.target_customers)}`,
    `Buyer types: ${fmtList(icp.buyer_types)}`,
    exampleDescription ? `Reference-company description: ${exampleDescription}` : '',
  ].filter(Boolean).join('\n');
}

type LlmCompanyFitComponent = {
  score?: unknown;
  detail?: unknown;
  matched_values?: unknown;
  gaps?: unknown;
  available?: unknown;
};

type LlmCompanyFitItem = {
  icp_id?: unknown;
  icp_name?: unknown;
  score?: unknown;
  coverage?: unknown;
  reasoning?: unknown;
  matched_on?: unknown;
  gaps?: unknown;
  components?: unknown;
};

function number01(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : NaN;
  if (!Number.isFinite(n)) return 0;
  return roundScore01(n > 1 ? n / 100 : n);
}

function stringArray(value: unknown): string[] {
  return cleanTextList(value, 20);
}

function llmComponent(
  components: Record<string, LlmCompanyFitComponent>,
  key: keyof ScoreBreakdown['components'],
  label: string,
  weight: number,
): BreakdownComponent {
  const component = components[key] ?? {};
  const score01 = number01(component.score);
  const matchedValues = stringArray(component.matched_values);
  const unmatchedValues = stringArray(component.gaps);
  return makeComponent({
    label,
    active: true,
    available: typeof component.available === 'boolean' ? component.available : true,
    weight,
    earned: weight * score01,
    detail:
      typeof component.detail === 'string' && component.detail.trim()
        ? component.detail.trim()
        : `${label} scored ${scoreToPercent(score01)}% by the LLM fit scorer.`,
    matchedCount: matchedValues.length,
    matchedValues,
    unmatchedValues,
    matchStatus: score01 >= 0.8 ? 'strong' : score01 >= 0.45 ? 'partial' : 'weak',
  });
}

function fallbackScoreForIcp(company: CompanyScoreRow, icp: IcpScoreRow, reason: string): CompanyIcpScoreResult {
  const component = (label: string, weight: number) => makeComponent({
    label,
    active: true,
    available: false,
    weight,
    earned: 0,
    detail: reason,
    matchStatus: 'unknown',
  });
  const components = {
    company_type: component('Company type', COMPONENT_WEIGHTS.companyType),
    offering: component('Offering', COMPONENT_WEIGHTS.offering),
    development_stages: component('Development stages', COMPONENT_WEIGHTS.developmentStages),
    company_size: component('Company size', COMPONENT_WEIGHTS.companySize),
    funding: component('Funding', COMPONENT_WEIGHTS.funding),
  };
  return {
    icpId: icp.id,
    icpName: icp.name,
    icpIndex: icp.icpIndex,
    rawScore01: 0,
    finalScore01: 0,
    scoreCap01: 1,
    coverage01: 0,
    companyTypeMatchStatus: 'unknown',
    breakdown: {
      score_version: SCORE_VERSION,
      matched_on: [],
      gaps: ['LLM scoring unavailable'],
      summary: {
        raw_score01: 0,
        final_score01: 0,
        raw_score_pct: 0,
        final_score_pct: 0,
        score_cap01: 1,
        coverage01: 0,
        reasoning: `${company.company_name || 'This company'} was not scored against ${icp.name || 'this ICP'} because ${reason}`,
      },
      components,
    },
  };
}

function parseCompanyFitResponse(text: string): LlmCompanyFitItem[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`Could not parse company-fit response: ${text.slice(0, 240)}`);
  const parsed = JSON.parse(jsonMatch[0]) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Company-fit response was not a JSON array');
  return parsed as LlmCompanyFitItem[];
}

async function scoreCompanyAgainstIcps(
  company: CompanyScoreRow,
  icps: IcpScoreRow[],
  userId: string,
): Promise<CompanyIcpScoreResult[]> {
  const prompt = `You score whether a company is a fit for each ICP. Use judgment, not exact keyword matching.

This score determines account priority and whether the system may later buy contacts, so be conservative:
- High fit means the company itself matches the ICP's intended buyer/account profile, not merely that one word overlaps.
- Insurance payers, pet/veterinary companies, media, associations, and generic services companies should score very low unless the ICP explicitly targets them.
- Hospitals, CROs, CDMOs, universities, and research institutes can be valid only when the ICP company type and buying context actually targets them.
- Academic or university organizations can fit tools/research ICPs when the evidence points to researchers/labs, but not when it is university administration.
- Do not punish missing enrichment fields too harshly when the description clearly establishes fit; do punish contradictory evidence.

COMPANY:
${formatCompanyForLlm(company)}

ICPS:
${icps.map(formatIcpForLlm).join('\n\n---\n\n')}

Return ONLY a valid JSON array with one object per ICP:
[
  {
    "icp_id": "<ICP id exactly as provided>",
    "icp_name": "<ICP name>",
    "score": <integer 0-100>,
    "coverage": <integer 0-100, how much evidence was available to judge fit>,
    "reasoning": "<2 concise sentences>",
    "matched_on": ["company type", "offering", "stage", "size", "funding"],
    "gaps": ["specific missing or mismatched evidence"],
    "components": {
      "company_type": { "score": <0-100>, "available": true, "detail": "...", "matched_values": [], "gaps": [] },
      "offering": { "score": <0-100>, "available": true, "detail": "...", "matched_values": [], "gaps": [] },
      "development_stages": { "score": <0-100>, "available": true, "detail": "...", "matched_values": [], "gaps": [] },
      "company_size": { "score": <0-100>, "available": true, "detail": "...", "matched_values": [], "gaps": [] },
      "funding": { "score": <0-100>, "available": true, "detail": "...", "matched_values": [], "gaps": [] }
    }
  }
]`;

  const completion = await completeLlm({
    feature: 'company_fit_scoring',
    prompt,
    maxTokens: 3500,
    temperature: 0,
  });

  await recordLlmUsageEvent({
    userId,
    provider: completion.provider,
    feature: 'company_fit_scoring',
    route: 'lib/company-fit#scoreCompanyAgainstIcps',
    model: completion.model,
    usage: completion.usage,
    metadata: {
      company_id: company.id,
      icp_count: icps.length,
    },
  });

  const parsed = parseCompanyFitResponse(completion.text);
  return icps.map((icp) => {
    const item =
      parsed.find((candidate) => candidate.icp_id === icp.id) ??
      parsed.find((candidate) => candidate.icp_name === icp.name);
    if (!item) {
      return fallbackScoreForIcp(company, icp, 'the LLM did not return a score for this ICP.');
    }

    const componentsInput =
      item.components && typeof item.components === 'object' && !Array.isArray(item.components)
        ? (item.components as Record<string, LlmCompanyFitComponent>)
        : {};
    const finalScore01 = number01(item.score);
    const coverage01 = number01(item.coverage);
    const components = {
      company_type: llmComponent(componentsInput, 'company_type', 'Company type', COMPONENT_WEIGHTS.companyType),
      offering: llmComponent(componentsInput, 'offering', 'Offering', COMPONENT_WEIGHTS.offering),
      development_stages: llmComponent(componentsInput, 'development_stages', 'Development stages', COMPONENT_WEIGHTS.developmentStages),
      company_size: llmComponent(componentsInput, 'company_size', 'Company size', COMPONENT_WEIGHTS.companySize),
      funding: llmComponent(componentsInput, 'funding', 'Funding', COMPONENT_WEIGHTS.funding),
    };
    const matchedOn = stringArray(item.matched_on);
    const gaps = stringArray(item.gaps);
    const companyTypeScore = components.company_type.score01;

    return {
      icpId: icp.id,
      icpName: icp.name,
      icpIndex: icp.icpIndex,
      rawScore01: finalScore01,
      finalScore01,
      scoreCap01: 1,
      coverage01,
      companyTypeMatchStatus:
        companyTypeScore >= 0.75
          ? 'exact'
          : companyTypeScore <= 0.25
            ? 'mismatch'
            : 'unknown',
      breakdown: {
        score_version: SCORE_VERSION,
        matched_on: matchedOn,
        gaps,
        summary: {
          raw_score01: finalScore01,
          final_score01: finalScore01,
          raw_score_pct: scoreToPercent(finalScore01),
          final_score_pct: scoreToPercent(finalScore01),
          score_cap01: 1,
          coverage01,
          reasoning:
            typeof item.reasoning === 'string' && item.reasoning.trim()
              ? item.reasoning.trim()
              : `${company.company_name || 'This company'} scored ${scoreToPercent(finalScore01)}% against ${icp.name || 'this ICP'} by the LLM fit scorer.`,
        },
        components,
      },
    };
  });
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

function buildCompanyFitSummary(
  company: CompanyScoreRow,
  winner: CompanyIcpScoreResult | null,
): string {
  const companyLabel = company.company_name?.trim() || 'This company';
  if (!winner) {
    return `${companyLabel} has no ICP fit winner yet, so company fit is low until ICP criteria and profile evidence are available.`;
  }
  const scorePct = Math.round(winner.finalScore01 * 100);
  const icpName = winner.icpName?.trim() || 'the best-matching ICP';
  const icpLabel =
    winner.icpIndex != null
      ? `your ICP ${winner.icpIndex} ${icpName}`
      : icpName;
  const matched = winner.breakdown.matched_on.length > 0
    ? winner.breakdown.matched_on.join(', ').toLowerCase()
    : 'limited criteria overlap';
  return `${companyLabel} is currently ${scorePct}% aligned to ${icpLabel}, with strongest fit evidence in ${matched}.`;
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
  // Org-scoped: company-wide ICPs + this user's own personal ICPs (see scopeIcpsToUser).
  // For a solo owner this is exactly their own ICPs — behavior-preserving.
  const orgId = await orgIdForUser(supabase, userId);
  const { data, error } = await scopeIcpsToUser(
    supabase
      .from('icps')
      .select(
        'id, name, created_at, company_type, platform_category, therapeutic_areas, modalities, development_stages, company_sizes, funding_stages, target_customers, buyer_types, example_company_enrichment',
      ),
    orgId,
    userId,
  ).order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return ((data || []) as Array<Omit<IcpScoreRow, 'icpIndex'> & { created_at?: string | null }>).map((row, index) => ({
    ...row,
    icpIndex: index + 1,
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
      'id, company_name, domain, website, description, bio_summary, tagline, industry, sub_industry, company_type, company_type_display, platform_category, therapeutic_areas, modalities, development_stages, clinical_stage, company_size_bucket, employee_count, employee_range, funding_stage, funding_status_label, total_funding_usd, specialties, products_services, services, technologies',
    )
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

  // Per-user scoring state lives in user_companies.
  const userCompanyUpdateResult = await supabase
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
        company_fit_summary: 'This company has no ICP fit winner yet, so company fit is low until ICP criteria and profile evidence are available.',
        updated_at: now,
      },
      { onConflict: 'user_id,company_id' },
    );
  if (userCompanyUpdateResult.error) {
    throw userCompanyUpdateResult.error;
  }

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
  company: CompanyScoreRow,
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

  // Per-user scoring state lives in user_companies.
  const userCompanyUpdate = await supabase
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
        company_fit_summary: buildCompanyFitSummary(company, winner ?? null),
        updated_at: now,
      },
      { onConflict: 'user_id,company_id' },
    );
  if (userCompanyUpdate.error) {
    throw userCompanyUpdate.error;
  }

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

      const scores = await scoreCompanyAgainstIcps(company, icps, userId);
      const expectedIcpIds = new Set(scores.map((score) => score.icpId));
      const staleIcpIds = (existingScores.get(companyId) || []).filter(
        (icpId) => !expectedIcpIds.has(icpId),
      );

      result.contactsSynced += await persistScoresForCompany(
        supabase,
        userId,
        company,
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
    .from('user_companies')
    .select('company_id')
    .eq('user_id', userId);

  if (error) {
    throw error;
  }

  const result = await syncCompanyFitForCompanies(
    supabase,
    userId,
    ((companies || []) as Array<{ company_id: string }>).map((row) => row.company_id),
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
