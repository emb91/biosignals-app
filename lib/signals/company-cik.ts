/**
 * Eager CIK enrichment for companies — populates `companies.cik` via a
 * three-tier resolution strategy:
 *
 *  Tier 1: SEC `company_tickers.json`  — public companies, instant, free.
 *  Tier 2: EDGAR company browse search — any company that has ever filed
 *           (including private Form D filers). Calls the Atom XML endpoint.
 *  Tier 3: Haiku disambiguation        — only when tier 2 returns multiple
 *           candidates with similar names.
 *
 * Terminal state: null + `cik_checked_at` set = "confirmed no SEC filings" —
 * honest, don't retry for CIK_REFRESH_DAYS.
 *
 * Idempotent — cheap to call repeatedly. Cached for CIK_REFRESH_DAYS.
 */
import type { createAdminClient } from '@/lib/supabase-admin';
import { normalizeCompanyForMatching } from '@/lib/signals/company-name-variants';
import { secFetchJson, secFetchText, isRateLimitError } from '@/lib/signals/sec-edgar-client';
import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';
import { CIK_REFRESH_DAYS, isCikResolutionStale } from '@/lib/signals/cik-staleness';

export { isCikResolutionStale } from '@/lib/signals/cik-staleness';
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

// ── EDGAR browse Atom endpoint ────────────────────────────────────────────
// Covers any company that has ever filed — public or private Form D filers.
// Returns up to `count` results in Atom XML. We use type=D to focus on the
// Form D filers that name-match fallback cares most about; the endpoint works
// for any form type, but limiting to D keeps result sets tight.
const EDGAR_BROWSE_BASE = 'https://www.sec.gov/cgi-bin/browse-edgar';

/**
 * Extract text content of a single XML tag (case-insensitive, with or without
 * namespace prefix, handles nested tags by stripping inner markup).
 * Identical pattern to `extractTagText` in sync-sec-delta.ts.
 */
function extractAtomTagText(xml: string, tagName: string): string | null {
  const re = new RegExp(`<(?:\\w+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tagName}>`, 'i');
  const match = xml.match(re);
  if (!match) return null;
  return match[1]
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

/**
 * Extract all `<entry>` blocks from an Atom feed response.
 */
function extractAtomEntries(xml: string): string[] {
  const entries: string[] = [];
  const re = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    entries.push(match[1]);
  }
  return entries;
}

type EdgarBrowseCandidate = {
  cik: string;
  name: string;
};

/**
 * Tier 2: Query EDGAR company browse for a single name, returning CIK
 * candidates. Uses the Atom XML output format.
 *
 * Throws `SecHttpError` on 403/429 so callers can bubble rate-limit errors.
 * Returns an empty array when EDGAR returns no results or the XML is
 * unparseable.
 */
async function queryEdgarBrowse(name: string): Promise<EdgarBrowseCandidate[]> {
  const params = new URLSearchParams({
    action: 'getcompany',
    company: name,
    CIK: '',
    type: 'D',
    dateb: '',
    owner: 'include',
    count: '10',
    search_text: '',
    output: 'atom',
  });
  const url = `${EDGAR_BROWSE_BASE}?${params.toString()}`;
  const xml = await secFetchText(url);
  const entries = extractAtomEntries(xml);
  const candidates: EdgarBrowseCandidate[] = [];
  for (const entry of entries) {
    // CIK is in <CIK> or inside the URI
    const rawCik = extractAtomTagText(entry, 'CIK');
    const companyName =
      extractAtomTagText(entry, 'company-name') ??
      extractAtomTagText(entry, 'entity-name') ??
      extractAtomTagText(entry, 'name');
    if (!rawCik || !companyName) continue;
    const cik = padCik(rawCik);
    if (!cik) continue;
    candidates.push({ cik, name: companyName });
  }
  return candidates;
}

/**
 * Tier 3: Haiku disambiguation when EDGAR returns multiple candidates and no
 * single one is an exact normalised match. Returns the chosen CIK or null if
 * none match confidently.
 */
