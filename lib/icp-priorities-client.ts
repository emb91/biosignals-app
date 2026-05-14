/**
 * Client-side cache for ICP audit priorities used in the agent inbox on `/icps`.
 *
 * /today now reads the aggregator at `/api/today/priorities` (grouped form), which has its
 * own server-side life. This module is unchanged from its original purpose — fetch the raw
 * individual items needed for the agent panel inbox — and uses `sessionStorage` so a tab
 * doesn't re-run the Claude audit on every visit.
 *
 * After the agent mutates an ICP, call `clearIcpPrioritiesCache()` to bust the cache and
 * force the next call to re-fetch fresh.
 */

export type IcpPriorityKind = 'overlap' | 'gap' | 'too_broad' | 'too_narrow' | 'rename' | 'other';
export type IcpPrioritySeverity = 'low' | 'medium' | 'high';

export interface IcpPriority {
  id: string;
  kind: IcpPriorityKind;
  severity: IcpPrioritySeverity;
  headline: string;
  detail: string;
  cta: { label: string; seedPrompt: string };
  icpIds: string[];
  icpLabels: string[];
}

const CACHE_KEY = 'arcova:icp-priorities';
// Long TTL — the server-side hash check is the real source of freshness. The TTL just
// catches edge cases (prompt changes, app updates, manual sessionStorage rot).
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DISMISSED_KEY = 'arcova:icp-dismissed-priorities';

interface CachedEntry {
  fetchedAt: number;
  priorities: IcpPriority[];
  /** Server-returned hash of the ICP set + company + dismissals. Sent back on the next
      fetch so the server can short-circuit the Claude call when nothing has changed. */
  hash: string;
}

function readCache(): CachedEntry | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    if (!parsed || typeof parsed.fetchedAt !== 'number' || !Array.isArray(parsed.priorities)) return null;
    if (Date.now() - parsed.fetchedAt > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(priorities: IcpPriority[], hash: string): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CachedEntry = { fetchedAt: Date.now(), priorities, hash };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // sessionStorage may be unavailable (Safari private, etc.) — ignore.
  }
}

export function getDismissedPriorityIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = sessionStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

/**
 * Dismiss a priority. Hides it in the UI immediately (sessionStorage) and writes to the
 * server so /today stays in sync — dismissed items won't appear on /today either.
 */
export function dismissPriority(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getDismissedPriorityIds();
    current.add(id);
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...current]));
  } catch {
    // ignore
  }
  void fetch('/api/agent/dismiss-priority', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, source: 'icp-audit' }),
  }).catch(() => {});
  clearIcpPrioritiesCache();
}

/**
 * Clear all dismissals (session + DB) and bust the cache so the next fetch re-surfaces
 * all findings. Called by the Re-audit button — resets /today alignment too.
 */
export async function clearIcpAuditDismissals(): Promise<void> {
  if (typeof window !== 'undefined') {
    try { sessionStorage.removeItem(DISMISSED_KEY); } catch { /* ignore */ }
  }
  try {
    await fetch('/api/agent/dismiss-priority?source=icp-audit', { method: 'DELETE' });
  } catch { /* ignore */ }
  clearIcpPrioritiesCache();
}

export function clearIcpPrioritiesCache(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(CACHE_KEY);
    // Today's aggregator also caches in its own key — keep them in sync.
    sessionStorage.removeItem('arcova:today-priorities');
  } catch {
    // ignore
  }
}

/**
 * Fetches the raw individual ICP-audit items used by the agent inbox on `/icps`.
 *
 * Sends the cached `hash` so the server can short-circuit the Claude call when the ICP
 * set / company profile / dismissals haven't changed. Three flows:
 *
 *   1. No cache locally → server runs the audit, returns priorities + new hash.
 *   2. Cache + matching hash → server responds `{ unchanged: true }`, we keep the cache.
 *   3. Cache + different hash → server runs the audit, returns priorities + new hash, we overwrite.
 *
 * `forceRefresh: true` bypasses the hash check (e.g. the Re-audit this page button).
 */
export async function fetchIcpPriorities(opts?: { forceRefresh?: boolean }): Promise<IcpPriority[]> {
  const cached = readCache();
  if (!opts?.forceRefresh && cached) {
    // Optimistically return cached value; concurrently ask the server whether the inputs
    // have changed. If they have, the next call will pick up the fresh result.
    // (For simplicity we await the round-trip here — the server response is fast when
    // it's just a hash check; only the cache-miss path runs Claude.)
  }
  try {
    const res = await fetch('/api/agent/icp-priorities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        knownHash: cached?.hash ?? '',
        forceRefresh: opts?.forceRefresh === true,
      }),
    });
    if (!res.ok) return cached?.priorities ?? [];
    const data = await res.json() as {
      priorities?: IcpPriority[];
      unchanged?: boolean;
      hash?: string;
    };
    if (data.unchanged && cached) {
      // Inputs haven't changed; keep our cached priorities (and refresh the TTL).
      writeCache(cached.priorities, cached.hash);
      return cached.priorities;
    }
    const priorities = Array.isArray(data.priorities) ? data.priorities : [];
    if (typeof data.hash === 'string') writeCache(priorities, data.hash);
    return priorities;
  } catch {
    return cached?.priorities ?? [];
  }
}
