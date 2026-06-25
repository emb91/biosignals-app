import type { createClient as createServerClient } from '@/lib/supabase-server';
import { orgIdForUser, scopeIcpsToUser } from '@/lib/org-context';
import {
  type AccountQueryFilters,
  type AccountSortBy,
  type QueryAccount,
  fetchAggregatedAccounts,
  applyServerSideFilters,
  applySort,
  finiteNumber,
  normalizeScore01,
  getCoverageStatus,
} from '@/lib/accounts-data';
import {
  type LeadQueryFilters,
  fetchFilteredLeads,
} from '@/lib/leads-data';
import { quarterOf, isValidPeriod } from '@/lib/coverage/period';
import { normalizeIcpTaxonomyPayload } from '@/lib/icp-taxonomy';
import type { McpScope } from '@/lib/mcp/tokens';

/**
 * MCP tool registry for the Arcova MCP server.
 *
 * Handlers call the shared lib/* data functions directly (they do NOT import the
 * agent's in-route handlers, which live inside the dirty app/api/agent/chat/route.ts).
 * This is intentional, additive duplication — see memory/project_mcp_server_build.md.
 * When the chat route's WIP lands, route.ts can be refactored to consume this registry
 * and the duplication removed.
 *
 * Tool surface excludes the chat-only UI side-effect tools (filter_accounts_table,
 * filter_leads_table, suggest_navigation) — they mutate Arcova's on-screen tables and
 * are meaningless to an external client.
 */

/** RLS-scoped server client OR a service-role client cast to the same shape (MCP path). */
export type AgentDbClient = Awaited<ReturnType<typeof createServerClient>>;

