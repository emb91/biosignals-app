import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase-server';
import {
  type DataProvenanceChannel,
  formatDataProvenanceTypeOnly,
  resolveContactDataProvenance,
} from '@/lib/data-provenance';

const anthropic = new Anthropic();

export const VALID_ACCOUNT_COLUMNS = [
  'company',
  'company_type',
  'fit',
  'contacts',
  'therapeutic_areas',
  'modalities',
  'action',
  'funding_stage',
  'icp_match',
  'development_stages',
  'employee_range',
  'location',
  'source',
] as const;

const DEFAULT_ACCOUNT_COLUMNS: AccountQueryColumn[] = [
  'company',
  'company_type',
  'fit',
  'contacts',
  'therapeutic_areas',
  'modalities',
  'action',
];

export type AccountQueryColumn = (typeof VALID_ACCOUNT_COLUMNS)[number];

export type AccountSortBy =
  | 'company_fit_desc'
  | 'company_fit_asc'
  | 'contact_count_desc'
  | 'contact_count_asc'
  | 'best_contact_fit_desc'
  | 'best_contact_fit_asc'
  | 'company_name_asc'
  | 'company_name_desc'
  | null;

export interface AccountQueryFilters {
  companyNameSearch?: string;
  domainSearch?: string;
  companyTypes?: string[];
  fundingStages?: string[];
  therapeuticAreas?: string[];
  modalities?: string[];
  developmentStages?: string[];
  employeeRanges?: string[];
  locations?: string[];
  icpSearch?: string;
  sources?: string[];
  coverageStatuses?: Array<'opportunity' | 'covered' | 'weak'>;
  minCompanyFit?: number;
  maxCompanyFit?: number;
  minBestContactFit?: number;
  maxBestContactFit?: number;
  minContactCount?: number;
  maxContactCount?: number;
  hasFunding?: boolean;
}

export interface QueryAccount {
  id: string;
  company_name: string | null;
  domain: string | null;
  logo_url: string | null;
  company_fit_score: number | null;
  company_fit_coverage: number | null;
  matched_icp_id: string | null;
  matched_icp_label: string | null;
  therapeutic_areas: string[] | null;
  modalities: string[] | null;
  development_stages: string[] | null;
  funding_stage: string | null;
  funding_status_label: string | null;
  company_type: string | null;
  linkedin_url: string | null;
  description: string | null;
  bio_summary: string | null;
  employee_count: number | null;
  employee_range: string | null;
  headquarters_city: string | null;
  headquarters_country: string | null;
  total_funding_usd: number | null;
  latest_funding_date: string | null;
  funding_resolution_summary: string | null;
  founded_year: number | null;
  specialties: string[] | null;
  products_services: string[] | null;
  services: string[] | null;
  technologies: string[] | null;
  last_enriched_at: string | null;
  contact_count: number;
  best_contact_fit: number | null;
  worst_contact_fit: number | null;
  avg_contact_fit: number | null;
  data_provenance_type: string;
  data_provenance_imported_at: string | null;
}

export interface AgentAccountsQueryResult {
  interpretation: string | null;
  columns: AccountQueryColumn[];
  accounts: QueryAccount[];
  conversational: string | null;
}

type CompanyAggRow = {
  id: string;
  company_name: string | null;
  domain: string | null;
  logo_url: string | null;
  company_fit_score: number | null;
  company_fit_coverage: number | null;
  matched_icp_id: string | null;
  therapeutic_areas: string[] | null;
  modalities: string[] | null;
  development_stages: string[] | null;
  funding_stage: string | null;
  funding_status_label: string | null;
  total_funding_usd: number | null;
  latest_funding_date: string | null;
  funding_resolution_summary: string | null;
  company_type: string | null;
  linkedin_url: string | null;
  description: string | null;
  bio_summary: string | null;
  employee_count: number | null;
  employee_range: string | null;
  headquarters_city: string | null;
  headquarters_country: string | null;
  founded_year: number | null;
  specialties: string[] | null;
  products_services: string[] | null;
  services: string[] | null;
  technologies: string[] | null;
  last_enriched_at: string | null;
};

