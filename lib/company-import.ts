/**
 * Company-first import.
 *
 * The contact importer (lib/import-queue.ts) is person-centric: every row needs
 * a person identifier AND a company, and companies only ever come into being as
 * a side-effect of a contact import. This path is the inverse — the user brings
 * a list of COMPANIES they care about (name and/or domain), we enrich + fit-score
 * each one, and they land in `/companies` as records with zero contacts. Buying
 * contacts at them stays a separate, user-initiated action via `/data`.
 *
 * Reuses the same enrichment pipeline as the Companies side-panel "Refresh
 * enrichment" button (`runCompanyEnrichmentById`) and the same org credit system
 * (`reserveCredits` / `settleCredits`, action `company_enrichment`), so the cost
 * is honest and identical to a single-company refresh: ACTION_CREDITS.company_enrichment
 * per company. Progress is tracked through `raw_uploads` + `upload_batches`, so
 * the existing import-status / import-history UI works unchanged.
 */
import { createAdminClient } from '@/lib/supabase-admin';
import { ACTION_CREDITS } from '@/lib/billing/config';
import { orgIdForUser } from '@/lib/org-context';

/**
 * User-facing credits reserved per company. Company import pre-reserves this
 * amount before queuing deep enrichment; the queue settles on success or refunds
 * on failure, so a company that fails to enrich is not charged.
 */
export const COMPANY_IMPORT_CREDITS_PER_COMPANY = ACTION_CREDITS.company_enrichment;

export type CompanyImportField = 'company_name' | 'company_domain' | 'company_linkedin_url' | 'ignore';

export type CompanyImportRow = {
  company_name: string;
  company_domain: string;
  company_linkedin_url: string;
};

const normalizeLower = (value: string | null | undefined) => (value || '').trim().toLowerCase();

export function cleanCompanyDomain(value?: string | null): string | null {
  const trimmed = (value ?? '').trim().toLowerCase();
  if (!trimmed) return null;
  const cleaned = trimmed
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .trim();
  // Reject obvious non-domains (no dot) so a stray company name dropped in the
  // domain column doesn't masquerade as a real domain.
  return cleaned.includes('.') ? cleaned : null;
}

