import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  type DataProvenanceChannel,
  formatDataProvenanceTypeOnly,
  resolveContactDataProvenance,
} from '@/lib/data-provenance';

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

// AggregatedAccount inherits all CompanyAggRow fields (including the new funding/founding ones)
type AggregatedAccount = CompanyAggRow & {
  contact_count: number;
  best_contact_fit: number | null;
  worst_contact_fit: number | null;
  avg_contact_fit: number | null;
  max_contact_intent_score: number | null;
  data_provenance_type: string;
  data_provenance_imported_at: string | null;
  user_overrides?: Record<string, unknown> | null;
};

type ScratchAgg = CompanyAggRow & {
  contact_count: number;
  fit_sum: number;
  fit_n: number;
  best_contact_fit: number | null;
  worst_contact_fit: number | null;
  max_contact_intent_score: number | null;
  provenance_channels: Set<DataProvenanceChannel>;
  provenance_earliest_import_at: string | null;
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeScore01(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value > 1 && value <= 100) return value / 100;
  if (value >= 0 && value <= 1) return value;
  return null;
}

function maxPositiveIntent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function parseThreshold(raw: string | null, fallback: number): number {
  const n = parseFloat(raw ?? '');
  if (!Number.isFinite(n)) return fallback;
  return clamp01(n);
}