export interface AgentToolContext {
  supabase: AgentDbClient;
  userId: string;
  orgId: string | null;
  userEmail?: string | null;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Minimum scope a token must hold to call this tool. */
  scope: McpScope;
  /** True = no writes, no spend. */
  readOnly: boolean;
  /** True = spends provider credits (Apollo/Apify). Requires the 'acquire' scope. */
  paid?: boolean;
  /** Returns the model-facing JSON string. Throws on hard failure; the caller wraps it. */
  handler(ctx: AgentToolContext, input: Record<string, unknown>): Promise<string>;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function clampLimit(raw: unknown, def: number, max: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : def;
  return Math.max(1, Math.min(max, n));
}

function strArr(raw: unknown): string[] | undefined {
  return Array.isArray(raw) ? (raw.filter((x) => typeof x === 'string') as string[]) : undefined;
}

function num(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function pctStr(v: number | null | undefined): string | null {
  const n = finiteNumber(v as number | null | undefined);
  return n == null ? null : `${Math.round(n * 100)}%`;
}

function parseAccountFilters(input: Record<string, unknown>): AccountQueryFilters {
  return {
    companyTypes: strArr(input.companyTypes),
    therapeuticAreas: strArr(input.therapeuticAreas),
    modalities: strArr(input.modalities),
    fundingStages: strArr(input.fundingStages),
    minCompanyFit: num(input.minCompanyFit),
    maxCompanyFit: num(input.maxCompanyFit),
    maxBestContactFit: num(input.maxBestContactFit),
    minContactCount: num(input.minContactCount),
    maxContactCount: num(input.maxContactCount),
    coverageStatuses: Array.isArray(input.coverageStatuses)
      ? (input.coverageStatuses as string[]).filter(
          (s): s is 'opportunity' | 'covered' | 'weak' =>
            s === 'opportunity' || s === 'covered' || s === 'weak',
        )
      : undefined,
    hasFunding: typeof input.hasFunding === 'boolean' ? input.hasFunding : undefined,
  };
}

function projectAccount(a: QueryAccount) {
  return {
    id: a.id,
    name: a.company_name ?? a.domain,
    company_type: a.company_type,
    company_fit: pctStr(a.company_fit_score),
    contact_count: a.contact_count,
    coverage_status: getCoverageStatus(a),
    matched_icp: a.matched_icp_label,
    therapeutic_areas: a.therapeutic_areas?.slice(0, 5) ?? [],
    modalities: a.modalities?.slice(0, 5) ?? [],
    funding_stage: a.funding_stage ?? null,
    location: [a.headquarters_city, a.headquarters_state, a.headquarters_country]
      .filter(Boolean)
      .join(', ') || null,
  };
}

// ─── read tools ─────────────────────────────────────────────────────────────

const getWorkspaceSummary: AgentTool = {
  name: 'get_workspace_summary',
  description:
    'High-level summary of the workspace: company name, total account and contact counts, ICP count, and coverage breakdown (covered / opportunity / weak). Call first for broad questions about pipeline or data health.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  scope: 'read',
  readOnly: true,
  async handler(ctx) {
    const [{ data: userCompany }, orgId] = await Promise.all([
      ctx.supabase
        .from('user_company')
        .select('company_name, domain')
        .eq('user_id', ctx.userId)
        .order('analyzed_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ company_name: string | null; domain: string | null }>(),
      orgIdForUser(ctx.supabase, ctx.userId),
    ]);

    const { count: icpCount } = await scopeIcpsToUser(
      ctx.supabase.from('icps').select('*', { count: 'exact', head: true }),
      orgId,
      ctx.userId,
    );

    const { accounts } = await fetchAggregatedAccounts(ctx.supabase, ctx.userId);
    const totalAccounts = accounts.length;
    const totalContacts = accounts.reduce((s, a) => s + a.contact_count, 0);

    let covered = 0, opportunity = 0, weak = 0;
    for (const a of accounts) {
      const status = getCoverageStatus(a);
      if (status === 'covered') covered++;
      else if (status === 'opportunity') opportunity++;
      else if (status === 'weak') weak++;
    }
    const avgFit = totalAccounts > 0
      ? (accounts.reduce((s, a) => s + (finiteNumber(a.company_fit_score) ?? 0), 0) / totalAccounts).toFixed(2)
      : 'N/A';

    return JSON.stringify({
      company: userCompany?.company_name ?? userCompany?.domain ?? 'Unknown',
      icps_defined: icpCount ?? 0,
      total_accounts: totalAccounts,
      total_contacts: totalContacts,
      avg_company_fit: avgFit,
      coverage: { covered, opportunity, weak, uncategorised: totalAccounts - covered - opportunity - weak },
    });
  },
};

const getIcpDefinitions: AgentTool = {
  name: 'get_icp_definitions',
  description:
    'The workspace ICP (Ideal Customer Profile) definitions — the criteria and personas that determine company and contact fit. Use to explain scoring or list ICPs.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  scope: 'read',
  readOnly: true,
  async handler(ctx) {
    const orgId = await orgIdForUser(ctx.supabase, ctx.userId);
    const [icpsResult, personasResult] = await Promise.all([
      scopeIcpsToUser(
        ctx.supabase
          .from('icps')
          .select('id, name, created_at, company_type, platform_category, therapeutic_areas, modalities, development_stages, funding_stages, company_sizes'),
        orgId,
        ctx.userId,
      ).order('created_at', { ascending: true }),
      orgId
        ? ctx.supabase.from('personas').select('id, icp_id, name, functions, seniority_levels').eq('org_id', orgId)
        : ctx.supabase.from('personas').select('id, icp_id, name, functions, seniority_levels').eq('user_id', ctx.userId),
    ]);

    if (icpsResult.error || !icpsResult.data || icpsResult.data.length === 0) {
      return JSON.stringify({ error: 'No ICPs defined yet.' });
    }

    const byIcp = new Map<string, Array<Record<string, unknown>>>();
    for (const p of (personasResult.data ?? []) as Array<Record<string, unknown>>) {
      const key = p.icp_id as string;
      if (!byIcp.has(key)) byIcp.set(key, []);
      byIcp.get(key)!.push(p);
    }

    return JSON.stringify(
      (icpsResult.data as Array<Record<string, unknown> & { id: string; name: string | null }>).map((icp, i) => ({
        id: icp.id,
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
        personas: (byIcp.get(icp.id) ?? []).map((p) => ({
          name: p.name,
          functions: p.functions,
          seniority_levels: p.seniority_levels,
        })),
      })),
    );
  },
};

const queryCompanies: AgentTool = {
  name: 'query_companies',
  description:
    'Query the workspace accounts with optional filters and sorting. Use to answer questions like "how many oncology companies?", "which funded biotechs have no strong contacts?", "top 5 accounts".',
  inputSchema: {
    type: 'object',
    properties: {
      companyTypes: { type: 'array', items: { type: 'string' }, description: 'e.g. ["Biotech / Biopharma","CDMO","CRO","Pharma","Academic / Research Institute","Hospital / Health System","SaaS"]' },
      therapeuticAreas: { type: 'array', items: { type: 'string' } },
      modalities: { type: 'array', items: { type: 'string' } },
      fundingStages: { type: 'array', items: { type: 'string' } },
      minCompanyFit: { type: 'number', description: '0–1. Use 0.7 for "good fit".' },
      maxCompanyFit: { type: 'number' },
      maxBestContactFit: { type: 'number', description: 'Use 0.999999 to find accounts with no 100% contact.' },
      minContactCount: { type: 'number' },
      maxContactCount: { type: 'number', description: 'Use 0 for accounts with no contacts.' },
      coverageStatuses: { type: 'array', items: { type: 'string', enum: ['opportunity', 'covered', 'weak'] } },
      hasFunding: { type: 'boolean' },
      sortBy: {
        type: 'string',
        enum: ['company_fit_desc', 'company_fit_asc', 'contact_count_desc', 'contact_count_asc', 'best_contact_fit_desc', 'best_contact_fit_asc', 'company_name_asc', 'company_name_desc'],
      },
      limit: { type: 'number', description: 'Max companies to return (default 10, max 50).' },
    },
    required: [],
  },
  scope: 'read',
  readOnly: true,
  async handler(ctx, input) {
    const { accounts, error } = await fetchAggregatedAccounts(ctx.supabase, ctx.userId);
    if (error) return JSON.stringify({ error });

    const filtered = applyServerSideFilters(accounts, parseAccountFilters(input));
    const sortBy = (typeof input.sortBy === 'string' ? input.sortBy : 'company_fit_desc') as AccountSortBy;
    const sorted = applySort(filtered, sortBy);
    const limit = clampLimit(input.limit, 10, 50);

    return JSON.stringify({
      count: filtered.length,
      returned: Math.min(limit, sorted.length),
      companies: sorted.slice(0, limit).map(projectAccount),
    });
  },
};

const getCompanyDetails: AgentTool = {
  name: 'get_company_details',
  description:
    'Full details for one company by name (partial match) — fit, contacts, therapeutic areas, modalities, funding, firmographics, products/services.',
  inputSchema: {
    type: 'object',
    properties: { company_name: { type: 'string', description: 'Company name (partial match is fine).' } },
    required: ['company_name'],
  },
  scope: 'read',
  readOnly: true,
  async handler(ctx, input) {
    const name = typeof input.company_name === 'string' ? input.company_name.trim().toLowerCase() : '';
    if (!name) return JSON.stringify({ error: 'company_name required.' });

    const { accounts, error } = await fetchAggregatedAccounts(ctx.supabase, ctx.userId);
    if (error) return JSON.stringify({ error });

    const match =
      accounts.find((a) => (a.company_name ?? '').toLowerCase() === name) ??
      accounts.find((a) => (a.company_name ?? '').toLowerCase().includes(name)) ??
      accounts.find((a) => (a.domain ?? '').toLowerCase().includes(name));
    if (!match) return JSON.stringify({ error: `No company matching "${input.company_name}".` });

    return JSON.stringify({
      ...projectAccount(match),
      best_contact_fit: pctStr(normalizeScore01(match.best_contact_fit)),
      avg_contact_fit: pctStr(normalizeScore01(match.avg_contact_fit)),
      description: match.description ?? match.bio_summary ?? null,
      employee_range: match.employee_range,
      founded_year: match.founded_year,
      total_funding_usd: match.total_funding_usd,
      latest_funding_date: match.latest_funding_date,
      development_stages: match.development_stages ?? [],
      customer_therapeutic_areas: match.customer_therapeutic_areas ?? [],
      customer_modalities: match.customer_modalities ?? [],
      products_services: match.products_services ?? [],
      services: match.services ?? [],
      technologies: match.technologies ?? [],
      linkedin_url: match.linkedin_url,
    });
  },
};

const getAccountDetail: AgentTool = {
  name: 'get_account_detail',
  description:
    'Full account detail for a specific company by id (when you already have the id from query_companies). Same shape as get_company_details.',
  inputSchema: {
    type: 'object',
    properties: { company_id: { type: 'string', description: 'Company UUID from query_companies.' } },
    required: ['company_id'],
  },
  scope: 'read',
  readOnly: true,
  async handler(ctx, input) {
    const id = typeof input.company_id === 'string' ? input.company_id : '';
    if (!id) return JSON.stringify({ error: 'company_id required.' });
    const { accounts, error } = await fetchAggregatedAccounts(ctx.supabase, ctx.userId);
    if (error) return JSON.stringify({ error });
    const match = accounts.find((a) => a.id === id);
    if (!match) return JSON.stringify({ error: `No account with id ${id}.` });
    return JSON.stringify({
      ...projectAccount(match),
      best_contact_fit: pctStr(normalizeScore01(match.best_contact_fit)),
      description: match.description ?? match.bio_summary ?? null,
      employee_range: match.employee_range,
      founded_year: match.founded_year,
      total_funding_usd: match.total_funding_usd,
      development_stages: match.development_stages ?? [],
      customer_therapeutic_areas: match.customer_therapeutic_areas ?? [],
      products_services: match.products_services ?? [],
      technologies: match.technologies ?? [],
    });
  },
};

const queryContacts: AgentTool = {
  name: 'query_contacts',
  description:
    "Query the workspace contacts with optional filters. Returns matching contacts with fit scores and company info. Use for 'who should I reach out to', persona questions, or contacts at a company.",
  inputSchema: {
    type: 'object',
    properties: {
      companyName: { type: 'string', description: 'Filter by company name (partial match).' },
      minContactFit: { type: 'number', description: '0–1. Use 1.0 for perfect-match contacts only.' },
      jobTitleSearch: { type: 'string', description: 'Job title keyword, e.g. "VP", "Director".' },
      limit: { type: 'number', description: 'Max contacts (default 10, max 50).' },
    },
    required: [],
  },
  scope: 'read',
  readOnly: true,
  async handler(ctx, input) {
    const filters: LeadQueryFilters = {
      companyNameSearch: typeof input.companyName === 'string' ? input.companyName : undefined,
      titleKeywords: typeof input.jobTitleSearch === 'string' ? [input.jobTitleSearch] : undefined,
    };
    const { leads, error } = await fetchFilteredLeads(ctx.supabase, ctx.userId, filters, 'contact_fit_desc', 500);
    if (error) return JSON.stringify({ error });

    const minFit = num(input.minContactFit);
    const filtered = minFit != null
      ? leads.filter((l) => (l.contact_fit_score ?? 0) >= minFit)
      : leads;
    const limit = clampLimit(input.limit, 10, 50);

    return JSON.stringify({
      count: filtered.length,
      returned: Math.min(limit, filtered.length),
      contacts: filtered.slice(0, limit).map((l) => ({
        id: l.id,
        name: l.full_name,
        job_title: l.resolved_current_job_title ?? l.job_title,
        company: l.resolved_current_company_name ?? l.company_name,
        company_fit: pctStr(l.company_fit_score),
        contact_fit: pctStr(l.contact_fit_score),
        matched_icp: l.matched_icp_label ?? l.matched_icp_name ?? null,
      })),
    });
  },
};

const getContactCoverageForCompany: AgentTool = {
  name: 'get_contact_coverage_for_company',
  description:
    'Existing contact coverage at one company: how many contacts you already have, how many are strong persona fits, and a few sample names/titles.',
  inputSchema: {
    type: 'object',
    properties: { company_id: { type: 'string', description: 'Company UUID.' } },
    required: ['company_id'],
  },
  scope: 'read',
  readOnly: true,
  async handler(ctx, input) {
    const id = typeof input.company_id === 'string' ? input.company_id : '';
    if (!id) return JSON.stringify({ error: 'company_id required.' });
    const { leads, error } = await fetchFilteredLeads(ctx.supabase, ctx.userId, { companyIds: [id] }, 'contact_fit_desc', 500);
    if (error) return JSON.stringify({ error });
    const strong = leads.filter((l) => (l.contact_fit_score ?? 0) >= 1);
    return JSON.stringify({
      company_id: id,
      total_contacts: leads.length,
      strong_fit_contacts: strong.length,
      sample: leads.slice(0, 6).map((l) => ({
        name: l.full_name,
        job_title: l.resolved_current_job_title ?? l.job_title,
        contact_fit: pctStr(l.contact_fit_score),
      })),
    });
  },
};

// ─── write tools (scope: 'write') ─────────────────────────────────────────────
// Plain table ops on stable surfaces (icps, gtm_targets). These mirror the in-app
// agent handlers (toolUpdateIcp/toolDeleteIcp/toolSetGtmTarget) but are reimplemented
// here so they don't depend on the dirty route.ts. Scoped by user_id, matching the app.

const updateIcp: AgentTool = {
  name: 'update_icp',
  description:
    "Modify an existing ICP. Only pass fields you want to change; omitted fields are untouched. Requires the ICP's UUID. Always explain why in `reasoning`. Never call without the user's explicit confirmation.",
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The ICP UUID to update (from get_icp_definitions).' },
      reasoning: { type: 'string', description: 'One sentence on why this edit makes sense. Shown to the user.' },
      name: { type: 'string' },
      companyType: { type: 'string' },
      therapeuticAreas: { type: 'array', items: { type: 'string' } },
      modalities: { type: 'array', items: { type: 'string' } },
      developmentStages: { type: 'array', items: { type: 'string' } },
      companySizes: { type: 'array', items: { type: 'string' } },
      fundingStages: { type: 'array', items: { type: 'string' } },
      targetCustomers: { type: 'array', items: { type: 'string' } },
      buyerTypes: { type: 'array', items: { type: 'string' } },
    },
    required: ['id', 'reasoning'],
  },
  scope: 'write',
  readOnly: false,
  async handler(ctx, input) {
    const id = typeof input.id === 'string' ? input.id : '';
    if (!id) return JSON.stringify({ success: false, error: 'id (ICP UUID) is required.' });

    const { data: before, error: fetchErr } = await ctx.supabase
      .from('icps').select('id, name').eq('id', id).eq('user_id', ctx.userId).maybeSingle<{ id: string; name: string | null }>();
    if (fetchErr || !before) {
      const { data: all } = await ctx.supabase
        .from('icps').select('id, name').eq('user_id', ctx.userId).order('created_at', { ascending: true });
      return JSON.stringify({ success: false, error: `ICP "${id}" not found. Use a UUID from get_icp_definitions.`, availableIcps: all ?? [] });
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const a = (v: unknown) => (Array.isArray(v) ? (v as string[]) : null);
    const taxonomy = normalizeIcpTaxonomyPayload(input);
    if (typeof input.name === 'string') patch.name = input.name;
    if (typeof input.companyType === 'string') patch.company_type = taxonomy.company_type;
    if (a(input.therapeuticAreas)) patch.therapeutic_areas = taxonomy.therapeutic_areas;
    if (a(input.modalities)) patch.modalities = taxonomy.modalities;
    if (a(input.developmentStages)) patch.development_stages = taxonomy.development_stages;
    if (a(input.companySizes)) patch.company_sizes = taxonomy.company_sizes;
    if (a(input.fundingStages)) patch.funding_stages = taxonomy.funding_stages;
    if (a(input.targetCustomers)) patch.target_customers = a(input.targetCustomers);
    if (a(input.buyerTypes)) patch.buyer_types = a(input.buyerTypes);

    const { error: updateErr } = await ctx.supabase.from('icps').update(patch).eq('id', id).eq('user_id', ctx.userId);
    if (updateErr) return JSON.stringify({ success: false, error: updateErr.message });
    return JSON.stringify({ success: true, id, changedFields: Object.keys(patch).filter((k) => k !== 'updated_at') });
  },
};

const deleteIcp: AgentTool = {
  name: 'delete_icp',
  description:
    "Delete an existing ICP by UUID. Never call without the user's explicit confirmation. For a merge, update the ICP you're keeping first, then delete the other.",
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The ICP UUID to delete.' },
      reasoning: { type: 'string', description: 'One sentence on why. Shown to the user.' },
    },
    required: ['id', 'reasoning'],
  },
  scope: 'write',
  readOnly: false,
  async handler(ctx, input) {
    const id = typeof input.id === 'string' ? input.id : '';
    if (!id) return JSON.stringify({ success: false, error: 'id (ICP UUID) is required.' });
    const { data: before, error: fetchErr } = await ctx.supabase
      .from('icps').select('id, name').eq('id', id).eq('user_id', ctx.userId).maybeSingle<{ id: string; name: string | null }>();
    if (fetchErr || !before) {
      const { data: all } = await ctx.supabase
        .from('icps').select('id, name').eq('user_id', ctx.userId).order('created_at', { ascending: true });
      return JSON.stringify({ success: false, error: `ICP "${id}" not found.`, availableIcps: all ?? [] });
    }
    const { error: delErr } = await ctx.supabase.from('icps').delete().eq('id', id).eq('user_id', ctx.userId);
    if (delErr) return JSON.stringify({ success: false, error: delErr.message });
    return JSON.stringify({ success: true, id, deletedName: before.name });
  },
};