type ScratchAgg = CompanyAggRow & {
  contact_count: number;
  fit_sum: number;
  fit_n: number;
  best_contact_fit: number | null;
  worst_contact_fit: number | null;
  provenance_channels: Set<DataProvenanceChannel>;
  provenance_earliest_import_at: string | null;
};

const SYSTEM_PROMPT = `You are an AI agent for Arcova, a life sciences go-to-market workspace. Interpret natural language queries about company accounts and return structured JSON.

Account data available:
- company_name and domain
- company_type: "CDMO", "Biotech", "CRO", "Pharma", "Academic", "Hospital", "MedTech", "AgBio"
- company_fit_score: 0-1, where higher means a better ICP fit
- contact_count: number of known contacts at the company
- best_contact_fit, avg_contact_fit, worst_contact_fit: 0-1 contact/persona fit scores
- funding_stage and funding_status_label
- therapeutic_areas, modalities, development_stages
- employee_count and employee_range
- headquarters_city and headquarters_country
- matched_icp_label
- data source: "HubSpot", "CSV", "Arcova"

Computed account coverage status:
- "opportunity": company_fit_score >= 0.6 and best_contact_fit is missing or < 0.45; a good account where they need better contacts
- "covered": company_fit_score >= 0.6 and best_contact_fit >= 0.5
- "weak": company_fit_score < 0.6

Available display columns (MUST pick from this list exactly):
company, company_type, fit, contacts, therapeutic_areas, modalities, action, funding_stage, icp_match, development_stages, employee_range, location, source

Return JSON with this exact shape:
{
  "interpretation": "...",
  "columns": ["company", "company_type", "fit", "contacts", "therapeutic_areas", "modalities", "action"],
  "sortBy": null,
  "filters": {
    "companyNameSearch": null,
    "domainSearch": null,
    "companyTypes": null,
    "fundingStages": null,
    "therapeuticAreas": null,
    "modalities": null,
    "developmentStages": null,
    "employeeRanges": null,
    "locations": null,
    "icpSearch": null,
    "sources": null,
    "coverageStatuses": null,
    "minCompanyFit": null,
    "maxCompanyFit": null,
    "minBestContactFit": null,
    "maxBestContactFit": null,
    "minContactCount": null,
    "maxContactCount": null,
    "hasFunding": null
  },
  "conversational": null
}

COLUMN RULES - be conservative:
- Default columns are: ["company", "company_type", "fit", "contacts", "therapeutic_areas", "modalities", "action"]
- For sort/order queries, keep the default columns.
- Add "funding_stage" only if the user asks about funding or investment stage.
- Add "icp_match" only if the user asks about ICP.
- Add "development_stages" only if the user asks about development stage, clinical stage, or pipeline stage.
- Add "employee_range" only if the user asks about company size, employees, or headcount.
- Add "location" only if the user asks about headquarters, country, city, or location.
- Add "source" only if the user asks where the account data came from.

SORT RULES:
- "best first", "highest fit", "sort by fit" -> sortBy: "company_fit_desc"
- "worst first", "lowest fit", "deprioritised first" -> sortBy: "company_fit_asc"
- "most contacts" -> sortBy: "contact_count_desc"
- "fewest contacts" or "least contacts" -> sortBy: "contact_count_asc"
- "best contact coverage" or "highest contact fit" -> sortBy: "best_contact_fit_desc"
- "poor contacts", "weak contacts", or "lowest contact fit" -> sortBy: "best_contact_fit_asc"
- "A to Z" or "alphabetical" -> sortBy: "company_name_asc"
- "Z to A" -> sortBy: "company_name_desc"

FILTER RULES:
- "good fit" or "high fit" -> minCompanyFit: 0.7
- "poor fit", "low fit", or "deprioritised" -> maxCompanyFit: 0.6
- "good fit companies with poor contacts", "coverage gaps", "need better contacts", or "source contacts" -> minCompanyFit: 0.6 and maxBestContactFit: 0.45, include "fit" and "contacts"
- "no contacts" -> maxContactCount: 0
- "has contacts" -> minContactCount: 1
- "covered accounts" -> coverageStatuses: ["covered"]
- "funded companies" -> hasFunding: true and add "funding_stage"
- For a specific company name like "show me Enzene only", set companyNameSearch to the company name.
- Always respond with valid JSON only, no markdown fences.`;