export async function disambiguateCikWithHaiku(
  companyName: string,
  domain: string | null,
  candidates: EdgarBrowseCandidate[],
): Promise<string | null> {
  const list = candidates
    .map((c, i) => `${i + 1}. CIK ${c.cik} — "${c.name}"`)
    .join('\n');
  const domainHint = domain ? ` (domain: ${domain})` : '';
  const prompt =
    `I am looking for SEC EDGAR CIK for the company "${companyName}"${domainHint}.\n\n` +
    `The following candidates were returned by EDGAR:\n${list}\n\n` +
    `Which candidate is the correct match? Reply with ONLY the CIK number (10 digits, zero-padded) ` +
    `if you are confident, or "none" if none match or you are unsure.`;

  let result: Awaited<ReturnType<typeof completeLlm>> | null = null;
  try {
    result = await completeLlm({
      feature: 'cik_disambiguation',
      prompt,
      maxTokens: 32,
      temperature: 0,
    });
  } catch (err) {
    console.warn('[cik] Haiku disambiguation failed:', err instanceof Error ? err.message : String(err));
    return null;
  }

  void recordLlmUsageEvent({
    provider: 'anthropic',
    feature: 'cik_disambiguation',
    route: 'lib/signals/company-cik',
    model: result.model,
    usage: result.usage,
  }).catch(() => undefined);

  const text = result.text.trim();
  if (/^none$/i.test(text)) return null;
  // Extract a 10-digit zero-padded CIK from the response
  const cikMatch = text.match(/\b(\d{1,10})\b/);
  if (!cikMatch) return null;
  const chosen = padCik(cikMatch[1]);
  // Verify the chosen CIK is one of the candidates we provided
  if (chosen && candidates.some((c) => c.cik === chosen)) return chosen;
  return null;
}

/**
 * Tier 2 + 3: Resolve a CIK via EDGAR company browse search.
 *
 * - Tries each name variant in order, stopping at the first definitive result.
 * - Single result: return that CIK directly.
 * - Multiple results with an exact normalised match: return that CIK.
 * - Multiple ambiguous results: delegate to Haiku disambiguation (tier 3).
 * - Zero results: try next variant; if all exhausted, return null.
 *
 * Rate limit errors (SecHttpError 403/429) are allowed to propagate — callers
 * must catch them and abort the run, not swallow them.
 */
export async function resolveCompanyCikFromEdgar(
  names: string[],
  domain?: string | null,
): Promise<string | null> {
  const seen = new Set<string>();
  for (const name of names) {
    if (!name?.trim() || seen.has(name.trim())) continue;
    seen.add(name.trim());

    let candidates: EdgarBrowseCandidate[];
    try {
      candidates = await queryEdgarBrowse(name.trim());
    } catch (err) {
      // Bubble rate-limit errors; swallow other transient HTTP errors so one
      // bad variant doesn't abort the whole resolution attempt.
      if (isRateLimitError(err)) throw err;
      console.warn(`[cik] EDGAR browse failed for "${name}":`, err instanceof Error ? err.message : String(err));
      continue;
    }

    if (candidates.length === 0) continue;
    if (candidates.length === 1) return candidates[0].cik;

    // Exact normalised match wins without needing LLM.
    const normName = normalizeCompanyForMatching(name.trim());
    const exact = candidates.find((c) => normalizeCompanyForMatching(c.name) === normName);
    if (exact) return exact.cik;

    // Multiple ambiguous candidates — try Haiku.
    const chosen = await disambiguateCikWithHaiku(name.trim(), domain ?? null, candidates);
    if (chosen) return chosen;
    // Haiku couldn't decide — try next name variant before giving up.
  }
  return null;
}

export type EnsureCompanyCikResult = {
  companyId: string;
  cik: string | null;
  source: 'cached' | 'tickers_json' | 'edgar_browse' | 'no_match' | 'skipped_unknown';
};

/**
 * Ensure a company has a CIK populated. Returns the existing cached value if
 * fresh (<90 days). Otherwise runs a three-tier resolution:
 *
 *  1. SEC `company_tickers.json` — public companies (fast, free, in-memory)
 *  2. EDGAR company browse search — private Form D filers and any other filer
 *  3. Haiku disambiguation — only when tier 2 returns multiple candidates
 *
 * Writes back the result (including null + cik_checked_at = "confirmed no
 * match, don't retry for CIK_REFRESH_DAYS").
 */
