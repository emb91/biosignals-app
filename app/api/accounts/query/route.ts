import { TASK_AGENT_OPENING } from '@/lib/prompts/agent-voice';
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase-server';
import { recordLlmUsageEvent } from '@/lib/llm-usage';
import {
  type AccountQueryColumn,
  type AccountQueryFilters,
  type AccountSortBy,
  type AgentAccountsQueryResult,
  fetchAggregatedAccounts,
  applyServerSideFilters,
  applySort,
  hasActiveFilters,
} from '@/lib/accounts-data';

const anthropic = new Anthropic();

export const VALID_ACCOUNT_COLUMNS = [
  'company',
  'company_type',
  'fit',
  'contacts',
  'readiness',
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
  'action',
];

const SYSTEM_PROMPT = `${TASK_AGENT_OPENING} Interpret natural language queries about company accounts and return structured JSON.

Account data available:
- company_name and domain
- company_type: "CDMO", "Biotech", "CRO", "Pharma", "Academic", "Hospital", "MedTech", "AgBio"
- company_fit_score: 0-1, where higher means a better ICP fit
- contact_count: number of known contacts at the company
- best_contact_fit, avg_contact_fit, worst_contact_fit: 0-1 contact/persona fit scores
- A strong contact/persona match is binary: best_contact_fit must be 1.0 (100%). Anything below 1.0 means no strong contact has been identified.
- funding_stage and funding_status_label
- therapeutic_areas, modalities, development_stages
- employee_count and employee_range
- headquarters_city and headquarters_country
- matched_icp_label
- data source: "HubSpot", "CSV", "Arcova"

Computed account coverage status:
- "opportunity": company_fit_score >= 0.6 and best_contact_fit is missing or < 1.0; a good account where they need a 100% contact match
- "covered": company_fit_score >= 0.6 and best_contact_fit >= 1.0
- "weak": company_fit_score < 0.6

Available display columns (MUST pick from this list exactly):
company, company_type, fit, contacts, therapeutic_areas, modalities, action, funding_stage, icp_match, development_stages, employee_range, location, source

Return JSON with this exact shape:
{
  "interpretation": "...",
  "columns": ["company", "company_type", "fit", "contacts", "action"],
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
- Default columns are: ["company", "company_type", "fit", "contacts", "action"]
- For sort/order queries, keep the default columns.
- For queries that only request specific columns to display (e.g., "show me company names, types, and therapeutic areas"), set the appropriate columns with no filters and no sortBy, and write a brief conversational acknowledgment.
- Add "therapeutic_areas" only if the user explicitly asks to display therapeutic areas or disease areas.
- Add "modalities" only if the user explicitly asks to display modalities.
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
- "good companies", "good accounts", "good fit", or "high fit" -> minCompanyFit: 0.7
- "companies with ..." or "accounts with ..." does not imply good company fit by itself; only filter on the condition after "with" unless the query also says "good companies", "good accounts", "good fit", or "high fit".
- "poor fit", "low fit", or "deprioritised" -> maxCompanyFit: 0.6
- "no strong contacts", "no strong accounts", "without strong contacts", "coverage gaps", "need better contacts", "source contacts", "poor contacts", or "weak contacts" -> maxBestContactFit: 0.999999, include "fit" and "contacts"; do not add minCompanyFit unless the query separately says "good companies", "good accounts", "good fit", or "high fit"
- "no contacts" -> maxContactCount: 0
- "has contacts" -> minContactCount: 1
- "covered accounts" -> coverageStatuses: ["covered"]
- "funded companies" -> hasFunding: true and add "funding_stage"
- For a specific company name like "show me Enzene only", set companyNameSearch to the company name.
- Always respond with valid JSON only, no markdown fences.`;

function parseArray(raw: unknown): string[] | undefined {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : undefined;
}

function parseNumber(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function asksForNoStrongContacts(query: string): boolean {
  const q = query.toLowerCase();
  return (
    q.includes('no strong contact') ||
    q.includes('no strong account') ||
    q.includes('without strong contact') ||
    q.includes('poor contact') ||
    q.includes('weak contact') ||
    q.includes('coverage gap') ||
    q.includes('need better contact') ||
    q.includes('source contact')
  );
}

function asksForGoodFit(query: string): boolean {
  const q = query.toLowerCase();
  return (
    q.includes('good fit') ||
    q.includes('high fit') ||
    q.includes('good compan') ||
    q.includes('good account')
  );
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

  await recordLlmUsageEvent({
    provider: 'anthropic',
    feature: 'accounts_query',
    route: 'app/api/accounts/query',
    model: 'claude-sonnet-4-6',
    usage: message.usage,
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

  if (asksForNoStrongContacts(query)) {
    filters.maxBestContactFit = 0.999999;
    filters.coverageStatuses = undefined;
    if (!asksForGoodFit(query)) filters.minCompanyFit = undefined;
  }

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

    // No filtering or sorting — reshape only (update columns/message without re-fetching)
    if (!hasActiveFilters(claudeResult.filters) && !claudeResult.sortBy) {
      return NextResponse.json({
        interpretation: claudeResult.interpretation,
        columns: claudeResult.columns,
        accounts: [],
        conversational: claudeResult.conversational,
        reshapeOnly: true,
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