const setGtmTarget: AgentTool = {
  name: 'set_gtm_target',
  description:
    "Set or update the overall GTM target for a quarter. One number per quarter (revenue USD or deal count). Confirm the number and unit before calling. Defaults to the current quarter.",
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['revenue', 'deals'] },
      value: { type: 'number', description: 'Dollars for revenue, a whole number for deals. Must be positive.' },
      period: { type: 'string', description: "Quarter as 'YYYY-Qn' (e.g. '2026-Q3'). Omit for current quarter." },
      reasoning: { type: 'string', description: 'One sentence on why this target makes sense.' },
    },
    required: ['type', 'value', 'reasoning'],
  },
  scope: 'write',
  readOnly: false,
  async handler(ctx, input) {
    const type: 'revenue' | 'deals' = input.type === 'deals' ? 'deals' : 'revenue';
    const period = typeof input.period === 'string' && isValidPeriod(input.period) ? input.period : quarterOf();
    const raw = typeof input.value === 'number' ? input.value : Number(input.value);
    if (!Number.isFinite(raw) || raw <= 0 || raw > 1_000_000_000) {
      return JSON.stringify({ success: false, error: 'Invalid target value — must be a positive number.' });
    }
    const value = type === 'deals' ? Math.round(raw) : Math.round(raw * 100) / 100;
    const { error } = await ctx.supabase.from('gtm_targets').upsert(
      { user_id: ctx.userId, period, target_type: type, target_value: value, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,period' },
    );
    if (error) return JSON.stringify({ success: false, error: error.message });
    return JSON.stringify({ success: true, period, type, value });
  },
};

