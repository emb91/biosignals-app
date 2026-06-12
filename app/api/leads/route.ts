import { NextResponse } from 'next/server';
import {
  DEVELOPMENT_STAGE_OPTIONS,
  canonicalizeCompanyType,
  canonicalizeModality,
  canonicalizeTherapeuticArea,
} from '@/lib/arcova-taxonomy';
import { normalizePlatformTaxonomyFields } from '@/lib/platform-category';
import { createClient } from '@/lib/supabase-server';
import {
  fetchContactEmailsForContacts,
  type ContactEmailRow,
} from '@/lib/contact-emails';
import {
  fetchContactPhonesForContacts,
  type ContactPhoneRow,
} from '@/lib/contact-phones';
import {
  formatDataProvenanceTypeOnly,
  resolveContactDataProvenance,
} from '@/lib/data-provenance';
import { HUBSPOT_CLOSED_DEAL_STAGES } from '@/lib/hubspot-deals';
import { effectiveReadiness } from '@/lib/lead-action';

/** Normalise a 0-1 or 0-100 score to a 0-1 fraction (null if unusable). */
function norm01Score(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value > 1 && value <= 100) return value / 100;
  if (value >= 0 && value <= 1) return value;
  return null;
}

/**
 * Recompute each contact's priority_score LIVE from the freshly-attached
 * company_fit + contact_fit + effective readiness, overwriting the stored
 * (mirrored) value which can go stale when company_fit changes without a
 * readiness recompute. Same formula as lib/signals/readiness-store and the
 * client's contactPriorityScore:
 *   priority = company_fit × contact_fit × (0.5 + 0.5 × effectiveReadiness)
 * Mirrors the live-priority fix applied to the accounts RPC (list_user_accounts).
 * Contacts without a contact_fit keep their stored value (no fresh inputs).
 */
function recomputeContactPriorityLive(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const contactFit = norm01Score(row.contact_fit_score);
    if (contactFit == null) return row;
    const companyFit = norm01Score(row.company_fit_score) ?? 1;
    const eff = effectiveReadiness(
      row.company_readiness_score as number | null,
      row.contact_readiness_score as number | null,
    ) ?? 0;
    const live = Math.max(0, Math.min(1, companyFit * contactFit * (0.5 + 0.5 * eff)));
    return { ...row, priority_score: live };
  });
}

function isMissingColumnError(error: unknown): boolean {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : '';

  return message.includes('column') && message.includes('does not exist');
}

type SupabaseClientLike = {
  from: (table: string) => any;
};

type LeadRow = Record<string, unknown>;
type HubSpotLeadState = 'active' | 'customer' | 'dormant' | 'context_only' | 'none';

function attachDataProvenance(rows: LeadRow[]): LeadRow[] {
  return rows.map((row) => {
    const { channels, importedAt } = resolveContactDataProvenance({
      upload_batches: row.upload_batches,
      created_at: typeof row.created_at === 'string' ? row.created_at : null,
      source: typeof row.source === 'string' ? row.source : null,
    });
    const { upload_batches: _omit, ...rest } = row;
    return {
      ...rest,
      data_provenance_type: formatDataProvenanceTypeOnly(channels),
      data_provenance_imported_at: importedAt,
    };
  });
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ');
}

function canonicalizeDevelopmentStage(value: string): string | null {
  const normalized = normalizeText(value);
  return (
    DEVELOPMENT_STAGE_OPTIONS.find((option) => normalizeText(option) === normalized) ?? null
  );
}

function normalizeCompanyRow(row: Record<string, unknown>): Record<string, unknown> {
  return normalizePlatformTaxonomyFields({
    company_name: row.company_name ?? null,
    domain: row.domain ?? null,
    website: row.website ?? row.company_website ?? null,
    linkedin_url: row.linkedin_url ?? null,
    description: row.description ?? null,
    bio_summary: row.bio_summary ?? null,
    tagline: row.tagline ?? null,
    logo_url: row.logo_url ?? null,
    follower_count: row.follower_count ?? null,
    industry: row.industry ?? null,
    employee_count: row.employee_count ?? null,
    employee_range: row.employee_range ?? null,
    founded_year: row.founded_year ?? null,
    headquarters_city: row.headquarters_city ?? null,
    headquarters_state: row.headquarters_state ?? null,
    headquarters_country: row.headquarters_country ?? null,
    specialties: row.specialties ?? null,
    company_type: row.company_type ?? null,
    company_type_display: row.company_type_display ?? null,
    platform_category: row.platform_category ?? null,
    funding_stage: row.funding_stage ?? null,
    funding_status_label: row.funding_status_label ?? null,
    total_funding_usd: row.total_funding_usd ?? null,
    latest_funding_date: row.latest_funding_date ?? null,
    funding_data_source: row.funding_data_source ?? null,
    funding_resolution_confidence: row.funding_resolution_confidence ?? null,
    funding_resolution_summary: row.funding_resolution_summary ?? null,
    therapeutic_areas: row.therapeutic_areas ?? row.therapeutic_area ?? null,
    modalities: row.modalities ?? row.modality ?? null,
    clinical_stage: row.clinical_stage ?? null,
    matched_icp_id: row.matched_icp_id ?? null,
    company_fit_score: row.company_fit_score ?? null,
    last_enriched_at: row.last_enriched_at ?? row.updated_at ?? null,
  });
}

function withTopLevelCompanyFitScore<T extends Record<string, unknown>>(row: T): T {
  const company =
    row.companies && typeof row.companies === 'object'
      ? (row.companies as Record<string, unknown>)
      : null;

  return {
    ...row,
    company_fit_score: row.company_fit_score ?? company?.company_fit_score ?? null,
  };
}

function withTopLevelCompanyFitScores(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => withTopLevelCompanyFitScore(row));
}

