import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase-server';
import { getLeadActionFromFits } from '@/lib/lead-action';
import {
  formatDataProvenanceTypeOnly,
  resolveContactDataProvenance,
} from '@/lib/data-provenance';
import { normalizePlatformTaxonomyFields } from '@/lib/platform-category';

const anthropic = new Anthropic();

export const VALID_COLUMNS = [
  'name',
  'job_title',
  'company',
  'status',
  'company_fit',
  'contact_fit',
  'source',
  'signals',
  'icp_match',
  'funding_stage',
  'therapeutic_areas',
  'seniority',
] as const;

export type QueryColumn = (typeof VALID_COLUMNS)[number];

export type SortBy =
  | 'status_best_first'
  | 'status_worst_first'
  | 'company_fit_desc'
  | 'company_fit_asc'
  | 'contact_fit_desc'
  | null;

export interface QueryFilters {
  actions?: string[]; // 'reach_out' | 'source_contact' | 'monitor' | 'deprioritize'
  minCompanyFit?: number; // 0–1
  maxCompanyFit?: number;
  hasSignal?: boolean;
  companyTypes?: string[];
  fundingStages?: string[];
  therapeuticAreas?: string[];
  modalities?: string[];
  seniorityKeywords?: string[];
  titleKeywords?: string[];
  nameSearch?: string;
  companyNameSearch?: string;
  sources?: string[]; // 'HubSpot' | 'CSV' | 'Arcova'
  sortBy?: SortBy;
}

export interface AgentQueryResult {
  interpretation: string | null;
  columns: QueryColumn[];
  leads: QueryLead[];
  conversational: string | null;
}

export interface QueryLead {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  resolved_current_job_title: string | null;
  seniority_level: string | null;
  company_name: string | null;
  resolved_current_company_name: string | null;
  company_id: string | null;
  company_domain: string | null;
  company_fit_score: number | null;
  contact_fit_score: number | null;
  intent_score: number | null;
  source: string | null;
  data_provenance_type: string | null;
  matched_icp_name: string | null;
  matched_icp_label: string | null;
  companies: {
    company_type?: string | null;
    company_type_display?: string | null;
    funding_stage?: string | null;
    therapeutic_areas?: string[] | null;
    modalities?: string[] | null;
    company_fit_score?: number | null;
    domain?: string | null;
    website?: string | null;
  } | null;
}