function hasActiveFilters(filters: AccountQueryFilters): boolean {
  return Object.values(filters).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null;
  });
}

function normalizeNeedle(value: string): string {
  return value.trim().toLowerCase();
}

function includesAny(value: string | null | undefined, needles: string[] | undefined): boolean {
  if (!needles || needles.length === 0) return true;
  const haystack = (value || '').toLowerCase();
  return needles.some((needle) => haystack.includes(normalizeNeedle(needle)));
}

function listIncludesAny(list: string[] | null | undefined, needles: string[] | undefined): boolean {
  if (!needles || needles.length === 0) return true;
  const haystack = (list || []).map((item) => item.toLowerCase());
  return needles.some((needle) => {
    const n = normalizeNeedle(needle);
    return haystack.some((item) => item.includes(n));
  });
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getCoverageStatus(account: QueryAccount): 'opportunity' | 'covered' | 'weak' | null {
  const companyFit = finiteNumber(account.company_fit_score);
  if (companyFit == null) return null;
  if (companyFit < 0.6) return 'weak';
  const bestContactFit = finiteNumber(account.best_contact_fit);
  if (bestContactFit == null || bestContactFit < 0.45) return 'opportunity';
  if (bestContactFit >= 0.5) return 'covered';
  return null;
}

function finalizeScratch(row: ScratchAgg): QueryAccount {
  return {
    id: row.id,
    company_name: row.company_name,
    domain: row.domain,
    logo_url: row.logo_url,
    company_fit_score: row.company_fit_score,
    company_fit_coverage: row.company_fit_coverage,
    matched_icp_id: row.matched_icp_id,
    matched_icp_label: null,
    therapeutic_areas: row.therapeutic_areas,
    modalities: row.modalities,
    development_stages: row.development_stages,
    funding_stage: row.funding_stage,
    funding_status_label: row.funding_status_label,
    company_type: row.company_type,
    linkedin_url: row.linkedin_url,
    description: row.description,
    bio_summary: row.bio_summary,
    employee_count: row.employee_count,
    employee_range: row.employee_range,
    headquarters_city: row.headquarters_city,
    headquarters_country: row.headquarters_country,
    total_funding_usd: row.total_funding_usd,
    latest_funding_date: row.latest_funding_date,
    funding_resolution_summary: row.funding_resolution_summary,
    founded_year: row.founded_year,
    specialties: row.specialties,
    products_services: row.products_services,
    services: row.services,
    technologies: row.technologies,
    last_enriched_at: row.last_enriched_at,
    contact_count: row.contact_count,
    best_contact_fit: row.best_contact_fit,
    worst_contact_fit: row.worst_contact_fit,
    avg_contact_fit: row.fit_n > 0 ? row.fit_sum / row.fit_n : null,
    data_provenance_type: formatDataProvenanceTypeOnly([...row.provenance_channels]),
    data_provenance_imported_at: row.provenance_earliest_import_at,
  };
}

function parseArray(raw: unknown): string[] | undefined {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : undefined;
}

function parseNumber(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

async function callClaude(query: string): Promise<{
  interpretation: string | null;
  columns: AccountQueryColumn[];
  filters: AccountQueryFilters;
  sortBy: AccountSortBy;
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
      columns: DEFAULT_ACCOUNT_COLUMNS,
      filters: {},
      sortBy: null,
      conversational: "I had trouble understanding that query. Try something like 'Show me good fit companies with poor contacts'.",
    };
  }

  const validColumns = (parsed.columns || []).filter((c): c is AccountQueryColumn =>
    VALID_ACCOUNT_COLUMNS.includes(c as AccountQueryColumn),
  );
  const columns =
    validColumns.length > 0
      ? validColumns.includes('company')
        ? validColumns
        : (['company', ...validColumns] as AccountQueryColumn[])
      : DEFAULT_ACCOUNT_COLUMNS;

  const rawFilters = parsed.filters || {};
  const filters: AccountQueryFilters = {};

  if (typeof rawFilters.companyNameSearch === 'string') filters.companyNameSearch = rawFilters.companyNameSearch;
  if (typeof rawFilters.domainSearch === 'string') filters.domainSearch = rawFilters.domainSearch;
  filters.companyTypes = parseArray(rawFilters.companyTypes);
  filters.fundingStages = parseArray(rawFilters.fundingStages);
  filters.therapeuticAreas = parseArray(rawFilters.therapeuticAreas);
  filters.modalities = parseArray(rawFilters.modalities);
  filters.developmentStages = parseArray(rawFilters.developmentStages);
  filters.employeeRanges = parseArray(rawFilters.employeeRanges);
  filters.locations = parseArray(rawFilters.locations);
  if (typeof rawFilters.icpSearch === 'string') filters.icpSearch = rawFilters.icpSearch;
  filters.sources = parseArray(rawFilters.sources);
  const rawCoverageStatuses = parseArray(rawFilters.coverageStatuses);
  if (rawCoverageStatuses) {
    filters.coverageStatuses = rawCoverageStatuses.filter(
      (s): s is 'opportunity' | 'covered' | 'weak' =>
        s === 'opportunity' || s === 'covered' || s === 'weak',
    );
  }
  filters.minCompanyFit = parseNumber(rawFilters.minCompanyFit);
  filters.maxCompanyFit = parseNumber(rawFilters.maxCompanyFit);
  filters.minBestContactFit = parseNumber(rawFilters.minBestContactFit);
  filters.maxBestContactFit = parseNumber(rawFilters.maxBestContactFit);
  filters.minContactCount = parseNumber(rawFilters.minContactCount);
  filters.maxContactCount = parseNumber(rawFilters.maxContactCount);
  if (typeof rawFilters.hasFunding === 'boolean') filters.hasFunding = rawFilters.hasFunding;

  const validSorts: AccountSortBy[] = [
    'company_fit_desc',
    'company_fit_asc',
    'contact_count_desc',
    'contact_count_asc',
    'best_contact_fit_desc',
    'best_contact_fit_asc',
    'company_name_asc',
    'company_name_desc',
  ];
  const sortBy: AccountSortBy =
    typeof parsed.sortBy === 'string' && validSorts.includes(parsed.sortBy as AccountSortBy)
      ? (parsed.sortBy as AccountSortBy)
      : null;

  return {
    interpretation: typeof parsed.interpretation === 'string' ? parsed.interpretation : null,
    columns,
    filters,
    sortBy,
    conversational: typeof parsed.conversational === 'string' ? parsed.conversational : null,
  };
}