// ─── registry ───────────────────────────────────────────────────────────────

export const MCP_TOOLS: AgentTool[] = [
  getIcpDefinitions,
  queryContacts,
  getContactCoverageForCompany,
  updateIcp,
  deleteIcp,
  setGtmTarget,
  // ── DEFERRED: account-aggregation tools ──────────────────────────────────────
  // getWorkspaceSummary, queryCompanies, getCompanyDetails, getAccountDetail all call
  // fetchAggregatedAccounts, whose `companies(...)` embed is stale against the migrated
  // schema (company_fit_score now lives on accounts_view / org company state, not companies).
  // That function is mid-migration in the dirty WIP branch, so we do NOT reimplement it
  // here (a parallel accounts_view aggregation would be throwaway and risk drift).
  // These tools are wired to the canonical fetchAggregatedAccounts and will start working
  // automatically once the WIP lands — re-add them to this array then. The handler code is
  // kept above intact. See memory/project_mcp_server_build.md.
  //   getWorkspaceSummary, queryCompanies, getCompanyDetails, getAccountDetail,
  // write tools (update_icp, delete_icp, set_gtm_target) and the paid acquire tool
  // (start_acquisition_job) are added in a later pass — same file.
];

export const MCP_TOOL_MAP = new Map(MCP_TOOLS.map((t) => [t.name, t]));
