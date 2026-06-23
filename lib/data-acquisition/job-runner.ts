import { createAdminClient } from '@/lib/supabase-admin';
import { orgIdForUser, scopeIcpsToUser } from '@/lib/org-context';
import { processQueuedRowsInBackground, type QueuedRow } from '@/lib/import-queue';
import type { ImportProgressCallback } from '@/lib/import-ingestion';
import {
  DEFAULT_CONTACTS_PER_COMPANY,
  DEFAULT_MONTHLY_CREDIT_LIMIT,
  creditUnitsForEvent,
  recordDataAcquisitionUsageEvent,
  type DataAcquisitionUsageEventType,
} from '@/lib/data-acquisition-metering';
import { refundCredits, settleCredits, settleUsage } from '@/lib/billing/credits';
import {
  discoverApolloCompanies,
  discoverApolloPeopleForCompanies,
  type DiscoveredCompany,
  type DiscoveredPerson,
  type PeopleSearchTarget,
} from '@/lib/data-acquisition/apollo-discovery';
import {
  apolloOrganizationMatchesIcpKeywords,
  buildApolloCompanySearchRecipes,
  buildApolloPeopleSearchRecipe,
  icpKeywordCorpus,
  type AcquisitionIcp,
  type AcquisitionPersona,
} from '@/lib/data-acquisition/search-spec';
import { discoverCompaniesWithWebSearch } from '@/lib/data-acquisition/web-discovery';

type DataAcquisitionJob = {
  id: string;
  user_id: string;
  org_id: string | null;
  icp_id: string;
  upload_batch_id: string | null;
  request_type: 'expand_companies' | 'better_contacts' | 'more_contacts_at_accounts' | 'contacts_at_company';
  target_company_count: number;
  target_contact_count: number | null;
  max_screened_companies: number | null;
  max_contact_enrichments: number | null;
  max_credit_units: number | string | null;
  actual_credit_units: number | string | null;
  status: string;
  metadata: Record<string, unknown> | null;
};

type ExistingCompany = {
  company_name: string | null;
  domain?: string | null;
  website?: string | null;
  linkedin_url: string | null;
};

type ExistingContact = {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  linkedin_url: string | null;
  company_name: string | null;
  company_domain: string | null;
  apollo_person_raw?: unknown;
};

