/**
 * Sync recent NIH RePORTER grant awards into the nih_grants_local mirror.
 *
 * Two paginated queries per delta, union'd by appl_id:
 *   1. SBIR/STTR activity codes (R41, R42, R43, R44, U43, U44)
 *   2. Domestic For-Profits org_type (any NIH award to a for-profit recipient)
 *
 * NIH RePORTER guidance: ~1 req/sec; we throttle to be polite. No auth or
 * special headers required. Max limit=500 per page, max offset=9999.
 *
 * Endpoint: POST https://api.reporter.nih.gov/v2/projects/search
 * Verified live before implementation; see reference_nih_reporter_api.md.
 */
import type { createAdminClient } from '@/lib/supabase-admin';
import { normalizeCompanyForMatching } from '@/lib/signals/company-name-variants';
import { resolveCompanyMentions } from '@/lib/companies/resolve-mentions';

const NIH_REPORTER_ENDPOINT = 'https://api.reporter.nih.gov/v2/projects/search';

const SBIR_STTR_ACTIVITY_CODES = ['R41', 'R42', 'R43', 'R44', 'U43', 'U44'];
const FOR_PROFIT_ORG_TYPE = 'Domestic For-Profits';

const DEFAULT_OVERLAP_DAYS = 14;
const PAGE_LIMIT = 500;
const MAX_OFFSET = 9000; // NIH cap is 9999; leave headroom
const THROTTLE_MS = 1100; // ~0.9 req/sec, under NIH's 1/sec guidance
const UPSERT_CHUNK = 250;

type AdminClient = ReturnType<typeof createAdminClient>;

type ReporterPi = {
  profile_id?: number | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  is_contact_pi?: boolean | null;
  title?: string | null;
};

type ReporterOrganization = {
  org_name?: string | null;
  org_city?: string | null;
  org_state?: string | null;
  org_country?: string | null;
  primary_uei?: string | null;
};

type ReporterOrgType = {
  name?: string | null; // e.g. "Domestic For-Profits"
  code?: string | null; // e.g. "FP"
};

type ReporterAgencyIc = {
  code?: string | null;
  abbreviation?: string | null;
  name?: string | null;
};

type ReporterAward = {
  appl_id?: number | null;
  project_num?: string | null;
  core_project_num?: string | null;
  activity_code?: string | null;
  award_type?: string | null;
  award_amount?: number | null;
  award_notice_date?: string | null; // ISO with time
  project_start_date?: string | null;
  project_end_date?: string | null;
  fiscal_year?: number | null;
  organization?: ReporterOrganization | null;
  organization_type?: ReporterOrgType | null;
  agency_ic_admin?: ReporterAgencyIc | null;
  project_title?: string | null;
  contact_pi_name?: string | null;
  principal_investigators?: ReporterPi[] | null;
  is_active?: boolean | null;
  opportunity_number?: string | null;
  mechanism_code_dc?: string | null;
  spending_categories?: unknown;
};

type ReporterSearchResponse = {
  meta?: {
    total?: number;
    offset?: number;
    limit?: number;
    search_id?: string | null;
  };
  results?: ReporterAward[];
};

type SearchCriteria = {
  award_notice_date: { from_date: string; to_date: string };
  activity_codes?: string[];
  organization_type?: string[];
};

export type SyncNihGrantsDeltaInput = {
  admin: AdminClient;
  overlapDays?: number;
};

export type SyncNihGrantsDeltaResult = {
  cutoff_date: string;
  awards_upserted: number;
  sbir_pages_fetched: number;
  for_profit_pages_fetched: number;
  duration_ms: number;
};

let lastFetchAt = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastFetchAt;
  if (elapsed < THROTTLE_MS) {
    await new Promise((resolve) => setTimeout(resolve, THROTTLE_MS - elapsed));
  }
  lastFetchAt = Date.now();
}

function isoFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  // RePORTER returns "2026-05-12T00:00:00" — strip time component.
  const head = value.length >= 10 ? value.slice(0, 10) : value;
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : null;
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function postSearch(
  criteria: SearchCriteria,
  offset: number,
  limit: number,
): Promise<ReporterSearchResponse> {
  await throttle();
  const body = JSON.stringify({ criteria, limit, offset });
  const response = await fetch(NIH_REPORTER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // No auth required; identify ourselves as good citizens.
      'User-Agent': 'Arcova GTM grants-monitor (contact: emma@arcova.bio)',
    },
    body,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`NIH RePORTER ${response.status}: ${text.slice(0, 500)}`);
  }
  return (await response.json()) as ReporterSearchResponse;
}

/**
 * Walk pages for a single criteria until either no more results or we hit
 * the NIH offset ceiling. Accumulates into the map (keyed by appl_id) so
 * subsequent calls (with different criteria) just upsert into the same map
 * — that's how we union the SBIR + for-profit criteria.
 */
async function fetchAllPagesInto(
  map: Map<number, ReporterAward>,
  criteria: SearchCriteria,
): Promise<number> {
  let offset = 0;
  let pages = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (offset > MAX_OFFSET) {
      console.warn(`[nih-grants-sync] offset ${offset} exceeds NIH ceiling; truncating`);
      break;
    }
    const response = await postSearch(criteria, offset, PAGE_LIMIT);
    pages += 1;
    const results = response.results ?? [];
    for (const award of results) {
      if (typeof award.appl_id === 'number' && Number.isFinite(award.appl_id)) {
        // Last-write-wins on collision between SBIR + for-profit criteria.
        // The two queries return the same shape for the same appl_id so it
        // doesn't matter which copy we keep.
        map.set(award.appl_id, award);
      }
    }
    const total = response.meta?.total ?? 0;
    if (results.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
    if (offset >= total) break;
  }
  return pages;
}

type GrantUpsertRow = {
  appl_id: number;
  project_num: string | null;
  core_project_num: string | null;
  activity_code: string | null;
  award_type: string | null;
  award_amount: number | null;
  award_notice_date: string | null;
  project_start_date: string | null;
  project_end_date: string | null;
  fiscal_year: number | null;
  org_name: string | null;
  org_name_normalized: string | null;
  org_type_code: string | null;
  org_type_name: string | null;
  org_city: string | null;
  org_state: string | null;
  org_country: string | null;
  org_uei: string | null;
  agency_ic_code: string | null;
  agency_ic_abbr: string | null;
  agency_ic_name: string | null;
  project_title: string | null;
  contact_pi_name: string | null;
  principal_investigators: ReporterPi[] | null;
  is_active: boolean | null;
  opportunity_number: string | null;
  mechanism_code_dc: string | null;
  extras: Record<string, unknown> | null;
  last_seen_at: string;
  mentioned_company_ids?: string[];
};

function awardToRow(award: ReporterAward, startedAtIso: string): GrantUpsertRow | null {
  if (typeof award.appl_id !== 'number') return null;
  const org = award.organization ?? {};
  const orgType = award.organization_type ?? {};
  const agency = award.agency_ic_admin ?? {};
  const orgName = org.org_name ?? null;
  return {
    appl_id: award.appl_id,
    project_num: award.project_num ?? null,
    core_project_num: award.core_project_num ?? null,
    activity_code: award.activity_code ?? null,
    award_type: award.award_type ?? null,
    award_amount: typeof award.award_amount === 'number' ? award.award_amount : null,
    award_notice_date: parseIsoDate(award.award_notice_date),
    project_start_date: parseIsoDate(award.project_start_date),
    project_end_date: parseIsoDate(award.project_end_date),
    fiscal_year: typeof award.fiscal_year === 'number' ? award.fiscal_year : null,
    org_name: orgName,
    org_name_normalized: orgName ? normalizeCompanyForMatching(orgName) : null,
    org_type_code: orgType.code ?? null,
    org_type_name: orgType.name ?? null,
    org_city: org.org_city ?? null,
    org_state: org.org_state ?? null,
    org_country: org.org_country ?? null,
    org_uei: org.primary_uei ?? null,
    agency_ic_code: agency.code ?? null,
    agency_ic_abbr: agency.abbreviation ?? null,
    agency_ic_name: agency.name ?? null,
    project_title: award.project_title ?? null,
    contact_pi_name: award.contact_pi_name ?? null,
    principal_investigators: Array.isArray(award.principal_investigators)
      ? award.principal_investigators
      : null,
    is_active: typeof award.is_active === 'boolean' ? award.is_active : null,
    opportunity_number: award.opportunity_number ?? null,
    mechanism_code_dc: award.mechanism_code_dc ?? null,
    extras: award.spending_categories
      ? { spending_categories: award.spending_categories }
      : null,
    last_seen_at: startedAtIso,
  };
}

