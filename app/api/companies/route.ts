import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { orgIdForUser, scopeIcpsToUser } from '@/lib/org-context';
import { type SequenceDispatchStatus } from '@/lib/lead-action';
import { resolveEffectivePriority } from '@/lib/effective-priority';
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
import { fetchOrgOutreachActivityByPerson, statusForTeammateAction } from '@/lib/org-outreach';

// Row returned by the list_user_accounts Postgres RPC.
// Aggregation, sort, and pagination happen entirely in SQL.
type AccountRpcRow = {
  id: string;
  company_name: string | null;
  domain: string | null;
  website: string | null;
  logo_url: string | null;
  logo_cached: string | null;
  company_fit_score: number | null;
  company_fit_coverage: number | null;
  matched_icp_id: string | null;
  therapeutic_areas: string[] | null;
  modalities: string[] | null;
  development_stages: string[] | null;
  customer_therapeutic_areas: string[] | null;
  customer_modalities: string[] | null;
  customer_development_stages: string[] | null;
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
  enrichment_refresh_status: 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled' | null;
  enrichment_refresh_last_error: string | null;
  enrichment_refresh_started_at: string | null;
  enrichment_refresh_finished_at: string | null;
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
  if (src === 'arcova' || src === 'apollo' || src === 'job_change_monitor') return ['arcova'];
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
  /** Close-date proxy (winning deal's last-modified) — drives the CRM suppression cooldown. */
  closedAt: string | null;
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

    // 2. Resolve HubSpot state per contact — exact same logic as /api/contacts
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
          closedAt: resolved.modifiedAt ?? null,
        });
      }
    }

    return companyStatus;
  } catch {
    return new Map();
  }
}

/**
 * Aggregate outreach funnel state per account so the account action mirrors the
 * contact action's outreach overlay (Send outreach / Await reply). Takes each
 * contact's LATEST sequence status (same normalisation as /api/contacts), then per
 * company keeps the highest-actionability state: a 'generating'/'draft' row
 * (the rep has committed to outreach, or has something ready to dispatch)
 * outranks a 'sent' one, matching LEAD_ACTION_SORT_ORDER (send_outreach >
 * await_reply). 'replied' / 'failed' contribute nothing — they fall through to
 * the score-driven action, exactly like a single contact does.
 */