export async function ensureCompanyCik(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  opts: { refreshIfOlderThanDays?: number; aliases?: string[] } = {},
): Promise<EnsureCompanyCikResult> {
  const { data, error } = await admin
    .from('companies')
    .select('id, company_name, domain, aliases, cik, cik_checked_at')
    .eq('id', companyId)
    .maybeSingle();
  if (error) throw new Error(`load company failed: ${error.message}`);
  if (!data) throw new Error(`company not found: ${companyId}`);
  const row = data as {
    id: string;
    company_name: string | null;
    domain: string | null;
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

  const nameVariants = [name, ...(opts.aliases ?? row.aliases ?? [])];
  const domain = row.domain ?? null;

  // ── Tier 1: company_tickers.json (public companies) ──────────────────────
  const index = await loadTickerIndex();
  const normalizedVariants = nameVariants
    .map((v) => normalizeCompanyForMatching(v))
    .filter((v) => v.length >= 4);

  let resolved: string | null = null;
  let source: EnsureCompanyCikResult['source'] = 'no_match';

  for (const candidate of normalizedVariants) {
    const cik = index.byNormalizedTitle.get(candidate);
    if (cik) {
      resolved = cik;
      source = 'tickers_json';
      break;
    }
  }

  // ── Tier 2 + 3: EDGAR browse (private cos / Form D filers) ───────────────
  if (!resolved) {
    resolved = await resolveCompanyCikFromEdgar(nameVariants, domain)
      .catch((err) => {
        if (isRateLimitError(err)) throw err;
        console.warn(`[cik] resolveCompanyCikFromEdgar failed for company ${companyId}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
    if (resolved) source = 'edgar_browse';
  }

  const { error: updateErr } = await admin
    .from('companies')
    .update({ cik: resolved, cik_checked_at: new Date().toISOString() })
    .eq('id', companyId);
  if (updateErr) throw new Error(`update cik failed: ${updateErr.message}`);

  return {
    companyId,
    cik: resolved,
    source: resolved ? source : 'no_match',
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

/**
 * Returns the set of normalized company names known to any company. Used by the
 * SEC sync to decide which Form D filings are worth a primary-doc fetch: a Form
 * D whose issuer name matches a tracked company should get its offering amounts
 * and industry_group_type parsed even when we don't yet know its CIK — otherwise
 * the funding monitor sees an index-only row (no amount, no fund filter). Mirrors
 * the >= 4 char guard used by the CIK resolver so the keys line up.
 */
export async function loadAllTrackedNormalizedNames(
  admin: ReturnType<typeof createAdminClient>,
): Promise<Set<string>> {
  const result = new Set<string>();
  const PAGE_SIZE = 1000;
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await admin
      .from('companies')
      .select('company_name')
      .not('company_name', 'is', null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`loadAllTrackedNormalizedNames: ${error.message}`);
    const rows = (data ?? []) as Array<{ company_name: string | null }>;
    for (const r of rows) {
      const norm = normalizeCompanyForMatching(r.company_name ?? '');
      if (norm.length >= 4) result.add(norm);
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
 * Distinct company ids that are actually tracked by some user (org- or
 * user-scoped, non-archived) — the only companies a funding run will query. We
 * scope CIK priming to these instead of every canonical company so the cost
 * stays proportional to what's monitored, not the whole companies table.
 */
async function loadMonitoredCompanyIds(
  admin: ReturnType<typeof createAdminClient>,
): Promise<string[]> {
  const ids = new Set<string>();
  for (const table of ['org_companies', 'user_companies'] as const) {
    const PAGE_SIZE = 1000;
    let from = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await admin
        .from(table)
        .select('company_id')
        .is('archived_at', null)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`loadMonitoredCompanyIds(${table}): ${error.message}`);
      const rows = (data ?? []) as Array<{ company_id: string | null }>;
      for (const r of rows) {
        if (typeof r.company_id === 'string' && r.company_id) ids.add(r.company_id);
      }
      if (rows.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }
  return [...ids];
}

/**
 * Prime CIKs before SEC syncs that rely on `companies.cik` for high-precision
 * filtering (8-K item fetching, Form D primary-doc gate). Scoped to monitored
 * companies, and only the stale ones are resolved — so a steady-state run does a
 * couple of cheap id reads and zero per-company SEC/LLM/DB work once the 90-day
 * cache is warm, instead of touching every canonical company every run.
 */
export async function ensureTrackedCompanyCiks(
  admin: ReturnType<typeof createAdminClient>,
): Promise<EnsureTrackedCompanyCiksResult> {
  let processed = 0;
  let resolved = 0;
  let failed = 0;
  const failures: Array<{ company_id: string; error: string }> = [];

  const monitoredIds = await loadMonitoredCompanyIds(admin);
  if (monitoredIds.length === 0) {
    return { processed, resolved, failed, failures };
  }

  // Batch the staleness check: one chunked read of cik_checked_at, then resolve
  // only the companies that are actually due (those need SEC work anyway).
  const nowMs = Date.now();
  const staleIds: string[] = [];
  for (let i = 0; i < monitoredIds.length; i += 200) {
    const slice = monitoredIds.slice(i, i + 200);
    const { data, error } = await admin
      .from('companies')
      .select('id, cik_checked_at')
      .in('id', slice);
    if (error) throw new Error(`ensureTrackedCompanyCiks staleness read: ${error.message}`);
    for (const r of (data ?? []) as Array<{ id: string; cik_checked_at: string | null }>) {
      if (isCikResolutionStale(r.cik_checked_at, nowMs)) staleIds.push(r.id);
    }
  }

  for (const id of staleIds) {
    processed += 1;
    try {
      const result = await ensureCompanyCik(admin, id);
      if (result.cik) resolved += 1;
    } catch (entryError) {
      failed += 1;
      failures.push({ company_id: id, error: messageFromUnknown(entryError) });
    }
  }

  return { processed, resolved, failed, failures };
}