async function attachContactEmailsBestEffort(
  supabase: SupabaseClientLike,
  rows: LeadRow[],
): Promise<LeadRow[]> {
  const ids = rows.map((row) => row.id).filter((id): id is string => typeof id === 'string');
  if (ids.length === 0) return rows;

  try {
    const grouped = await fetchContactEmailsForContacts(supabase, ids);
    return rows.map((row) =>
      typeof row.id === 'string'
        ? { ...row, contact_emails: (grouped.get(row.id) ?? []) as ContactEmailRow[] }
        : row,
    );
  } catch (e: unknown) {
    const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '';
    if (msg.includes('contact_emails') || msg.includes('does not exist')) {
      return rows.map((row) => ({ ...row, contact_emails: [] }));
    }
    console.warn('[leads GET] attachContactEmailsBestEffort failed:', e);
    return rows.map((row) => ({ ...row, contact_emails: [] }));
  }
}

async function attachContactPhonesBestEffort(
  supabase: SupabaseClientLike,
  rows: LeadRow[],
): Promise<LeadRow[]> {
  const ids = rows.map((row) => row.id).filter((id): id is string => typeof id === 'string');
  if (ids.length === 0) return rows;
  try {
    const grouped = await fetchContactPhonesForContacts(supabase, ids);
    return rows.map((row) =>
      typeof row.id === 'string'
        ? { ...row, contact_phones: (grouped.get(row.id) ?? []) as ContactPhoneRow[] }
        : row,
    );
  } catch (e: unknown) {
    const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '';
    if (msg.includes('contact_phones') || msg.includes('does not exist')) {
      return rows.map((row) => ({ ...row, contact_phones: [] }));
    }
    console.warn('[leads GET] attachContactPhonesBestEffort failed:', e);
    return rows.map((row) => ({ ...row, contact_phones: [] }));
  }
}

async function attachCompaniesBestEffort(
  supabase: SupabaseClientLike,
  rows: LeadRow[]
): Promise<LeadRow[]> {
  const companyIds = [...new Set(rows.map((row) => row.company_id).filter(Boolean))] as string[];
  if (companyIds.length === 0) {
    return rows.map((row) => ({ ...row, companies: null }));
  }

  const companySelects = [
    'id, company_name, domain, website, linkedin_url, description, bio_summary, tagline, logo_url, follower_count, industry, employee_count, employee_range, founded_year, headquarters_city, headquarters_state, headquarters_country, specialties, company_type, platform_category, funding_stage, funding_status_label, total_funding_usd, latest_funding_date, funding_data_source, funding_resolution_confidence, funding_resolution_summary, therapeutic_areas, modalities, clinical_stage, matched_icp_id, last_enriched_at',
    'id, company_name, domain, website, linkedin_url, description, bio_summary, tagline, logo_url, follower_count, industry, employee_count, employee_range, founded_year, headquarters_city, headquarters_state, headquarters_country, specialties, company_type, platform_category, funding_stage, funding_status_label, total_funding_usd, latest_funding_date, funding_data_source, funding_resolution_confidence, funding_resolution_summary, therapeutic_area, modality, clinical_stage, matched_icp_id, last_enriched_at',
    'id, company_name, domain, website, linkedin_url, description, industry, employee_count, employee_range, founded_year, headquarters_city, headquarters_state, headquarters_country, company_type, platform_category, funding_stage, therapeutic_area, modality, matched_icp_id, updated_at',
    'id, company_name, company_website, linkedin_url, company_type, platform_category, funding_stage, therapeutic_area, modality, matched_icp_id, updated_at',
    'id, company_name, linkedin_url, company_type, platform_category, funding_stage, matched_icp_id, updated_at',
    'id, company_name',
  ];

  let companies: Record<string, Record<string, unknown>> = {};

  for (const selectClause of companySelects) {
    const result = await supabase.from('companies').select(selectClause).in('id', companyIds);

    if (result.error && isMissingColumnError(result.error)) {
      continue;
    }

    if (result.error) {
      console.warn('Best-effort company fetch failed:', result.error);
      break;
    }

    companies = Object.fromEntries(
      ((result.data || []) as Record<string, unknown>[])
        .filter((company) => typeof company.id === 'string')
        .map((company) => [company.id as string, normalizeCompanyRow(company)])
    );
    break;
  }

  return rows.map((row) => ({
    ...row,
    companies:
      typeof row.company_id === 'string' && companies[row.company_id]
        ? companies[row.company_id]
        : null,
  }));
}

async function attachMatchedIcpNames(
  supabase: SupabaseClientLike,
  rows: LeadRow[],
): Promise<LeadRow[]> {
  const icpIds = dedupe(
    rows
      .map((row) => {
        const company =
          row.companies && typeof row.companies === 'object'
            ? (row.companies as Record<string, unknown>)
            : null;
        return company && typeof company.matched_icp_id === 'string'
          ? company.matched_icp_id
          : null;
      })
      .filter((value): value is string => Boolean(value)),
  );

  if (icpIds.length === 0) {
    return rows.map((row) => ({
      ...row,
      matched_icp_name: null,
      matched_icp_index: null,
      matched_icp_label: null,
    }));
  }

  // Names for the ICPs referenced by these rows. Scoped to those ids (RLS still applies),
  // so it returns company-wide + the caller's own personal ICPs without a user filter.
  const { data, error } = await supabase
    .from('icps')
    .select('id, name, created_at')
    .in('id', icpIds)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('Best-effort ICP name fetch failed:', error);
    return rows.map((row) => ({
      ...row,
      matched_icp_name: null,
      matched_icp_index: null,
      matched_icp_label: null,
    }));
  }

  const icpRows = ((data || []) as Array<{ id: string; name: string | null }>)
    .filter((row) => typeof row.id === 'string');
  const namesById = new Map(
    icpRows.map((row) => [row.id, row.name ?? null]),
  );
  const indexById = new Map(
    icpRows.map((row, index) => [row.id, index + 1]),
  );

  return rows.map((row) => {
    const company =
      row.companies && typeof row.companies === 'object'
        ? (row.companies as Record<string, unknown>)
        : null;
    const matchedIcpId = company && typeof company.matched_icp_id === 'string'
      ? company.matched_icp_id
      : null;
    const matchedIcpIndex = matchedIcpId ? indexById.get(matchedIcpId) ?? null : null;
    const matchedIcpName = matchedIcpId ? namesById.get(matchedIcpId) ?? null : null;

    return {
      ...row,
      matched_icp_name: matchedIcpName,
      matched_icp_index: matchedIcpIndex,
      matched_icp_label:
        matchedIcpIndex && matchedIcpName
          ? `ICP ${matchedIcpIndex}: ${matchedIcpName}`
          : matchedIcpName,
    };
  });
}