async function fetchAggregatedAccounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ accounts: QueryAccount[]; error: string | null }> {
  const { data: rows, error } = await supabase
    .from('contacts')
    .select(
      `
      company_id,
      contact_fit_score,
      created_at,
      source,
      upload_batches (
        filename,
        created_at
      ),
      companies (
        id,
        company_name,
        domain,
        logo_url,
        company_fit_score,
        company_fit_coverage,
        matched_icp_id,
        therapeutic_areas,
        modalities,
        development_stages,
        funding_stage,
        funding_status_label,
        company_type,
        linkedin_url,
        description,
        bio_summary,
        employee_count,
        employee_range,
        headquarters_city,
        headquarters_country,
        total_funding_usd,
        latest_funding_date,
        funding_resolution_summary,
        founded_year,
        specialties,
        products_services,
        services,
        technologies,
        last_enriched_at
      )
    `,
    )
    .eq('user_id', userId)
    .not('company_id', 'is', null);

  if (error) return { accounts: [], error: error.message };

  const byCompany = new Map<string, ScratchAgg>();

  for (const row of rows || []) {
    const companyId = row.company_id as string | null;
    const company = row.companies as CompanyAggRow | CompanyAggRow[] | null;
    const resolvedCompany = Array.isArray(company) ? company[0] : company;

    if (!companyId || !resolvedCompany?.id) continue;

    const contactFit = finiteNumber(row.contact_fit_score as number | null);
    const prov = resolveContactDataProvenance({
      upload_batches: row.upload_batches,
      created_at: typeof row.created_at === 'string' ? row.created_at : null,
      source: typeof row.source === 'string' ? row.source : null,
    });

    const existing = byCompany.get(companyId);
    if (!existing) {
      byCompany.set(companyId, {
        ...resolvedCompany,
        contact_count: 1,
        fit_sum: contactFit ?? 0,
        fit_n: contactFit == null ? 0 : 1,
        best_contact_fit: contactFit,
        worst_contact_fit: contactFit,
        provenance_channels: new Set(prov.channels),
        provenance_earliest_import_at: prov.importedAt,
      });
    } else {
      existing.contact_count += 1;
      for (const channel of prov.channels) existing.provenance_channels.add(channel);
      if (
        prov.importedAt &&
        (!existing.provenance_earliest_import_at || prov.importedAt < existing.provenance_earliest_import_at)
      ) {
        existing.provenance_earliest_import_at = prov.importedAt;
      }
      if (contactFit != null) {
        existing.fit_sum += contactFit;
        existing.fit_n += 1;
        existing.best_contact_fit =
          existing.best_contact_fit == null ? contactFit : Math.max(existing.best_contact_fit, contactFit);
        existing.worst_contact_fit =
          existing.worst_contact_fit == null ? contactFit : Math.min(existing.worst_contact_fit, contactFit);
      }
    }
  }

  let accounts = [...byCompany.values()].map(finalizeScratch);

  const icpIds = [
    ...new Set(accounts.map((account) => account.matched_icp_id).filter((id): id is string => Boolean(id))),
  ];

  if (icpIds.length > 0) {
    const { data: icps, error: icpError } = await supabase
      .from('icps')
      .select('id, name, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!icpError && icps) {
      const ordered = icps as Array<{ id: string; name: string | null }>;
      const indexById = new Map(ordered.map((row, index) => [row.id, index + 1]));
      const labelById = new Map(
        ordered.map((row) => {
          const idx = indexById.get(row.id);
          const label =
            idx != null && row.name?.trim()
              ? `ICP ${idx}: ${row.name}`
              : row.name?.trim() || (idx != null ? `ICP ${idx}` : null);
          return [row.id, label ?? ''];
        }),
      );

      accounts = accounts.map((account) => ({
        ...account,
        matched_icp_label: account.matched_icp_id
          ? labelById.get(account.matched_icp_id) ?? null
          : null,
      }));
    }
  }

  return { accounts, error: null };
}

