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
import { getLeadActionFromFits } from '@/lib/lead-action';
import { buildWorkspaceJourneyState } from '@/lib/agent-journey-state';
import { ROUTES, withQuery } from '@/lib/routes';

// ─── Types ────────────────────────────────────────────────────────────────────

type Page = 'accounts' | 'leads' | 'dashboard' | 'health' | 'signals' | 'imports' | 'data';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface PageContext {
  leadsView?: 'contacts' | 'accounts';
  totalAccounts?: number;
  filteredAccounts?: number;
  activeQuery?: string;
  totalLeads?: number;
  selectedAccount?: {
    id?: string;
    name?: string | null;
    matchedIcpId?: string | null;
    bestContactFit?: number | null;
    contactCount?: number | null;
  };
  // Data page context
  acquisitionMode?: 'companies' | 'contacts_at_company' | 'contacts_at_companies';
  acquisitionIcpId?: string;
  acquisitionIcpLabel?: string;
  acquisitionCompanyId?: string;
  acquisitionCompanyName?: string;
  acquisitionBatchCompanies?: { id: string; name: string; icpId?: string | null }[];
  dashboardBrief?: string;
  dashboardAgenda?: { title?: string; detail?: string; href?: string }[];
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
  suggestedNavigation?: { href: string; label: string; batchCompanies?: { id: string; name: string; icpId?: string | null }[] };
  pendingJobStart?: { requestType: string; icpId?: string; companyId?: string; batchCompanies?: { id: string; name: string; icpId?: string | null }[]; quantity: number };
}

// ─── Anthropic client ─────────────────────────────────────────────────────────

