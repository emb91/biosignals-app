import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase-server';
import {
  type AccountQueryColumn,
  type AccountQueryFilters,
  type AccountSortBy,
  fetchAggregatedAccounts,
  applyServerSideFilters,
  applySort,
  finiteNumber,
  normalizeScore01,
  getCoverageStatus,
} from '@/lib/accounts-data';
import {
  type QueryColumn as LeadQueryColumn,
  type LeadQueryFilters,
  type LeadSortBy,
  type QueryLead,
  fetchFilteredLeads,
} from '@/lib/leads-data';

// ─── Types ────────────────────────────────────────────────────────────────────

type Page = 'accounts' | 'leads' | 'dashboard' | 'pipeline' | 'signals' | 'imports' | 'data';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface PageContext {
  totalAccounts?: number;
  filteredAccounts?: number;
  activeQuery?: string;
  totalLeads?: number;
}

interface TableFilter {
  columns: AccountQueryColumn[];
  filters: AccountQueryFilters;
  sortBy: AccountSortBy;
  reshapeOnly: boolean;
  interpretation: string | null;
}

interface LeadsTableFilter {
  columns: LeadQueryColumn[];
  filters: LeadQueryFilters;
  sortBy: LeadSortBy;
  interpretation: string | null;
}

interface ChatResponse {
  message: string;
  toolsUsed: string[];
  tableFilter?: TableFilter;
  tableAccounts?: import('@/lib/accounts-data').QueryAccount[];
  leadsFilter?: LeadsTableFilter;
  tableLeads?: QueryLead[];
  suggestedNavigation?: { href: string; label: string };
}

// ─── Anthropic client ─────────────────────────────────────────────────────────

