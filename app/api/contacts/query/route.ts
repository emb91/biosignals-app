import { TASK_AGENT_OPENING } from '@/lib/prompts/agent-voice';
import { NextResponse } from 'next/server';
import { completeLlm } from '@/lib/llm-client';
import { createClient } from '@/lib/supabase-server';
import { recordLlmUsageEvent } from '@/lib/llm-usage';
import {
  type QueryColumn,
  type LeadSortBy,
  type LeadQueryFilters,
  type QueryLead,
  type AgentLeadsQueryResult,
  fetchFilteredLeads,
} from '@/lib/leads-data';

// ─── Re-exports for backward compatibility ────────────────────────────────────
// (results page imports these names from this module)
export type { QueryColumn, QueryLead } from '@/lib/leads-data';
export type { LeadSortBy as SortBy } from '@/lib/leads-data';
export type { LeadQueryFilters as QueryFilters } from '@/lib/leads-data';
export type { AgentLeadsQueryResult as AgentQueryResult } from '@/lib/leads-data';

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_COLUMNS: QueryColumn[] = [
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
];

// ─── Claude NLP → structured filters ─────────────────────────────────────────

const SYSTEM_PROMPT = `${TASK_AGENT_OPENING} Interpret natural language queries about contacts/leads and return structured JSON.

Contact data available:
- name (full_name, first_name, last_name)
- job_title (raw job title text)
- seniority_level: "Director", "VP", "C-Suite", "Manager", "Senior", "Associate", "Entry"
- business_area: "Manufacturing", "Scientific/Technical", "Commercial", "Finance", "Operations"
- company_name
- company_fit_score: 0–1 (composite: company type, TA, modality, dev stage, size, funding)
- contact_fit_score: 0–1 (right function + right seniority for the ICP)
- readiness_score: number >0 means the contact has fired a buying signal (e.g. job change, promotion)
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

COLUMN RULES - be conservative, only add columns when the query explicitly asks about that data:
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

async function callClaude(query: string): Promise<{
  interpretation: string | null;
  columns: QueryColumn[];
  filters: LeadQueryFilters;
  sortBy: LeadSortBy;
  conversational: string | null;
}> {
  const completion = await completeLlm({
    feature: 'leads_query',
    prompt: `Query: "${query}"`,
    system: SYSTEM_PROMPT,
    maxTokens: 512,
    temperature: 0,
  });

  await recordLlmUsageEvent({
    provider: completion.provider,
    feature: 'leads_query',
    route: 'app/api/contacts/query',
    model: completion.model,
    usage: completion.usage,
  });

  const text = completion.text;

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
    VALID_COLUMNS.includes(c as QueryColumn),
  );
  const cols: QueryColumn[] =
    validCols.length > 0 ? validCols : ['name', 'job_title', 'company', 'status'];

  const rawFilters = parsed.filters || {};
  const filters: LeadQueryFilters = {
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

  const VALID_SORTS: LeadSortBy[] = [
    'status_best_first',
    'status_worst_first',
    'company_fit_desc',
    'company_fit_asc',
    'contact_fit_desc',
  ];
  const sortBy: LeadSortBy =
    typeof parsed.sortBy === 'string' && VALID_SORTS.includes(parsed.sortBy as LeadSortBy)
      ? (parsed.sortBy as LeadSortBy)
      : null;

  return {
    interpretation: typeof parsed.interpretation === 'string' ? parsed.interpretation : null,
    columns: cols,
    filters,
    sortBy,
    conversational: typeof parsed.conversational === 'string' ? parsed.conversational : null,
  };
}

// ─── Route handler ────────────────────────────────────────────────────────────

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

    const claudeResult = await callClaude(query);

    if (claudeResult.conversational && Object.keys(claudeResult.filters).length === 0 && !claudeResult.sortBy) {
      return NextResponse.json({
        interpretation: null,
        columns: ['name', 'job_title', 'company', 'status'],
        leads: [],
        conversational: claudeResult.conversational,
      } satisfies AgentLeadsQueryResult);
    }

    const { leads, error } = await fetchFilteredLeads(
      supabase,
      user.id,
      claudeResult.filters,
      claudeResult.sortBy,
      200,
    );

    if (error) {
      console.error('Query contacts fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch contacts' }, { status: 500 });
    }

    if (leads.length === 0 && !claudeResult.conversational) {
      return NextResponse.json({
        interpretation: claudeResult.interpretation,
        columns: claudeResult.columns,
        leads: [],
        conversational:
          "I couldn't find any contacts matching that. Try broadening your search or adjusting the filters.",
      } satisfies AgentLeadsQueryResult);
    }

    return NextResponse.json({
      interpretation: claudeResult.interpretation,
      columns: claudeResult.columns,
      leads,
      conversational: claudeResult.conversational ?? null,
    } satisfies AgentLeadsQueryResult);
  } catch (err) {
    console.error('Contacts query error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