async function attachEnrichmentMetadataBestEffort(
  supabase: SupabaseClientLike,
  rows: LeadRow[],
): Promise<LeadRow[]> {
  const contactIds = dedupe(
    rows
      .map((row) => (typeof row.id === 'string' ? row.id : null))
      .filter((value): value is string => Boolean(value)),
  );

  if (contactIds.length === 0) return rows;

  const result = await supabase
    .from('contacts')
    .select(
      'id, linkedin_resolution_last_error, profile_enrichment_last_error, linkedin_resolution_started_at, linkedin_resolution_completed_at, profile_enrichment_started_at, profile_enrichment_completed_at, enrichment_refresh_status, enrichment_refresh_last_error, enrichment_refresh_started_at, enrichment_refresh_finished_at',
    )
    .in('id', contactIds);

  if (result.error && isMissingColumnError(result.error)) {
    return rows;
  }

  if (result.error) {
    console.warn('Best-effort lead enrichment metadata fetch failed:', result.error);
    return rows;
  }

  const metadataById = new Map(
    ((result.data || []) as Array<Record<string, unknown>>)
      .filter((row) => typeof row.id === 'string')
      .map((row) => [row.id as string, row]),
  );

  return rows.map((row) => {
    const metadata =
      typeof row.id === 'string' ? metadataById.get(row.id) ?? null : null;

    if (!metadata) return row;

    return {
      ...row,
      linkedin_resolution_last_error: metadata.linkedin_resolution_last_error ?? null,
      profile_enrichment_last_error: metadata.profile_enrichment_last_error ?? null,
      linkedin_resolution_started_at: metadata.linkedin_resolution_started_at ?? null,
      linkedin_resolution_completed_at: metadata.linkedin_resolution_completed_at ?? null,
      profile_enrichment_started_at: metadata.profile_enrichment_started_at ?? null,
      profile_enrichment_completed_at: metadata.profile_enrichment_completed_at ?? null,
      enrichment_refresh_status: metadata.enrichment_refresh_status ?? null,
      enrichment_refresh_last_error: metadata.enrichment_refresh_last_error ?? null,
      enrichment_refresh_started_at: metadata.enrichment_refresh_started_at ?? null,
      enrichment_refresh_finished_at: metadata.enrichment_refresh_finished_at ?? null,
    };
  });
}

async function attachReadinessBestEffort(
  supabase: SupabaseClientLike,
  rows: LeadRow[],
): Promise<LeadRow[]> {
  const contactIds = dedupe(
    rows
      .map((row) => (typeof row.id === 'string' ? row.id : null))
      .filter((v): v is string => Boolean(v)),
  );
  if (contactIds.length === 0) {
    return rows.map((row) => ({ ...row, contact_readiness_label: null, contact_readiness_score: null }));
  }
  try {
    const { data, error } = await supabase
      .from('contact_readiness_snapshots')
      .select('contact_id, overall_label, overall_score')
      .in('contact_id', contactIds);
    if (error || !data) return rows.map((row) => ({ ...row, contact_readiness_label: null, contact_readiness_score: null }));
    const readinessMap = new Map<string, { label: string | null; score: number | null }>(
      (data as Array<{ contact_id: string; overall_label: string | null; overall_score: number | null }>).map((r) => [
        r.contact_id,
        { label: r.overall_label, score: r.overall_score },
      ]),
    );
    return rows.map((row) => {
      const r = typeof row.id === 'string' ? readinessMap.get(row.id) : null;
      return {
        ...row,
        contact_readiness_label: r?.label ?? null,
        contact_readiness_score: r?.score ?? null,
      };
    });
  } catch {
    return rows.map((row) => ({ ...row, contact_readiness_label: null, contact_readiness_score: null }));
  }
}

/**
 * Surface the latest outreach_sequences.dispatch_status per contact so the
 * action gate can overlay outreach state (draft → "Send outreach", sent →
 * "Await reply") on top of the score-driven action. Picks the most recent
 * sequence per contact: if the user iterated and staged a new draft after a
 * previous send, the new draft wins (a fresh ask is pending). 'replied' /
 * 'failed' are still surfaced; the override in lib/lead-action falls them
 * through to the base action so the user can decide whether to engage.
 */