const SYSTEM_PROMPT = `You are an AI agent for Arcova, a life sciences go-to-market workspace. Interpret natural language queries about contacts/leads and return structured JSON.

Contact data available:
- name (full_name, first_name, last_name)
- job_title (raw job title text)
- seniority_level: "Director", "VP", "C-Suite", "Manager", "Senior", "Associate", "Entry"
- business_area: "Manufacturing", "Scientific/Technical", "Commercial", "Finance", "Operations"
- company_name
- company_fit_score: 0–1 (composite: company type, TA, modality, dev stage, size, funding)
- contact_fit_score: 0–1 (right function + right seniority for the ICP)
- intent_score: number >0 means the contact has fired a buying signal (e.g. job change, promotion)
- source / data_provenance_type: "HubSpot", "CSV", "Arcova"

Company data (joined):
- company_type: "CDMO", "Biotech", "CRO", "Pharma", "Academic", "Hospital", "MedTech", "AgBio"
- funding_stage: "Pre-Seed", "Seed", "Series A", "Series B", "Series C", "Series D+", "Public", "Private Equity", "Unknown"
- therapeutic_areas: ["Oncology", "Rare Disease", "Immunology", "Neuroscience", "Cardiovascular", "Infectious Disease", "Metabolic", "Ophthalmology"]
- modalities: ["Small Molecule", "Biologics", "Cell Therapy", "Gene Therapy", "ADC", "mRNA", "Oligonucleotide", "Diagnostics"]

Computed status (from fit scores):
- "reach_out": company_fit >= 0.5 AND contact_fit >= 0.65 AND has_signal (ready to engage now)
- "source_contact": company_fit >= 0.5 AND contact_fit < 0.65 (good company, need better contact)
- "monitor": company_fit >= 0.45, not source/reach_out (watch and wait)
- "deprioritize": company_fit < 0.45 (not a fit)

Available display columns (MUST pick from this list exactly):
name, job_title, company, status, company_fit, contact_fit, source, signals, icp_match, funding_stage, therapeutic_areas, seniority

Return JSON with this exact shape:
{
  "interpretation": "...",  // one short phrase, e.g. "Sorting by status: Deprioritise first" or "Filtering by: status = Reach out"
  "columns": ["name", "job_title", "company", "status"],  // ordered list from valid columns
  "sortBy": null,  // one of: "status_best_first" | "status_worst_first" | "company_fit_desc" | "company_fit_asc" | "contact_fit_desc" | null
  "filters": {
    "actions": null,          // e.g. ["reach_out", "source_contact"]
    "minCompanyFit": null,    // 0–1 number
    "maxCompanyFit": null,
    "hasSignal": null,        // true if they must have a signal
    "companyTypes": null,     // e.g. ["CDMO", "CRO"]
    "fundingStages": null,    // e.g. ["Series B", "Series C"]
    "therapeuticAreas": null, // e.g. ["Oncology"]
    "modalities": null,
    "seniorityKeywords": null,// e.g. ["Director", "VP"]
    "titleKeywords": null,    // keywords to match in job title
    "nameSearch": null,       // search in contact's own name
    "companyNameSearch": null, // search in company name (e.g. "show me Enzene only" → "Enzene")
    "sources": null           // ["HubSpot", "CSV", "Arcova"]
  },
  "conversational": null      // set this if query is truly uninterpretable; leave null otherwise
}

COLUMN RULES — be conservative, only add columns when the query explicitly asks about that data:
- Default columns are always: ["name", "job_title", "company", "status"]
- Add "company_fit" only if the user asks about company fit, scores, or fit percentages
- Add "contact_fit" only if the user asks about contact fit or persona fit
- Add "signals" only if the user asks about signals or buying signals
- Add "icp_match" only if the user asks about ICP
- Add "funding_stage" only if the user asks about funding or investment stage
- Add "therapeutic_areas" only if the user asks about therapeutic areas or disease areas
- Add "seniority" only if the user asks about seniority
- Add "source" only if the user asks about data source or where contacts came from
- For sort/organise/order queries, keep the default columns — do NOT add extra columns

SORT RULES:
- "deprioritised first" / "worst first" / "lowest fit first" → sortBy: "status_worst_first"
- "best first" / "highest fit" / "reach out first" → sortBy: "status_best_first"
- "sort by company fit" → sortBy: "company_fit_desc"
- "sort by contact fit" → sortBy: "contact_fit_desc"

FILTER RULES:
- "who should I reach out to" → actions: ["reach_out"]
- "good fit" / "high fit" → minCompanyFit: 0.7
- "haven't actioned" / "not actioned" → actions: ["monitor", "source_contact"]
- "recent signal" / "has signal" → hasSignal: true, add "signals" column
- Always respond with valid JSON only, no markdown fences.`;

function isMissingColumnError(error: unknown): boolean {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : '';
  return message.includes('column') && message.includes('does not exist');
}

function normalizeCompanyRow(row: Record<string, unknown>): Record<string, unknown> {
  return normalizePlatformTaxonomyFields({
    company_name: row.company_name ?? null,
    domain: row.domain ?? null,
    website: row.website ?? row.company_website ?? null,
    linkedin_url: row.linkedin_url ?? null,
    description: null,
    bio_summary: null,
    tagline: null,
    logo_url: row.logo_url ?? null,
    follower_count: null,
    industry: row.industry ?? null,
    employee_count: row.employee_count ?? null,
    employee_range: row.employee_range ?? null,
    founded_year: null,
    headquarters_city: null,
    headquarters_state: null,
    headquarters_country: null,
    specialties: null,
    company_type: row.company_type ?? null,
    company_type_display: row.company_type_display ?? null,
    platform_category: row.platform_category ?? null,
    funding_stage: row.funding_stage ?? null,
    funding_status_label: null,
    total_funding_usd: null,
    latest_funding_date: null,
    funding_data_source: null,
    therapeutic_areas: row.therapeutic_areas ?? row.therapeutic_area ?? null,
    modalities: row.modalities ?? row.modality ?? null,
    development_stages: null,
    clinical_stage: null,
    matched_icp_id: row.matched_icp_id ?? null,
    company_fit_score: row.company_fit_score ?? null,
    last_enriched_at: row.last_enriched_at ?? row.updated_at ?? null,
  });
}