export async function syncNihGrantsDelta(input: SyncNihGrantsDeltaInput): Promise<SyncNihGrantsDeltaResult> {
  const admin = input.admin;
  const overlapDays = input.overlapDays ?? DEFAULT_OVERLAP_DAYS;
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const endDate = new Date(Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), startedAt.getUTCDate()));
  const startDate = new Date(endDate.getTime() - overlapDays * 24 * 60 * 60 * 1000);
  const fromDate = isoFromDate(startDate);
  const toDate = isoFromDate(endDate);

  const { data: runRow, error: runInsertErr } = await admin
    .from('nih_grant_delta_sync_runs')
    .insert({ status: 'running', cutoff_date: fromDate, started_at: startedAtIso })
    .select('id')
    .single();
  if (runInsertErr) throw new Error(`nih_grant_delta_sync_runs insert: ${runInsertErr.message}`);
  const runId = runRow?.id as string;

  try {
    // NIH criteria are AND'd within a single request. To get the UNION of
    // "SBIR/STTR activity codes" OR "Domestic For-Profits org_type" we run
    // two separate paginated queries and dedupe by appl_id client-side.
    const byApplId = new Map<number, ReporterAward>();

    const sbirCriteria: SearchCriteria = {
      award_notice_date: { from_date: fromDate, to_date: toDate },
      activity_codes: SBIR_STTR_ACTIVITY_CODES,
    };
    const sbirPages = await fetchAllPagesInto(byApplId, sbirCriteria);

    const forProfitCriteria: SearchCriteria = {
      award_notice_date: { from_date: fromDate, to_date: toDate },
      organization_type: [FOR_PROFIT_ORG_TYPE],
    };
    const forProfitPages = await fetchAllPagesInto(byApplId, forProfitCriteria);

    // Batch upsert.
    const rows: GrantUpsertRow[] = [];
    for (const award of byApplId.values()) {
      const row = awardToRow(award, startedAtIso);
      if (row) rows.push(row);
    }

    // Resolve org_name → canonical company ids in one batched call so signal
    // monitors can query mentioned_company_ids instead of fuzzy ILIKE.
    const uniqueOrgs = [...new Set(rows.map((r) => r.org_name).filter((n): n is string => Boolean(n)))];
    if (uniqueOrgs.length > 0) {
      try {
        const resolved = await resolveCompanyMentions(admin, uniqueOrgs);
        for (const row of rows) {
          const id = row.org_name ? resolved.get(row.org_name)?.canonicalId : null;
          row.mentioned_company_ids = id ? [id] : [];
        }
      } catch (e) {
        console.error('[sync-nih-grants] resolver failed:', e);
        for (const row of rows) row.mentioned_company_ids = [];
      }
    }

    let upserted = 0;
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK);
      const { error } = await admin
        .from('nih_grants_local')
        .upsert(chunk, { onConflict: 'appl_id' });
      if (error) throw new Error(`nih_grants_local upsert: ${error.message}`);
      upserted += chunk.length;
    }

    const finishedAt = new Date();
    await admin
      .from('nih_grant_delta_sync_runs')
      .update({
        finished_at: finishedAt.toISOString(),
        status: 'success',
        awards_upserted: upserted,
        sbir_pages_fetched: sbirPages,
        for_profit_pages_fetched: forProfitPages,
      })
      .eq('id', runId);

    return {
      cutoff_date: fromDate,
      awards_upserted: upserted,
      sbir_pages_fetched: sbirPages,
      for_profit_pages_fetched: forProfitPages,
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    };
  } catch (error) {
    await admin
      .from('nih_grant_delta_sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: 'failed',
        error: messageFromUnknown(error),
      })
      .eq('id', runId);
    throw error;
  }
}