function finalizeScratch(row: ScratchAgg): AggregatedAccount {
  return {
    id: row.id,
    company_name: row.company_name,
    domain: row.domain,
    logo_url: row.logo_url,
    company_fit_score: row.company_fit_score,
    company_fit_coverage: row.company_fit_coverage,
    matched_icp_id: row.matched_icp_id,
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
    max_contact_intent_score: row.max_contact_intent_score,
    data_provenance_type: formatDataProvenanceTypeOnly([...row.provenance_channels]),
    data_provenance_imported_at: row.provenance_earliest_import_at,
  };
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const rawPage = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const companyIdFocus = (searchParams.get('companyId') || '').trim();
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)));
    const search = (searchParams.get('search') || '').trim();

    /** Narrow “strong ICP / weak persona” slice. Off by default so Accounts lists every company you have contacts on. */
    const coverageGapsOnly =
      searchParams.get('coverageGaps') === '1' || searchParams.get('coverageGaps') === 'true';

    const minCompanyFit = coverageGapsOnly
      ? parseThreshold(searchParams.get('minCompanyFit'), 0.65)
      : 0;
    const maxBestContactFit = coverageGapsOnly
      ? parseThreshold(searchParams.get('maxBestContactFit'), 0.999999)
      : 1;

    const { data: rows, error } = await supabase
      .from('contacts')
      .select(
        `
        company_id,
        contact_fit_score,
        intent_score,
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
      .eq('user_id', user.id)
      .is('archived_at', null)
      .not('company_id', 'is', null);

    if (error) {
      console.error('Error fetching contacts for accounts:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

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
          max_contact_intent_score: maxPositiveIntent(row.intent_score),
          provenance_channels: new Set(prov.channels),
          provenance_earliest_import_at: prov.importedAt,
        });
      } else {
        existing.contact_count += 1;
        for (const c of prov.channels) existing.provenance_channels.add(c);
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
            existing.best_contact_fit == null
              ? contactFit
              : Math.max(existing.best_contact_fit, contactFit);
          existing.worst_contact_fit =
            existing.worst_contact_fit == null
              ? contactFit
              : Math.min(existing.worst_contact_fit, contactFit);
        }
        const rowIntent = maxPositiveIntent(row.intent_score);
        if (rowIntent != null) {
          existing.max_contact_intent_score =
            existing.max_contact_intent_score == null
              ? rowIntent
              : Math.max(existing.max_contact_intent_score, rowIntent);
        }
      }
    }

    // Merge per-user overrides from user_companies.user_overrides on top of
    // the canonical company fields. The accounts_view does this via COALESCE
    // server-side; here we replicate it in code because the existing query
    // joins contacts → companies (not accounts_view).
    if (byCompany.size > 0) {
      const companyIds = [...byCompany.keys()];
      const { data: overrideRows, error: overrideErr } = await supabase
        .from('user_companies')
        .select('company_id, user_overrides')
        .eq('user_id', user.id)
        .in('company_id', companyIds);
      if (!overrideErr && overrideRows) {
        for (const row of overrideRows as Array<{ company_id: string; user_overrides: Record<string, unknown> | null }>) {
          const target = byCompany.get(row.company_id);
          if (!target) continue;
          const overrides = row.user_overrides ?? {};
          for (const [key, value] of Object.entries(overrides)) {
            if (value === null || value === undefined) continue;
            (target as unknown as Record<string, unknown>)[key] = value;
          }
          (target as unknown as Record<string, unknown>).user_overrides = overrides;
        }
      }
    }

    let accounts: AggregatedAccount[] = [...byCompany.values()].map(finalizeScratch);

    if (coverageGapsOnly) {
      accounts = accounts.filter((account) => {
        const companyFit =
          typeof account.company_fit_score === 'number' && Number.isFinite(account.company_fit_score)
            ? account.company_fit_score
            : null;
        if (companyFit == null || companyFit < minCompanyFit) return false;

        const best = normalizeScore01(account.best_contact_fit) ?? 0;

        return best <= maxBestContactFit;
      });
    }

    if (search) {
      const q = search.toLowerCase();
      const listMatch = (arr: string[] | null | undefined) =>
        (arr || []).some((s) => s.toLowerCase().includes(q));
      accounts = accounts.filter((account) => {
        const name = (account.company_name || '').toLowerCase();
        const domain = (account.domain || '').toLowerCase();
        if (name.includes(q) || domain.includes(q)) return true;
        if (listMatch(account.therapeutic_areas)) return true;
        if (listMatch(account.modalities)) return true;
        if (listMatch(account.development_stages)) return true;
        const funding = (account.funding_stage || account.funding_status_label || '').toLowerCase();
        if (funding.includes(q)) return true;
        const ctype = (account.company_type || '').toLowerCase();
        if (ctype.includes(q)) return true;
        return false;
      });
    }

    accounts.sort((a, b) => {
      const cfA =
        typeof a.company_fit_score === 'number' && Number.isFinite(a.company_fit_score)
          ? a.company_fit_score
          : 0;
      const cfB =
        typeof b.company_fit_score === 'number' && Number.isFinite(b.company_fit_score)
          ? b.company_fit_score
          : 0;
      if (cfB !== cfA) return cfB - cfA;

      const bestA = normalizeScore01(a.best_contact_fit) ?? 0;
      const bestB = normalizeScore01(b.best_contact_fit) ?? 0;
      return bestA - bestB;
    });

    let page = rawPage;
    if (companyIdFocus) {
      const idx = accounts.findIndex((a) => a.id === companyIdFocus);
      if (idx >= 0) {
        page = Math.floor(idx / pageSize) + 1;
      }
    }

    const total = accounts.length;
    const offset = (page - 1) * pageSize;
    const slice = accounts.slice(offset, offset + pageSize);

    let icpLabels = new Map<string, string>();

    const needsIcps = slice.some((a) => Boolean(a.matched_icp_id));
    if (needsIcps) {
      const { data: icps, error: icpError } = await supabase
        .from('icps')
        .select('id, name, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (!icpError && icps) {
        const ordered = icps as Array<{ id: string; name: string | null }>;
        const indexById = new Map(ordered.map((row, index) => [row.id, index + 1]));
        icpLabels = new Map(
          ordered.map((row) => {
            const idx = indexById.get(row.id);
            const label =
              idx != null && row.name?.trim()
                ? `ICP ${idx}: ${row.name}`
                : row.name?.trim() || (idx != null ? `ICP ${idx}` : null);
            return [row.id, label ?? ''];
          }),
        );
      }
    }

    const data = slice.map((account) => ({
      ...account,
      matched_icp_label: account.matched_icp_id
        ? icpLabels.get(account.matched_icp_id) ?? null
        : null,
    }));

    return NextResponse.json({
      data,
      total,
      page,
      pageSize,
      coverageGapsOnly,
      thresholds: coverageGapsOnly ? { minCompanyFit, maxBestContactFit } : null,
    });
  } catch (err) {
    console.error('Error in accounts GET:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