async function attachLatestSequenceStatusBestEffort(
  supabase: SupabaseClientLike,
  rows: LeadRow[],
  userId: string,
): Promise<LeadRow[]> {
  const contactIds = dedupe(
    rows
      .map((row) => (typeof row.id === 'string' ? row.id : null))
      .filter((v): v is string => Boolean(v)),
  );
  if (contactIds.length === 0) {
    return rows.map((row) => ({ ...row, latest_sequence_status: null }));
  }
  try {
    const { data, error } = await supabase
      .from('outreach_sequences')
      .select('contact_id, dispatch_status, exported_to, created_at')
      .eq('user_id', userId)
      .in('contact_id', contactIds)
      .order('created_at', { ascending: false });
    if (error || !data) {
      return rows.map((row) => ({ ...row, latest_sequence_status: null }));
    }
    const latest = new Map<string, string | null>();
    for (const r of data as Array<{
      contact_id: string;
      dispatch_status: string | null;
      exported_to: string | null;
    }>) {
      // Order by created_at desc, so the first hit per contact_id is the most
      // recent one — set-if-absent preserves that.
      if (latest.has(r.contact_id)) continue;
      // Normalise to the four states the action override understands. Legacy
      // 'exported' rows (CSV/clipboard pulls before the export feature was
      // retired) imply manual dispatch — collapse to 'sent'. A null status
      // with no export means staged-but-not-dispatched → 'draft' (matches
      // /outreach's `dispatch_status ?? 'draft'` display).
      let normalized = r.dispatch_status;
      if (normalized === 'exported') normalized = 'sent';
      if (!normalized) normalized = r.exported_to ? 'sent' : 'draft';
      latest.set(r.contact_id, normalized);
    }
    return rows.map((row) => ({
      ...row,
      latest_sequence_status:
        typeof row.id === 'string' ? latest.get(row.id) ?? null : null,
    }));
  } catch {
    return rows.map((row) => ({ ...row, latest_sequence_status: null }));
  }
}

/**
 * Surface the per-user company fit + readiness from user_companies so the
 * action gate has all three axes it needs (company fit, contact fit, effective
 * readiness). These fields moved off the canonical companies table in Phase 1d
 * — without this attach, the lean company select carries no fit and every row
 * gates to Deprioritise regardless of priority. company_fit_score is also
 * written as the top-level row field so resolveCompanyFitForLeadAction picks
 * it up directly. Best-effort: a missing row leaves both null.
 */
async function attachUserCompanyScoresBestEffort(
  supabase: SupabaseClientLike,
  rows: LeadRow[],
  userId: string,
): Promise<LeadRow[]> {
  const companyIds = dedupe(
    rows
      .map((row) => (typeof row.company_id === 'string' ? row.company_id : null))
      .filter((v): v is string => Boolean(v)),
  );
  if (companyIds.length === 0) {
    return rows.map((row) => ({ ...row, company_readiness_score: null }));
  }
  try {
    const { data, error } = await supabase
      .from('user_companies')
      .select('company_id, company_fit_score, readiness_score')
      .eq('user_id', userId)
      .in('company_id', companyIds);
    if (error || !data) return rows.map((row) => ({ ...row, company_readiness_score: null }));
    const scoreMap = new Map<string, { fit: number | null; readiness: number | null }>(
      (data as Array<{
        company_id: string;
        company_fit_score: number | null;
        readiness_score: number | null;
      }>).map((r) => [
        r.company_id,
        {
          fit: typeof r.company_fit_score === 'number' ? r.company_fit_score : null,
          readiness: typeof r.readiness_score === 'number' ? r.readiness_score : null,
        },
      ]),
    );
    return rows.map((row) => {
      const hit = typeof row.company_id === 'string' ? scoreMap.get(row.company_id) : null;
      // Only OVERRIDE company_fit_score when we have a value; preserve any
      // existing top-level value so we don't regress contacts whose fit was
      // populated elsewhere.
      const company_fit_score =
        hit?.fit != null
          ? hit.fit
          : typeof row.company_fit_score === 'number'
          ? row.company_fit_score
          : null;
      return {
        ...row,
        company_fit_score,
        company_readiness_score: hit?.readiness ?? null,
      };
    });
  } catch {
    return rows.map((row) => ({ ...row, company_readiness_score: null }));
  }
}

