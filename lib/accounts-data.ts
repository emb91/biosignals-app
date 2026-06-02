/**
 * Shared accounts data-fetching logic.
 * Used by /api/accounts/query and /api/agent/chat.
 */
import {
  formatDataProvenanceTypeOnly,
  resolveContactDataProvenance,
  type DataProvenanceChannel,
} from '@/lib/data-provenance';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AccountQueryColumn =
  | 'company'
  | 'company_type'
  | 'fit'
  | 'contacts'
  | 'crm_status'
  | 'readiness'
  | 'priority'
  | 'therapeutic_areas'
  | 'modalities'
  | 'action'
  | 'funding_stage'
  | 'icp_match'
  | 'development_stages'
  | 'employee_range'
  | 'location'
  | 'source';

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
  headquarters_state: string | null;
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
  /** Max `contacts.readiness_score` for this company among linked contacts; drives Reach out vs Monitor at account level. */
  max_contact_readiness_score: number | null;
  data_provenance_type: string;
  data_provenance_imported_at: string | null;
}

export interface AgentAccountsQueryResult {
  interpretation: string | null;
  columns: AccountQueryColumn[];
  accounts: QueryAccount[];
  conversational: string | null;
  reshapeOnly?: boolean;
}

// ─── Internal types ───────────────────────────────────────────────────────────

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
  headquarters_state: string | null;
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
  max_contact_readiness_score: number | null;
  provenance_channels: Set<DataProvenanceChannel>;
  provenance_earliest_import_at: string | null;
};

// ─── Utilities ────────────────────────────────────────────────────────────────

export function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalizeScore01(value: number | null | undefined): number | null {
  const n = finiteNumber(value);
  if (n == null) return null;
  if (n > 1 && n <= 100) return n / 100;
  if (n >= 0 && n <= 1) return n;
  return null;
}

function maxPositiveIntent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function getCoverageStatus(account: QueryAccount): 'opportunity' | 'covered' | 'weak' | null {
  const companyFit = finiteNumber(account.company_fit_score);
  if (companyFit == null) return null;
  if (companyFit < 0.6) return 'weak';
  const bestContactFit = normalizeScore01(account.best_contact_fit);
  if (bestContactFit == null || bestContactFit < 1) return 'opportunity';
  if (bestContactFit >= 1) return 'covered';
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
    headquarters_state: row.headquarters_state,
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
    max_contact_readiness_score: row.max_contact_readiness_score,
    data_provenance_type: formatDataProvenanceTypeOnly([...row.provenance_channels]),
    data_provenance_imported_at: row.provenance_earliest_import_at,
  };
}

// ─── Data fetching ────────────────────────────────────────────────────────────