const anthropic = new Anthropic();

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_workspace_summary',
    description:
      'Get a high-level summary of the user\'s workspace: their company name, total account and contact counts, ICP count, and coverage breakdown (how many accounts are "covered", "opportunity", or "weak"). Call this first when the user asks broad questions about their pipeline, data health, or overview.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_icp_definitions',
    description:
      "Get the user's ICP (Ideal Customer Profile) definitions — the criteria and personas that determine company and contact fit scores. Call this when the user asks why something is scored a certain way, what their ICPs are, or wants to understand the scoring logic.",
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'query_companies',
    description:
      'Query the user\'s accounts with optional filters and sorting. Returns a list of matching companies with their key stats. Use this to answer questions like "how many oncology companies do I have?", "which funded biotechs have no strong contacts?", "who are my top 5 accounts?". Also use this when the user asks you to filter or sort the accounts table — in that case, also call filter_accounts_table.',
    input_schema: {
      type: 'object' as const,
      properties: {
        companyTypes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by company type. Valid values: "CDMO", "Biotech", "CRO", "Pharma", "Academic", "Hospital", "MedTech", "AgBio"',
        },
        therapeuticAreas: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by therapeutic area, e.g. ["oncology", "rare disease"]',
        },
        modalities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by modality, e.g. ["antibody", "cell therapy"]',
        },
        fundingStages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by funding stage, e.g. ["Series B", "Series C"]',
        },
        minCompanyFit: {
          type: 'number',
          description: 'Minimum company fit score (0–1). Use 0.7 for "good fit".',
        },
        maxCompanyFit: {
          type: 'number',
          description: 'Maximum company fit score (0–1).',
        },
        maxBestContactFit: {
          type: 'number',
          description: 'Max best contact fit score. Use 0.999999 to find accounts with no strong (100%) contact.',
        },
        minContactCount: {
          type: 'number',
          description: 'Minimum number of known contacts at the company.',
        },
        maxContactCount: {
          type: 'number',
          description: 'Maximum number of known contacts at the company. Use 0 to find accounts with no contacts.',
        },
        coverageStatuses: {
          type: 'array',
          items: { type: 'string', enum: ['opportunity', 'covered', 'weak'] },
          description: '"opportunity" = good fit but no strong contact. "covered" = good fit + strong contact. "weak" = low fit.',
        },
        hasFunding: {
          type: 'boolean',
          description: 'Filter to only funded companies (true) or unfunded (false).',
        },
        sortBy: {
          type: 'string',
          enum: [
            'company_fit_desc',
            'company_fit_asc',
            'contact_count_desc',
            'contact_count_asc',
            'best_contact_fit_desc',
            'best_contact_fit_asc',
            'company_name_asc',
            'company_name_desc',
          ],
          description: 'Sort order for results.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of companies to return in the response (default 10, max 50).',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_company_details',
    description:
      "Get full details about a specific company — their fit score breakdown, contacts, therapeutic areas, funding, and more. Use this when the user asks about a specific company by name.",
    input_schema: {
      type: 'object' as const,
      properties: {
        company_name: {
          type: 'string',
          description: 'The company name (partial match is fine).',
        },
      },
      required: ['company_name'],
    },
  },
  {
    name: 'query_contacts',
    description:
      "Query the user's contacts with optional filters. Returns matching contacts with their fit scores and company info. Use this when the user asks about specific contacts, personas, or wants to see who to reach out to.",
    input_schema: {
      type: 'object' as const,
      properties: {
        companyName: {
          type: 'string',
          description: 'Filter contacts by company name (partial match).',
        },
        minContactFit: {
          type: 'number',
          description: 'Minimum contact fit score (0–1). Use 1.0 to find only perfect-match contacts.',
        },
        jobTitleSearch: {
          type: 'string',
          description: 'Filter by job title keyword (e.g. "VP", "Director", "CTO").',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of contacts to return (default 10, max 50).',
        },
      },
      required: [],
    },
  },
  {
    name: 'filter_leads_table',
    description:
      "Update the leads/contacts table visible on screen to show filtered/sorted results. Call this when the user asks to filter, sort, or reshape the leads table. Also call query_contacts alongside this to get data for your answer.",
    input_schema: {
      type: 'object' as const,
      properties: {
        columns: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['name', 'job_title', 'company', 'status', 'company_fit', 'contact_fit', 'source', 'signals', 'icp_match', 'funding_stage', 'therapeutic_areas', 'seniority'],
          },
          description: 'Columns to show. Always include "name", "job_title", "company", "status".',
        },
        filters: {
          type: 'object',
          description: 'Structured filters to apply to the leads table.',
          properties: {
            actions: {
              type: 'array',
              items: { type: 'string', enum: ['reach_out', 'source_contact', 'monitor', 'deprioritize'] },
              description: '"reach_out" = good company + good contact + signal. "source_contact" = good company, weak contact. "monitor" = borderline. "deprioritize" = poor fit.',
            },
            minCompanyFit: { type: 'number' },
            maxCompanyFit: { type: 'number' },
            hasSignal: { type: 'boolean' },
            companyTypes: { type: 'array', items: { type: 'string' } },
            fundingStages: { type: 'array', items: { type: 'string' } },
            therapeuticAreas: { type: 'array', items: { type: 'string' } },
            modalities: { type: 'array', items: { type: 'string' } },
            seniorityKeywords: { type: 'array', items: { type: 'string' }, description: 'e.g. ["VP", "Director"]' },
            titleKeywords: { type: 'array', items: { type: 'string' }, description: 'Keywords in job title' },
            nameSearch: { type: 'string' },
            companyNameSearch: { type: 'string' },
            sources: { type: 'array', items: { type: 'string' } },
          },
        },
        sortBy: {
          type: 'string',
          enum: ['status_best_first', 'status_worst_first', 'company_fit_desc', 'company_fit_asc', 'contact_fit_desc'],
        },
        interpretation: {
          type: 'string',
          description: 'Brief label for the active filter, shown above the table.',
        },
      },
      required: ['columns'],
    },
  },
  {
    name: 'suggest_navigation',
    description:
      'Suggest that the user navigate to another page in the app. Call this whenever the next action for the user requires them to go somewhere else — always pair it with a short explanation of what to do there. Only call this once per response.',
    input_schema: {
      type: 'object' as const,
      properties: {
        href: {
          type: 'string',
          enum: ['/pipeline', '/results', '/accounts', '/import', '/dashboard', '/data'],
          description: 'The destination page path.',
        },
        label: {
          type: 'string',
          description: 'Short button label shown to the user. e.g. "Open Data"',
        },
      },
      required: ['href', 'label'],
    },
  },
  {
    name: 'filter_accounts_table',
    description:
      "Update the accounts table visible on screen to show filtered/sorted results. Call this ALONGSIDE query_companies when the user asks to filter or sort the table — query_companies fetches the data for your answer, while filter_accounts_table updates the UI table. Do NOT call this for purely informational questions that don't require changing what's on screen.",
    input_schema: {
      type: 'object' as const,
      properties: {
        columns: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'company', 'company_type', 'fit', 'contacts',
              'therapeutic_areas', 'modalities', 'action',
              'funding_stage', 'icp_match', 'development_stages',
              'employee_range', 'location', 'source',
            ],
          },
          description: 'Columns to show in the table. Always include "company".',
        },
        filters: {
          type: 'object',
          description: 'Filters to apply. Mirrors the query_companies filter params.',
          properties: {
            companyTypes: { type: 'array', items: { type: 'string' } },
            therapeuticAreas: { type: 'array', items: { type: 'string' } },
            modalities: { type: 'array', items: { type: 'string' } },
            fundingStages: { type: 'array', items: { type: 'string' } },
            minCompanyFit: { type: 'number' },
            maxCompanyFit: { type: 'number' },
            maxBestContactFit: { type: 'number' },
            minContactCount: { type: 'number' },
            maxContactCount: { type: 'number' },
            coverageStatuses: { type: 'array', items: { type: 'string' } },
            hasFunding: { type: 'boolean' },
          },
        },
        sortBy: {
          type: 'string',
          enum: [
            'company_fit_desc', 'company_fit_asc',
            'contact_count_desc', 'contact_count_asc',
            'best_contact_fit_desc', 'best_contact_fit_asc',
            'company_name_asc', 'company_name_desc',
          ],
        },
        reshapeOnly: {
          type: 'boolean',
          description: 'If true, only changes column layout without filtering rows. Use for column-only changes.',
        },
        interpretation: {
          type: 'string',
          description: 'Brief label for what filter is applied, shown above the table.',
        },
      },
      required: ['columns'],
    },
  },
];