const anthropic = new Anthropic();

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_workspace_journey_state',
    description:
      'Diagnose where the user is in the Arcova journey and what they should do next. This combines setup, import, lead status, account coverage, ICP gaps, and Data acquisition recommendations. Call this whenever the user asks "what should I do next?", "where am I?", "help me", seems lost, asks for guidance, or asks what matters on any page.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_import_history',
    description:
      'Get recent upload_batches (CSV and HubSpot pull batches) and the last HubSpot CRM sync log. IMPORTANT: sync log "contacts pushed to HubSpot" is OUTBOUND (Arcova enrichment written to HubSpot). It is NOT how many contacts arrived FROM HubSpot. Inbound contacts from HubSpot use auto_pull_count / hubspot_contacts_pulled count and batches whose filename suggests HubSpot (e.g. hubspot-auto-, hubspot-sync-). For "where did my contacts come from", combine upload batch filenames with contact source in other tools if needed.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
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
            companyIds: { type: 'array', items: { type: 'string' } },
            sources: { type: 'array', items: { type: 'string' } },
            importedToday: { type: 'boolean' },
            latestImportOnly: {
              type: 'boolean',
              description: 'When true, filter to contacts whose batch_id equals the newest contact-bearing import batch with more than one contact for this user, falling back to the newest contact-bearing batch only if no multi-contact batch exists. Use this for "new contacts", "latest import", or "newly imported contacts"; do not interpret "new" as high score or recently updated.',
            },
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
      `Suggest that the user navigate to another page in the app. Call this whenever the next action for the user requires them to go somewhere else — always pair it with a short explanation of what to do there. Only call this once per response. When sending multiple accounts for batch contact sourcing, set href to ${withQuery(ROUTES.leads.data, 'mode=contacts_at_companies')} and populate batchCompanies with the full list.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        href: {
          type: 'string',
          description:
            `The destination page path. Use ${ROUTES.leads.data} for generic acquisition, ${ROUTES.leads.data}?mode=contacts_at_company&companyId=...&companyName=...&icpId=... for a single company, or ${withQuery(ROUTES.leads.data, 'mode=contacts_at_companies')} when sending a batch of accounts.`,
        },
        label: {
          type: 'string',
          description: 'Short button label shown to the user. e.g. "Open Data" or "Source contacts for all 12 accounts"',
        },
        batchCompanies: {
          type: 'array',
          description: 'When navigating to contacts_at_companies batch mode, provide the list of companies to source contacts for.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Company ID' },
              name: { type: 'string', description: 'Company name' },
              icpId: { type: 'string', description: 'Matched ICP ID (optional)' },
            },
            required: ['id', 'name'],
          },
        },
      },
      required: ['href', 'label'],
    },
  },
  {
    name: 'start_acquisition_job',
    description:
      'Start a data acquisition job once the user has confirmed they want to proceed. Use this on the Data page only. The job will be queued and appear in the recent jobs panel.',
    input_schema: {
      type: 'object' as const,
      properties: {
        requestType: {
          type: 'string',
          enum: ['expand_companies', 'contacts_at_company', 'contacts_at_companies'],
          description: '"expand_companies" = find more ICP-fit companies. "contacts_at_company" = source contacts at a single company. "contacts_at_companies" = batch-source contacts across multiple companies.',
        },
        quantity: {
          type: 'number',
          description: 'How many companies (for expand_companies) or contacts per account (for contacts modes) to target.',
        },
        icpId: {
          type: 'string',
          description: 'The ICP id to use. For contacts_at_company/contacts_at_companies, falls back to the company\'s matched ICP.',
        },
        companyId: {
          type: 'string',
          description: 'Company id for contacts_at_company mode.',
        },
      },
      required: ['requestType', 'quantity'],
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
            icpSearch: { type: 'string' },
            sources: { type: 'array', items: { type: 'string' } },
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

function buildSystemPrompt(page: Page, context?: PageContext): string {
  const pageContext: Record<Page, string> = {
    accounts: `You are on the Accounts page. This shows a table of all target companies (accounts) the user has in their workspace — enriched with fit scores, contact counts, therapeutic areas, funding info, and more. The user can filter, sort, and explore these accounts. You can update the table by calling filter_accounts_table.`,
    leads: `You are on the Leads page. This shows individual contacts (leads) across all companies, with their fit scores and job details. The user can filter and prioritise contacts to reach out to.`,
    dashboard: `You are on the Dashboard page. This is not a reporting page. It is the user's daily briefing room: you act like a calm, highly capable operating partner, help them ease into the day, ask what they want to tackle, and route them into the right workflow only after they choose.`,
    health: `You are on the Health page. This shows ICP coverage health: where the workspace has enough companies, where contact fit is weak, and where account depth is thin.`,
    signals: `You are on the Signals page. This shows recent signal events for companies and contacts — things like job changes, funding rounds, new hires, or other triggers that indicate buying intent.`,
    imports: `You are on the Imports page. This shows upload batch history (CSV uploads and any HubSpot pull batches) plus a HubSpot sync summary. HubSpot sync logs two directions: contacts pulled FROM HubSpot into Arcova as new import rows, and enriched contacts pushed FROM Arcova TO HubSpot. When the user asks how many contacts came from HubSpot, use inbound pull counts and HubSpot-named batches, not the push count.`,
    data: `You are on the Data page. You help the user start data acquisition jobs conversationally. Jobs available: (1) find more companies for an ICP, (2) source contacts at a specific account, (3) source contacts across a batch of accounts. Your goal is to understand what the user wants, ask one clarifying question (how many?), get confirmation, then call start_acquisition_job. Keep the conversation to 2–3 turns maximum.`,
  };

  const selectedAccountContext = context?.selectedAccount?.id
    ? `
## Current selection
The selected account is ${context.selectedAccount.name || 'the selected company'}.
Company id: ${context.selectedAccount.id}.
Matched ICP id: ${context.selectedAccount.matchedIcpId || 'unknown'}.
If the user asks to find contacts, buyer personas, or more coverage for this selected account, call suggest_navigation with ${withQuery(ROUTES.leads.data, `mode=contacts_at_company&companyId=${encodeURIComponent(context.selectedAccount.id)}&companyName=${encodeURIComponent(context.selectedAccount.name || 'Selected company')}${context.selectedAccount.matchedIcpId ? `&icpId=${encodeURIComponent(context.selectedAccount.matchedIcpId)}` : ''}`)}.`
    : '';

  const dataPageContext = page === 'data' && context?.acquisitionMode
    ? (() => {
        const mode = context.acquisitionMode;
        if (mode === 'contacts_at_companies' && context.acquisitionBatchCompanies?.length) {
          const names = context.acquisitionBatchCompanies.map((c) => c.name).join(', ');
          const n = context.acquisitionBatchCompanies.length;
          return `
## Queued job context
The user has arrived with ${n} account${n !== 1 ? 's' : ''} queued for contact sourcing: ${names}.
Company ids and ICP ids: ${JSON.stringify(context.acquisitionBatchCompanies)}.
Open the conversation by summarising what you see, then ask how many contacts they want per account. Suggest 3 to 5 for typical biotech or CRO-sized companies. When they confirm, call start_acquisition_job with requestType "contacts_at_companies". The batch list will be resolved from context.`;
        }
        if (mode === 'contacts_at_company' && context.acquisitionCompanyId) {
          return `
## Queued job context
The user wants to source contacts at ${context.acquisitionCompanyName || 'a specific company'} (id: ${context.acquisitionCompanyId}, icpId: ${context.acquisitionIcpId || 'unknown'}).
Open the conversation by confirming the company, then ask how many contacts they want. Suggest 3 to 5. When they confirm, call start_acquisition_job with requestType "contacts_at_company", companyId "${context.acquisitionCompanyId}", quantity [what the user said].`;
        }
        if (mode === 'companies' && context.acquisitionIcpId) {
          return `
## Queued job context
The user wants to find more companies for ${context.acquisitionIcpLabel || 'their ICP'} (id: ${context.acquisitionIcpId}).
Open the conversation by confirming the ICP, then ask how many companies they want to add. Suggest 20 to 50 for an initial run. When they confirm, call start_acquisition_job with requestType "expand_companies", icpId "${context.acquisitionIcpId}", quantity [what the user said].`;
        }
        return '';
      })()
    : '';

  const dashboardContext = page === 'dashboard'
    ? `
## Dashboard briefing context
Current dashboard brief: ${context?.dashboardBrief || 'No dashboard brief was supplied.'}
Agenda options shown beside the chat: ${JSON.stringify(context?.dashboardAgenda ?? [])}

On Dashboard, behave like an executive assistant starting the user's work session.
- When the page opens, start warmly and lightly. A little morning personality is good.
- Do not immediately unload the whole agenda. Ask whether the user already knows what they want to tackle, or whether they would like a suggestion.
- Never invent operational colour in the opener. Avoid phrases like "everything looks clean", "import landed", "HubSpot is tidy", "all quiet", or "looking good" unless the user asked for a status read and the tools prove it.
- If they ask for a suggestion, recommend one low-friction starting task first. Make it feel like a warm-up, not a demand.
- Do not explain the whole product. Do not turn this into analytics commentary.
- If the user says they want to work on an item, acknowledge the sequence and call suggest_navigation for the matching agenda href when available.
- After routing them, remind them briefly that Dashboard is where they can come back to decide what to do next.
- Keep dashboard messages short, practical, and work-session oriented.`
    : '';

  const leadsViewContext = context?.leadsView
    ? `
## Active Leads lens
The user is in the ${context.leadsView === 'accounts' ? 'Accounts view of Leads' : 'Contacts view of Leads'}.
${context.leadsView === 'accounts'
  ? 'Use the account lens: talk about company coverage, fit, contact depth, and which accounts need better contacts.'
  : 'Use the contacts lens: talk about individual people, contact status, seniority/function fit, and which contacts are Ready, Monitor, Source, or Deprioritised.'}`
    : '';

  return `You are the Arcova Agent — an expert go-to-market co-pilot embedded in the Arcova platform, a life sciences GTM workspace.

${pageContext[page]}
${selectedAccountContext}
${dataPageContext}
${dashboardContext}
${leadsViewContext}

## Journey model
Arcova has a clear user journey. Setup teaches the product who the user is and who they target. Import brings in contacts from HubSpot or CSV. Leads reveals contact quality: Ready, Monitor, Source, and Deprioritised. Accounts reveals company-level coverage gaps. Health reveals ICP-level strategic gaps. Data fixes those gaps by sourcing companies for an ICP, then sourcing contacts at those specific companies. Contacts are always nested inside companies; never describe this as sourcing contacts across an ICP. Signals comes later, once coverage is good, to show timing and intent.

Your job is to narrate that journey and route users to the highest-leverage next step. Make Data feel like the precise fix for a diagnosed gap, not a generic upsell.

## Your role and voice
You help users understand their data, prioritise accounts and contacts, diagnose scoring, and take action. You are cutting-edge helpful and extremely intelligent, but you should feel easy to work with: warm, lightly witty, grounded, and conversational.

Think of a brilliant operating partner with a bit of Dr Watson energy: observant, reassuring, humane, and quietly sharp. You notice what matters, make the user feel less alone in the work, and keep things moving without making the product feel heavy.

Voice rules:
- Be casual but not sloppy. Prefer plain English over dashboard jargon.
- Use short paragraphs. Avoid dense lists unless the user asks for a list or the page truly needs one.
- Do not sound like a report, a consultant deck, or a compliance memo.
- Do not over-greet on every page. Warmth should show through phrasing, not repeated hellos.
- A light aside is welcome when it reduces tension, but never bury the useful answer.
- Be decisive once the next step is obvious.
- Ask one useful question when the user is choosing between paths.
- Use "we" naturally when working through next steps with the user.
- Avoid filler phrases like "certainly", "great question", "delve", "leverage", "unlock", and "robust".

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
- Use get_workspace_journey_state whenever the user asks what to do next, asks where they are in the process, seems unsure, asks for guidance, or asks what matters on the current page. This is the main navigation and upsell tool.
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
- Navigation is a gentle follow-up, not the answer. Always give the explanation or diagnosis first. Only add a suggest_navigation call at the end if the user would genuinely benefit from going there — and only if it feels like a natural next step, not a push.
- Never lead with navigation. Never make "go to the Data page" the headline of a response.
- One navigation suggestion per response maximum.

## Journey guidance rules
- If setup is incomplete, point the user back to setup before discussing enrichment, scoring, or Data.
- If setup is complete but there are no imports, point them to Import. Mention HubSpot if connected or CSV if not.
- If imports exist but there are no scored leads or accounts yet, explain that enrichment/import processing is the next thing to wait for or check.
- If Source contacts exist at high-fit companies, explain that the companies are good but the people are wrong, then suggest Data for contact sourcing.
- If high-fit accounts have no strong contacts, explain the account coverage gap, then suggest Data for contacts at those accounts.
- If an ICP has low or zero company coverage, explain that this is a strategic coverage gap, then suggest Data to find companies for that ICP.
- If an ICP has enough companies but weak average contact fit, explain that the next step is to identify the specific companies with weak/no buyer coverage, then source contacts at those companies. Never suggest sourcing contacts directly across an ICP.
- If coverage looks healthy, point them toward Signals or prioritising Ready/Monitor leads.

## Batch contact sourcing
When the user wants to source contacts for multiple accounts at once (e.g. "source contacts for all opportunity accounts", "find contacts for all these companies"), do this in one response:
1. Call query_companies with coverageStatuses: ["opportunity"] (and limit: 50) to get the full list.
2. Explain the situation in 1–2 sentences: how many accounts need contacts and what that means.
3. Call suggest_navigation with href: "${withQuery(ROUTES.leads.data, 'mode=contacts_at_companies')}", a label like "Source contacts for all N accounts", and batchCompanies set to the full list of {id, name, icpId} objects from the query results. The id field must be the company's database id (use the raw id from the query result — if unavailable fall back to domain or name as a key).
Never ask the user to confirm each account one-by-one. Batch them all in a single suggest_navigation call.

## Response style — strict rules

**Format**
- CRITICAL TOOL CALL RULE: When you call tools, write NO text in that same turn. Silence while calling. Write your full response only AFTER you have received all tool results back. This is the most important rule.
- When you call a tool to answer a question, you MUST use the data it returns in your prose. Never discard tool results. If you fetched company details, mention what you found. If you fetched contacts, say what they showed. A response that ignores its own tool results is wrong.
- You MUST always write text in your final response turn. Never end with an empty message.
- Plain prose only. Absolutely no markdown of any kind: no asterisks, no bold, no bullet points, no numbered lists, no headers, no tables, no pipe characters (|).
- Keep it short. 1–2 sentences per paragraph. Never write a wall of text.
- For multi-part answers (diagnosis + implication + offer), use separate short paragraphs separated by a blank line. Each paragraph becomes its own chat bubble. Example: "These two accounts are flagged as opportunities — they both match your ICP well.\n\nNeither has a contact that fits your buyer persona yet, which is why they're flagged.\n\nWant me to send both to the Data page so you can source better contacts?" Note how each paragraph is one tight thought, and there's no redundancy between them.
- For simple answers, a single sentence is enough.
- Lead with the direct answer. No preamble.
- If you need to share multiple numbers, weave them into a sentence. Never format data as a table.
- Write at an 8th-grade reading level or below. Short words, short sentences. Fewer words always beats more words.
- Never list raw metrics or per-company breakdowns. Synthesise into a short story.
- End with one short follow-up question only when it would genuinely help. Skip it when the answer is complete.

**No internal details**
- Never mention score thresholds, cutoff numbers, or internal filter values. The user has no context for what "≥ 0.7" means and cannot change it, so do not say it.
- Never offer to "lower the threshold", "broaden the search", or present multiple technical options for the user to choose from. Just pick the most helpful answer and give it.

**When the user asks "why" or "explain" or "what is going on"**
- You MUST use the data you fetched to write a real explanation. Never skip this. The text response IS the answer — not navigation.
- Write 1–2 sentences saying what's actually wrong: the company fit, what contacts exist, what's missing and why that matters. Use the actual company names and facts from the tool result.
- Example of a GOOD response: "Both PhenoVista and BioOra are strong fits for your ICP but neither has a contact that fully matches your buyer persona yet — the contacts you have are there but none reach 100% fit." Example of a BAD response: "Head to the Data page to pull the right contacts." The bad example tells the user nothing.
- Only add a suggest_navigation call after the explanation, and only if it genuinely helps. It is never the answer itself.
- The goal is to help the user understand the problem well enough that they decide what to do next on their own. Explain. Don't instruct.

**When no results are found**
- State it plainly in one sentence. Example: "You don't have any VP-level contacts at high-fit companies right now."
- Follow with one short sentence pointing to the next step, then call suggest_navigation to show the button. Use Data (${ROUTES.leads.data}) when better contacts or more companies are needed. Use Import (${ROUTES.import}) when the user should upload data themselves. Pick one — never list both.
- Never speculate about why the data is missing or list hypotheses.

**When updating the table**
- One sentence only: what you filtered and how many results came back. Example: "Filtered to CDMOs — 3 results." No breakdown of fit scores, no sub-categories, nothing more.
- Only offer a follow-up if it genuinely makes sense given the result count. If there are 1–2 results, do not offer to narrow further. If there are 0 results, point to Data or Import instead.

**Never say "certainly", "great question", "sure!", or similar filler.**`;
}

