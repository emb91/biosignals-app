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
  formatDataProvenanceTypeOnly,
  resolveContactDataProvenance,
} from '@/lib/data-provenance';
import { HUBSPOT_CLOSED_DEAL_STAGES } from '@/lib/hubspot-deals';

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
type LeadsLifecycleView = 'leads' | 'customers' | 'all';

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

  const { data, error } = await supabase
    .from('icps')
    .select('id, name, created_at')
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

function hubSpotLeadStateForStage(stage: string | null, suppressed: boolean): HubSpotLeadState {
  const normalized = (stage || '').trim().toLowerCase();
  if (!normalized) return suppressed ? 'context_only' : 'none';
  if (normalized === 'closedwon') return 'customer';
  if (normalized === 'closedlost') return 'dormant';
  if (suppressed) return 'context_only';
  if (HUBSPOT_CLOSED_DEAL_STAGES.has(normalized)) return 'context_only';
  return 'active';
}

async function listHubSpotCustomerContactIds(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<string[]> {
  const linksResult = await supabase
    .from('crm_deal_contact_links')
    .select('arcova_contact_id, hubspot_deal_id')
    .eq('user_id', userId)
    .not('arcova_contact_id', 'is', null);

  if (linksResult.error) {
    console.warn('Best-effort customer lifecycle contact-link fetch failed:', linksResult.error);
    return [];
  }

  const links = ((linksResult.data || []) as LeadRow[]).filter(
    (row) => typeof row.arcova_contact_id === 'string' && row.hubspot_deal_id != null,
  );
  if (!links.length) return [];

  const dealIds = dedupe(
    links
      .map((row) => (row.hubspot_deal_id != null ? String(row.hubspot_deal_id) : null))
      .filter((value): value is string => Boolean(value)),
  );
  if (!dealIds.length) return [];

  const [dealsResult, companyLinksResult] = await Promise.all([
    supabase
      .from('crm_deals')
      .select('hubspot_deal_id, deal_stage, hs_lastmodifieddate, synced_at')
      .eq('user_id', userId)
      .in('hubspot_deal_id', dealIds),
    supabase
      .from('crm_deal_company_links')
      .select('hubspot_deal_id, raw_payload')
      .eq('user_id', userId)
      .in('hubspot_deal_id', dealIds),
  ]);

  if (dealsResult.error || companyLinksResult.error) {
    console.warn('Best-effort customer lifecycle deal fetch failed:', dealsResult.error || companyLinksResult.error);
    return [];
  }

  const dealsById = new Map(
    (((dealsResult.data || []) as LeadRow[]).map((row) => [String(row.hubspot_deal_id), row])),
  );
  const companyLinksByDealId = new Map(
    (((companyLinksResult.data || []) as LeadRow[]).map((row) => [String(row.hubspot_deal_id), row])),
  );

  const latestByContactId = new Map<string, { state: HubSpotLeadState; modifiedAt: string | null }>();

  for (const link of links) {
    const contactId = String(link.arcova_contact_id);
    const dealId = String(link.hubspot_deal_id);
    const deal = dealsById.get(dealId);
    if (!deal) continue;

    const companyPayload = (companyLinksByDealId.get(dealId)?.raw_payload ?? {}) as Record<string, unknown>;
    const suppressed =
      companyPayload.resolution_suppressed === true || companyPayload.resolution_suppressed === 'true';
    const modifiedAt =
      typeof deal.hs_lastmodifieddate === 'string'
        ? deal.hs_lastmodifieddate
        : typeof deal.synced_at === 'string'
          ? deal.synced_at
          : null;

    const candidate = {
      state: hubSpotLeadStateForStage(
        typeof deal.deal_stage === 'string' ? deal.deal_stage : null,
        suppressed,
      ),
      modifiedAt,
    };

    const current = latestByContactId.get(contactId);
    const currentTime = current?.modifiedAt ? new Date(current.modifiedAt).getTime() : 0;
    const candidateTime = candidate.modifiedAt ? new Date(candidate.modifiedAt).getTime() : 0;
    if (!current || candidateTime >= currentTime) {
      latestByContactId.set(contactId, candidate);
    }
  }

  return Array.from(latestByContactId.entries())
    .filter(([, value]) => value.state === 'customer')
    .map(([contactId]) => contactId);
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
    const lifecycle = (searchParams.get('lifecycle') || 'leads') as LeadsLifecycleView;

    const offset = (page - 1) * pageSize;
    const customerContactIds =
      lifecycle === 'all' ? [] : await listHubSpotCustomerContactIds(supabase, user.id);

    if (lifecycle === 'customers' && customerContactIds.length === 0) {
      return NextResponse.json({ data: [], total: 0, page, pageSize });
    }

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
        .eq('user_id', user.id);

      if (lifecycle === 'customers') {
        query = query.in('id', customerContactIds);
      } else if (lifecycle === 'leads' && customerContactIds.length > 0) {
        query = query.not('id', 'in', `(${customerContactIds.join(',')})`);
      }

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

      return query
        .order('overall_fit_score', { ascending: false, nullsFirst: false })
        .order('fit_score', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);
    };

    const baseLeadSelect =
      'id, full_name, first_name, last_name, job_title, job_title_standardised, seniority_level, business_area, company_name, company_domain, company_linkedin_url, email, email_status, email_status_reasoning, linkedin_url, profile_photo_url, headline, location, city, country, resolved_current_company_name, resolved_current_company_domain, resolved_current_job_title, resolved_employment_history, contact_bio, contact_discovery_status, linkedin_resolution_status, profile_enrichment_status, fit_score, intent_score, overall_fit_score, contact_fit_score, source, created_at, updated_at, company_id, upload_batches(filename, created_at)';
    const companySelectCore =
      'companies(company_name, domain, website, linkedin_url, description, bio_summary, tagline, logo_url, follower_count, industry, employee_count, employee_range, founded_year, headquarters_city, headquarters_state, headquarters_country, specialties, products_services, services, technologies, company_type, company_type_display, platform_category, funding_stage, funding_status_label, total_funding_usd, latest_funding_date, funding_data_source, therapeutic_areas, modalities, development_stages, clinical_stage, matched_icp_id, company_fit_score, last_enriched_at)';
    const companySelectStable =
      'companies(company_name, domain, website, linkedin_url, description, bio_summary, tagline, logo_url, follower_count, industry, employee_count, employee_range, founded_year, headquarters_city, headquarters_country, specialties, products_services, services, technologies, company_type, company_type_display, platform_category, funding_stage, total_funding_usd, latest_funding_date, funding_data_source, therapeutic_areas, modalities, development_stages, clinical_stage, matched_icp_id, company_fit_score, last_enriched_at)';
    const companySelectWithFundingDebug =
      'companies(company_name, domain, website, linkedin_url, description, bio_summary, tagline, logo_url, follower_count, industry, employee_count, employee_range, founded_year, headquarters_city, headquarters_country, specialties, products_services, services, technologies, company_type, company_type_display, platform_category, funding_stage, funding_status_label, total_funding_usd, latest_funding_date, funding_data_source, funding_resolution_confidence, funding_resolution_summary, clinical_stage, therapeutic_areas, modalities, development_stages, matched_icp_id, company_fit_score, last_enriched_at)';
    const companySelectCoreLegacyTaxonomy =
      'companies(company_name, domain, website, linkedin_url, description, bio_summary, tagline, logo_url, follower_count, industry, employee_count, employee_range, founded_year, headquarters_city, headquarters_state, headquarters_country, specialties, company_type, funding_stage, funding_status_label, total_funding_usd, latest_funding_date, funding_data_source, therapeutic_areas:therapeutic_area, modalities:modality, clinical_stage, matched_icp_id, company_fit_score, last_enriched_at)';
    const companySelectStableLegacyTaxonomy =
      'companies(company_name, domain, website, linkedin_url, description, bio_summary, tagline, logo_url, follower_count, industry, employee_count, employee_range, founded_year, headquarters_city, headquarters_state, headquarters_country, specialties, company_type, funding_stage, total_funding_usd, latest_funding_date, funding_data_source, therapeutic_areas:therapeutic_area, modalities:modality, clinical_stage, matched_icp_id, company_fit_score, last_enriched_at)';
    const companySelectMinimalLegacy =
      'companies(company_name, website:company_website, linkedin_url, company_type, funding_stage, therapeutic_areas:therapeutic_area, modalities:modality, matched_icp_id, company_fit_score, updated_at)';

    const primarySelect =
      `${baseLeadSelect}, ${companySelectWithFundingDebug}`;
    const secondarySelect =
      `${baseLeadSelect}, ${companySelectCore}`;
    const tertiarySelect =
      `${baseLeadSelect}, ${companySelectStable}`;
    const fallbackSelect =
      'id, full_name, first_name, last_name, job_title, job_title_standardised, seniority_level, business_area, company_name, company_domain, company_linkedin_url, email, linkedin_url, profile_photo_url, headline, location, city, country, resolved_current_company_name, resolved_current_company_domain, resolved_current_job_title, resolved_employment_history, contact_bio, contact_discovery_status, linkedin_resolution_status, profile_enrichment_status, fit_score, intent_score, overall_fit_score, contact_fit_score, source, created_at, updated_at, company_id, upload_batches(filename, created_at)';

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

    const rowsWithEnrichmentMetadata = await attachEnrichmentMetadataBestEffort(
      supabase,
      ((data || []) as unknown) as LeadRow[],
    );

    const enrichedRows = attachDataProvenance(
      (await attachMatchedIcpNames(supabase, rowsWithEnrichmentMetadata)) as LeadRow[],
    );

    const withEmails = await attachContactEmailsBestEffort(supabase, enrichedRows);
    const withHubSpotLeadState = await attachHubSpotLeadStateBestEffort(supabase, withEmails);

    return NextResponse.json({
      data: withHubSpotLeadState,
      total: count ?? 0,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('Error in leads GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