// ─── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(page: Page): string {
  const pageContext: Record<Page, string> = {
    accounts: `You are on the Accounts page. This shows a table of all target companies (accounts) the user has in their workspace — enriched with fit scores, contact counts, therapeutic areas, funding info, and more. The user can filter, sort, and explore these accounts. You can update the table by calling filter_accounts_table.`,
    leads: `You are on the Leads page. This shows individual contacts (leads) across all companies, with their fit scores and job details. The user can filter and prioritise contacts to reach out to.`,
    dashboard: `You are on the Dashboard page. This shows a high-level overview of the workspace: coverage stats, top accounts, recent signal events, and ICP performance.`,
    pipeline: `You are on the Pipeline page. This shows ICP coverage health: where the workspace has enough companies, where contact fit is weak, and where account depth is thin.`,
    signals: `You are on the Signals page. This shows recent signal events for companies and contacts — things like job changes, funding rounds, new hires, or other triggers that indicate buying intent.`,
    imports: `You are on the Imports page. This shows the history of contact data imports — CSV uploads and HubSpot syncs. The user can see what data came in and when.`,
    data: `You are on the Data page. This is where the user starts and monitors acquisition jobs: finding more ICP-fit companies, finding better contacts, and tracking sourcing usage.`,
  };

  return `You are the Arcova Agent — an expert go-to-market co-pilot embedded in the Arcova platform, a life sciences GTM workspace.

${pageContext[page]}

## Your role
You help users understand their data, prioritise accounts and contacts, diagnose scoring, and take action. You're knowledgeable, direct, and concise — like a smart colleague who knows the platform inside-out. You don't use filler phrases like "certainly!" or "great question!".

## The Arcova platform
Arcova helps life sciences sales and BD teams identify, score, and prioritise target accounts and contacts. Key concepts:

**Company fit score (0–1)**: How well a company matches the user's ICP. Calculated from criteria like company type, therapeutic area, modality, development stage, employee size. Higher = better fit.

**Contact fit score (0–1)**: How well an individual contact matches the user's ideal buyer persona. A score of 1.0 (100%) means a perfect match.

**Coverage status**:
- "opportunity" = company fit ≥ 0.6 but no 100%-match contact yet. These are high-priority accounts to find contacts for.
- "covered" = company fit ≥ 0.6 AND at least one 100%-match contact. Ready to action.
- "weak" = company fit < 0.6. Deprioritise unless context changes.

**ICPs (Ideal Customer Profiles)**: The criteria the user defined for what makes a good target company. Multiple ICPs can be defined and ranked. Each ICP has company criteria (type, therapeutic area, etc.) and persona criteria (seniority, department, job title signals).

**Data sources**: Contacts can come from HubSpot (CRM sync), CSV imports, or Arcova-discovered contacts.

## Tools
Use your tools proactively to give accurate, data-driven answers. Don't guess at numbers — call a tool if you're not sure.

- Use get_workspace_summary for broad "overview" or "how am I doing" questions.
- Use get_icp_definitions when the user asks about scoring logic or ICPs.
- Use query_companies to answer specific questions about accounts (counts, top lists, filtered subsets).
- Use get_company_details for questions about a specific named company.
- Use query_contacts for questions about individual contacts or personas.
- Use filter_accounts_table to update the accounts table. It returns the actual filtered records — use those to craft your response. Do NOT also call query_companies; the filter tool is the single source of truth.
- Use filter_leads_table to update the leads table. It returns the actual filtered records — use those to craft your response. Do NOT also call query_contacts; the filter tool is the single source of truth.
- Use query_companies or query_contacts only for purely informational questions where the user is NOT asking to filter the visible table.
- Use suggest_navigation whenever the user's next action requires going to a different page. Always call it — never just tell the user to "go to X" in text alone.

## Navigation rules
- Only offer to do things you can actually do right now with your tools on the current page.
- Never say "Want me to do X?" if X requires the user to navigate somewhere else. Instead, tell them what to do there and call suggest_navigation so a button appears.
- One navigation suggestion per response maximum.

## Response style — strict rules

**Format**
- Plain prose only. Absolutely no markdown of any kind: no asterisks, no bold, no bullet points, no numbered lists, no headers, no tables, no pipe characters (|).
- Keep it short — 1 to 3 sentences maximum for most answers. Never write a wall of text.
- Lead with the direct answer. No preamble.
- If you need to share multiple numbers, weave them into a sentence. Never format data as a table.
- Write at an 8th-grade reading level or below. Short words, short sentences. Fewer words always beats more words.
- Never list raw metrics. Synthesise them into a 1–2 sentence story. "You have 8 accounts — 3 are ready to action, 2 need better contacts, and 3 are weak fit." Not a breakdown of each number on its own line.
- End with one short follow-up question only when it would genuinely be useful — not after every single response. Skip it when the result is small (1–2 items), when the answer is complete on its own, or when there is nothing meaningful left to offer.

**No internal details**
- Never mention score thresholds, cutoff numbers, or internal filter values. The user has no context for what "≥ 0.7" means and cannot change it, so do not say it.
- Never offer to "lower the threshold", "broaden the search", or present multiple technical options for the user to choose from. Just pick the most helpful answer and give it.

**When no results are found**
- State it plainly in one sentence. Example: "You don't have any VP-level contacts at high-fit companies right now."
- Follow with one short sentence pointing to the next step, then call suggest_navigation to show the button. Use Data (/data) when better contacts or more companies are needed. Use Import (/import) when the user should upload data themselves. Pick one — never list both.
- Never speculate about why the data is missing or list hypotheses.

**When updating the table**
- One sentence only: what you filtered and how many results came back. Example: "Filtered to CDMOs — 3 results." No breakdown of fit scores, no sub-categories, nothing more.
- Only offer a follow-up if it genuinely makes sense given the result count. If there are 1–2 results, do not offer to narrow further. If there are 0 results, point to Data or Import instead.

**Never say "certainly", "great question", "sure!", or similar filler.**`;
}