export async function fetchAggregatedAccounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
): Promise<{ accounts: QueryAccount[]; error: string | null }> {
  const { data: rows, error } = await supabase
    .from('contacts')
    .select(
      `
      company_id,
      contact_fit_score,
      readiness_score,
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
        headquarters_state,
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
    .is('archived_at', null)
    .not('company_id', 'is', null);

  if (error) return { accounts: [], error: error.message };

  const byCompany = new Map<string, ScratchAgg>();

  for (const row of rows || []) {
    const companyId = row.company_id as string | null;
    const company = row.companies as CompanyAggRow | CompanyAggRow[] | null;
    const resolvedCompany = Array.isArray(company) ? company[0] : company;
    if (!companyId || !resolvedCompany?.id) continue;

    const contactFit = normalizeScore01(row.contact_fit_score as number | null);
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
        max_contact_readiness_score: maxPositiveIntent(row.readiness_score),
        provenance_channels: new Set(prov.channels),
        provenance_earliest_import_at: prov.importedAt,
      });
    } else {
      existing.contact_count += 1;
      for (const ch of prov.channels) existing.provenance_channels.add(ch);
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
      const rowIntent = maxPositiveIntent(row.readiness_score);
      if (rowIntent != null) {
        existing.max_contact_readiness_score =
          existing.max_contact_readiness_score == null
            ? rowIntent
            : Math.max(existing.max_contact_readiness_score, rowIntent);
      }
    }
  }

  let accounts = [...byCompany.values()].map(finalizeScratch);

  // Resolve ICP labels
  const icpIds = [...new Set(accounts.map((a) => a.matched_icp_id).filter((id): id is string => Boolean(id)))];
  if (icpIds.length > 0) {
    const { data: icps, error: icpError } = await supabase
      .from('icps')
      .select('id, name, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!icpError && icps) {
      const ordered = icps as Array<{ id: string; name: string | null }>;
      const indexById = new Map(ordered.map((row, idx) => [row.id, idx + 1]));
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
      accounts = accounts.map((a) => ({
        ...a,
        matched_icp_label: a.matched_icp_id ? labelById.get(a.matched_icp_id) ?? null : null,
      }));
    }
  }

  return { accounts, error: null };
}

// ─── Filtering & sorting ──────────────────────────────────────────────────────

function includesAny(value: string | null | undefined, needles: string[] | undefined): boolean {
  if (!needles || needles.length === 0) return true;
  const haystack = (value || '').toLowerCase();
  return needles.some((n) => haystack.includes(n.trim().toLowerCase()));
}

function listIncludesAny(list: string[] | null | undefined, needles: string[] | undefined): boolean {
  if (!needles || needles.length === 0) return true;
  const haystack = (list || []).map((i) => i.toLowerCase());
  return needles.some((n) => haystack.some((h) => h.includes(n.trim().toLowerCase())));
}

export function applyServerSideFilters(accounts: QueryAccount[], filters: AccountQueryFilters): QueryAccount[] {
  return accounts.filter((account) => {
    const companyFit = finiteNumber(account.company_fit_score);
    const bestContactFit = normalizeScore01(account.best_contact_fit);
    const fundingLabel = [account.funding_stage, account.funding_status_label].filter(Boolean).join(' ');

    if (filters.companyNameSearch) {
      const needle = filters.companyNameSearch.trim().toLowerCase();
      if (
        !(account.company_name || '').toLowerCase().includes(needle) &&
        !(account.domain || '').toLowerCase().includes(needle)
      )
        return false;
    }
    if (filters.domainSearch && !includesAny(account.domain, [filters.domainSearch])) return false;
    if (!includesAny(account.company_type, filters.companyTypes)) return false;
    if (!includesAny(fundingLabel, filters.fundingStages)) return false;
    if (!listIncludesAny(account.therapeutic_areas, filters.therapeuticAreas)) return false;
    if (!listIncludesAny(account.modalities, filters.modalities)) return false;
    if (!listIncludesAny(account.development_stages, filters.developmentStages)) return false;
    if (!includesAny(account.employee_range, filters.employeeRanges)) return false;
    if (filters.locations && filters.locations.length > 0) {
      const loc = [account.headquarters_city, account.headquarters_state, account.headquarters_country].filter(Boolean).join(' ');
      if (!includesAny(loc, filters.locations)) return false;
    }
    if (filters.icpSearch) {
      const needle = filters.icpSearch.trim().toLowerCase();
      if (
        !(account.matched_icp_label || '').toLowerCase().includes(needle) &&
        !(account.matched_icp_id || '').toLowerCase().includes(needle)
      )
        return false;
    }
    if (!includesAny(account.data_provenance_type, filters.sources)) return false;
    if (filters.coverageStatuses && filters.coverageStatuses.length > 0) {
      const status = getCoverageStatus(account);
      if (!status || !filters.coverageStatuses.includes(status)) return false;
    }
    if (typeof filters.minCompanyFit === 'number' && (companyFit == null || companyFit < filters.minCompanyFit))
      return false;
    if (typeof filters.maxCompanyFit === 'number' && companyFit != null && companyFit > filters.maxCompanyFit)
      return false;
    if (typeof filters.minBestContactFit === 'number' && (bestContactFit == null || bestContactFit < filters.minBestContactFit))
      return false;
    if (typeof filters.maxBestContactFit === 'number' && (bestContactFit ?? 0) > filters.maxBestContactFit)
      return false;
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

export function applySort(accounts: QueryAccount[], sortBy: AccountSortBy): QueryAccount[] {
  if (!sortBy) return accounts;
  return [...accounts].sort((a, b) => {
    const fitA = finiteNumber(a.company_fit_score);
    const fitB = finiteNumber(b.company_fit_score);
    const bestA = normalizeScore01(a.best_contact_fit);
    const bestB = normalizeScore01(b.best_contact_fit);
    const nameA = (a.company_name || a.domain || '').toLowerCase();
    const nameB = (b.company_name || b.domain || '').toLowerCase();
    switch (sortBy) {
      case 'company_fit_desc': return (fitB ?? -1) - (fitA ?? -1);
      case 'company_fit_asc': return (fitA ?? Infinity) - (fitB ?? Infinity);
      case 'contact_count_desc': return b.contact_count - a.contact_count;
      case 'contact_count_asc': return a.contact_count - b.contact_count;
      case 'best_contact_fit_desc': return (bestB ?? -1) - (bestA ?? -1);
      case 'best_contact_fit_asc': return (bestA ?? 0) - (bestB ?? 0);
      case 'company_name_asc': return nameA.localeCompare(nameB);
      case 'company_name_desc': return nameB.localeCompare(nameA);
      default: return 0;
    }
  });
}

export function hasActiveFilters(filters: AccountQueryFilters): boolean {
  return Object.values(filters).some((v) => {
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && v !== null;
  });
}