// ─── Tool implementations ─────────────────────────────────────────────────────

async function toolGetWorkspaceJourneyState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string> {
  const [companyResult, icpsResult, personasResult, batchesResult, syncLogResult, accountsResult, leadsResult] =
    await Promise.all([
      supabase
        .from('user_company')
        .select('company_name, domain, analyzed_at')
        .eq('user_id', userId)
        .order('analyzed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('icps')
        .select('id, name, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('personas')
        .select('id, icp_id')
        .eq('user_id', userId),
      supabase
        .from('upload_batches')
        .select('id, filename, status, total_rows, processed_rows, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('hubspot_sync_log')
        .select('synced_at, auto_pull_at, auto_pull_count, contacts_synced')
        .eq('user_id', userId)
        .order('synced_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      fetchAggregatedAccounts(supabase, userId),
      fetchFilteredLeads(supabase, userId, {}, 'status_best_first', 500),
    ]);

  const icps = icpsResult.data ?? [];
  const personas = personasResult.data ?? [];
  const batches = batchesResult.data ?? [];
  const accounts = accountsResult.accounts ?? [];
  const leads = leadsResult.leads ?? [];
  const sync = syncLogResult.data;

  const setup = {
    company_profile_complete: !!companyResult.data,
    company_name: companyResult.data?.company_name ?? companyResult.data?.domain ?? null,
    icps_defined: icps.length,
    personas_defined: personas.length,
    setup_complete: !!companyResult.data && icps.length > 0,
  };

  const importState = {
    has_imported_contacts: batches.length > 0 || leads.length > 0 || !!sync?.auto_pull_count,
    recent_batches: batches.map((b) => ({
      filename: b.filename,
      status: b.status,
      total_rows: b.total_rows,
      processed_rows: b.processed_rows,
      created_at: b.created_at,
      likely_hubspot_pull: /\bhubspot/i.test(String(b.filename ?? '')),
    })),
    hubspot_last_job: sync
      ? {
          synced_at: sync.synced_at,
          inbound_hubspot_contacts: sync.auto_pull_count,
          inbound_recorded_at: sync.auto_pull_at,
          outbound_contacts_written_to_hubspot: sync.contacts_synced,
        }
      : null,
  };

  const leadStatusCounts = { ready: 0, monitor: 0, source: 0, deprioritized: 0 };
  const sourceContactsAtHighFitCompanies: Array<{
    id: string;
    name: string;
    job_title: string | null;
    company_id: string | null;
    company_name: string | null;
    icp: string | null;
  }> = [];

  for (const lead of leads) {
    const companyFit = lead.company_fit_score ?? lead.companies?.company_fit_score ?? null;
    const action = getLeadActionFromFits(companyFit, lead.contact_fit_score ?? null, lead.intent_score ?? null);
    if (action === 'reach_out') leadStatusCounts.ready++;
    else if (action === 'monitor') leadStatusCounts.monitor++;
    else if (action === 'source_contact') {
      leadStatusCounts.source++;
      if (sourceContactsAtHighFitCompanies.length < 8) {
        sourceContactsAtHighFitCompanies.push({
          id: lead.id,
          name: lead.full_name ?? 'Unknown contact',
          job_title: lead.resolved_current_job_title ?? lead.job_title,
          company_id: lead.company_id,
          company_name: lead.resolved_current_company_name ?? lead.company_name,
          icp: lead.matched_icp_label ?? lead.matched_icp_name,
        });
      }
    } else if (action === 'deprioritize') {
      leadStatusCounts.deprioritized++;
    }
  }

  const accountCoverage = { covered: 0, opportunity: 0, weak: 0, unscored: 0 };
  const highFitPoorCoverage: Array<{
    id: string;
    name: string;
    icpId: string | null;
    icp: string | null;
    contact_count: number;
    best_contact_fit: number | null;
    issue: string;
  }> = [];

  for (const account of accounts) {
    const status = getCoverageStatus(account);
    if (status === 'covered') accountCoverage.covered++;
    else if (status === 'opportunity') {
      accountCoverage.opportunity++;
      if (highFitPoorCoverage.length < 50) {
        highFitPoorCoverage.push({
          id: account.id,
          name: account.company_name ?? account.domain ?? 'Unknown company',
          icpId: account.matched_icp_id,
          icp: account.matched_icp_label,
          contact_count: account.contact_count,
          best_contact_fit: normalizeScore01(account.best_contact_fit),
          issue: account.contact_count === 0 ? 'no contacts' : 'contacts exist but none fully match the buyer persona',
        });
      }
    } else if (status === 'weak') accountCoverage.weak++;
    else accountCoverage.unscored++;
  }

  const icpRows = icps.map((icp, index) => {
    const icpAccounts = accounts.filter((a) => a.matched_icp_id === icp.id);
    const avgContactFit =
      icpAccounts.length > 0
        ? icpAccounts.reduce((sum, account) => sum + (normalizeScore01(account.avg_contact_fit) ?? 0), 0) / icpAccounts.length
        : null;
    const opportunityAccounts = icpAccounts.filter((a) => getCoverageStatus(a) === 'opportunity').length;
    return {
      id: icp.id,
      label: icp.name?.trim() ? `ICP ${index + 1}: ${icp.name}` : `ICP ${index + 1}`,
      company_count: icpAccounts.length,
      opportunity_accounts: opportunityAccounts,
      average_contact_fit: avgContactFit,
    };
  });

  const lowCompanyCoverageIcps = icpRows
    .filter((icp) => icp.company_count < 5)
    .sort((a, b) => a.company_count - b.company_count);

  const poorContactFitIcps = icpRows
    .filter((icp) => icp.company_count >= 5 && (icp.average_contact_fit ?? 0) < 0.6)
    .sort((a, b) => (a.average_contact_fit ?? 0) - (b.average_contact_fit ?? 0));

  const journeyState = buildWorkspaceJourneyState({
    setup,
    import_state: importState,
    leads: {
      total: leads.length,
      status_counts: leadStatusCounts,
      source_contacts_at_high_fit_companies: sourceContactsAtHighFitCompanies,
    },
    accounts: {
      total: accounts.length,
      coverage: accountCoverage,
      high_fit_poor_coverage_examples: highFitPoorCoverage.slice(0, 12),
    },
    icps: {
      rows: icpRows.map((icp) => ({
        ...icp,
        average_contact_fit:
          icp.average_contact_fit == null ? null : `${Math.round(icp.average_contact_fit * 100)}%`,
      })),
      low_company_coverage: lowCompanyCoverageIcps,
      poor_average_contact_fit: poorContactFitIcps.map((icp) => ({
        ...icp,
        average_contact_fit:
          icp.average_contact_fit == null ? null : `${Math.round(icp.average_contact_fit * 100)}%`,
      })),
    },
  });

  return JSON.stringify(journeyState);
}

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
      .order('created_at', { ascending: true }),
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
      id: a.id ?? null,
      name: a.company_name ?? a.domain ?? 'Unknown',
      icp_id: a.matched_icp_id ?? null,
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

async function toolGetImportHistory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string> {
  const [batchesResult, syncLogResult] = await Promise.all([
    supabase
      .from('upload_batches')
      .select('filename, total_rows, processed_rows, duplicate_rows, failed_rows, status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('hubspot_sync_log')
      .select(
        'synced_at, contacts_synced, contacts_errors, contacts_skipped, auto_pull_at, auto_pull_count',
      )
      .eq('user_id', userId)
      .order('synced_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const batches = batchesResult.data ?? [];
  const isHubspotSourcedFilename = (name: string | null) =>
    /\bhubspot/i.test(String(name ?? ''));

  const batchRow = (b: {
    filename: string;
    total_rows: number | null;
    processed_rows: number | null;
    duplicate_rows: number | null;
    failed_rows: number | null;
    status: string;
    created_at: string;
  }) => ({
    filename: b.filename,
    status: b.status,
    total_rows: b.total_rows,
    processed_rows: b.processed_rows,
    duplicate_rows: b.duplicate_rows,
    failed_rows: b.failed_rows,
    imported_at: b.created_at,
    likely_hubspot_pull_batch: isHubspotSourcedFilename(b.filename),
  });

  const sync = syncLogResult.data;

  return JSON.stringify({
    hubspot_sync_last_job: sync
      ? {
          completed_at: sync.synced_at,
          outbound_arcova_contacts_written_to_hubspot: sync.contacts_synced,
          outbound_push_errors: sync.contacts_errors,
          outbound_push_skipped: sync.contacts_skipped,
          inbound_hubspot_contacts_queued_for_enrichment: sync.auto_pull_count,
          inbound_pull_recorded_at: sync.auto_pull_at,
        }
      : null,
    recent_upload_batches: batches.map(batchRow),
    batches_that_look_like_hubspot_pulls: batches.filter((b) => isHubspotSourcedFilename(b.filename)).map(batchRow),
    _never_confuse: [
      'outbound_arcova_contacts_written_to_hubspot counts enrichment synced TO HubSpot.',
      'inbound_hubspot_contacts_queued_for_enrichment counts new contacts pulled FROM HubSpot into Arcova on the last job.',
      'If inbound is 0 and batches_that_look_like_hubspot_pulls is empty, say no HubSpot-sourced import batches appear in recent history; outbound push may still be non-zero.',
    ],
  });
}

// ─── Agentic loop ─────────────────────────────────────────────────────────────

async function runAgentLoop(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  page: Page,
  messages: ChatMessage[],
  pageContext?: PageContext,
): Promise<{ message: string; toolsUsed: string[]; tableFilter?: TableFilter; tableAccounts?: import('@/lib/accounts-data').QueryAccount[]; leadsFilter?: LeadsTableFilter; tableLeads?: QueryLead[]; suggestedNavigation?: { href: string; label: string; batchCompanies?: { id: string; name: string; icpId?: string | null }[] }; pendingJobStart?: { requestType: string; icpId?: string; companyId?: string; batchCompanies?: { id: string; name: string; icpId?: string | null }[]; quantity: number } }> {
  const systemPrompt = buildSystemPrompt(page, pageContext);
  const toolsUsed: string[] = [];
  let tableFilter: TableFilter | undefined;
  let tableAccounts: import('@/lib/accounts-data').QueryAccount[] | undefined;
  let leadsFilter: LeadsTableFilter | undefined;
  let tableLeads: QueryLead[] | undefined;
  let suggestedNavigation: { href: string; label: string; batchCompanies?: { id: string; name: string; icpId?: string | null }[] } | undefined;
  let pendingJobStart: { requestType: string; icpId?: string; companyId?: string; batchCompanies?: { id: string; name: string; icpId?: string | null }[]; quantity: number } | undefined;

  const DATA_PAGE_OPEN_TRIGGER = '__OPEN__';

  // Build Anthropic message history (normalize programmatic Data page opener)
  const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => {
    if (
      m.role === 'user' &&
      page === 'data' &&
      m.content.trim() === DATA_PAGE_OPEN_TRIGGER
    ) {
      return {
        role: 'user' as const,
        content:
          'The Data page just loaded with the Queued job context from your instructions. Speak first: greet the user and follow that context. Do not mention a code word, a blank message, or that the user sent this line.',
      };
    }
    return { role: m.role, content: m.content };
  });

  const MAX_ITERATIONS = 5;
  // Carry text written in the same turn as tool calls — it won't appear in the
  // next turn so we preserve it and prepend to the eventual final message.
  let spilloverText = '';

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

    // If no tool calls, we're done — combine any spillover with this turn's text
    if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
      const turnText = textBlocks.map((b) => b.text).join('');
      const finalMessage = [spilloverText, turnText].filter(Boolean).join(' ');
      return { message: finalMessage, toolsUsed, tableFilter, tableAccounts, leadsFilter, tableLeads, suggestedNavigation, pendingJobStart };
    }

    // The model wrote text alongside tool calls — save it so it isn't lost
    const turnText = textBlocks.map((b) => b.text).join('').trim();
    if (turnText) spilloverText = [spilloverText, turnText].filter(Boolean).join(' ');

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
          case 'get_workspace_journey_state':
            result = await toolGetWorkspaceJourneyState(supabase, userId);
            break;
          case 'get_import_history':
            result = await toolGetImportHistory(supabase, userId);
            break;
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
          case 'start_acquisition_job': {
            const requestType = typeof toolInput.requestType === 'string' ? toolInput.requestType : undefined;
            const quantity = typeof toolInput.quantity === 'number' ? Math.round(toolInput.quantity) : 5;
            const jobIcpId = typeof toolInput.icpId === 'string' ? toolInput.icpId : pageContext?.acquisitionIcpId;
            const jobCompanyId = typeof toolInput.companyId === 'string' ? toolInput.companyId : pageContext?.acquisitionCompanyId;
            const jobBatch = pageContext?.acquisitionBatchCompanies;
            if (requestType) {
              pendingJobStart = {
                requestType,
                quantity,
                ...(jobIcpId ? { icpId: jobIcpId } : {}),
                ...(jobCompanyId ? { companyId: jobCompanyId } : {}),
                ...(jobBatch?.length ? { batchCompanies: jobBatch } : {}),
              };
            }
            result = JSON.stringify({ success: true, message: 'Job queued.' });
            break;
          }

          case 'suggest_navigation': {
            const href = typeof toolInput.href === 'string' ? toolInput.href : undefined;
            const label = typeof toolInput.label === 'string' ? toolInput.label : 'Go there';
            const batchCompanies = Array.isArray(toolInput.batchCompanies)
              ? (toolInput.batchCompanies as { id: string; name: string; icpId?: string | null }[])
              : undefined;
            if (href) suggestedNavigation = { href, label, ...(batchCompanies ? { batchCompanies } : {}) };
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
              companyIds: Array.isArray(rawFilters.companyIds) ? (rawFilters.companyIds as string[]) : undefined,
              sources: Array.isArray(rawFilters.sources) ? (rawFilters.sources as string[]) : undefined,
              importedToday: rawFilters.importedToday === true ? true : undefined,
              latestImportOnly: rawFilters.latestImportOnly === true ? true : undefined,
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
              icpSearch: typeof rawFilters.icpSearch === 'string' ? rawFilters.icpSearch : undefined,
              sources: Array.isArray(rawFilters.sources) ? (rawFilters.sources as string[]) : undefined,
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

  const finalText = [
    spilloverText,
    finalResponse.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(''),
  ].filter(Boolean).join(' ');

  return { message: finalText, toolsUsed, tableFilter, tableAccounts, leadsFilter, tableLeads, suggestedNavigation, pendingJobStart };
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
    const pageContext: PageContext | undefined =
      body.pageContext && typeof body.pageContext === 'object' ? body.pageContext : undefined;

    if (messages.length === 0) {
      return NextResponse.json({ error: 'messages array is required' }, { status: 400 });
    }

    const result = await runAgentLoop(supabase, user.id, page, messages, pageContext);

    return NextResponse.json(result satisfies ChatResponse);
  } catch (err) {
    console.error('Agent chat error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