// ─── Tool implementations ─────────────────────────────────────────────────────

async function toolGetWorkspaceSummary(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string> {
  // Get user company
  const { data: userCompany } = await supabase
    .from('user_company')
    .select('company_name, domain')
    .eq('user_id', userId)
    .order('analyzed_at', { ascending: false })
    .limit(1)
    .single();

  // Get ICP count
  const { count: icpCount } = await supabase
    .from('icps')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  // Get accounts + compute coverage
  const { accounts } = await fetchAggregatedAccounts(supabase, userId);
  const totalAccounts = accounts.length;
  const totalContacts = accounts.reduce((sum, a) => sum + a.contact_count, 0);

  let covered = 0, opportunity = 0, weak = 0;
  for (const a of accounts) {
    const status = getCoverageStatus(a);
    if (status === 'covered') covered++;
    else if (status === 'opportunity') opportunity++;
    else if (status === 'weak') weak++;
  }

  const avgFit = totalAccounts > 0
    ? (accounts.reduce((sum, a) => sum + (finiteNumber(a.company_fit_score) ?? 0), 0) / totalAccounts).toFixed(2)
    : 'N/A';

  return JSON.stringify({
    user_company: userCompany?.company_name ?? userCompany?.domain ?? 'Unknown',
    icps_defined: icpCount ?? 0,
    total_accounts: totalAccounts,
    total_contacts: totalContacts,
    avg_company_fit: avgFit,
    coverage: {
      covered,
      opportunity,
      weak,
      uncategorised: totalAccounts - covered - opportunity - weak,
    },
    summary: `${covered} accounts ready to action, ${opportunity} opportunities needing contacts, ${weak} weak-fit accounts.`,
  });
}

async function toolGetIcpDefinitions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string> {
  const [icpsResult, personasResult] = await Promise.all([
    supabase
      .from('icps')
      .select('id, name, created_at, company_type, platform_category, therapeutic_areas, modalities, development_stages, funding_stages, company_sizes')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('personas')
      .select('id, icp_id, name, functions, seniority_levels')
      .eq('user_id', userId),
  ]);

  if (icpsResult.error || !icpsResult.data || icpsResult.data.length === 0) {
    return JSON.stringify({ error: 'No ICPs defined yet.' });
  }

  const personasByIcp = new Map<string, typeof personasResult.data>();
  for (const p of personasResult.data ?? []) {
    const key = p.icp_id as string;
    if (!personasByIcp.has(key)) personasByIcp.set(key, []);
    personasByIcp.get(key)!.push(p);
  }

  return JSON.stringify(
    icpsResult.data.map((icp, i) => ({
      label: icp.name?.trim() ? `ICP ${i + 1}: ${icp.name}` : `ICP ${i + 1}`,
      company_criteria: {
        company_type: icp.company_type,
        platform_category: icp.platform_category,
        therapeutic_areas: icp.therapeutic_areas,
        modalities: icp.modalities,
        development_stages: icp.development_stages,
        funding_stages: icp.funding_stages,
        company_sizes: icp.company_sizes,
      },
      personas: (personasByIcp.get(icp.id as string) ?? []).map((p) => ({
        name: p.name,
        functions: p.functions,
        seniority_levels: p.seniority_levels,
      })),
    })),
  );
}

async function toolQueryCompanies(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  input: Record<string, unknown>,
): Promise<string> {
  const { accounts, error } = await fetchAggregatedAccounts(supabase, userId);
  if (error) return JSON.stringify({ error });

  const filters: AccountQueryFilters = {
    companyTypes: Array.isArray(input.companyTypes) ? (input.companyTypes as string[]) : undefined,
    therapeuticAreas: Array.isArray(input.therapeuticAreas) ? (input.therapeuticAreas as string[]) : undefined,
    modalities: Array.isArray(input.modalities) ? (input.modalities as string[]) : undefined,
    fundingStages: Array.isArray(input.fundingStages) ? (input.fundingStages as string[]) : undefined,
    minCompanyFit: typeof input.minCompanyFit === 'number' ? input.minCompanyFit : undefined,
    maxCompanyFit: typeof input.maxCompanyFit === 'number' ? input.maxCompanyFit : undefined,
    maxBestContactFit: typeof input.maxBestContactFit === 'number' ? input.maxBestContactFit : undefined,
    minContactCount: typeof input.minContactCount === 'number' ? input.minContactCount : undefined,
    maxContactCount: typeof input.maxContactCount === 'number' ? input.maxContactCount : undefined,
    coverageStatuses: Array.isArray(input.coverageStatuses)
      ? (input.coverageStatuses as string[]).filter(
          (s): s is 'opportunity' | 'covered' | 'weak' =>
            s === 'opportunity' || s === 'covered' || s === 'weak',
        )
      : undefined,
    hasFunding: typeof input.hasFunding === 'boolean' ? input.hasFunding : undefined,
  };

  const sortBy: AccountSortBy =
    typeof input.sortBy === 'string' ? (input.sortBy as AccountSortBy) : 'company_fit_desc';
  const limit = typeof input.limit === 'number' ? Math.min(input.limit, 50) : 10;

  const filtered = applyServerSideFilters(accounts, filters);
  const sorted = applySort(filtered, sortBy);
  const top = sorted.slice(0, limit);

  return JSON.stringify({
    total_matching: filtered.length,
    showing: top.length,
    companies: top.map((a) => ({
      name: a.company_name ?? a.domain ?? 'Unknown',
      company_type: a.company_type,
      company_fit: finiteNumber(a.company_fit_score) != null
        ? `${Math.round((finiteNumber(a.company_fit_score) ?? 0) * 100)}%`
        : 'unscored',
      best_contact_fit: normalizeScore01(a.best_contact_fit) != null
        ? `${Math.round((normalizeScore01(a.best_contact_fit) ?? 0) * 100)}%`
        : 'none',
      contact_count: a.contact_count,
      coverage_status: getCoverageStatus(a) ?? 'unknown',
      therapeutic_areas: a.therapeutic_areas?.slice(0, 3) ?? [],
      funding_stage: a.funding_stage ?? a.funding_status_label ?? null,
    })),
  });
}

async function toolGetCompanyDetails(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  input: Record<string, unknown>,
): Promise<string> {
  const searchName = typeof input.company_name === 'string' ? input.company_name.toLowerCase() : '';
  if (!searchName) return JSON.stringify({ error: 'company_name is required' });

  const { accounts, error } = await fetchAggregatedAccounts(supabase, userId);
  if (error) return JSON.stringify({ error });

  const match = accounts.find(
    (a) =>
      (a.company_name ?? '').toLowerCase().includes(searchName) ||
      (a.domain ?? '').toLowerCase().includes(searchName),
  );

  if (!match) {
    return JSON.stringify({ error: `No company found matching "${input.company_name}"` });
  }

  return JSON.stringify({
    name: match.company_name ?? match.domain,
    domain: match.domain,
    company_type: match.company_type,
    company_fit_score: finiteNumber(match.company_fit_score) != null
      ? `${Math.round((finiteNumber(match.company_fit_score) ?? 0) * 100)}%`
      : 'unscored',
    company_fit_coverage: finiteNumber(match.company_fit_coverage) != null
      ? `${Math.round((finiteNumber(match.company_fit_coverage) ?? 0) * 100)}% of criteria scored`
      : null,
    coverage_status: getCoverageStatus(match),
    matched_icp: match.matched_icp_label,
    contact_count: match.contact_count,
    best_contact_fit: normalizeScore01(match.best_contact_fit) != null
      ? `${Math.round((normalizeScore01(match.best_contact_fit) ?? 0) * 100)}%`
      : 'none',
    avg_contact_fit: normalizeScore01(match.avg_contact_fit) != null
      ? `${Math.round((normalizeScore01(match.avg_contact_fit) ?? 0) * 100)}%`
      : null,
    therapeutic_areas: match.therapeutic_areas,
    modalities: match.modalities,
    development_stages: match.development_stages,
    funding_stage: match.funding_stage ?? match.funding_status_label,
    employee_range: match.employee_range,
    location: [match.headquarters_city, match.headquarters_country].filter(Boolean).join(', ') || null,
    description: match.bio_summary ?? match.description,
    data_source: match.data_provenance_type,
  });
}

async function toolQueryContacts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  input: Record<string, unknown>,
): Promise<string> {
  const limit = typeof input.limit === 'number' ? Math.min(input.limit, 50) : 10;
  const minContactFit = typeof input.minContactFit === 'number' ? input.minContactFit : undefined;
  const companyName = typeof input.companyName === 'string' ? input.companyName.toLowerCase() : undefined;
  const jobTitleSearch = typeof input.jobTitleSearch === 'string' ? input.jobTitleSearch.toLowerCase() : undefined;

  let query = supabase
    .from('contacts')
    .select(`
      id,
      first_name,
      last_name,
      job_title,
      contact_fit_score,
      linkedin_url,
      companies (
        id,
        company_name,
        domain
      )
    `)
    .eq('user_id', userId)
    .order('contact_fit_score', { ascending: false })
    .limit(limit * 5); // fetch more to allow client-side filtering

  if (minContactFit != null) {
    query = query.gte('contact_fit_score', minContactFit);
  }

  const { data: rows, error } = await query;
  if (error) return JSON.stringify({ error: error.message });

  let contacts = (rows ?? []).map((row) => {
    const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
    return {
      name: [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Unknown',
      job_title: row.job_title,
      contact_fit: normalizeScore01(row.contact_fit_score as number | null) != null
        ? `${Math.round((normalizeScore01(row.contact_fit_score as number | null) ?? 0) * 100)}%`
        : 'unscored',
      company: (company as { company_name?: string; domain?: string } | null)?.company_name
        ?? (company as { company_name?: string; domain?: string } | null)?.domain
        ?? 'Unknown',
      linkedin_url: row.linkedin_url,
    };
  });

  if (companyName) {
    contacts = contacts.filter((c) => c.company.toLowerCase().includes(companyName));
  }
  if (jobTitleSearch) {
    contacts = contacts.filter((c) => (c.job_title ?? '').toLowerCase().includes(jobTitleSearch));
  }

  contacts = contacts.slice(0, limit);

  return JSON.stringify({
    total_shown: contacts.length,
    contacts,
  });
}

// ─── Agentic loop ─────────────────────────────────────────────────────────────

async function runAgentLoop(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  page: Page,
  messages: ChatMessage[],
): Promise<{ message: string; toolsUsed: string[]; tableFilter?: TableFilter; tableAccounts?: import('@/lib/accounts-data').QueryAccount[]; leadsFilter?: LeadsTableFilter; tableLeads?: QueryLead[]; suggestedNavigation?: { href: string; label: string } }> {
  const systemPrompt = buildSystemPrompt(page);
  const toolsUsed: string[] = [];
  let tableFilter: TableFilter | undefined;
  let tableAccounts: import('@/lib/accounts-data').QueryAccount[] | undefined;
  let leadsFilter: LeadsTableFilter | undefined;
  let tableLeads: QueryLead[] | undefined;
  let suggestedNavigation: { href: string; label: string } | undefined;

  // Build Anthropic message history
  const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const MAX_ITERATIONS = 5;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      tools: TOOLS,
      messages: anthropicMessages,
    });

    // Collect text blocks and tool use blocks
    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    // If no tool calls, we're done
    if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
      const finalMessage = textBlocks.map((b) => b.text).join('');
      return { message: finalMessage, toolsUsed, tableFilter, tableAccounts, leadsFilter, tableLeads, suggestedNavigation };
    }

    // Add assistant turn with all content blocks
    anthropicMessages.push({ role: 'assistant', content: response.content });

    // Execute each tool and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      const toolName = toolUse.name;
      const toolInput = (toolUse.input ?? {}) as Record<string, unknown>;

      if (!toolsUsed.includes(toolName)) toolsUsed.push(toolName);

      let result: string;

      try {
        switch (toolName) {
          case 'get_workspace_summary':
            result = await toolGetWorkspaceSummary(supabase, userId);
            break;
          case 'get_icp_definitions':
            result = await toolGetIcpDefinitions(supabase, userId);
            break;
          case 'query_companies':
            result = await toolQueryCompanies(supabase, userId, toolInput);
            break;
          case 'get_company_details':
            result = await toolGetCompanyDetails(supabase, userId, toolInput);
            break;
          case 'query_contacts':
            result = await toolQueryContacts(supabase, userId, toolInput);
            break;
          case 'suggest_navigation': {
            const href = typeof toolInput.href === 'string' ? toolInput.href : undefined;
            const label = typeof toolInput.label === 'string' ? toolInput.label : 'Go there';
            if (href) suggestedNavigation = { href, label };
            result = JSON.stringify({ success: true });
            break;
          }

          case 'filter_leads_table': {
            const rawFilters = (toolInput.filters ?? {}) as Record<string, unknown>;
            const columns: LeadQueryColumn[] = Array.isArray(toolInput.columns)
              ? (toolInput.columns as string[]).filter(
                  (c): c is LeadQueryColumn =>
                    ['name', 'job_title', 'company', 'status', 'company_fit', 'contact_fit', 'source', 'signals', 'icp_match', 'funding_stage', 'therapeutic_areas', 'seniority'].includes(c),
                )
              : ['name', 'job_title', 'company', 'status'];

            const parsedFilters: LeadQueryFilters = {
              actions: Array.isArray(rawFilters.actions) ? (rawFilters.actions as string[]) : undefined,
              minCompanyFit: typeof rawFilters.minCompanyFit === 'number' ? rawFilters.minCompanyFit : undefined,
              maxCompanyFit: typeof rawFilters.maxCompanyFit === 'number' ? rawFilters.maxCompanyFit : undefined,
              hasSignal: typeof rawFilters.hasSignal === 'boolean' ? rawFilters.hasSignal : undefined,
              companyTypes: Array.isArray(rawFilters.companyTypes) ? (rawFilters.companyTypes as string[]) : undefined,
              fundingStages: Array.isArray(rawFilters.fundingStages) ? (rawFilters.fundingStages as string[]) : undefined,
              therapeuticAreas: Array.isArray(rawFilters.therapeuticAreas) ? (rawFilters.therapeuticAreas as string[]) : undefined,
              modalities: Array.isArray(rawFilters.modalities) ? (rawFilters.modalities as string[]) : undefined,
              seniorityKeywords: Array.isArray(rawFilters.seniorityKeywords) ? (rawFilters.seniorityKeywords as string[]) : undefined,
              titleKeywords: Array.isArray(rawFilters.titleKeywords) ? (rawFilters.titleKeywords as string[]) : undefined,
              nameSearch: typeof rawFilters.nameSearch === 'string' ? rawFilters.nameSearch : undefined,
              companyNameSearch: typeof rawFilters.companyNameSearch === 'string' ? rawFilters.companyNameSearch : undefined,
              sources: Array.isArray(rawFilters.sources) ? (rawFilters.sources as string[]) : undefined,
            };

            const lfSortBy = typeof toolInput.sortBy === 'string' ? (toolInput.sortBy as LeadSortBy) : null;

            leadsFilter = {
              columns,
              filters: parsedFilters,
              sortBy: lfSortBy,
              interpretation: typeof toolInput.interpretation === 'string' ? toolInput.interpretation : null,
            };

            // Fetch the actual filtered leads — this is the single source of truth
            try {
              const { leads: filteredLeads, error: leadsError } = await fetchFilteredLeads(supabase, userId, parsedFilters, lfSortBy);
              if (!leadsError) {
                tableLeads = filteredLeads;
                // Return the real records to the model so it describes accurate data
                result = JSON.stringify({
                  count: filteredLeads.length,
                  contacts: filteredLeads.slice(0, 20).map((l) => ({
                    name: l.full_name,
                    job_title: l.resolved_current_job_title ?? l.job_title,
                    company: l.resolved_current_company_name ?? l.company_name,
                    company_fit: l.company_fit_score != null ? `${Math.round(l.company_fit_score * 100)}%` : null,
                    contact_fit: l.contact_fit_score != null ? `${Math.round(l.contact_fit_score * 100)}%` : null,
                    company_type: l.companies?.company_type ?? null,
                  })),
                });
              } else {
                result = JSON.stringify({ error: leadsError });
              }
            } catch (e) {
              result = JSON.stringify({ error: 'Failed to fetch leads.' });
            }
            break;
          }

          case 'filter_accounts_table': {
            // Build the table filter from tool input — this is returned to the UI
            const rawFilters = (toolInput.filters ?? {}) as Record<string, unknown>;
            const columns: AccountQueryColumn[] = Array.isArray(toolInput.columns)
              ? (toolInput.columns as string[]).filter(
                  (c): c is AccountQueryColumn =>
                    [
                      'company', 'company_type', 'fit', 'contacts', 'therapeutic_areas',
                      'modalities', 'action', 'funding_stage', 'icp_match', 'development_stages',
                      'employee_range', 'location', 'source',
                    ].includes(c),
                )
              : ['company', 'company_type', 'fit', 'contacts', 'action'];

            const parsedFilters: AccountQueryFilters = {
              companyTypes: Array.isArray(rawFilters.companyTypes) ? (rawFilters.companyTypes as string[]) : undefined,
              therapeuticAreas: Array.isArray(rawFilters.therapeuticAreas) ? (rawFilters.therapeuticAreas as string[]) : undefined,
              modalities: Array.isArray(rawFilters.modalities) ? (rawFilters.modalities as string[]) : undefined,
              fundingStages: Array.isArray(rawFilters.fundingStages) ? (rawFilters.fundingStages as string[]) : undefined,
              minCompanyFit: typeof rawFilters.minCompanyFit === 'number' ? rawFilters.minCompanyFit : undefined,
              maxCompanyFit: typeof rawFilters.maxCompanyFit === 'number' ? rawFilters.maxCompanyFit : undefined,
              maxBestContactFit: typeof rawFilters.maxBestContactFit === 'number' ? rawFilters.maxBestContactFit : undefined,
              minContactCount: typeof rawFilters.minContactCount === 'number' ? rawFilters.minContactCount : undefined,
              maxContactCount: typeof rawFilters.maxContactCount === 'number' ? rawFilters.maxContactCount : undefined,
              coverageStatuses: Array.isArray(rawFilters.coverageStatuses)
                ? (rawFilters.coverageStatuses as string[]).filter(
                    (s): s is 'opportunity' | 'covered' | 'weak' =>
                      s === 'opportunity' || s === 'covered' || s === 'weak',
                  )
                : undefined,
              hasFunding: typeof rawFilters.hasFunding === 'boolean' ? rawFilters.hasFunding : undefined,
            };

            const tfSortBy = typeof toolInput.sortBy === 'string' ? (toolInput.sortBy as AccountSortBy) : null;
            const tfReshapeOnly = toolInput.reshapeOnly === true;

            tableFilter = {
              columns,
              filters: parsedFilters,
              sortBy: tfSortBy,
              reshapeOnly: tfReshapeOnly,
              interpretation: typeof toolInput.interpretation === 'string' ? toolInput.interpretation : null,
            };

            // Fetch full account objects — single source of truth for both UI and model
            if (!tfReshapeOnly) {
              try {
                const { accounts: allAccts, error: acctError } = await fetchAggregatedAccounts(supabase, userId);
                if (!acctError) {
                  const filteredAccts = applyServerSideFilters(allAccts, parsedFilters);
                  const sortedAccts = applySort(filteredAccts, tfSortBy);
                  tableAccounts = sortedAccts.slice(0, 200);
                  // Return the real records to the model so it describes accurate data
                  result = JSON.stringify({
                    count: filteredAccts.length,
                    accounts: sortedAccts.slice(0, 20).map((a) => ({
                      name: a.company_name ?? a.domain,
                      company_type: a.company_type,
                      company_fit: finiteNumber(a.company_fit_score) != null
                        ? `${Math.round((finiteNumber(a.company_fit_score) ?? 0) * 100)}%` : null,
                      contact_count: a.contact_count,
                      coverage_status: getCoverageStatus(a),
                      therapeutic_areas: a.therapeutic_areas?.slice(0, 3) ?? [],
                      funding_stage: a.funding_stage ?? null,
                    })),
                  });
                } else {
                  result = JSON.stringify({ error: acctError });
                }
              } catch {
                result = JSON.stringify({ error: 'Failed to fetch accounts.' });
              }
            } else {
              result = JSON.stringify({ success: true, message: 'Table columns updated.' });
            }
            break;
          }
          default:
            result = JSON.stringify({ error: `Unknown tool: ${toolName}` });
        }
      } catch (err) {
        console.error(`Tool ${toolName} error:`, err);
        result = JSON.stringify({ error: 'Tool execution failed.' });
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    // Add tool results turn
    anthropicMessages.push({ role: 'user', content: toolResults });
  }

  // Exceeded max iterations — ask for a final text response
  anthropicMessages.push({
    role: 'user',
    content: 'Please give your final response now.',
  });

  const finalResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: systemPrompt,
    messages: anthropicMessages,
  });

  const finalText = finalResponse.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return { message: finalText, toolsUsed, tableFilter, tableAccounts, leadsFilter, tableLeads, suggestedNavigation };
}

// ─── Route handler ─────────────────────────────────────────────────────────────

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
    const messages: ChatMessage[] = Array.isArray(body.messages) ? body.messages : [];
    const page: Page = body.page ?? 'accounts';

    if (messages.length === 0) {
      return NextResponse.json({ error: 'messages array is required' }, { status: 400 });
    }

    const result = await runAgentLoop(supabase, user.id, page, messages);

    return NextResponse.json(result satisfies ChatResponse);
  } catch (err) {
    console.error('Agent chat error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