async function fetchCompanySequenceStatuses(
  supabase: SupabaseLike,
  userId: string,
  orgId: string | null,
  companyIds: string[],
): Promise<Map<string, SequenceDispatchStatus>> {
  if (!companyIds.length) return new Map();
  const companySeq = new Map<string, SequenceDispatchStatus>();
  const applyStatus = (companyId: string | null | undefined, status: string | null | undefined) => {
    if (!companyId) return;
    if (status === 'generating') {
      companySeq.set(companyId, 'generating');
    } else if (status === 'draft') {
      companySeq.set(companyId, 'draft');
    } else if (status === 'sent' && !['generating', 'draft'].includes(companySeq.get(companyId) ?? '')) {
      companySeq.set(companyId, 'sent');
    }
  };

  try {
    const { data: contacts, error: contactsErr } = await supabase
      .from('contacts')
      .select('id, company_id')
      .eq('user_id', userId)
      .in('company_id', companyIds)
      .is('archived_at', null);
    if (contactsErr || !contacts?.length) throw contactsErr ?? new Error('No own contacts found');

    const companyByContactId = new Map(
      (contacts as Array<{ id: string; company_id: string }>).map((c) => [c.id, c.company_id]),
    );
    const contactIds = [...companyByContactId.keys()];

    const { data: seqs, error: seqErr } = await supabase
      .from('outreach_sequences')
      .select('contact_id, dispatch_status, exported_to, created_at')
      .eq('user_id', userId)
      .in('contact_id', contactIds)
      .order('created_at', { ascending: false });
    if (seqErr || !seqs?.length) throw seqErr ?? new Error('No own sequences found');

    // Latest status per contact (newest first → set-if-absent), normalised to the
    // states the action override understands — identical to /api/contacts.
    const latestByContact = new Map<string, string>();
    for (const r of seqs as Array<{
      contact_id: string;
      dispatch_status: string | null;
      exported_to: string | null;
    }>) {
      if (latestByContact.has(r.contact_id)) continue;
      let normalized = r.dispatch_status;
      if (normalized === 'queued') normalized = 'sent';
      if (normalized === 'exported') normalized = 'sent';
      if (!normalized) normalized = r.exported_to ? 'sent' : 'draft';
      latestByContact.set(r.contact_id, normalized);
    }

    // Aggregate per company: generating/draft > sent; everything else ignored.
    for (const [contactId, status] of latestByContact) {
      applyStatus(companyByContactId.get(contactId), status);
    }
  } catch {
    // Own-sequence lookup is best-effort; teammate activity below can still fill.
  }

  if (!orgId) return companySeq;
  try {
    const { data: states } = await supabase
      .from('org_contact_state')
      .select('person_id, company_id')
      .eq('org_id', orgId)
      .in('company_id', companyIds)
      .is('archived_at', null);
    const stateRows = (states ?? []) as Array<{ person_id: string | null; company_id: string | null }>;
    const companyByPersonId = new Map<string, string>();
    for (const row of stateRows) {
      if (row.person_id && row.company_id && !companyByPersonId.has(row.person_id)) {
        companyByPersonId.set(row.person_id, row.company_id);
      }
    }
    const personIds = [...companyByPersonId.keys()];
    if (personIds.length > 0) {
      const { data: ownSeqs } = await supabase
        .from('outreach_sequences')
        .select('person_id, dispatch_status, exported_to, created_at')
        .eq('user_id', userId)
        .in('person_id', personIds)
        .order('created_at', { ascending: false });
      const latestByPerson = new Set<string>();
      for (const row of (ownSeqs ?? []) as Array<{
        person_id: string | null;
        dispatch_status: string | null;
        exported_to: string | null;
      }>) {
        if (!row.person_id || latestByPerson.has(row.person_id)) continue;
        latestByPerson.add(row.person_id);
        let normalized = row.dispatch_status;
        if (normalized === 'queued') normalized = 'sent';
        if (normalized === 'exported') normalized = 'sent';
        if (!normalized) normalized = row.exported_to ? 'sent' : 'draft';
        applyStatus(companyByPersonId.get(row.person_id), normalized);
      }
    }
    const activity = await fetchOrgOutreachActivityByPerson(supabase, {
      userId,
      personIds,
    });
    for (const [personId, row] of activity) {
      applyStatus(companyByPersonId.get(personId), statusForTeammateAction(row.status));
    }
  } catch {
    // Best-effort teammate overlay; never break the accounts list for it.
  }

  return companySeq;
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

    const orgId = await orgIdForUser(supabase, user.id);
    const [icpResult, companyCrmStatuses, companySequenceStatuses, orgOverrideResult] = await Promise.all([
      needsIcps
        ? scopeIcpsToUser(
            supabase.from('icps').select('id, name, created_at'),
            orgId,
            user.id,
          ).order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      // CRM status scoped to this page only — the expensive per-contact lookup.
      fetchCompanyCrmStatuses(supabase, user.id, sliceCompanyIds),
      // Aggregate outreach funnel state per account (mirrors the contact action).
      fetchCompanySequenceStatuses(supabase, user.id, orgId, sliceCompanyIds),
      orgId && sliceCompanyIds.length > 0
        ? supabase
            .from('org_company_overrides')
            .select('company_id, overrides')
            .eq('org_id', orgId)
            .in('company_id', sliceCompanyIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const orgOverridesByCompanyId = new Map<string, Record<string, unknown>>();
    if (!orgOverrideResult.error && orgOverrideResult.data) {
      for (const row of orgOverrideResult.data as Array<{ company_id: string; overrides: Record<string, unknown> | null }>) {
        orgOverridesByCompanyId.set(row.company_id, row.overrides ?? {});
      }
    }

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
      const overrides = {
        ...(row.user_overrides ?? {}),
        ...(orgOverridesByCompanyId.get(row.id) ?? {}),
      };

      const crmEntry = companyCrmStatuses.get(row.id) ?? null;

      // CRM suppression cooldown (same rule as the contacts view): a closed-won
      // (1yr) or closed-lost (6mo) account has its readiness floored to 0.01 so
      // priority drops and the action reads Deprioritise — but only WITHIN the
      // cooldown. Past it, the floor lifts and the stored priority/readiness
      // (driven by real signals) resurfaces the account. The stored DB value
      // stays intrinsic; suppression is applied here at read time so it can't
      // go stale when CRM state changes.
      const fitNorm = normalizeScore01(row.company_fit_score);
      const priorityPolicy = resolveEffectivePriority({
        intrinsicPriority: row.priority_score ?? null,
        companyFit: fitNorm,
        intrinsicReadiness: row.readiness_score ?? 0,
        crmState: crmEntry?.state ?? null,
        crmClosedAt: crmEntry?.closedAt ?? null,
      });

      // LEAN LIST projection — only the fields the table view + agent
      // list-mode actually need. Side panel + agent detail-mode use the
      // GET /api/companies/[id] endpoint for the full ~44-field record.
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
        logo_cached: row.logo_cached,
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
        // Customer-facing taxonomy (who they sell into) — populated for CRO/vendor/services
      // companies whose OWN therapeutic_areas/modalities are intentionally empty.
        customer_therapeutic_areas: row.customer_therapeutic_areas,
        customer_modalities: row.customer_modalities,
        customer_development_stages: row.customer_development_stages,
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
        readiness_score: priorityPolicy.effectiveReadiness,
        raw_readiness_score: row.readiness_score ?? null,
        priority_score: priorityPolicy.effectivePriority,
        intrinsic_priority_score: priorityPolicy.intrinsicPriority,
        crm_is_suppressed: priorityPolicy.isSuppressed,
        crm_status: crmEntry?.state ?? null,
        crm_deal_stage_label: crmEntry?.dealStageLabel ?? null,
        crm_closed_at: crmEntry?.closedAt ?? null,
        // Aggregate outreach funnel state → drives the Send outreach / Await
        // reply action overlay in getAccountRowAction (mirrors contacts).
        latest_sequence_status: companySequenceStatuses.get(row.id) ?? null,
        // Dedicated company-enrichment job state → drives the table-row
        // "enriching…" animation + the side panel banner. Now carried on the
        // lean list (the RPC returns it) so the table can show progress, not
        // just the side panel.
        enrichment_refresh_status: row.enrichment_refresh_status ?? null,
        enrichment_refresh_last_error: row.enrichment_refresh_last_error ?? null,
        enrichment_refresh_started_at: row.enrichment_refresh_started_at ?? null,
        enrichment_refresh_finished_at: row.enrichment_refresh_finished_at ?? null,
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
    console.error('Error in companies GET:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