async function attachHubSpotLeadStateBestEffort(
  supabase: SupabaseClientLike,
  rows: LeadRow[],
): Promise<LeadRow[]> {
  const contactIds = dedupe(
    rows
      .map((row) => (typeof row.id === 'string' ? row.id : null))
      .filter((value): value is string => Boolean(value)),
  );
  const emails = dedupe(
    rows
      .map((row) => (typeof row.email === 'string' ? row.email.trim().toLowerCase() : null))
      .filter((value): value is string => Boolean(value)),
  );

  if (contactIds.length === 0 && emails.length === 0) {
    return rows.map((row) => ({
      ...row,
      hubspot_lead_state: 'none' satisfies HubSpotLeadState,
      hubspot_latest_deal_stage: null,
      hubspot_latest_deal_name: null,
      hubspot_latest_deal_updated_at: null,
    }));
  }

  try {
    const [contactIdLinksResult, emailLinksResult] = await Promise.all([
      contactIds.length
        ? supabase
            .from('crm_deal_contact_links')
            .select('arcova_contact_id, hubspot_deal_id, hubspot_contact_email, raw_payload')
            .in('arcova_contact_id', contactIds)
        : Promise.resolve({ data: [], error: null }),
      emails.length
        ? supabase
            .from('crm_deal_contact_links')
            .select('arcova_contact_id, hubspot_deal_id, hubspot_contact_email, raw_payload')
            .in('hubspot_contact_email', emails)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (contactIdLinksResult.error || emailLinksResult.error) {
      console.warn('Best-effort HubSpot lead-state link fetch failed:', contactIdLinksResult.error || emailLinksResult.error);
      return rows;
    }

    const allLinks = [...((contactIdLinksResult.data || []) as LeadRow[]), ...((emailLinksResult.data || []) as LeadRow[])];
    const dealIds = dedupe(
      allLinks
        .map((row) => (row.hubspot_deal_id != null ? String(row.hubspot_deal_id) : null))
        .filter((value): value is string => Boolean(value)),
    );

    if (dealIds.length === 0) {
      return rows.map((row) => ({
        ...row,
        hubspot_lead_state: 'none' satisfies HubSpotLeadState,
        hubspot_latest_deal_stage: null,
        hubspot_latest_deal_name: null,
        hubspot_latest_deal_updated_at: null,
      }));
    }

    const [dealsResult, companyLinksResult] = await Promise.all([
      supabase
        .from('crm_deals')
        .select('hubspot_deal_id, deal_name, deal_stage, hs_lastmodifieddate, synced_at')
        .in('hubspot_deal_id', dealIds),
      supabase
        .from('crm_deal_company_links')
        .select('hubspot_deal_id, raw_payload')
        .in('hubspot_deal_id', dealIds),
    ]);

    if (dealsResult.error || companyLinksResult.error) {
      console.warn('Best-effort HubSpot lead-state deal fetch failed:', dealsResult.error || companyLinksResult.error);
      return rows;
    }

    const dealsById = new Map(
      (((dealsResult.data || []) as LeadRow[]).map((row) => [String(row.hubspot_deal_id), row])),
    );
    const companyLinksByDealId = new Map(
      (((companyLinksResult.data || []) as LeadRow[]).map((row) => [String(row.hubspot_deal_id), row])),
    );

    const linksByContactId = new Map<string, LeadRow[]>();
    const linksByEmail = new Map<string, LeadRow[]>();

    for (const row of allLinks) {
      const byId = typeof row.arcova_contact_id === 'string' ? row.arcova_contact_id : null;
      const byEmail = typeof row.hubspot_contact_email === 'string' ? row.hubspot_contact_email.trim().toLowerCase() : null;
      if (byId) {
        const current = linksByContactId.get(byId) ?? [];
        current.push(row);
        linksByContactId.set(byId, current);
      }
      if (byEmail) {
        const current = linksByEmail.get(byEmail) ?? [];
        current.push(row);
        linksByEmail.set(byEmail, current);
      }
    }

    return rows.map((row) => {
      const rowId = typeof row.id === 'string' ? row.id : null;
      const rowEmail = typeof row.email === 'string' ? row.email.trim().toLowerCase() : null;
      const candidateLinks = [
        ...(rowId ? linksByContactId.get(rowId) ?? [] : []),
        ...(rowEmail ? linksByEmail.get(rowEmail) ?? [] : []),
      ];
      const dedupedLinks = Array.from(
        new Map(
          candidateLinks
            .map((link) => [String(link.hubspot_deal_id), link] as const)
            .filter((entry): entry is readonly [string, (typeof candidateLinks)[number]] => Boolean(entry[0])),
        ).values(),
      );

      const rankedDeals = dedupedLinks
        .map((link) => {
          const dealId = String(link.hubspot_deal_id);
          const deal = dealsById.get(dealId);
          if (!deal) return null;
          const companyPayload = (companyLinksByDealId.get(dealId)?.raw_payload ?? {}) as Record<string, unknown>;
          const suppressed =
            companyPayload.resolution_suppressed === true || companyPayload.resolution_suppressed === 'true';
          const modifiedAt =
            typeof deal.hs_lastmodifieddate === 'string'
              ? deal.hs_lastmodifieddate
              : typeof deal.synced_at === 'string'
                ? deal.synced_at
                : null;

          return {
            dealStage: typeof deal.deal_stage === 'string' ? deal.deal_stage : null,
            dealName: typeof deal.deal_name === 'string' ? deal.deal_name : null,
            modifiedAt,
            state: hubSpotLeadStateForStage(
              typeof deal.deal_stage === 'string' ? deal.deal_stage : null,
              suppressed,
            ),
          };
        })
        .filter((deal): deal is NonNullable<typeof deal> => Boolean(deal))
        .sort((a, b) => {
          const aTime = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0;
          const bTime = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0;
          return bTime - aTime;
        });

      const latest = rankedDeals[0] ?? null;

      return {
        ...row,
        hubspot_lead_state: latest?.state ?? ('none' satisfies HubSpotLeadState),
        hubspot_latest_deal_stage: latest?.dealStage ?? null,
        hubspot_latest_deal_name: latest?.dealName ?? null,
        hubspot_latest_deal_updated_at: latest?.modifiedAt ?? null,
      };
    });
  } catch (error) {
    console.warn('Best-effort HubSpot lead-state attachment failed:', error);
    return rows;
  }
}

async function attachContactAttributionBestEffort(
  supabase: SupabaseClientLike,
  rows: LeadRow[],
): Promise<LeadRow[]> {
  const contactIds = dedupe(
    rows
      .map((row) => (typeof row.id === 'string' ? row.id : null))
      .filter((value): value is string => Boolean(value)),
  );

  if (contactIds.length === 0) return rows;

  const result = await supabase
    .from('contact_attribution_snapshots')
    .select(
      'contact_id, is_arcova_sourced, is_arcova_enriched, arcova_touchpoint_count, arcova_touchpoints, first_arcova_touch_at, latest_arcova_touch_at, latest_arcova_touch_type, latest_closed_won_deal_id, latest_closed_won_deal_name, latest_closed_won_at, won_after_arcova_touch, computed_at',
    )
    .in('contact_id', contactIds);

  if (result.error && isMissingColumnError(result.error)) {
    return rows.map((row) => ({
      ...row,
      attribution_is_arcova_sourced: null,
      attribution_is_arcova_enriched: null,
      attribution_arcova_touchpoint_count: null,
      attribution_arcova_touchpoints: [],
      attribution_first_arcova_touch_at: null,
      attribution_latest_arcova_touch_at: null,
      attribution_latest_arcova_touch_type: null,
      attribution_latest_closed_won_deal_id: null,
      attribution_latest_closed_won_deal_name: null,
      attribution_latest_closed_won_at: null,
      attribution_won_after_arcova_touch: null,
      attribution_computed_at: null,
    }));
  }

  if (result.error) {
    console.warn('Best-effort contact attribution fetch failed:', result.error);
    return rows.map((row) => ({
      ...row,
      attribution_is_arcova_sourced: null,
      attribution_is_arcova_enriched: null,
      attribution_arcova_touchpoint_count: null,
      attribution_arcova_touchpoints: [],
      attribution_first_arcova_touch_at: null,
      attribution_latest_arcova_touch_at: null,
      attribution_latest_arcova_touch_type: null,
      attribution_latest_closed_won_deal_id: null,
      attribution_latest_closed_won_deal_name: null,
      attribution_latest_closed_won_at: null,
      attribution_won_after_arcova_touch: null,
      attribution_computed_at: null,
    }));
  }

  const attributionByContactId = new Map(
    ((result.data || []) as Array<Record<string, unknown>>)
      .filter((row) => typeof row.contact_id === 'string')
      .map((row) => [row.contact_id as string, row] as const),
  );

  return rows.map((row) => {
    const attribution =
      typeof row.id === 'string' ? attributionByContactId.get(row.id) ?? null : null;

    return {
      ...row,
      attribution_is_arcova_sourced:
        typeof attribution?.is_arcova_sourced === 'boolean' ? attribution.is_arcova_sourced : null,
      attribution_is_arcova_enriched:
        typeof attribution?.is_arcova_enriched === 'boolean' ? attribution.is_arcova_enriched : null,
      attribution_arcova_touchpoint_count:
        typeof attribution?.arcova_touchpoint_count === 'number' ? attribution.arcova_touchpoint_count : null,
      attribution_arcova_touchpoints: Array.isArray(attribution?.arcova_touchpoints)
        ? attribution.arcova_touchpoints
        : [],
      attribution_first_arcova_touch_at:
        typeof attribution?.first_arcova_touch_at === 'string' ? attribution.first_arcova_touch_at : null,
      attribution_latest_arcova_touch_at:
        typeof attribution?.latest_arcova_touch_at === 'string' ? attribution.latest_arcova_touch_at : null,
      attribution_latest_arcova_touch_type:
        typeof attribution?.latest_arcova_touch_type === 'string' ? attribution.latest_arcova_touch_type : null,
      attribution_latest_closed_won_deal_id:
        typeof attribution?.latest_closed_won_deal_id === 'string' ? attribution.latest_closed_won_deal_id : null,
      attribution_latest_closed_won_deal_name:
        typeof attribution?.latest_closed_won_deal_name === 'string' ? attribution.latest_closed_won_deal_name : null,
      attribution_latest_closed_won_at:
        typeof attribution?.latest_closed_won_at === 'string' ? attribution.latest_closed_won_at : null,
      attribution_won_after_arcova_touch:
        typeof attribution?.won_after_arcova_touch === 'boolean' ? attribution.won_after_arcova_touch : null,
      attribution_computed_at:
        typeof attribution?.computed_at === 'string' ? attribution.computed_at : null,
    };
  });
}

function hubSpotLeadStateForStage(stage: string | null, suppressed: boolean): HubSpotLeadState {
  const normalized = (stage || '').trim().toLowerCase();
  if (!normalized) return suppressed ? 'context_only' : 'none';
  if (normalized === 'closedwon') return 'customer';
  if (normalized === 'closedlost') return 'dormant';
  if (suppressed) return 'context_only';
  if (HUBSPOT_CLOSED_DEAL_STAGES.has(normalized)) return 'context_only';
  return 'active';
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
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
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)));
    const search = searchParams.get('search') || '';
    const companyId = searchParams.get('companyId') || '';

    const offset = (page - 1) * pageSize;

    // Find company IDs matching taxonomy search terms (company type, TA, modality)
    let taxonomyCompanyIds: string[] = [];
    if (search) {
      const canonicalCompanyType = canonicalizeCompanyType(search);
      const canonicalTherapeuticArea = canonicalizeTherapeuticArea(search);
      const canonicalModality = canonicalizeModality(search);
      const canonicalDevelopmentStage = canonicalizeDevelopmentStage(search);

      const taxonomyFilters = [
        `company_type.ilike.%${search}%`,
        `company_type_display.ilike.%${search}%`,
        `platform_category.ilike.%${search}%`,
        canonicalCompanyType && canonicalCompanyType !== search
          ? `company_type.ilike.%${canonicalCompanyType}%`
          : null,
        canonicalTherapeuticArea
          ? `therapeutic_areas.cs.{"${canonicalTherapeuticArea}"}`
          : null,
        canonicalModality
          ? `modalities.cs.{"${canonicalModality}"}`
          : null,
        canonicalDevelopmentStage
          ? `development_stages.cs.{"${canonicalDevelopmentStage}"}`
          : null,
      ].filter(Boolean).join(',');

      const { data: taxonomyMatches } = await supabase
        .from('companies')
        .select('id')
        .or(taxonomyFilters);
      taxonomyCompanyIds = (taxonomyMatches || []).map((c) => c.id as string).filter(Boolean);
    }

    const runQuery = (selectClause: string) => {
    let query = supabase
      .from('contacts')
      .select(selectClause, { count: 'exact' })
      .eq('user_id', user.id)
      .is('archived_at', null);

      if (companyId) {
        query = query.eq('company_id', companyId);
      } else if (search) {
        const contactFilter = `full_name.ilike.%${search}%,company_name.ilike.%${search}%,job_title.ilike.%${search}%`;
        const filter =
          taxonomyCompanyIds.length > 0
            ? `${contactFilter},company_id.in.(${taxonomyCompanyIds.join(',')})`
            : contactFilter;
        query = query.or(filter);
      }

      // CRM-suppressed (closed-won/lost within cooldown) contacts sink to the
      // bottom GLOBALLY — this must be the first sort key so pagination doesn't
      // strand a closed deal's high intrinsic priority on page 1 (the read-time
      // display suppression only sees one page). Maintained by
      // denormalizeCrmSuppressionState on every HubSpot sync.
      //
      // Then priority_score (mirrored from contact_readiness_snapshots) orders
      // within each group; overall_fit_score / fit_score are tiebreakers for
      // contacts without a readiness snapshot yet, then created_at.
      return query
        .order('crm_is_suppressed', { ascending: true })
        .order('priority_score', { ascending: false, nullsFirst: false })
        .order('overall_fit_score', { ascending: false, nullsFirst: false })
        .order('fit_score', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);
    };

    const baseLeadSelect =
      'id, full_name, first_name, last_name, job_title, job_title_standardised, seniority_level, business_area, company_name, company_domain, company_linkedin_url, email, email_status, email_status_reasoning, email_deliverability, linkedin_url, profile_photo_url, profile_photo_cached, headline, location, city, country, resolved_current_company_name, resolved_current_company_domain, resolved_current_job_title, resolved_employment_history, contact_bio, contact_discovery_status, linkedin_resolution_status, profile_enrichment_status, fit_score, readiness_score, overall_fit_score, contact_fit_score, contact_panel_summary, contact_fit_summary, priority_score, source, created_at, updated_at, company_id, upload_batches(filename, created_at)';
    // LEAN nested companies select — the contact LIST view only needs minimal
    // company context. The side panel + agent fetch full company detail via
    // GET /api/leads/[id]. Trimming here saves ~30 fields × 50 rows per list
    // load. All 6 variants below are aliased to the same lean shape so the
    // schema-mismatch fallback path is also lean.
    // Note: matched_icp_id and company_fit_score live on user_companies now
    // (Phase 1d moved per-user fields off the canonical companies table).
    // The lead's contact_fit_score / overall_fit_score on the contact row are
    // what the table actually displays anyway.
    const companySelectLean =
      'companies(id, company_name, domain, company_type, funding_stage)';
    const companySelectCore = companySelectLean;
    const companySelectStable = companySelectLean;
    const companySelectWithFundingDebug = companySelectLean;
    const companySelectCoreLegacyTaxonomy = companySelectLean;
    const companySelectStableLegacyTaxonomy = companySelectLean;
    const companySelectMinimalLegacy = companySelectLean;

    const primarySelect =
      `${baseLeadSelect}, ${companySelectWithFundingDebug}`;
    const secondarySelect =
      `${baseLeadSelect}, ${companySelectCore}`;
    const tertiarySelect =
      `${baseLeadSelect}, ${companySelectStable}`;
    const fallbackSelect =
      'id, full_name, first_name, last_name, job_title, job_title_standardised, seniority_level, business_area, company_name, company_domain, company_linkedin_url, email, linkedin_url, profile_photo_url, profile_photo_cached, headline, location, city, country, resolved_current_company_name, resolved_current_company_domain, resolved_current_job_title, resolved_employment_history, contact_bio, contact_discovery_status, linkedin_resolution_status, profile_enrichment_status, fit_score, readiness_score, overall_fit_score, contact_fit_score, contact_panel_summary, contact_fit_summary, source, created_at, updated_at, company_id, upload_batches(filename, created_at)';

    let { data, error, count } = await runQuery(primarySelect);

    if (error && isMissingColumnError(error)) {
      const secondaryResult = await runQuery(secondarySelect);

      if (secondaryResult.error && isMissingColumnError(secondaryResult.error)) {
        const tertiaryResult = await runQuery(tertiarySelect);

        if (tertiaryResult.error && isMissingColumnError(tertiaryResult.error)) {
          const legacyCoreResult = await runQuery(`${baseLeadSelect}, ${companySelectCoreLegacyTaxonomy}`);

          if (legacyCoreResult.error && isMissingColumnError(legacyCoreResult.error)) {
            const legacyStableResult = await runQuery(`${baseLeadSelect}, ${companySelectStableLegacyTaxonomy}`);

            if (legacyStableResult.error && isMissingColumnError(legacyStableResult.error)) {
              const minimalLegacyResult = await runQuery(`${baseLeadSelect}, ${companySelectMinimalLegacy}`);

              if (minimalLegacyResult.error && isMissingColumnError(minimalLegacyResult.error)) {
                const fallbackResult = await runQuery(fallbackSelect);
                const fallbackData = ((fallbackResult.data || []) as unknown) as Array<Record<string, unknown>>;
                data = ((await attachCompaniesBestEffort(supabase, fallbackData.map((row) => ({
                  ...(row && typeof row === 'object' ? row : {}),
                  email_status: null,
                  email_status_reasoning: null,
                  email_deliverability: null,
                }))).then(withTopLevelCompanyFitScores)) as unknown) as typeof data;
                error = fallbackResult.error;
                count = fallbackResult.count;
              } else {
                const minimalLegacyData = ((minimalLegacyResult.data || []) as unknown) as Array<Record<string, unknown>>;
                data = (withTopLevelCompanyFitScores(minimalLegacyData.map((row) => ({
                  ...(row && typeof row === 'object' ? row : {}),
                  companies:
                    row?.companies && typeof row.companies === 'object'
                      ? {
                          ...(row.companies as Record<string, unknown>),
                          domain: null,
                          description: null,
                          bio_summary: null,
                          tagline: null,
                          logo_url: null,
                          follower_count: null,
                          industry: null,
                          employee_count: null,
                          employee_range: null,
                          founded_year: null,
                          headquarters_city: null,
                          headquarters_country: null,
                          specialties: null,
                          funding_status_label: null,
                          total_funding_usd: null,
                          latest_funding_date: null,
                          funding_data_source: null,
                          funding_resolution_confidence: null,
                          funding_resolution_summary: null,
                          clinical_stage: null,
                          last_enriched_at: (row.companies as Record<string, unknown>).updated_at ?? null,
                        }
                      : row?.companies ?? null,
                }))) as unknown) as typeof data;
                error = minimalLegacyResult.error;
                count = minimalLegacyResult.count;
              }
            } else {
              const legacyStableData = ((legacyStableResult.data || []) as unknown) as Array<Record<string, unknown>>;
              data = (withTopLevelCompanyFitScores(legacyStableData.map((row) => ({
                ...(row && typeof row === 'object' ? row : {}),
                companies:
                  row?.companies && typeof row.companies === 'object'
                    ? {
                        ...(row.companies as Record<string, unknown>),
                        funding_status_label: null,
                        funding_resolution_confidence: null,
                        funding_resolution_summary: null,
                    }
                    : row?.companies ?? null,
              }))) as unknown) as typeof data;
              error = legacyStableResult.error;
              count = legacyStableResult.count;
            }
          } else {
            const legacyCoreData = ((legacyCoreResult.data || []) as unknown) as Array<Record<string, unknown>>;
            data = (withTopLevelCompanyFitScores(legacyCoreData.map((row) => ({
              ...(row && typeof row === 'object' ? row : {}),
              companies:
                row?.companies && typeof row.companies === 'object'
                  ? {
                      ...(row.companies as Record<string, unknown>),
                      funding_resolution_confidence: null,
                      funding_resolution_summary: null,
                  }
                  : row?.companies ?? null,
            }))) as unknown) as typeof data;
            error = legacyCoreResult.error;
            count = legacyCoreResult.count;
          }
        } else {
          const tertiaryData = ((tertiaryResult.data || []) as unknown) as Array<Record<string, unknown>>;
          data = (withTopLevelCompanyFitScores(tertiaryData.map((row) => ({
            ...(row && typeof row === 'object' ? row : {}),
            companies:
              row?.companies && typeof row.companies === 'object'
                ? {
                    ...(row.companies as Record<string, unknown>),
                    funding_status_label: null,
                    funding_resolution_confidence: null,
                    funding_resolution_summary: null,
                }
                : row?.companies ?? null,
          }))) as unknown) as typeof data;
          error = tertiaryResult.error;
          count = tertiaryResult.count;
        }
      } else {
        const secondaryData = ((secondaryResult.data || []) as unknown) as Array<Record<string, unknown>>;
        data = (withTopLevelCompanyFitScores(secondaryData.map((row) => ({
          ...(row && typeof row === 'object' ? row : {}),
          companies:
            row?.companies && typeof row.companies === 'object'
              ? {
                  ...(row.companies as Record<string, unknown>),
                  funding_resolution_confidence: null,
                  funding_resolution_summary: null,
              }
              : row?.companies ?? null,
        }))) as unknown) as typeof data;
        error = secondaryResult.error;
        count = secondaryResult.count;
      }
    }

    if (data) {
      data = (withTopLevelCompanyFitScores(((data || []) as unknown) as Array<Record<string, unknown>>) as unknown) as typeof data;
    }

    if (error) {
      console.error('Error fetching leads:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Parallelize all "best-effort attach" passes. Each helper takes the same
    // base rows array and returns rows.map(row => ({ ...row, ...itsFields })),
    // so the index order is preserved and we can merge by index. The previous
    // implementation chained these sequentially — 7 round-trips serialized,
    // which was the dominant /api/leads latency cost. Now they run as a
    // single Promise.all, so total wait ≈ slowest single query.
    //
    // CRM-readiness masking moved to applyCrmReadinessMask (runs after merge)
    // so attachReadinessBestEffort no longer needs the hubspot result.
    const baseRows = ((data || []) as unknown) as LeadRow[];
    const [
      enrichmentRows,
      icpRows,
      emailRows,
      phoneRows,
      hubspotRows,
      readinessRows,
      companyReadinessRows,
      attributionRows,
      sequenceStatusRows,
    ] = await Promise.all([
      attachEnrichmentMetadataBestEffort(supabase, baseRows),
      attachMatchedIcpNames(supabase, baseRows),
      attachContactEmailsBestEffort(supabase, baseRows),
      attachContactPhonesBestEffort(supabase, baseRows),
      attachHubSpotLeadStateBestEffort(supabase, baseRows),
      attachReadinessBestEffort(supabase, baseRows),
      attachUserCompanyScoresBestEffort(supabase, baseRows, user.id),
      attachContactAttributionBestEffort(supabase, baseRows),
      attachLatestSequenceStatusBestEffort(supabase, baseRows, user.id),
    ]);

    const merged: LeadRow[] = baseRows.map((_, idx) => ({
      ...enrichmentRows[idx],
      ...icpRows[idx],
      ...emailRows[idx],
      ...phoneRows[idx],
      ...hubspotRows[idx],
      ...readinessRows[idx],
      ...attributionRows[idx],
      ...sequenceStatusRows[idx],
      // Must come LAST: each attach* helper spreads the original baseRow, which
      // carries company_fit_score = null (it lives on user_companies, not on the
      // contacts row). If we spread anything after this helper, that null base
      // value clobbers the per-user fit we just attached and the action gate
      // re-collapses to Deprioritise.
      ...companyReadinessRows[idx],
    }));

    // Synchronous post-processing: provenance label + LIVE priority recompute.
    // priority_score is recomputed from the freshly-attached company_fit +
    // contact_fit + readiness so it can't drift from the displayed fit/action
    // (the stored mirror goes stale when company_fit changes without a readiness
    // recompute — same bug that showed Moderna as "Reach out" but priority 0 on
    // the accounts side). CRM-resolved (customer/dormant) suppression is applied
    // at display time + reflected in the action tree / CRM badge, not here.
    const finalRows = recomputeContactPriorityLive(attachDataProvenance(merged));

    return NextResponse.json({
      data: finalRows,
      total: count ?? 0,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('Error in leads GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
