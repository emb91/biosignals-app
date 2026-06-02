import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  type DataProvenanceChannel,
  formatDataProvenanceTypeOnly,
} from '@/lib/data-provenance';
import {
  resolveContactHubSpotStates,
  HUBSPOT_STATE_PRIORITY,
  type HubSpotLeadState,
  formatHubSpotStageLabel,
} from '@/lib/hubspot-lead-state';

// Row returned by the list_user_accounts Postgres RPC.
// Aggregation, sort, and pagination happen entirely in SQL.
type AccountRpcRow = {
  id: string;
  company_name: string | null;
  domain: string | null;
  website: string | null;
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
  industry: string | null;
  sub_industry: string | null;
  clinical_stage: string | null;
  platform_category: string | null;
  company_size_bucket: string | null;
  tagline: string | null;
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
  contact_count: number;
  best_contact_fit: number | null;
  worst_contact_fit: number | null;
  avg_contact_fit: number | null;
  max_contact_readiness_score: number | null;
  readiness_score: number | null;
  readiness_label: string | null;
  priority_score: number | null;
  uc_source: string | null;
  uc_added_at: string | null;
  user_overrides: Record<string, unknown> | null;
  total_count: number;
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

function parseThreshold(raw: string | null, fallback: number): number {
  const n = parseFloat(raw ?? '');
  if (!Number.isFinite(n)) return fallback;
  return clamp01(n);
}

function channelFromSource(source: string | null): DataProvenanceChannel[] {
  const src = (source || '').trim().toLowerCase();
  if (src === 'arcova' || src === 'fiber' || src === 'apollo' || src === 'job_change_monitor') return ['arcova'];
  if (src === 'hubspot') return ['hubspot'];
  if (src) return ['csv'];
  return [];
}

// ── Account-level CRM status ──────────────────────────────────────────────

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

export type AccountCrmStatus = HubSpotLeadState;

export type AccountCrmEntry = {
  state: AccountCrmStatus;
  /** Formatted deal stage label for the winning contact's deal (e.g. "Buy-in", "Contract"). */
  dealStageLabel: string | null;
};

async function fetchCompanyCrmStatuses(
  supabase: SupabaseLike,
  userId: string,
  companyIds: string[],
): Promise<Map<string, AccountCrmEntry>> {
  if (!companyIds.length) return new Map();
  try {
    // 1. Fetch contacts for the page's companies
    const { data: contacts, error: contactsErr } = await supabase
      .from('contacts')
      .select('id, email, company_id')
      .eq('user_id', userId)
      .in('company_id', companyIds)
      .is('archived_at', null);

    if (contactsErr || !contacts?.length) return new Map();

    type ContactStub = { id: string; email: string | null; company_id: string };
    const stubs = contacts as ContactStub[];
    const companyByContactId = new Map(stubs.map((c) => [c.id, c.company_id]));

    // 2. Resolve HubSpot state per contact — exact same logic as /api/leads
    const contactStates = await resolveContactHubSpotStates(
      supabase,
      userId,
      stubs.map((c) => ({ id: c.id, email: c.email })),
    );

    // 3. Aggregate per company — highest-priority state wins; carry its dealStage
    const companyStatus = new Map<string, AccountCrmEntry>();
    for (const [contactId, resolved] of contactStates) {
      const companyId = companyByContactId.get(contactId);
      if (!companyId) continue;
      const existing = companyStatus.get(companyId);
      if (
        !existing ||
        HUBSPOT_STATE_PRIORITY[resolved.state] > HUBSPOT_STATE_PRIORITY[existing.state]
      ) {
        companyStatus.set(companyId, {
          state: resolved.state,
          dealStageLabel: formatHubSpotStageLabel(resolved.dealStage),
        });
      }
    }

    return companyStatus;
  } catch {
    return new Map();
  }
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

    const coverageGapsOnly =
      searchParams.get('coverageGaps') === '1' || searchParams.get('coverageGaps') === 'true';

    const minCompanyFit = coverageGapsOnly
      ? parseThreshold(searchParams.get('minCompanyFit'), 0.65)
      : 0;
    const maxBestContactFit = coverageGapsOnly
      ? parseThreshold(searchParams.get('maxBestContactFit'), 0.999999)
      : 1;

    // ── Find focus-company page (no contacts scan needed) ──────────────────
    let page = rawPage;
    if (companyIdFocus) {
      const { data: focusPage } = await supabase.rpc('get_account_page_for_company', {
        p_user_id: user.id,
        p_company_id: companyIdFocus,
        p_page_size: pageSize,
      });
      if (typeof focusPage === 'number' && focusPage >= 1) {
        page = focusPage;
      }
    }

    const offset = (page - 1) * pageSize;

    // ── Single RPC: aggregation + join + sort + pagination in SQL ──────────
    // list_user_accounts groups contacts per company (with contact fit stats),
    // joins to companies + account_readiness_snapshots, orders by
    // priority_score DESC, and returns only the requested page — eliminating
    // the full contacts table scan and JS rollup that ran before.
    const { data: rpcRows, error: rpcError } = await supabase.rpc('list_user_accounts', {
      p_user_id: user.id,
      p_search: search || null,
      p_coverage_gaps_only: coverageGapsOnly,
      p_min_company_fit: minCompanyFit,
      p_max_best_contact_fit: maxBestContactFit,
      p_limit: pageSize,
      p_offset: offset,
    });

    if (rpcError) {
      console.error('Error in list_user_accounts RPC:', rpcError);
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    const rows = (rpcRows || []) as AccountRpcRow[];
    const total = rows[0]?.total_count ?? 0;
    const sliceCompanyIds = rows.map((r) => r.id);

    const needsIcps = rows.some((r) => Boolean(r.matched_icp_id));

    const [icpResult, companyCrmStatuses] = await Promise.all([
      needsIcps
        ? supabase
            .from('icps')
            .select('id, name, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      // CRM status scoped to this page only — the expensive per-contact lookup.
      fetchCompanyCrmStatuses(supabase, user.id, sliceCompanyIds),
    ]);

    let icpLabels = new Map<string, string>();
    if (!icpResult.error && icpResult.data) {
      const ordered = icpResult.data as Array<{ id: string; name: string | null }>;
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

    const data = rows.map((row) => {
      // Apply user_overrides on top of RPC row (lightweight key merge)
      const overrides = row.user_overrides ?? {};

      const crmEntry = companyCrmStatuses.get(row.id) ?? null;

      // CRM-deprioritised accounts: cap readiness at 0.01 so priority reflects
      // "already handled" — fit × (0.5 + 0.5 × 0.01) ≈ fit × 0.505.
      const crmDeprioritised =
        crmEntry?.state === 'customer' || crmEntry?.state === 'dormant';

      const rawReadiness = row.readiness_score ?? null;
      const displayedReadiness =
        crmDeprioritised && rawReadiness != null ? 0.01 : rawReadiness;

      const storedPriority = row.priority_score ?? null;
      const fitNorm = normalizeScore01(row.company_fit_score);
      const basePriority = crmDeprioritised
        ? fitNorm != null
          ? fitNorm * (0.5 + 0.5 * 0.01)
          : null
        : storedPriority != null
          ? storedPriority
          : fitNorm != null
            ? fitNorm * 0.5
            : null;

      // LEAN LIST projection — only the fields the table view + agent
      // list-mode actually need. Side panel + agent detail-mode use the
      // GET /api/accounts/[id] endpoint for the full ~44-field record.
      // Trimming here saves ~45% on wire payload per list load.
      const overrideFor = (k: string) => {
        const v = (overrides as Record<string, unknown>)[k];
        return v === null || v === undefined ? undefined : v;
      };
      return {
        // Identity
        id: row.id,
        company_name: overrideFor('company_name') ?? row.company_name,
        domain: row.domain,
        logo_url: row.logo_url,
        // ICP
        matched_icp_id: row.matched_icp_id,
        matched_icp_label: row.matched_icp_id ? icpLabels.get(row.matched_icp_id) ?? null : null,
        // Scores (sortable in table)
        company_fit_score: row.company_fit_score,
        company_fit_coverage: row.company_fit_coverage,
        best_contact_fit: row.best_contact_fit,
        avg_contact_fit: row.avg_contact_fit,
        worst_contact_fit: row.worst_contact_fit,
        max_contact_readiness_score: row.max_contact_readiness_score,
        contact_count: row.contact_count,
        // Categorisation (table pills)
        company_type: overrideFor('company_type') ?? row.company_type,
        therapeutic_areas: (overrideFor('therapeutic_areas') as string[] | undefined) ?? row.therapeutic_areas,
        modalities: (overrideFor('modalities') as string[] | undefined) ?? row.modalities,
        development_stages: (overrideFor('development_stages') as string[] | undefined) ?? row.development_stages,
        // Firmographics (table cols)
        employee_count: (overrideFor('employee_count') as number | undefined) ?? row.employee_count,
        employee_range: overrideFor('employee_range') ?? row.employee_range,
        headquarters_city: overrideFor('headquarters_city') ?? row.headquarters_city,
        headquarters_country: overrideFor('headquarters_country') ?? row.headquarters_country,
        // Funding (table col)
        funding_stage: overrideFor('funding_stage') ?? row.funding_stage,
        funding_status_label: row.funding_status_label,
        // Computed
        data_provenance_type: formatDataProvenanceTypeOnly(channelFromSource(row.uc_source)),
        data_provenance_imported_at: row.uc_added_at,
        readiness_label: row.readiness_label,
        readiness_score: displayedReadiness,
        raw_readiness_score: rawReadiness,
        priority_score: basePriority,
        crm_status: crmEntry?.state ?? null,
        crm_deal_stage_label: crmEntry?.dealStageLabel ?? null,
      };
    });

    return NextResponse.json({
      data,
      total: Number(total),
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
