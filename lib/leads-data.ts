/**
 * Shared leads/contacts data-fetching and filtering logic.
 * Used by /api/leads/query and /api/agent/chat.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getActionFromScores } from '@/lib/lead-action';
import {
  formatDataProvenanceTypeOnly,
  resolveContactDataProvenance,
} from '@/lib/data-provenance';
import { normalizePlatformTaxonomyFields } from '@/lib/platform-category';
import { orgIdForUser, scopeIcpsToUser } from '@/lib/org-context';

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueryColumn =
  | 'name'
  | 'job_title'
  | 'company'
  | 'status'
  | 'company_fit'
  | 'contact_fit'
  | 'source'
  | 'signals'
  | 'icp_match'
  | 'funding_stage'
  | 'therapeutic_areas'
  | 'seniority';

export type LeadSortBy =
  | 'status_best_first'
  | 'status_worst_first'
  | 'company_fit_desc'
  | 'company_fit_asc'
  | 'contact_fit_desc'
  | null;

export interface LeadQueryFilters {
  actions?: string[]; // 'reach_out' | 'source_contact' | 'monitor' | 'deprioritize'
  minCompanyFit?: number;
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
  companyIds?: string[];
  sources?: string[];
  latestImportOnly?: boolean;
  importedToday?: boolean;
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
  readiness_score: number | null;
  crm_is_suppressed: boolean;
  source: string | null;
  created_at: string | null;
  data_provenance_imported_at: string | null;
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

export interface AgentLeadsQueryResult {
  interpretation: string | null;
  columns: QueryColumn[];
  leads: QueryLead[];
  conversational: string | null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

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

// ─── Filtering & sorting ──────────────────────────────────────────────────────

export function applyLeadsSort(leads: QueryLead[], sortBy: LeadSortBy): QueryLead[] {
  if (!sortBy) return leads;
  const ACTION_ORDER: Record<string, number> = {
    reach_out: 3,
    monitor: 2,
    source_contact: 1,
    deprioritize: 0,
  };
  return [...leads].sort((a, b) => {
    const fitA = a.company_fit_score ?? a.companies?.company_fit_score ?? 0;
    const fitB = b.company_fit_score ?? b.companies?.company_fit_score ?? 0;
    const cfitA = a.contact_fit_score ?? 0;
    const cfitB = b.contact_fit_score ?? 0;
    const actionFor = (lead: QueryLead, fit: number) =>
      getActionFromScores(
        fit,
        lead.contact_fit_score ?? null,
        lead.readiness_score ?? null,
        lead.crm_is_suppressed ? 'dormant' : null,
      );
    switch (sortBy) {
      case 'status_best_first': {
        const oA = ACTION_ORDER[actionFor(a, fitA)] ?? 0;
        const oB = ACTION_ORDER[actionFor(b, fitB)] ?? 0;
        return oB - oA;
      }
      case 'status_worst_first': {
        const oA = ACTION_ORDER[actionFor(a, fitA)] ?? 0;
        const oB = ACTION_ORDER[actionFor(b, fitB)] ?? 0;
        return oA - oB;
      }
      case 'company_fit_desc': return fitB - fitA;
      case 'company_fit_asc': return fitA - fitB;
      case 'contact_fit_desc': return cfitB - cfitA;
      default: return 0;
    }
  });
}

export function applyLeadsFilters(leads: QueryLead[], filters: LeadQueryFilters): QueryLead[] {
  return leads.filter((lead) => {
    const companyFit =
      typeof lead.company_fit_score === 'number'
        ? lead.company_fit_score
        : typeof lead.companies?.company_fit_score === 'number'
          ? lead.companies.company_fit_score
          : null;

    if (filters.actions && filters.actions.length > 0) {
      const action = getActionFromScores(
        companyFit,
        lead.contact_fit_score ?? null,
        lead.readiness_score ?? null,
        lead.crm_is_suppressed ? 'dormant' : null,
      );
      if (!filters.actions.includes(action)) return false;
    }
    if (typeof filters.minCompanyFit === 'number') {
      if (companyFit === null || companyFit < filters.minCompanyFit) return false;
    }
    if (typeof filters.maxCompanyFit === 'number') {
      if (companyFit !== null && companyFit > filters.maxCompanyFit) return false;
    }
    if (filters.hasSignal === true) {
      if (!(typeof lead.readiness_score === 'number' && lead.readiness_score > 0)) return false;
    }
    if (filters.companyTypes && filters.companyTypes.length > 0) {
      const ct = (lead.companies?.company_type || '').toLowerCase();
      const ctd = (lead.companies?.company_type_display || '').toLowerCase();
      if (!filters.companyTypes.some((t) => ct.includes(t.toLowerCase()) || ctd.includes(t.toLowerCase()))) return false;
    }
    if (filters.fundingStages && filters.fundingStages.length > 0) {
      const fs = (lead.companies?.funding_stage || '').toLowerCase();
      if (!filters.fundingStages.some((s) => fs.includes(s.toLowerCase()))) return false;
    }
    if (filters.therapeuticAreas && filters.therapeuticAreas.length > 0) {
      const tas = (lead.companies?.therapeutic_areas || []).map((t) => t.toLowerCase());
      if (!filters.therapeuticAreas.some((ta) => tas.some((t) => t.includes(ta.toLowerCase())))) return false;
    }
    if (filters.modalities && filters.modalities.length > 0) {
      const mods = (lead.companies?.modalities || []).map((m) => m.toLowerCase());
      if (!filters.modalities.some((mod) => mods.some((m) => m.includes(mod.toLowerCase())))) return false;
    }
    if (filters.companyNameSearch) {
      const needle = filters.companyNameSearch.toLowerCase();
      const cn = (lead.resolved_current_company_name || lead.company_name || '').toLowerCase();
      if (!cn.includes(needle)) return false;
    }
    if (filters.companyIds && filters.companyIds.length > 0) {
      if (!lead.company_id || !filters.companyIds.includes(lead.company_id)) return false;
    }
    if (filters.sources && filters.sources.length > 0) {
      const prov = (lead.data_provenance_type || '').toLowerCase();
      const src = (lead.source || '').toLowerCase();
      if (!filters.sources.some((s) => prov.includes(s.toLowerCase()) || src.includes(s.toLowerCase()))) return false;
    }
    if (filters.importedToday) {
      const importedAt = lead.data_provenance_imported_at || lead.created_at;
      const t = importedAt ? Date.parse(importedAt) : NaN;
      if (!Number.isFinite(t)) return false;
      const imported = new Date(t);
      const now = new Date();
      if (
        imported.getFullYear() !== now.getFullYear() ||
        imported.getMonth() !== now.getMonth() ||
        imported.getDate() !== now.getDate()
      ) {
        return false;
      }
    }
    return true;
  });
}

// ─── Data fetching ────────────────────────────────────────────────────────────

export async function fetchFilteredLeads(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  filters: LeadQueryFilters,
  sortBy: LeadSortBy,
  limit = 200,
): Promise<{ leads: QueryLead[]; error: string | null }> {
  let latestBatchId: string | null = null;
  if (filters.latestImportOnly) {
    const { data: latestContactBatchRows, error: latestBatchError } = await supabase
      .from('contacts')
      .select('batch_id, created_at, upload_batches(created_at)')
      .eq('user_id', userId)
      .not('batch_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100);

    if (latestBatchError) return { leads: [], error: latestBatchError.message };
    const batchSummaries = new Map<string, { count: number; newestAt: string }>();
    for (const row of (latestContactBatchRows ?? []) as Record<string, unknown>[]) {
      const batchId = typeof row.batch_id === 'string' ? row.batch_id : null;
      if (!batchId) continue;
      const batch = row.upload_batches;
      const batchCreatedAt =
        batch && typeof batch === 'object' && !Array.isArray(batch)
          ? (batch as Record<string, unknown>).created_at
          : Array.isArray(batch)
            ? (batch[0] as Record<string, unknown> | undefined)?.created_at
            : null;
      const newestAt =
        typeof batchCreatedAt === 'string'
          ? batchCreatedAt
          : typeof row.created_at === 'string'
            ? row.created_at
            : '';
      const current = batchSummaries.get(batchId);
      batchSummaries.set(batchId, {
        count: (current?.count ?? 0) + 1,
        newestAt: current?.newestAt && current.newestAt > newestAt ? current.newestAt : newestAt,
      });
    }

    const sortedBatches = [...batchSummaries.entries()].sort((a, b) =>
      new Date(b[1].newestAt).getTime() - new Date(a[1].newestAt).getTime(),
    );
    latestBatchId =
      sortedBatches.find(([, summary]) => summary.count > 1)?.[0] ??
      sortedBatches[0]?.[0] ??
      null;
    if (!latestBatchId) return { leads: [], error: null };
  }

  // Fetch contacts ordered by fit score
  const selectClause =
    'id, full_name, first_name, last_name, job_title, resolved_current_job_title, seniority_level, business_area, company_name, resolved_current_company_name, company_id, company_domain, fit_score, overall_fit_score, contact_fit_score, readiness_score, crm_is_suppressed, source, created_at, upload_batches(filename, created_at)';

  let contactsQuery = supabase
    .from('contacts')
    .select(selectClause)
    .eq('user_id', userId)
    .order('overall_fit_score', { ascending: false, nullsFirst: false })
    .order('fit_score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(500);

  if (latestBatchId) {
    contactsQuery = contactsQuery.eq('batch_id', latestBatchId);
  }

  const { data: rawData, error: contactsError } = await contactsQuery;

  if (contactsError) return { leads: [], error: contactsError.message };

  let rows = (rawData || []) as Record<string, unknown>[];

  // Apply text-level filters early (name, seniority, title keywords)
  if (filters.nameSearch) {
    const needle = filters.nameSearch.toLowerCase();
    rows = rows.filter((r) => ((r.full_name as string) || '').toLowerCase().includes(needle));
  }
  if (filters.seniorityKeywords && filters.seniorityKeywords.length > 0) {
    rows = rows.filter((r) => {
      const sl = ((r.seniority_level as string) || '').toLowerCase();
      const title = ((r.resolved_current_job_title as string) || (r.job_title as string) || '').toLowerCase();
      return filters.seniorityKeywords!.some((kw) => sl.includes(kw.toLowerCase()) || title.includes(kw.toLowerCase()));
    });
  }
  if (filters.titleKeywords && filters.titleKeywords.length > 0) {
    rows = rows.filter((r) => {
      const title = ((r.resolved_current_job_title as string) || (r.job_title as string) || '').toLowerCase();
      return filters.titleKeywords!.some((kw) => title.includes(kw.toLowerCase()));
    });
  }

  // Fetch company data for matched company IDs
  const companyIds = [...new Set(rows.map((r) => r.company_id).filter(Boolean))] as string[];
  let companiesById = new Map<string, Record<string, unknown>>();

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

  // Resolve ICP labels
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
    // Org-scoped (company-wide + this user's personal). Explicit filter so it's correct
    // on a service-role client too, not just under RLS.
    const orgId = await orgIdForUser(supabase, userId);
    const { data: icps } = await scopeIcpsToUser(
      supabase.from('icps').select('id, name, created_at'),
      orgId,
      userId,
    ).order('created_at', { ascending: false });
    if (icps) {
      const icpRows = icps as Array<{ id: string; name: string | null }>;
      icpNamesById = new Map(icpRows.map((r) => [r.id, r.name ?? null]));
      icpIndexById = new Map(icpRows.map((r, i) => [r.id, i + 1]));
    }
  }

  // Shape into QueryLead[]
  const leads: QueryLead[] = rows.map((r) => {
    const companyId = typeof r.company_id === 'string' ? r.company_id : null;
    const company = companyId ? companiesById.get(companyId) ?? null : null;
    const matchedIcpId = company && typeof company.matched_icp_id === 'string' ? company.matched_icp_id : null;
    const matchedIcpName = matchedIcpId ? icpNamesById.get(matchedIcpId) ?? null : null;
    const matchedIcpIndex = matchedIcpId ? icpIndexById.get(matchedIcpId) ?? null : null;

    const { channels, importedAt } = resolveContactDataProvenance({
      upload_batches: r.upload_batches,
      created_at: typeof r.created_at === 'string' ? r.created_at : null,
      source: typeof r.source === 'string' ? r.source : null,
    });

    const companyFitFromCompany = company && typeof company.company_fit_score === 'number'
      ? company.company_fit_score : null;
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
      readiness_score: typeof r.readiness_score === 'number' ? r.readiness_score : null,
      crm_is_suppressed: r.crm_is_suppressed === true,
      source: typeof r.source === 'string' ? r.source : null,
      created_at: typeof r.created_at === 'string' ? r.created_at : null,
      data_provenance_imported_at: importedAt,
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
              ? (company.therapeutic_areas as string[]) : null,
            modalities: Array.isArray(company.modalities)
              ? (company.modalities as string[]) : null,
            company_fit_score: typeof company.company_fit_score === 'number'
              ? company.company_fit_score : null,
            domain: (company.domain as string | null) ?? null,
            website: (company.website as string | null) ?? null,
          }
        : null,
    };
  });

  // Apply structured filters then sort, then slice
  const filtered = applyLeadsFilters(leads, filters);
  const sorted = applyLeadsSort(filtered, sortBy);

  return { leads: sorted.slice(0, limit), error: null };
}
