/**
 * Lazy CIK enrichment for companies — populates `companies.cik` from SEC's
 * public `company_tickers.json` registry. Public companies get a CIK match;
 * private companies are left null and fall back to entity_name_normalized
 * matching in the funding monitor.
 *
 * V2 candidate: EDGAR full-text search for private-co Form D filers, so we
 * can pin private companies to a CIK once we've seen them file once.
 *
 * Idempotent — cheap to call repeatedly. Cached for CIK_REFRESH_DAYS.
 */
import type { createAdminClient } from '@/lib/supabase-admin';
import { normalizeCompanyForMatching } from '@/lib/signals/company-name-variants';
import { secFetchJson } from '@/lib/signals/sec-edgar-client';

const CIK_REFRESH_DAYS = 90;
const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';

type SecTickerRow = {
  cik_str?: number;
  ticker?: string;
  title?: string;
};

type SecTickersResponse = Record<string, SecTickerRow>;

type TickerIndex = {
  byNormalizedTitle: Map<string, string>; // normalized title → zero-padded CIK
  loadedAt: number;
};

let cachedIndex: TickerIndex | null = null;
const TICKER_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h is plenty — SEC publishes daily

function padCik(cik: number | string | undefined | null): string | null {
  if (cik === null || cik === undefined) return null;
  const s = String(cik).replace(/[^0-9]/g, '');
  if (!s) return null;
  return s.padStart(10, '0');
}

async function loadTickerIndex(): Promise<TickerIndex> {
  if (cachedIndex && Date.now() - cachedIndex.loadedAt < TICKER_CACHE_TTL_MS) {
    return cachedIndex;
  }
  const data = await secFetchJson<SecTickersResponse>(TICKERS_URL);
  const byNormalizedTitle = new Map<string, string>();
  for (const row of Object.values(data)) {
    const cik = padCik(row.cik_str);
    const title = row.title?.trim();
    if (!cik || !title) continue;
    const norm = normalizeCompanyForMatching(title);
    if (!norm || norm.length < 4) continue;
    // First entry wins on collision — SEC orders by CIK descending in this
    // file but ties are extremely rare for normalized full names.
    if (!byNormalizedTitle.has(norm)) {
      byNormalizedTitle.set(norm, cik);
    }
  }
  cachedIndex = { byNormalizedTitle, loadedAt: Date.now() };
  return cachedIndex;
}

export type EnsureCompanyCikResult = {
  companyId: string;
  cik: string | null;
  source: 'cached' | 'tickers_json' | 'no_match' | 'skipped_unknown';
};

/**
 * Ensure a company has a CIK populated. Returns the existing cached value if
 * fresh (<90 days). Otherwise consults SEC's company_tickers.json and writes
 * back the result (including a "checked but no match" cache via cik=null +
 * cik_checked_at=now).
 */
export async function ensureCompanyCik(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  opts: { refreshIfOlderThanDays?: number; aliases?: string[] } = {},
): Promise<EnsureCompanyCikResult> {
  const { data, error } = await admin
    .from('companies')
    .select('id, company_name, aliases, cik, cik_checked_at')
    .eq('id', companyId)
    .maybeSingle();
  if (error) throw new Error(`load company failed: ${error.message}`);
  if (!data) throw new Error(`company not found: ${companyId}`);
  const row = data as {
    id: string;
    company_name: string | null;
    aliases: string[] | null;
    cik: string | null;
    cik_checked_at: string | null;
  };

  const name = row.company_name?.trim();
  if (!name) {
    return { companyId, cik: null, source: 'skipped_unknown' };
  }

  const refreshAfterDays = opts.refreshIfOlderThanDays ?? CIK_REFRESH_DAYS;
  const checkedAt = row.cik_checked_at ? new Date(row.cik_checked_at).getTime() : 0;
  const ageDays = checkedAt ? (Date.now() - checkedAt) / (1000 * 60 * 60 * 24) : Infinity;
  if (checkedAt > 0 && ageDays < refreshAfterDays) {
    return { companyId, cik: row.cik, source: 'cached' };
  }

  const index = await loadTickerIndex();
  const candidates = [name, ...(opts.aliases ?? row.aliases ?? [])]
    .map((v) => normalizeCompanyForMatching(v))
    .filter((v) => v.length >= 4);

  let resolved: string | null = null;
  for (const candidate of candidates) {
    const cik = index.byNormalizedTitle.get(candidate);
    if (cik) {
      resolved = cik;
      break;
    }
  }

  const { error: updateErr } = await admin
    .from('companies')
    .update({ cik: resolved, cik_checked_at: new Date().toISOString() })
    .eq('id', companyId);
  if (updateErr) throw new Error(`update cik failed: ${updateErr.message}`);

  return {
    companyId,
    cik: resolved,
    source: resolved ? 'tickers_json' : 'no_match',
  };
}

/**
 * Returns the set of zero-padded CIKs known to any company in any user's
 * book. Used by the SEC sync to decide which 8-K filings are worth a
 * primary-doc fetch for items parsing.
 */
export async function loadAllTrackedCiks(
  admin: ReturnType<typeof createAdminClient>,
): Promise<Set<string>> {
  const result = new Set<string>();
  const PAGE_SIZE = 1000;
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await admin
      .from('companies')
      .select('cik')
      .not('cik', 'is', null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`loadAllTrackedCiks: ${error.message}`);
    const rows = (data ?? []) as Array<{ cik: string | null }>;
    for (const r of rows) {
      if (typeof r.cik === 'string' && r.cik) result.add(r.cik);
    }
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return result;
}

export type EnsureTrackedCompanyCiksResult = {
  processed: number;
  resolved: number;
  failed: number;
  failures: Array<{ company_id: string; error: string }>;
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Prime CIKs for active companies before SEC syncs that rely on `companies.cik`
 * for high-precision filtering (notably 8-K item fetching). This keeps the
 * first funding run from missing public-company filings just because the local
 * CIK cache was empty.
 */
export async function ensureTrackedCompanyCiks(
  admin: ReturnType<typeof createAdminClient>,
): Promise<EnsureTrackedCompanyCiksResult> {
  const PAGE_SIZE = 500;
  let from = 0;
  let processed = 0;
  let resolved = 0;
  let failed = 0;
  const failures: Array<{ company_id: string; error: string }> = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await admin
      .from('companies')
      .select('id')
      .is('archived_at', null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`ensureTrackedCompanyCiks: ${error.message}`);

    const rows = (data ?? []) as Array<{ id: string }>;
    for (const row of rows) {
      processed += 1;
      try {
        const result = await ensureCompanyCik(admin, row.id);
        if (result.cik) resolved += 1;
      } catch (entryError) {
        failed += 1;
        failures.push({ company_id: row.id, error: messageFromUnknown(entryError) });
      }
    }

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return {
    processed,
    resolved,
    failed,
    failures,
  };
}