function applyServerSideFilters(accounts: QueryAccount[], filters: AccountQueryFilters): QueryAccount[] {
  return accounts.filter((account) => {
    const companyFit = finiteNumber(account.company_fit_score);
    const bestContactFit = finiteNumber(account.best_contact_fit);

    if (filters.companyNameSearch) {
      const needle = normalizeNeedle(filters.companyNameSearch);
      const name = (account.company_name || '').toLowerCase();
      const domain = (account.domain || '').toLowerCase();
      if (!name.includes(needle) && !domain.includes(needle)) return false;
    }

    const fundingLabel = [account.funding_stage, account.funding_status_label].filter(Boolean).join(' ');

    if (filters.domainSearch && !includesAny(account.domain, [filters.domainSearch])) return false;
    if (!includesAny(account.company_type, filters.companyTypes)) return false;
    if (!includesAny(fundingLabel, filters.fundingStages)) return false;
    if (!listIncludesAny(account.therapeutic_areas, filters.therapeuticAreas)) return false;
    if (!listIncludesAny(account.modalities, filters.modalities)) return false;
    if (!listIncludesAny(account.development_stages, filters.developmentStages)) return false;
    if (!includesAny(account.employee_range, filters.employeeRanges)) return false;

    if (filters.locations && filters.locations.length > 0) {
      const location = [account.headquarters_city, account.headquarters_country].filter(Boolean).join(' ');
      if (!includesAny(location, filters.locations)) return false;
    }

    if (filters.icpSearch) {
      const needle = normalizeNeedle(filters.icpSearch);
      const label = (account.matched_icp_label || '').toLowerCase();
      const id = (account.matched_icp_id || '').toLowerCase();
      if (!label.includes(needle) && !id.includes(needle)) return false;
    }

    if (!includesAny(account.data_provenance_type, filters.sources)) return false;

    if (filters.coverageStatuses && filters.coverageStatuses.length > 0) {
      const status = getCoverageStatus(account);
      if (!status || !filters.coverageStatuses.includes(status)) return false;
    }

    if (typeof filters.minCompanyFit === 'number') {
      if (companyFit == null || companyFit < filters.minCompanyFit) return false;
    }
    if (typeof filters.maxCompanyFit === 'number') {
      if (companyFit != null && companyFit > filters.maxCompanyFit) return false;
    }
    if (typeof filters.minBestContactFit === 'number') {
      if (bestContactFit == null || bestContactFit < filters.minBestContactFit) return false;
    }
    if (typeof filters.maxBestContactFit === 'number') {
      if ((bestContactFit ?? 0) > filters.maxBestContactFit) return false;
    }
    if (typeof filters.minContactCount === 'number' && account.contact_count < filters.minContactCount) return false;
    if (typeof filters.maxContactCount === 'number' && account.contact_count > filters.maxContactCount) return false;

    if (filters.hasFunding === true) {
      if (!account.funding_stage && !account.funding_status_label && account.total_funding_usd == null) return false;
    }
    if (filters.hasFunding === false) {
      if (account.funding_stage || account.funding_status_label || account.total_funding_usd != null) return false;
    }

    return true;
  });
}