/** Provisional display name for a domain-only row; enrichment refines the rest. */
function deriveNameFromDomain(domain: string): string {
  const label = domain.split('.')[0] || domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** A row is importable if it carries at least one usable identifier. */
export function companyRowHasIdentifier(row: CompanyImportRow): boolean {
  return Boolean(
    cleanCompanyDomain(row.company_domain) ||
      (row.company_linkedin_url || '').trim() ||
      (row.company_name || '').trim(),
  );
}

/** Extract a single company row from a raw CSV row using the column mapping. */
export function mapRowToCompany(
  headers: string[],
  row: string[],
  columnMappings: Record<string, CompanyImportField>,
): CompanyImportRow {
  const byField: Record<CompanyImportField, string[]> = {
    company_name: [],
    company_domain: [],
    company_linkedin_url: [],
    ignore: [],
  };
  headers.forEach((header, index) => {
    const mapping = columnMappings[header] || 'ignore';
    const value = (row[index] || '').trim();
    if (value) byField[mapping].push(value);
  });
  return {
    company_name: byField.company_name[0] || '',
    company_domain: byField.company_domain[0] || '',
    company_linkedin_url: byField.company_linkedin_url[0] || '',
  };
}

/**
 * Map raw CSV rows to company import rows using the column mapping. Collapses
 * exact in-file duplicates (same domain, else same name) so a list that repeats
 * a company doesn't enrich — and bill — it twice.
 */
export function normalizeCompanyRows(
  headers: string[],
  rows: string[][],
  columnMappings: Record<string, CompanyImportField>,
): CompanyImportRow[] {
  const seen = new Set<string>();
  const out: CompanyImportRow[] = [];

  for (const row of rows) {
    const candidate = mapRowToCompany(headers, row, columnMappings);
    if (!companyRowHasIdentifier(candidate)) continue;

    const dedupeKey =
      cleanCompanyDomain(candidate.company_domain) ||
      normalizeLower(candidate.company_linkedin_url) ||
      normalizeLower(candidate.company_name);
    if (dedupeKey && seen.has(dedupeKey)) continue;
    if (dedupeKey) seen.add(dedupeKey);
    out.push(candidate);
  }

  return out;
}

type OwnedCompanyKeys = { domains: Set<string>; names: Set<string> };

/**
 * Load the domains + names of companies this user already owns, so we can skip
 * re-importing (and re-billing) accounts they already have. Mirrors the contact
 * importer's dedup-against-existing pass.
 */
export async function loadOwnedCompanyKeys(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<OwnedCompanyKeys> {
  const domains = new Set<string>();
  const names = new Set<string>();

  const orgId = await orgIdForUser(admin as never, userId);
  const companyIds = new Set<string>();
  if (orgId) {
    const { data } = await admin
      .from('org_companies')
      .select('company_id')
      .eq('org_id', orgId)
      .is('archived_at', null);
    for (const row of data ?? []) {
      companyIds.add((row as { company_id: string }).company_id);
    }
  }
  const { data: userCompanyRows } = await admin
    .from('user_companies')
    .select('company_id')
    .eq('user_id', userId)
    .is('archived_at', null);
  for (const row of userCompanyRows ?? []) {
    companyIds.add((row as { company_id: string }).company_id);
  }
  if (companyIds.size === 0) return { domains, names };

  // Chunk the IN() so a large book doesn't blow the query length.
  const companyIdList = [...companyIds];
  for (let i = 0; i < companyIdList.length; i += 500) {
    const slice = companyIdList.slice(i, i + 500);
    const { data } = await admin
      .from('companies')
      .select('domain, company_name')
      .in('id', slice);
    for (const row of (data ?? []) as Array<{ domain: string | null; company_name: string | null }>) {
      const d = cleanCompanyDomain(row.domain);
      if (d) domains.add(d);
      const n = normalizeLower(row.company_name);
      if (n) names.add(n);
    }
  }

  return { domains, names };
}

/** True when this row matches a company the user already owns. */
export function isOwnedCompany(row: CompanyImportRow, owned: OwnedCompanyKeys): boolean {
  const domain = cleanCompanyDomain(row.company_domain);
  if (domain && owned.domains.has(domain)) return true;
  const name = normalizeLower(row.company_name);
  if (name && owned.names.has(name)) return true;
  return false;
}

type LinkResult = {
  companyId: string;
  created: boolean;
  alreadyEnriched: boolean;
  enrichmentStatus: string | null;
  enrichmentStartedAt: string | null;
};

/**
 * Find the canonical company (by domain, else by name) and link it to the
 * workspace, or create a fresh stub. Identity stays sticky — we never overwrite
 * an existing canonical row's name/domain here; enrichment refreshes
 * firmographics. Mirrors the link shape used by import-ingestion + job-change.
 */
export async function findOrCreateCompany(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  orgId: string | null,
  row: CompanyImportRow,
): Promise<LinkResult> {
  const now = new Date().toISOString();
  const domain = cleanCompanyDomain(row.company_domain);
  const name = (row.company_name || '').trim();
  const source = 'company_import';

  const linkCompany = async (companyId: string) => {
    if (orgId) {
      await admin
        .from('org_companies')
        .upsert(
          {
            org_id: orgId,
            company_id: companyId,
            source,
            created_by: userId,
            archived_at: null,
            archived_by: null,
            archived_reason: null,
            updated_at: now,
          },
          { onConflict: 'org_id,company_id' },
        );
    }
    await admin
      .from('user_companies')
      .upsert(
        {
          user_id: userId,
          company_id: companyId,
          source,
          archived_at: null,
          archived_by: null,
          archived_reason: null,
          updated_at: now,
        },
        { onConflict: 'user_id,company_id' },
      );
  };

  // 1. Match an existing canonical row — domain is the strong key, name is the
  //    fallback. Either way we reuse it (merge, never duplicate).
  type ExistingCanonical = {
    id: string;
    last_enriched_at: string | null;
    enrichment_refresh_status: string | null;
    enrichment_refresh_started_at: string | null;
  };
  let existing: ExistingCanonical | null = null;
  if (domain) {
    const { data } = await admin
      .from('companies')
      .select('id, last_enriched_at, enrichment_refresh_status, enrichment_refresh_started_at')
      .eq('domain', domain)
      .maybeSingle();
    existing = (data as ExistingCanonical | null) ?? null;
  }
  if (!existing && name) {
    const { data } = await admin
      .from('companies')
      .select('id, last_enriched_at, enrichment_refresh_status, enrichment_refresh_started_at')
      .ilike('company_name', name)
      .limit(1)
      .maybeSingle();
    existing = (data as ExistingCanonical | null) ?? null;
  }

  if (existing?.id) {
    await linkCompany(existing.id);
    return {
      companyId: existing.id,
      created: false,
      alreadyEnriched: Boolean(existing.last_enriched_at),
      enrichmentStatus: existing.enrichment_refresh_status,
      enrichmentStartedAt: existing.enrichment_refresh_started_at,
    };
  }

  // 2. Create a fresh stub. Minimal fields only; the import route marks it
  //    `requested` after the full batch has reserved credits.
  // NOTE: the canonical `companies` table has NO `source` column — provenance
  // lives on the org_companies / user_companies link rows (set in linkCompany).
  const { data: created, error } = await admin
    .from('companies')
    .insert({
      company_name: name || (domain ? deriveNameFromDomain(domain) : 'Unknown company'),
      domain: domain ?? null,
      linkedin_url: (row.company_linkedin_url || '').trim() || null,
      enrichment_refresh_status: 'idle',
      enrichment_refresh_started_at: null,
    })
    .select('id')
    .single();

  if (error || !created || typeof (created as { id?: unknown }).id !== 'string') {
    throw new Error(`Failed to create company: ${error?.message || 'unknown error'}`);
  }
  const companyId = (created as { id: string }).id;
  await linkCompany(companyId);
  return {
    companyId,
    created: true,
    alreadyEnriched: false,
    enrichmentStatus: 'idle',
    enrichmentStartedAt: null,
  };
}