/** Apollo person id from a stored contact's revealed record, if present. */
function apolloPersonIdOf(raw: unknown): string | null {
  const id = (raw as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

type OwnedContactRef = {
  id: string;
  email: string | null;
  linkedin_url: string | null;
  company_id: string | null;
  company_domain: string | null;
};

type CompanyContext = {
  id: string;
  company_name: string | null;
  domain: string | null;
  website: string | null;
  linkedin_url: string | null;
  matched_icp_id: string | null;
};

type DbCompanyRow = {
  id: string;
  company_name: string | null;
  domain: string | null;
  website: string | null;
  linkedin_url: string | null;
  // The `companies` table does not store an Apollo org record — people search
  // falls back to the company domain (q_organization_domains_list), so this is
  // always absent here. Kept optional for the DiscoveredCompany mapping shape.
  apollo_organization_raw?: unknown;
  employee_count: number | null;
};

// Jobs in these states own the user's single execution slot. The FIFO queue
// only starts the next 'queued' job when nothing is in one of these states.
const ACTIVE_JOB_STATUSES = ['discovering', 'processing', 'importing', 'enriching'] as const;

/** Chunk imports so the /data pipeline rail can show stepped progress like the demo. */
const IMPORT_PROGRESS_CHUNKS = 4;

/** Max owned-contact exclusion entries passed to a single Apollo people search. */
const MAX_EXCLUSIONS_PER_CALL = 100;

function apolloOrgIdFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = (raw as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

function discoveredCompanyFromDbRow(row: DbCompanyRow): DiscoveredCompany | null {
  const domain =
    (row.domain || row.website || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '') || null;
  const name = row.company_name?.trim() || domain;
  if (!name || !domain) return null;
  const sourceId = apolloOrgIdFromRaw(row.apollo_organization_raw);
  return {
    source: 'apollo',
    source_id: sourceId,
    name,
    domain,
    linkedin_url: row.linkedin_url || null,
    employee_count: typeof row.employee_count === 'number' ? row.employee_count : null,
    raw: {
      name,
      primary_domain: domain,
      website_url: row.website || row.domain || null,
      linkedin_url: row.linkedin_url || null,
      id: sourceId || undefined,
    },
  };
}

async function loadPrioritizedCompaniesForIcpAccounts(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  icpId: string,
  requestType: 'better_contacts' | 'more_contacts_at_accounts',
  limit: number,
): Promise<DbCompanyRow[]> {
  const { data: ownedRows, error: ownedError } = await admin
    .from('user_companies')
    .select('company_id')
    .eq('user_id', userId)
    .eq('matched_icp_id', icpId);
  if (ownedError) throw new Error(ownedError.message);
  const ownedIds = (ownedRows ?? [])
    .map((r) => (r as { company_id?: unknown }).company_id)
    .filter((v): v is string => typeof v === 'string');
  if (ownedIds.length === 0) return [];

  const { data: companies, error } = await admin
    .from('companies')
    .select('id, company_name, domain, website, linkedin_url, employee_count')
    .in('id', ownedIds);

  if (error) throw new Error(error.message);
  const rows = (companies || []) as DbCompanyRow[];
  if (rows.length === 0) return [];

  const { data: contacts, error: cErr } = await admin
    .from('contacts')
    .select('company_id, contact_fit_score')
    .eq('user_id', userId)
    .not('company_id', 'is', null);

  if (cErr) throw new Error(cErr.message);

  const byCompany = new Map<string, { count: number; fitSum: number; fitN: number }>();
  for (const row of contacts || []) {
    const cid = row.company_id as string | null;
    if (!cid) continue;
    if (!byCompany.has(cid)) byCompany.set(cid, { count: 0, fitSum: 0, fitN: 0 });
    const agg = byCompany.get(cid)!;
    agg.count += 1;
    const rawFit = row.contact_fit_score;
    if (typeof rawFit === 'number' && Number.isFinite(rawFit)) {
      let f = rawFit;
      if (f > 1 && f <= 100) f /= 100;
      if (f >= 0 && f <= 1) {
        agg.fitSum += f;
        agg.fitN += 1;
      }
    }
  }

  const scored = rows.map((row) => {
    const agg = byCompany.get(row.id) || { count: 0, fitSum: 0, fitN: 0 };
    const avgFit = agg.fitN > 0 ? agg.fitSum / agg.fitN : null;
    return { row, contactCount: agg.count, avgFit };
  });

  if (requestType === 'more_contacts_at_accounts') {
    scored.sort((a, b) => a.contactCount - b.contactCount || a.row.id.localeCompare(b.row.id));
  } else {
    scored.sort((a, b) => {
      const af = a.avgFit ?? -1;
      const bf = b.avgFit ?? -1;
      if (af !== bf) return af - bf;
      return a.contactCount - b.contactCount;
    });
  }

  return scored.slice(0, limit).map((s) => s.row);
}

// ─── Internal provider-cost guard (never customer billing) ──────────────────

type CapKind = 'monthly' | 'job';

type CreditGuard = {
  /** Book units consumed by this job (call after each metered usage event). */
  charge: (units: number) => void;
  /** Which cap (if any) has been reached. */
  capReached: () => CapKind | null;
};

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Builds the optional runtime provider-cost safety guard. Monthly usage is the sum of
 * actual_credit_units over the user's jobs requested this calendar month
 * (trigger-maintained per job, so no event-table scan is needed). The monthly
 * limit comes from user_billing_limits and falls back to
 * DEFAULT_MONTHLY_CREDIT_LIMIT when the user has no row (or a null limit).
 * The per-job cap is the job's max_credit_units. Customer authorization is
 * handled by the Arcova credit reservation before this runner starts. This
 * legacy guard is analytics-only unless DATA_ACQUISITION_INTERNAL_SAFETY_CAP_ENABLED=true.
 */
async function buildCreditGuard(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
): Promise<CreditGuard> {
  // Org-scoped cap: data is billed to the org, so the monthly ceiling and month-to-date
  // spend are summed across the whole org. Falls back to the per-user limit/spend when the
  // job has no org (legacy / un-orged). org_billing_limits overrides user_billing_limits.
  let monthlyLimit: number | null = null;
  if (job.org_id) {
    const { data: orgLimitRow } = await admin
      .from('org_billing_limits')
      .select('monthly_credit_limit')
      .eq('org_id', job.org_id)
      .maybeSingle();
    monthlyLimit = toFiniteNumber((orgLimitRow as { monthly_credit_limit?: unknown } | null)?.monthly_credit_limit);
  }
  if (monthlyLimit == null) {
    const { data: limitRow } = await admin
      .from('user_billing_limits')
      .select('monthly_credit_limit')
      .eq('user_id', job.user_id)
      .maybeSingle();
    monthlyLimit =
      toFiniteNumber((limitRow as { monthly_credit_limit?: unknown } | null)?.monthly_credit_limit) ??
      DEFAULT_MONTHLY_CREDIT_LIMIT;
  }

  const now = new Date();
  const monthStartIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const monthJobsQuery = admin
    .from('data_acquisition_jobs')
    .select('id, actual_credit_units')
    .gte('requested_at', monthStartIso);
  const { data: monthJobs } = await (job.org_id
    ? monthJobsQuery.eq('org_id', job.org_id)
    : monthJobsQuery.eq('user_id', job.user_id));

  let monthUnits = 0;
  let jobUnits = 0;
  for (const row of (monthJobs ?? []) as Array<{ id: string; actual_credit_units: unknown }>) {
    const units = toFiniteNumber(row.actual_credit_units) ?? 0;
    monthUnits += units;
    if (row.id === job.id) jobUnits = units;
  }

  const jobLimit = toFiniteNumber(job.max_credit_units);

  return {
    charge(units: number) {
      jobUnits += units;
      monthUnits += units;
    },
    capReached() {
      if (process.env.DATA_ACQUISITION_INTERNAL_SAFETY_CAP_ENABLED !== 'true') return null;
      if (monthUnits >= monthlyLimit) return 'monthly';
      if (jobLimit != null && jobLimit > 0 && jobUnits >= jobLimit) return 'job';
      return null;
    },
  };
}

type Meter = (
  eventType: DataAcquisitionUsageEventType,
  quantity: number,
  metadata: Record<string, unknown>,
  provider?: string,
) => Promise<void>;

function makeMeter(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
  guard: CreditGuard,
): Meter {
  return async (eventType, quantity, metadata, provider = 'apollo') => {
    if (quantity <= 0) return;
    await recordDataAcquisitionUsageEvent(admin, {
      jobId: job.id,
      userId: job.user_id,
      orgId: job.org_id,
      eventType,
      provider,
      quantity,
      metadata,
    });
    guard.charge(creditUnitsForEvent(eventType, quantity));
  };
}

/**
 * Plain-language partial-fulfillment note. Deliberately never mentions credit
 * units: costs are internal-only (admin data-costs route).
 */
function shortfallNote(
  kind: CapKind,
  delivered: number,
  requested: number,
  unit: 'contacts' | 'companies',
): string {
  const reason =
    kind === 'monthly'
      ? "you've reached your plan's usage limit this month"
      : 'this job reached its size limit';
  return `We sourced ${delivered} of the ${requested} requested ${unit} because ${reason}.`;
}

// ─── Dedup keys ───────────────────────────────────────────────────────────────

function normalizeKey(value: string | null | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * LinkedIn identity key. CRITICAL: do NOT use `normalizeKey` on LinkedIn URLs —
 * it strips the path (`/company/<slug>` or `/in/<slug>`), collapsing EVERY
 * LinkedIn URL to a bare `linkedin.com`. That made every company/contact with a
 * LinkedIn falsely dedup against every other (expand_companies skipped all
 * candidates as "already owned"). Keep the slug; the host+path is the identity.
 * Returns '' for a path-less `linkedin.com` (no slug = no identity to dedup on).
 */
function normalizeLinkedinKey(value: string | null | undefined): string {
  const v = (value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
  return v.includes('/') ? v : '';
}

function companyKeys(company: Pick<DiscoveredCompany, 'domain' | 'linkedin_url' | 'name'>): string[] {
  const li = normalizeLinkedinKey(company.linkedin_url);
  return [
    company.domain ? `domain:${normalizeKey(company.domain)}` : '',
    li ? `linkedin:${li}` : '',
    company.name ? `name:${normalizeKey(company.name)}` : '',
  ].filter(Boolean);
}

function existingCompanyKeys(company: ExistingCompany): string[] {
  const li = normalizeLinkedinKey(company.linkedin_url);
  return [
    company.domain ? `domain:${normalizeKey(company.domain)}` : '',
    company.website ? `domain:${normalizeKey(company.website)}` : '',
    li ? `linkedin:${li}` : '',
    company.company_name ? `name:${normalizeKey(company.company_name)}` : '',
  ].filter(Boolean);
}

function contactKey(person: DiscoveredPerson): string {
  // Apollo person id first: people-search (api_search) returns obfuscated rows
  // (no email/linkedin, first-name-only), so name/email keys can't dedup them —
  // but the id is stable and always present, and existing Apollo-sourced
  // contacts carry it on apollo_person_raw.
  return (
    (person.source_id && `apollo:${normalizeKey(person.source_id)}`) ||
    (normalizeLinkedinKey(person.linkedin_url) && `linkedin:${normalizeLinkedinKey(person.linkedin_url)}`) ||
    (person.email && `email:${normalizeKey(person.email)}`) ||
    `name_company:${normalizeKey(person.full_name)}:${normalizeKey(person.company_name)}`
  );
}

function existingContactKeys(contact: ExistingContact): string[] {
  const fullName =
    contact.full_name ||
    [contact.first_name, contact.last_name].filter(Boolean).join(' ') ||
    null;
  const apolloId = apolloPersonIdOf(contact.apollo_person_raw);
  const li = normalizeLinkedinKey(contact.linkedin_url);
  return [
    apolloId ? `apollo:${normalizeKey(apolloId)}` : '',
    li ? `linkedin:${li}` : '',
    contact.email ? `email:${normalizeKey(contact.email)}` : '',
    fullName && contact.company_name
      ? `name_company:${normalizeKey(fullName)}:${normalizeKey(contact.company_name)}`
      : '',
  ].filter(Boolean);
}

async function updateJob(jobId: string, values: Record<string, unknown>) {
  const admin = createAdminClient();
  const { error } = await admin
    .from('data_acquisition_jobs')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) throw new Error(error.message);
}

// ─── Pre-flight contact gap helpers ──────────────────────────────────────────

/**
 * Owned contacts at specific companies, keyed by company_id and by normalized
 * company_domain. Used by the pre-flight gap check (skip companies whose
 * requested coverage already exists) and to build the per-company Apollo
 * exclusion lists. The "how many do we want" number is NOT computed here: it
 * comes from the job's requested quantity (which itself derives from the
 * coverage plan / persona definitions upstream).
 */
async function loadOwnedContactsForCompanies(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  companyIds: string[],
  domains: string[],
): Promise<{ byCompanyId: Map<string, OwnedContactRef[]>; byDomain: Map<string, OwnedContactRef[]> }> {
  const byCompanyId = new Map<string, OwnedContactRef[]>();
  const byDomain = new Map<string, OwnedContactRef[]>();
  const seenIds = new Set<string>();

  const ingest = (rows: OwnedContactRef[] | null | undefined) => {
    for (const row of rows ?? []) {
      if (seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      if (row.company_id) {
        if (!byCompanyId.has(row.company_id)) byCompanyId.set(row.company_id, []);
        byCompanyId.get(row.company_id)!.push(row);
      }
      const domainKey = normalizeKey(row.company_domain);
      if (domainKey) {
        if (!byDomain.has(domainKey)) byDomain.set(domainKey, []);
        byDomain.get(domainKey)!.push(row);
      }
    }
  };

  const select = 'id, email, linkedin_url, company_id, company_domain';
  if (companyIds.length > 0) {
    const { data, error } = await admin
      .from('contacts')
      .select(select)
      .eq('user_id', userId)
      .in('company_id', companyIds);
    if (error) throw new Error(error.message);
    ingest((data ?? []) as OwnedContactRef[]);
  }
  const cleanDomains = [...new Set(domains.map((d) => normalizeKey(d)).filter(Boolean))];
  if (cleanDomains.length > 0) {
    const { data, error } = await admin
      .from('contacts')
      .select(select)
      .eq('user_id', userId)
      .in('company_domain', cleanDomains);
    if (error) throw new Error(error.message);
    ingest((data ?? []) as OwnedContactRef[]);
  }

  return { byCompanyId, byDomain };
}

function ownedContactsAt(
  owned: { byCompanyId: Map<string, OwnedContactRef[]>; byDomain: Map<string, OwnedContactRef[]> },
  companyId: string | null,
  domain: string | null,
): OwnedContactRef[] {
  const merged = new Map<string, OwnedContactRef>();
  if (companyId) for (const c of owned.byCompanyId.get(companyId) ?? []) merged.set(c.id, c);
  const domainKey = normalizeKey(domain);
  if (domainKey) for (const c of owned.byDomain.get(domainKey) ?? []) merged.set(c.id, c);
  return [...merged.values()];
}

/** Exclusion lists for one Apollo people call, capped at MAX_EXCLUSIONS_PER_CALL entries total. */
function exclusionListsFor(contacts: OwnedContactRef[]): {
  excludeEmails: string[];
  excludeLinkedinUrls: string[];
} {
  const excludeEmails: string[] = [];
  const excludeLinkedinUrls: string[] = [];
  let total = 0;
  for (const contact of contacts) {
    if (total >= MAX_EXCLUSIONS_PER_CALL) break;
    if (contact.linkedin_url?.trim()) {
      excludeLinkedinUrls.push(contact.linkedin_url.trim());
      total += 1;
      if (total >= MAX_EXCLUSIONS_PER_CALL) break;
    }
    if (contact.email?.trim()) {
      excludeEmails.push(contact.email.trim());
      total += 1;
    }
  }
  // If a company somehow exceeds the cap we truncate here; the whole-book
  // post-fetch dedup below remains in place as the second line of defense.
  return { excludeEmails, excludeLinkedinUrls };
}

// ─── Shared pipeline tail ─────────────────────────────────────────────────────

function rawUploadFromPerson(userId: string, batchId: string, person: DiscoveredPerson, jobId: string) {
  const rawData = {
    full_name: person.full_name,
    first_name: person.first_name,
    last_name: person.last_name,
    company_name: person.company_name,
    company_domain: person.company_domain || '',
    company_linkedin_url: person.company_linkedin_url || '',
    job_title: person.job_title || '',
    email: person.email || '',
    linkedin_url: person.linkedin_url || '',
    location: person.location || '',
    source: 'arcova_data_acquisition',
    data_acquisition_job_id: jobId,
    apollo_person_raw: person.raw,
  };

  return {
    user_id: userId,
    batch_id: batchId,
    raw_data: rawData,
    full_name: person.full_name,
    email: person.email,
    linkedin_url: person.linkedin_url,
    company_name: person.company_name,
    status: 'enriching',
  };
}

async function ingestPeopleAndRunImportPipeline(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
  uniquePeople: DiscoveredPerson[],
  usageMeta: Record<string, unknown>,
  meter: Meter,
  completionNote: string | null,
): Promise<void> {
  const rawRows = uniquePeople.map((person) =>
    rawUploadFromPerson(job.user_id, job.upload_batch_id!, person, job.id),
  );
  const { data: insertedRows, error: insertError } =
    rawRows.length > 0
      ? await admin
          .from('raw_uploads')
          .insert(rawRows)
          .select('id, full_name, email, linkedin_url, company_name, raw_data')
      : { data: [], error: null };

  if (insertError) throw new Error(insertError.message);

  await admin
    .from('upload_batches')
    .update({
      total_rows: rawRows.length,
      status: rawRows.length > 0 ? 'processing' : 'complete',
      completed_at: rawRows.length > 0 ? null : new Date().toISOString(),
    })
    .eq('id', job.upload_batch_id);

  const queuedRows: QueuedRow[] = (insertedRows || []).map((row) => ({
    id: row.id as string,
    full_name: row.full_name as string | null,
    email: row.email as string | null,
    linkedin_url: row.linkedin_url as string | null,
    company_name: row.company_name as string | null,
    raw_data: row.raw_data as Record<string, unknown>,
  }));

  if (queuedRows.length === 0) {
    const metadata = await buildCoverageWritebackMetadata(admin, job);
    await updateJob(job.id, {
      status: 'complete',
      completed_at: new Date().toISOString(),
      completion_note: completionNote,
      metadata,
    });
    return;
  }

  await updateJob(job.id, { status: 'enriching' });

  if (rawRows.length > 0) {
    await meter('apollo_person_enrichment', rawRows.length, { batchId: job.upload_batch_id, ...usageMeta });
  }

  const chunkSize = Math.max(1, Math.ceil(queuedRows.length / IMPORT_PROGRESS_CHUNKS));
  let importPhaseStarted = false;

  const onProgress: ImportProgressCallback = async (event) => {
    if (job.request_type !== 'expand_companies' && event.type === 'imported_company') return;
    await meter(
      event.type,
      event.quantity,
      { batchId: job.upload_batch_id, ...usageMeta, ...event.metadata },
      'arcova',
    );
  };

  for (let i = 0; i < queuedRows.length; i += chunkSize) {
    const chunk = queuedRows.slice(i, i + chunkSize);
    await processQueuedRowsInBackground({
      queuedRows: chunk,
      batchId: job.upload_batch_id!,
      userId: job.user_id,
      autoEnrich: true,
      onBeforeIngest: async () => {
        if (!importPhaseStarted) {
          importPhaseStarted = true;
          await updateJob(job.id, { status: 'importing' });
        }
      },
      onProgress,
    });
  }

  const metadata = await buildCoverageWritebackMetadata(admin, job);
  await updateJob(job.id, {
    status: 'complete',
    completed_at: new Date().toISOString(),
    completion_note: completionNote,
    metadata,
  });
}

/** Terminal completion when nothing was purchased (coverage already owned, or a cap blocked the run). */
async function completeJobWithoutPurchase(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
  note: string,
): Promise<void> {
  await admin
    .from('upload_batches')
    .update({ total_rows: 0, status: 'complete', completed_at: new Date().toISOString() })
    .eq('id', job.upload_batch_id);
  const metadata = await buildCoverageWritebackMetadata(admin, job);
  await updateJob(job.id, {
    status: 'complete',
    completed_at: new Date().toISOString(),
    completion_note: note,
    metadata,
  });
}

async function buildCoverageWritebackMetadata(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
): Promise<Record<string, unknown>> {
  // The receipt is an ICP coverage snapshot; without an ICP there is nothing
  // meaningful to snapshot (an unscoped query would just record zeros).
  if (!job.icp_id) return job.metadata ?? {};

  const [{ data: currentJob }, { data: companies }] = await Promise.all([
    admin
      .from('data_acquisition_jobs')
      .select('metadata, imported_company_count, imported_contact_count, skipped_existing_count, skipped_duplicate_count')
      .eq('id', job.id)
      .maybeSingle(),
    admin
      .from('user_companies')
      .select('company_id')
      .eq('user_id', job.user_id)
      .eq('matched_icp_id', job.icp_id),
  ]);

  const companyIds = ((companies ?? []) as Array<{ company_id?: unknown }>)
    .map((row) => row.company_id)
    .filter((value): value is string => typeof value === 'string');

  let contactCount = 0;
  if (companyIds.length > 0) {
    const { count } = await admin
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', job.user_id)
      .in('company_id', companyIds);
    contactCount = count ?? 0;
  }

  const existingMetadata =
    currentJob?.metadata && typeof currentJob.metadata === 'object'
      ? (currentJob.metadata as Record<string, unknown>)
      : (job.metadata ?? {});
  const counters = (currentJob ?? {}) as {
    imported_company_count?: number | null;
    imported_contact_count?: number | null;
    skipped_existing_count?: number | null;
    skipped_duplicate_count?: number | null;
  };

  return {
    ...existingMetadata,
    coverage_writeback: {
      written_at: new Date().toISOString(),
      icp_id: job.icp_id,
      current_company_count: companyIds.length,
      current_contact_count: contactCount,
      imported_company_count: counters.imported_company_count ?? 0,
      imported_contact_count: counters.imported_contact_count ?? 0,
      skipped_count: (counters.skipped_existing_count ?? 0) + (counters.skipped_duplicate_count ?? 0),
    },
  };
}

function getCompanyContext(job: DataAcquisitionJob): CompanyContext | null {
  const company = job.metadata?.company;
  if (!company || typeof company !== 'object') return null;
  const record = company as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : '';
  if (!id) return null;
  return {
    id,
    company_name: typeof record.company_name === 'string' ? record.company_name : null,
    domain: typeof record.domain === 'string' ? record.domain : null,
    website: typeof record.website === 'string' ? record.website : null,
    linkedin_url: typeof record.linkedin_url === 'string' ? record.linkedin_url : null,
    matched_icp_id: typeof record.matched_icp_id === 'string' ? record.matched_icp_id : null,
  };
}

function discoveredCompanyFromContext(company: CompanyContext): DiscoveredCompany {
  const domain = normalizeKey(company.domain || company.website);
  const name = company.company_name || domain || 'Selected company';

  return {
    source: 'apollo',
    source_id: null,
    name,
    domain: domain || null,
    linkedin_url: company.linkedin_url || null,
    employee_count: null,
    raw: {
      name,
      primary_domain: domain || null,
      website_url: company.website || company.domain || null,
      linkedin_url: company.linkedin_url || null,
    },
  };
}

// ─── Screened-organizations cache ────────────────────────────────────────────

type ScreenCache = {
  /** 'qualified' | 'rejected:*' | null (never screened for this user+ICP). */
  lookup: (company: DiscoveredCompany) => string | null;
  store: (company: DiscoveredCompany, verdict: string) => Promise<void>;
};

/**
 * Loads the (user, ICP) screening history so every Apollo org is screened at
 * most once per ICP across all jobs: previously rejected orgs are skipped for
 * free, previously qualified ones short-circuit to qualified.
 */
async function loadScreenCache(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  icpId: string,
): Promise<ScreenCache> {
  const byOrgId = new Map<string, string>();
  const byDomain = new Map<string, string>();

  const { data, error } = await admin
    .from('screened_organizations')
    .select('apollo_org_id, domain, verdict')
    .eq('user_id', userId)
    .eq('icp_id', icpId);
  if (error) {
    // Cache is an optimization: if the table is missing (migration not yet
    // applied) screening still works, it just re-screens.
    console.warn('[data-acquisition] screened_organizations unavailable:', error.message);
  }
  for (const row of (data ?? []) as Array<{ apollo_org_id: string | null; domain: string | null; verdict: string }>) {
    if (row.apollo_org_id) byOrgId.set(row.apollo_org_id, row.verdict);
    const domainKey = normalizeKey(row.domain);
    if (domainKey) byDomain.set(domainKey, row.verdict);
  }

  return {
    lookup(company) {
      if (company.source_id && byOrgId.has(company.source_id)) return byOrgId.get(company.source_id)!;
      const domainKey = normalizeKey(company.domain);
      if (domainKey && byDomain.has(domainKey)) return byDomain.get(domainKey)!;
      return null;
    },
    async store(company, verdict) {
      if (company.source_id) byOrgId.set(company.source_id, verdict);
      const domainKey = normalizeKey(company.domain);
      if (domainKey) byDomain.set(domainKey, verdict);
      const { error: insertError } = await admin.from('screened_organizations').insert({
        user_id: userId,
        icp_id: icpId,
        apollo_org_id: company.source_id,
        domain: domainKey || null,
        verdict,
      });
      // Unique-violation (already cached by a concurrent job) and a missing
      // table are both fine to ignore; the in-memory maps stay authoritative
      // for this run.
      if (insertError && insertError.code !== '23505') {
        console.warn('[data-acquisition] screened_organizations insert failed:', insertError.message);
      }
    },
  };
}

// ─── FIFO queue (one running job per user) ───────────────────────────────────

/**
 * Atomically claims a job for execution (queued/failed -> discovering).
 * Returns false when another process already claimed it: this is the
 * double-start guard between the end-of-job queue advancer and the poll-time
 * recovery kick in GET /api/data-acquisition/jobs.
 */
async function claimJobForRun(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('data_acquisition_jobs')
    .update({
      status: 'discovering',
      started_at: new Date().toISOString(),
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .in('status', ['queued', 'failed'])
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Starts the user's oldest queued job if nothing is currently running.
 * Called when a job reaches a terminal state (and by the polling safety net
 * via runDataAcquisitionJob, whose atomic claim prevents double-starts).
 */
async function advanceQueueForUser(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { count } = await admin
    .from('data_acquisition_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', [...ACTIVE_JOB_STATUSES]);
  if ((count ?? 0) > 0) return;

  const { data: next } = await admin
    .from('data_acquisition_jobs')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'queued')
    .order('requested_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const nextId = (next as { id?: string } | null)?.id;
  if (!nextId) return;

  await runDataAcquisitionJob(nextId);
}

// ─── Job execution ────────────────────────────────────────────────────────────

export async function runDataAcquisitionJob(jobId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: jobData, error: jobError } = await admin
    .from('data_acquisition_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (jobError || !jobData) {
    throw new Error(jobError?.message || `Data acquisition job ${jobId} not found`);
  }

  const job = jobData as DataAcquisitionJob;
  if (!job.upload_batch_id) {
    throw new Error(`Data acquisition job ${jobId} is missing upload_batch_id`);
  }

  const claimed = await claimJobForRun(admin, job.id);
  if (!claimed) return;

  try {
    await executeClaimedJob(admin, job);
    const transactionId = typeof job.metadata?.customer_credit_transaction_id === 'string'
      ? job.metadata.customer_credit_transaction_id
      : null;
    const { data: completed } = await admin.from('data_acquisition_jobs')
      .select('imported_contact_count')
      .eq('id', job.id)
      .maybeSingle<{ imported_contact_count: number | null }>();
    const delivered = Math.max(0, Number(completed?.imported_contact_count ?? 0));
    await settleCredits(transactionId, delivered * 4);
    const usageOperationId = typeof job.metadata?.customer_usage_operation_id === 'string'
      ? job.metadata.customer_usage_operation_id
      : null;
    if (job.org_id && usageOperationId) {
      await settleUsage({
        orgId: job.org_id,
        action: 'net_new_enriched_lead',
        operationKey: usageOperationId,
        quantity: delivered,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown data acquisition failure';
    await updateJob(job.id, { status: 'failed', error: message, completed_at: new Date().toISOString() });
    await admin
      .from('upload_batches')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', job.upload_batch_id);
    const transactionId = typeof job.metadata?.customer_credit_transaction_id === 'string'
      ? job.metadata.customer_credit_transaction_id
      : null;
    await refundCredits(transactionId).catch(() => {});
    const usageOperationId = typeof job.metadata?.customer_usage_operation_id === 'string'
      ? job.metadata.customer_usage_operation_id
      : null;
    if (job.org_id && usageOperationId) {
      await settleUsage({
        orgId: job.org_id,
        action: 'net_new_enriched_lead',
        operationKey: usageOperationId,
        quantity: 0,
      }).catch(() => {});
    }
    throw error;
  } finally {
    // Sequential per-user queue: whatever happened to this job, start the
    // oldest queued one next. Never let advancement errors mask job errors.
    try {
      await advanceQueueForUser(job.user_id);
    } catch (advanceError) {
      console.error('[data-acquisition] queue advancement failed', advanceError);
    }
  }
}

async function executeClaimedJob(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
): Promise<void> {
  // Service-role client bypasses RLS, so scope the ICP explicitly to what job.user_id may
  // see (company-wide + their own personal). Personas are fetched by the ICP itself
  // (org-scoped) since a company ICP's personas belong to its creator, not the buyer.
  const jobOrgId = await orgIdForUser(admin, job.user_id);
  const [{ data: icpData, error: icpError }, { data: personaData, error: personaError }] = await Promise.all([
    scopeIcpsToUser(
      admin
        .from('icps')
        .select(
          'id, name, company_type, platform_category, therapeutic_areas, modalities, development_stages, company_sizes, funding_stages, target_customers, buyer_types',
        ),
      jobOrgId,
      job.user_id,
    )
      .eq('id', job.icp_id)
      .maybeSingle(),
    (jobOrgId
      ? admin
          .from('personas')
          .select('id, name, functions, seniority_levels, job_titles')
          .eq('org_id', jobOrgId)
          .eq('icp_id', job.icp_id)
      : admin
          .from('personas')
          .select('id, name, functions, seniority_levels, job_titles')
          .eq('user_id', job.user_id)
          .eq('icp_id', job.icp_id)),
  ]);

  if (icpError || !icpData) throw new Error(icpError?.message || 'ICP not found');
  if (personaError) throw new Error(personaError.message);

  const icp = icpData as AcquisitionIcp;
  const personas = (personaData || []) as AcquisitionPersona[];

  const guard = await buildCreditGuard(admin, job);
  const meter = makeMeter(admin, job, guard);

  // A queued job may start after earlier jobs already exhausted the month.
  if (guard.capReached() === 'monthly') {
    const requested =
      job.request_type === 'expand_companies'
        ? Math.max(1, job.target_company_count || 50)
        : Math.max(1, job.target_contact_count || DEFAULT_CONTACTS_PER_COMPANY);
    const unit = job.request_type === 'expand_companies' ? 'companies' : 'contacts';
    await completeJobWithoutPurchase(admin, job, shortfallNote('monthly', 0, requested, unit));
    return;
  }

  if (job.request_type === 'contacts_at_company') {
    await runContactsAtCompanyJob(admin, job, personas, guard, meter);
    return;
  }

  if (job.request_type === 'better_contacts' || job.request_type === 'more_contacts_at_accounts') {
    await runContactsAtAccountsJob(admin, job, personas, guard, meter);
    return;
  }

  if (job.request_type !== 'expand_companies') {
    throw new Error(`Unsupported data acquisition request type: ${job.request_type}`);
  }

  await runExpandCompaniesJob(admin, job, icp, personas, guard, meter);
}

// ─── contacts_at_company ─────────────────────────────────────────────────────

async function runContactsAtCompanyJob(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
  personas: AcquisitionPersona[],
  guard: CreditGuard,
  meter: Meter,
): Promise<void> {
  const companyContext = getCompanyContext(job);
  if (!companyContext) {
    throw new Error('contacts_at_company job is missing company context');
  }

  // `target_contact_count` is NET-NEW for this path: the agent asks "how many
  // MORE contacts to add" and the confirm dialog shows the number as net-new
  // leads, so source exactly this many NEW people. Owned contacts are loaded
  // only to exclude them from the Apollo search below — never subtracted from
  // the target. (Subtracting silently under-sourced once an account already had
  // contacts: "1 more" at a company with 1 owned produced gap=0 and delivered
  // nothing.) An exhausted company that returns no new people is handled
  // gracefully downstream (empty result -> full refund).
  const requested = Math.max(1, job.target_contact_count || DEFAULT_CONTACTS_PER_COMPANY);
  const company = discoveredCompanyFromContext(companyContext);
  if (!company.source_id && !company.domain) {
    await completeJobWithoutPurchase(
      admin,
      job,
      'This account needs a company domain before we can source contacts.',
    );
    return;
  }

  const owned = await loadOwnedContactsForCompanies(
    admin,
    job.user_id,
    [companyContext.id],
    company.domain ? [company.domain] : [],
  );
  const ownedHere = ownedContactsAt(owned, companyContext.id, company.domain);
  const gap = requested;

  const peopleRecipe = buildApolloPeopleSearchRecipe(personas);
  const target: PeopleSearchTarget = {
    company,
    contactsTarget: gap,
    ...exclusionListsFor(ownedHere),
  };

  const { people, stoppedByGuard } = await discoverApolloPeopleForCompanies({
    targets: [target],
    recipe: peopleRecipe,
    shouldContinue: async () => guard.capReached() === null,
    onSearchResult: async (newCount, excludedCount, c) => {
      await meter('apollo_people_search_result', newCount, {
        company: c.name,
        domain: c.domain,
        companyId: companyContext.id,
      });
      await meter('duplicate_contact_skipped', excludedCount, {
        company: c.name,
        domain: c.domain,
        companyId: companyContext.id,
        reason: 'already_owned_excluded',
      });
    },
  });

  const uniquePeople = await dedupAgainstWholeBook(admin, job, people, gap, meter, {
    companyId: companyContext.id,
  });

  const capKind = stoppedByGuard ? guard.capReached() : null;
  const note = capKind ? shortfallNote(capKind, uniquePeople.length, gap, 'contacts') : null;

  await updateJob(job.id, { status: 'processing' });
  await ingestPeopleAndRunImportPipeline(admin, job, uniquePeople, { companyId: companyContext.id }, meter, note);
}

// ─── more_contacts_at_accounts (and legacy better_contacts rows) ─────────────

async function runContactsAtAccountsJob(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
  personas: AcquisitionPersona[],
  guard: CreditGuard,
  meter: Meter,
): Promise<void> {
  const requestType = job.request_type as 'better_contacts' | 'more_contacts_at_accounts';
  const requestedTotal = Math.max(1, job.target_contact_count || DEFAULT_CONTACTS_PER_COMPANY);
  const maxAccounts = Math.min(100, Math.max(1, Math.ceil(requestedTotal / DEFAULT_CONTACTS_PER_COMPANY)));
  const perCompany = Math.max(1, Math.ceil(requestedTotal / maxAccounts));

  const prioritizedRows = await loadPrioritizedCompaniesForIcpAccounts(
    admin,
    job.user_id,
    job.icp_id,
    requestType,
    500,
  );

  if (prioritizedRows.length === 0) {
    throw new Error(
      'No ICP-matched accounts with a usable domain for Apollo search. Add or enrich company domains first.',
    );
  }

  const owned = await loadOwnedContactsForCompanies(
    admin,
    job.user_id,
    prioritizedRows.map((r) => r.id),
    prioritizedRows.map((r) => r.domain || r.website || '').filter(Boolean),
  );

  // Pre-flight gap check per account: skip fully-covered accounts before any
  // Apollo call; fetch only the gap at the rest.
  const targets: PeopleSearchTarget[] = [];
  let candidatesExamined = 0;
  for (const row of prioritizedRows) {
    if (targets.length >= maxAccounts) break;
    if (candidatesExamined >= maxAccounts * 5) break;
    const discovered = discoveredCompanyFromDbRow(row);
    if (!discovered) continue;
    candidatesExamined += 1;

    const ownedHere = ownedContactsAt(owned, row.id, discovered.domain);
    const gap = perCompany - ownedHere.length;
    if (gap <= 0) {
      await meter('skipped_existing', 1, {
        company: discovered.name,
        domain: discovered.domain,
        companyId: row.id,
        existingContacts: ownedHere.length,
        requestedContacts: perCompany,
        requestType,
      });
      continue;
    }

    targets.push({
      company: discovered,
      contactsTarget: gap,
      ...exclusionListsFor(ownedHere),
    });
  }

  if (targets.length === 0) {
    await completeJobWithoutPurchase(
      admin,
      job,
      'Your accounts in this ICP already have the requested contact coverage, so nothing new was sourced.',
    );
    return;
  }

  const peopleRecipe = buildApolloPeopleSearchRecipe(personas);
  const { people, stoppedByGuard } = await discoverApolloPeopleForCompanies({
    targets,
    recipe: peopleRecipe,
    shouldContinue: async () => guard.capReached() === null,
    onSearchResult: async (newCount, excludedCount, c) => {
      await meter('apollo_people_search_result', newCount, {
        company: c.name,
        domain: c.domain,
        requestType,
      });
      await meter('duplicate_contact_skipped', excludedCount, {
        company: c.name,
        domain: c.domain,
        requestType,
        reason: 'already_owned_excluded',
      });
    },
  });

  const uniquePeople = await dedupAgainstWholeBook(admin, job, people, requestedTotal, meter, { requestType });

  const capKind = stoppedByGuard ? guard.capReached() : null;
  const note = capKind ? shortfallNote(capKind, uniquePeople.length, requestedTotal, 'contacts') : null;

  await updateJob(job.id, { status: 'processing' });
  await ingestPeopleAndRunImportPipeline(admin, job, uniquePeople, { requestType }, meter, note);
}

// ─── expand_companies ────────────────────────────────────────────────────────

async function runExpandCompaniesJob(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
  icp: AcquisitionIcp,
  personas: AcquisitionPersona[],
  guard: CreditGuard,
  meter: Meter,
): Promise<void> {
  const companyRecipes = buildApolloCompanySearchRecipes(icp, job.request_type);
  const targetCompanyCount = Math.max(1, job.target_company_count || 50);
  const maxScreenedCompanies = Math.max(
    targetCompanyCount,
    job.max_screened_companies || targetCompanyCount * 6,
  );

  // Owned-company keys, loaded once. 10k+ entries are fine in memory; checking
  // this set is the FIRST step for every Apollo result so duplicates cost
  // nothing (no keyword screen, no metered screening event).
  const { data: existingOwned } = await admin
    .from('user_companies')
    .select('company_id')
    .eq('user_id', job.user_id);
  const existingOwnedIds = (existingOwned ?? [])
    .map((r) => (r as { company_id?: unknown }).company_id)
    .filter((v): v is string => typeof v === 'string');
  const { data: existingCompanies } = existingOwnedIds.length > 0
    ? await admin
        .from('companies')
        .select('company_name, domain, website, linkedin_url')
        .in('id', existingOwnedIds)
    : { data: [] as ExistingCompany[] };
  const existingCompanyKeySet = new Set(
    ((existingCompanies || []) as ExistingCompany[]).flatMap(existingCompanyKeys),
  );

  const screenCache = await loadScreenCache(admin, job.user_id, job.icp_id);
  const icpKeywords = icpKeywordCorpus(icp);
  let screenedCount = 0;
  const acceptedCompanyKeys = new Set<string>();

  const evaluateCompany = async (
    company: DiscoveredCompany,
    recipe: { name: string },
    provider: 'apollo' | 'web_search',
  ) => {
    const keys = companyKeys(company);
    if (keys.some((key) => existingCompanyKeySet.has(key) || acceptedCompanyKeys.has(key))) {
      await meter('skipped_existing', 1, {
        company: company.name,
        domain: company.domain,
        reason: 'already_owned_or_selected',
        provider,
      });
      return 'skip' as const;
    }

    const cachedVerdict = screenCache.lookup(company);
    if (cachedVerdict === 'qualified') {
      keys.forEach((key) => acceptedCompanyKeys.add(key));
      await meter('qualified_company', 1, {
        company: company.name,
        domain: company.domain,
        cached: true,
        provider,
      });
      return 'qualified' as const;
    }
    if (cachedVerdict) return 'skip' as const; // previously rejected for this ICP, free

    const passes = apolloOrganizationMatchesIcpKeywords(company.raw, icpKeywords);
    await screenCache.store(company, passes ? 'qualified' : 'rejected:keyword_mismatch');
    if (!passes) {
      return 'skip' as const;
    }

    if (screenedCount >= maxScreenedCompanies) return 'skip' as const;
    screenedCount += 1;
    if (provider === 'apollo') {
      await meter('apollo_company_search_result', 1, {
        company: company.name,
        domain: company.domain,
        recipe: recipe.name,
        provider,
      });
    } else {
      await meter('llm_fit_screen', 1, {
        company: company.name,
        domain: company.domain,
        recipe: recipe.name,
        provider,
        reason: 'web_discovery_fallback',
      }, 'anthropic_search');
    }

    keys.forEach((key) => acceptedCompanyKeys.add(key));
    await meter('qualified_company', 1, { company: company.name, domain: company.domain, provider });
    return 'qualified' as const;
  };

  const discovery = await discoverApolloCompanies({
    recipes: companyRecipes,
    targetCompanyCount,
    maxPagesPerRecipe: 20,
    shouldContinue: async () => guard.capReached() === null && screenedCount < maxScreenedCompanies,
    // Evaluation order per org: (1) owned/selected dedup, free; (2) screened
    // cache, free; (3) cheap keyword screen, free; (4) metered qualified screen.
    evaluate: async (company, recipe) => evaluateCompany(company, recipe, 'apollo'),
  });

  const qualifiedCompanies = [...discovery.companies];
  if (
    qualifiedCompanies.length < targetCompanyCount &&
    guard.capReached() === null &&
    process.env.ANTHROPIC_API_KEY
  ) {
    const fallbackTarget = targetCompanyCount - qualifiedCompanies.length;
    try {
      const fallbackCompanies = await discoverCompaniesWithWebSearch({
        icp,
        targetCompanyCount: fallbackTarget,
      });
      for (const company of fallbackCompanies) {
        if (qualifiedCompanies.length >= targetCompanyCount) break;
        if (guard.capReached() !== null || screenedCount >= maxScreenedCompanies) break;
        const verdict = await evaluateCompany(company, { name: 'web_search_fallback' }, 'web_search');
        if (verdict === 'qualified') qualifiedCompanies.push(company);
      }
      if (fallbackCompanies.length > 0) {
        await updateJob(job.id, {
          source_strategy: 'apollo_then_web_search',
          metadata: {
            ...(job.metadata ?? {}),
            secondary_source: {
              provider: 'anthropic_web_search',
              attempted_at: new Date().toISOString(),
              candidate_count: fallbackCompanies.length,
              accepted_count: qualifiedCompanies.filter((company) => company.source === 'web_search').length,
            },
          },
        });
      }
    } catch (error) {
      console.warn('[data-acquisition] web discovery fallback failed:', error);
    }
  }
  const companyPhaseCapKind = discovery.stoppedByGuard ? guard.capReached() : null;

  if (qualifiedCompanies.length === 0) {
    if (companyPhaseCapKind) {
      await completeJobWithoutPurchase(
        admin,
        job,
        shortfallNote(companyPhaseCapKind, 0, targetCompanyCount, 'companies'),
      );
      return;
    }
    throw new Error(
      'No new companies passed deduplication and ICP keyword screening. Widen the ICP or try again later.',
    );
  }

  await updateJob(job.id, { status: 'processing' });

  const peopleRecipe = buildApolloPeopleSearchRecipe(personas);
  const targetContactCount =
    job.target_contact_count || qualifiedCompanies.length * DEFAULT_CONTACTS_PER_COMPANY;
  const contactsPerCompany = Math.max(
    1,
    Math.ceil(targetContactCount / Math.max(1, qualifiedCompanies.length)),
  );

  // These companies are new by construction (owned dupes were skipped above),
  // so there is no pre-flight gap or exclusion list to build for them.
  const { people, stoppedByGuard: peoplePhaseCapped } = await discoverApolloPeopleForCompanies({
    targets: qualifiedCompanies.map((company) => ({ company, contactsTarget: contactsPerCompany })),
    recipe: peopleRecipe,
    shouldContinue: async () => guard.capReached() === null,
    onSearchResult: async (newCount, excludedCount, c) => {
      await meter('apollo_people_search_result', newCount, { company: c.name, domain: c.domain });
      await meter('duplicate_contact_skipped', excludedCount, {
        company: c.name,
        domain: c.domain,
        reason: 'already_owned_excluded',
      });
    },
  });

  const uniquePeople = await dedupAgainstWholeBook(admin, job, people, targetContactCount, meter, {});

  let note: string | null = null;
  if (companyPhaseCapKind && qualifiedCompanies.length < targetCompanyCount) {
    note = shortfallNote(companyPhaseCapKind, qualifiedCompanies.length, targetCompanyCount, 'companies');
  } else if (peoplePhaseCapped && guard.capReached()) {
    note = shortfallNote(guard.capReached()!, uniquePeople.length, targetContactCount, 'contacts');
  }

  await ingestPeopleAndRunImportPipeline(admin, job, uniquePeople, {}, meter, note);
}

// ─── Whole-book post-fetch dedup (second line of defense) ────────────────────

/**
 * The per-company exclusion lists should prevent owned contacts from coming
 * back at all, but this whole-book key check stays in place as the safety net
 * (name+company matches, truncated exclusion lists, contacts without a stored
 * email/linkedin, etc.).
 */
async function dedupAgainstWholeBook(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
  people: DiscoveredPerson[],
  limit: number,
  meter: Meter,
  metadata: Record<string, unknown>,
): Promise<DiscoveredPerson[]> {
  const { data: existingContacts } = await admin
    .from('contacts')
    .select('full_name, first_name, last_name, email, linkedin_url, company_name, company_domain, apollo_person_raw')
    .eq('user_id', job.user_id);
  const existingContactKeySet = new Set(
    ((existingContacts || []) as ExistingContact[]).flatMap(existingContactKeys),
  );

  const uniquePeople: DiscoveredPerson[] = [];
  const seenContactKeys = new Set<string>();
  for (const person of people) {
    const key = contactKey(person);
    if (existingContactKeySet.has(key) || seenContactKeys.has(key)) {
      await meter('duplicate_contact_skipped', 1, {
        person: person.full_name,
        company: person.company_name,
        ...metadata,
      });
      continue;
    }
    seenContactKeys.add(key);
    uniquePeople.push(person);
    if (uniquePeople.length >= limit) break;
  }
  return uniquePeople;
}