async function callClaude(query: string): Promise<{
  interpretation: string | null;
  columns: QueryColumn[];
  filters: QueryFilters;
  sortBy: SortBy;
  conversational: string | null;
}> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Query: "${query}"` }],
  });

  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  let parsed: {
    interpretation?: string | null;
    columns?: string[] | null;
    sortBy?: string | null;
    filters?: Record<string, unknown> | null;
    conversational?: string | null;
  };

  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      interpretation: null,
      columns: ['name', 'job_title', 'company', 'status'],
      filters: {},
      sortBy: null,
      conversational: "I had trouble understanding that query. Try something like 'Show me contacts ready to reach out to'.",
    };
  }

  const validCols = (parsed.columns || []).filter((c): c is QueryColumn =>
    VALID_COLUMNS.includes(c as QueryColumn)
  );
  const cols: QueryColumn[] =
    validCols.length > 0 ? validCols : ['name', 'job_title', 'company', 'status'];

  const rawFilters = parsed.filters || {};
  const filters: QueryFilters = {
    actions: Array.isArray(rawFilters.actions) ? (rawFilters.actions as string[]) : undefined,
    minCompanyFit:
      typeof rawFilters.minCompanyFit === 'number' ? rawFilters.minCompanyFit : undefined,
    maxCompanyFit:
      typeof rawFilters.maxCompanyFit === 'number' ? rawFilters.maxCompanyFit : undefined,
    hasSignal: typeof rawFilters.hasSignal === 'boolean' ? rawFilters.hasSignal : undefined,
    companyTypes: Array.isArray(rawFilters.companyTypes)
      ? (rawFilters.companyTypes as string[])
      : undefined,
    fundingStages: Array.isArray(rawFilters.fundingStages)
      ? (rawFilters.fundingStages as string[])
      : undefined,
    therapeuticAreas: Array.isArray(rawFilters.therapeuticAreas)
      ? (rawFilters.therapeuticAreas as string[])
      : undefined,
    modalities: Array.isArray(rawFilters.modalities)
      ? (rawFilters.modalities as string[])
      : undefined,
    seniorityKeywords: Array.isArray(rawFilters.seniorityKeywords)
      ? (rawFilters.seniorityKeywords as string[])
      : undefined,
    titleKeywords: Array.isArray(rawFilters.titleKeywords)
      ? (rawFilters.titleKeywords as string[])
      : undefined,
    nameSearch: typeof rawFilters.nameSearch === 'string' ? rawFilters.nameSearch : undefined,
    companyNameSearch:
      typeof rawFilters.companyNameSearch === 'string' ? rawFilters.companyNameSearch : undefined,
    sources: Array.isArray(rawFilters.sources) ? (rawFilters.sources as string[]) : undefined,
  };

  const VALID_SORTS: SortBy[] = [
    'status_best_first',
    'status_worst_first',
    'company_fit_desc',
    'company_fit_asc',
    'contact_fit_desc',
  ];
  const sortBy: SortBy =
    typeof parsed.sortBy === 'string' && VALID_SORTS.includes(parsed.sortBy as SortBy)
      ? (parsed.sortBy as SortBy)
      : null;

  return {
    interpretation: typeof parsed.interpretation === 'string' ? parsed.interpretation : null,
    columns: cols,
    filters,
    sortBy,
    conversational: typeof parsed.conversational === 'string' ? parsed.conversational : null,
  };
}

const ACTION_ORDER: Record<string, number> = {
  reach_out: 3,
  monitor: 2,
  source_contact: 1,
  deprioritize: 0,
};

function applySort(leads: QueryLead[], sortBy: SortBy): QueryLead[] {
  if (!sortBy) return leads;
  return [...leads].sort((a, b) => {
    const fitA = a.company_fit_score ?? a.companies?.company_fit_score ?? 0;
    const fitB = b.company_fit_score ?? b.companies?.company_fit_score ?? 0;
    const cfitA = a.contact_fit_score ?? 0;
    const cfitB = b.contact_fit_score ?? 0;

    switch (sortBy) {
      case 'status_best_first': {
        const orderA = ACTION_ORDER[getLeadActionFromFits(fitA, a.contact_fit_score ?? null, a.intent_score ?? null)] ?? 0;
        const orderB = ACTION_ORDER[getLeadActionFromFits(fitB, b.contact_fit_score ?? null, b.intent_score ?? null)] ?? 0;
        return orderB - orderA;
      }
      case 'status_worst_first': {
        const orderA = ACTION_ORDER[getLeadActionFromFits(fitA, a.contact_fit_score ?? null, a.intent_score ?? null)] ?? 0;
        const orderB = ACTION_ORDER[getLeadActionFromFits(fitB, b.contact_fit_score ?? null, b.intent_score ?? null)] ?? 0;
        return orderA - orderB;
      }
      case 'company_fit_desc':
        return fitB - fitA;
      case 'company_fit_asc':
        return fitA - fitB;
      case 'contact_fit_desc':
        return cfitB - cfitA;
      default:
        return 0;
    }
  });
}

function applyServerSideFilters(
  leads: QueryLead[],
  filters: QueryFilters,
): QueryLead[] {
  return leads.filter((lead) => {
    const companyFit =
      typeof lead.company_fit_score === 'number'
        ? lead.company_fit_score
        : typeof lead.companies?.company_fit_score === 'number'
          ? lead.companies.company_fit_score
          : null;

    // Action / status filter
    if (filters.actions && filters.actions.length > 0) {
      const action = getLeadActionFromFits(
        companyFit,
        lead.contact_fit_score ?? null,
        lead.intent_score ?? null,
      );
      if (!filters.actions.includes(action)) return false;
    }

    // Company fit range
    if (typeof filters.minCompanyFit === 'number') {
      if (companyFit === null || companyFit < filters.minCompanyFit) return false;
    }
    if (typeof filters.maxCompanyFit === 'number') {
      if (companyFit !== null && companyFit > filters.maxCompanyFit) return false;
    }

    // Signal
    if (filters.hasSignal === true) {
      if (!(typeof lead.intent_score === 'number' && lead.intent_score > 0)) return false;
    }

    // Company type
    if (filters.companyTypes && filters.companyTypes.length > 0) {
      const ct = (lead.companies?.company_type || '').toLowerCase();
      const ctd = (lead.companies?.company_type_display || '').toLowerCase();
      const match = filters.companyTypes.some(
        (t) => ct.includes(t.toLowerCase()) || ctd.includes(t.toLowerCase()),
      );
      if (!match) return false;
    }

    // Funding stage
    if (filters.fundingStages && filters.fundingStages.length > 0) {
      const fs = (lead.companies?.funding_stage || '').toLowerCase();
      const match = filters.fundingStages.some((s) => fs.includes(s.toLowerCase()));
      if (!match) return false;
    }

    // Therapeutic areas
    if (filters.therapeuticAreas && filters.therapeuticAreas.length > 0) {
      const tas = (lead.companies?.therapeutic_areas || []).map((t) => t.toLowerCase());
      const match = filters.therapeuticAreas.some((ta) =>
        tas.some((t) => t.includes(ta.toLowerCase())),
      );
      if (!match) return false;
    }

    // Modalities
    if (filters.modalities && filters.modalities.length > 0) {
      const mods = (lead.companies?.modalities || []).map((m) => m.toLowerCase());
      const match = filters.modalities.some((mod) =>
        mods.some((m) => m.includes(mod.toLowerCase())),
      );
      if (!match) return false;
    }

    // Company name search
    if (filters.companyNameSearch) {
      const needle = filters.companyNameSearch.toLowerCase();
      const cn = (lead.resolved_current_company_name || lead.company_name || '').toLowerCase();
      if (!cn.includes(needle)) return false;
    }

    // Source
    if (filters.sources && filters.sources.length > 0) {
      const prov = (lead.data_provenance_type || '').toLowerCase();
      const src = (lead.source || '').toLowerCase();
      const match = filters.sources.some(
        (s) => prov.includes(s.toLowerCase()) || src.includes(s.toLowerCase()),
      );
      if (!match) return false;
    }

    return true;
  });
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const query: string = typeof body.query === 'string' ? body.query.trim() : '';

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    // Call Claude concurrently with initial DB fetch for speed
    const [claudeResult, contactsResult] = await Promise.all([
      callClaude(query),
      (async () => {
        // Fetch up to 500 contacts with basic select (no pagination)
        // Note: company_fit_score is on the companies table, not contacts
        const selectClause =
          'id, full_name, first_name, last_name, job_title, resolved_current_job_title, seniority_level, business_area, company_name, resolved_current_company_name, company_id, company_domain, fit_score, overall_fit_score, contact_fit_score, intent_score, source, created_at, upload_batches(filename, created_at)';

        const { data, error } = await supabase
          .from('contacts')
          .select(selectClause)
          .eq('user_id', user.id)
          .order('overall_fit_score', { ascending: false, nullsFirst: false })
          .order('fit_score', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(500);

        return { data, error };
      })(),
    ]);

    if (claudeResult.conversational && Object.keys(claudeResult.filters).length === 0 && !claudeResult.sortBy) {
      return NextResponse.json({
        interpretation: null,
        columns: ['name', 'job_title', 'company', 'status'],
        leads: [],
        conversational: claudeResult.conversational,
      } satisfies AgentQueryResult);
    }

    if (contactsResult.error) {
      console.error('Query contacts fetch error:', contactsResult.error);
      return NextResponse.json({ error: 'Failed to fetch contacts' }, { status: 500 });
    }

    const rawRows = ((contactsResult.data || []) as Record<string, unknown>[]);

    // Apply DB-level text filters (seniority, title keywords, name search) inline
    let filteredRows = rawRows;
    const { filters } = claudeResult;

    if (filters.nameSearch) {
      const needle = filters.nameSearch.toLowerCase();
      filteredRows = filteredRows.filter((r) =>
        ((r.full_name as string) || '').toLowerCase().includes(needle),
      );
    }

    if (filters.seniorityKeywords && filters.seniorityKeywords.length > 0) {
      filteredRows = filteredRows.filter((r) => {
        const sl = ((r.seniority_level as string) || '').toLowerCase();
        const title = ((r.resolved_current_job_title as string) || (r.job_title as string) || '').toLowerCase();
        return filters.seniorityKeywords!.some(
          (kw) => sl.includes(kw.toLowerCase()) || title.includes(kw.toLowerCase()),
        );
      });
    }

    if (filters.titleKeywords && filters.titleKeywords.length > 0) {
      filteredRows = filteredRows.filter((r) => {
        const title = ((r.resolved_current_job_title as string) || (r.job_title as string) || '').toLowerCase();
        return filters.titleKeywords!.some((kw) => title.includes(kw.toLowerCase()));
      });
    }

    // Attach companies
    const companyIds = [
      ...new Set(filteredRows.map((r) => r.company_id).filter(Boolean)),
    ] as string[];

    let companiesById: Map<string, Record<string, unknown>> = new Map();

    if (companyIds.length > 0) {
      const companySelects = [
        'id, company_name, domain, website, company_type, company_type_display, platform_category, funding_stage, therapeutic_areas, modalities, matched_icp_id, company_fit_score, logo_url, industry, employee_count, employee_range',
        'id, company_name, domain, website, company_type, company_type_display, platform_category, funding_stage, therapeutic_area, modality, matched_icp_id, company_fit_score',
        'id, company_name, company_type, funding_stage, matched_icp_id, company_fit_score',
      ];

      for (const sel of companySelects) {
        const { data: companies, error } = await supabase
          .from('companies')
          .select(sel)
          .in('id', companyIds);

        if (error && isMissingColumnError(error)) continue;
        if (!error && companies) {
          companiesById = new Map(
            (companies as unknown as Record<string, unknown>[])
              .filter((c) => typeof c.id === 'string')
              .map((c) => [c.id as string, normalizeCompanyRow(c)]),
          );
          break;
        }
      }
    }

    // Attach ICP names
    const icpIds = [
      ...new Set(
        [...companiesById.values()]
          .map((c) => c.matched_icp_id)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];

    let icpNamesById = new Map<string, string | null>();
    let icpIndexById = new Map<string, number>();

    if (icpIds.length > 0) {
      const { data: icps } = await supabase
        .from('icps')
        .select('id, name, created_at')
        .order('created_at', { ascending: false });

      if (icps) {
        const icpRows = icps as Array<{ id: string; name: string | null }>;
        icpNamesById = new Map(icpRows.map((r) => [r.id, r.name ?? null]));
        icpIndexById = new Map(icpRows.map((r, i) => [r.id, i + 1]));
      }
    }

    // Shape leads
    const leads: QueryLead[] = filteredRows.map((r) => {
      const companyId = typeof r.company_id === 'string' ? r.company_id : null;
      const company = companyId ? companiesById.get(companyId) ?? null : null;
      const matchedIcpId =
        company && typeof company.matched_icp_id === 'string' ? company.matched_icp_id : null;
      const matchedIcpName = matchedIcpId ? icpNamesById.get(matchedIcpId) ?? null : null;
      const matchedIcpIndex = matchedIcpId ? icpIndexById.get(matchedIcpId) ?? null : null;

      const { channels, importedAt } = resolveContactDataProvenance({
        upload_batches: r.upload_batches,
        created_at: typeof r.created_at === 'string' ? r.created_at : null,
        source: typeof r.source === 'string' ? r.source : null,
      });

      const companyFitFromCompany =
        company && typeof company.company_fit_score === 'number'
          ? company.company_fit_score
          : null;
      // company_fit_score lives on companies, not contacts; fall back to overall_fit_score / fit_score
      const companyFitScore =
        companyFitFromCompany ??
        (typeof r.overall_fit_score === 'number' ? r.overall_fit_score : null) ??
        (typeof r.fit_score === 'number' ? r.fit_score : null);

      return {
        id: r.id as string,
        full_name: (r.full_name as string | null) ?? null,
        first_name: (r.first_name as string | null) ?? null,
        last_name: (r.last_name as string | null) ?? null,
        job_title: (r.job_title as string | null) ?? null,
        resolved_current_job_title: (r.resolved_current_job_title as string | null) ?? null,
        seniority_level: (r.seniority_level as string | null) ?? null,
        company_name: (r.company_name as string | null) ?? null,
        resolved_current_company_name: (r.resolved_current_company_name as string | null) ?? null,
        company_id: companyId,
        company_domain: (r.company_domain as string | null) ?? null,
        company_fit_score: companyFitScore,
        contact_fit_score: typeof r.contact_fit_score === 'number' ? r.contact_fit_score : null,
        intent_score: typeof r.intent_score === 'number' ? r.intent_score : null,
        source: typeof r.source === 'string' ? r.source : null,
        data_provenance_type: formatDataProvenanceTypeOnly(channels),
        matched_icp_name: matchedIcpName,
        matched_icp_label:
          matchedIcpIndex && matchedIcpName
            ? `ICP ${matchedIcpIndex}: ${matchedIcpName}`
            : matchedIcpName,
        companies: company
          ? {
              company_type: (company.company_type as string | null) ?? null,
              company_type_display: (company.company_type_display as string | null) ?? null,
              funding_stage: (company.funding_stage as string | null) ?? null,
              therapeutic_areas: Array.isArray(company.therapeutic_areas)
                ? (company.therapeutic_areas as string[])
                : null,
              modalities: Array.isArray(company.modalities)
                ? (company.modalities as string[])
                : null,
              company_fit_score:
                typeof company.company_fit_score === 'number' ? company.company_fit_score : null,
              domain: (company.domain as string | null) ?? null,
              website: (company.website as string | null) ?? null,
            }
          : null,
      };
    });

    // Apply server-side filters (action, fit scores, company type, TA, etc.) then sort
    const filtered = applyServerSideFilters(leads, filters);
    const sorted = applySort(filtered, claudeResult.sortBy);

    if (sorted.length === 0 && !claudeResult.conversational) {
      return NextResponse.json({
        interpretation: claudeResult.interpretation,
        columns: claudeResult.columns,
        leads: [],
        conversational:
          "I couldn't find any contacts matching that. Try broadening your search or adjusting the filters.",
      } satisfies AgentQueryResult);
    }

    return NextResponse.json({
      interpretation: claudeResult.interpretation,
      columns: claudeResult.columns,
      leads: sorted.slice(0, 200),
      conversational: claudeResult.conversational ?? null,
    } satisfies AgentQueryResult);
  } catch (err) {
    console.error('Leads query error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