function applySort(accounts: QueryAccount[], sortBy: AccountSortBy): QueryAccount[] {
  if (!sortBy) return accounts;

  return [...accounts].sort((a, b) => {
    const fitA = finiteNumber(a.company_fit_score);
    const fitB = finiteNumber(b.company_fit_score);
    const bestA = finiteNumber(a.best_contact_fit);
    const bestB = finiteNumber(b.best_contact_fit);
    const nameA = (a.company_name || a.domain || '').toLowerCase();
    const nameB = (b.company_name || b.domain || '').toLowerCase();

    switch (sortBy) {
      case 'company_fit_desc':
        return (fitB ?? -1) - (fitA ?? -1);
      case 'company_fit_asc':
        return (fitA ?? Number.POSITIVE_INFINITY) - (fitB ?? Number.POSITIVE_INFINITY);
      case 'contact_count_desc':
        return b.contact_count - a.contact_count;
      case 'contact_count_asc':
        return a.contact_count - b.contact_count;
      case 'best_contact_fit_desc':
        return (bestB ?? -1) - (bestA ?? -1);
      case 'best_contact_fit_asc':
        return (bestA ?? 0) - (bestB ?? 0);
      case 'company_name_asc':
        return nameA.localeCompare(nameB);
      case 'company_name_desc':
        return nameB.localeCompare(nameA);
      default:
        return 0;
    }
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

    const [claudeResult, accountsResult] = await Promise.all([
      callClaude(query),
      fetchAggregatedAccounts(supabase, user.id),
    ]);

    if (claudeResult.conversational && !hasActiveFilters(claudeResult.filters) && !claudeResult.sortBy) {
      return NextResponse.json({
        interpretation: null,
        columns: DEFAULT_ACCOUNT_COLUMNS,
        accounts: [],
        conversational: claudeResult.conversational,
      } satisfies AgentAccountsQueryResult);
    }

    if (accountsResult.error) {
      console.error('Query accounts fetch error:', accountsResult.error);
      return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 });
    }

    const filtered = applyServerSideFilters(accountsResult.accounts, claudeResult.filters);
    const sorted = applySort(filtered, claudeResult.sortBy);

    if (sorted.length === 0 && !claudeResult.conversational) {
      return NextResponse.json({
        interpretation: claudeResult.interpretation,
        columns: claudeResult.columns,
        accounts: [],
        conversational:
          "I couldn't find any accounts matching that. Try broadening your search or adjusting the filters.",
      } satisfies AgentAccountsQueryResult);
    }

    return NextResponse.json({
      interpretation: claudeResult.interpretation,
      columns: claudeResult.columns,
      accounts: sorted.slice(0, 200),
      conversational: claudeResult.conversational ?? null,
    } satisfies AgentAccountsQueryResult);
  } catch (err) {
    console.error('Accounts query error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
