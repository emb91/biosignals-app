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
const TTL_MS = 15 * 60 * 1000; // 15 minutes
const DISMISSED_KEY = 'arcova:icp-dismissed-priorities';

interface CachedEntry {
  fetchedAt: number;
  priorities: IcpPriority[];
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

function writeCache(priorities: IcpPriority[]): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CachedEntry = { fetchedAt: Date.now(), priorities };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // sessionStorage may be unavailable (Safari private, etc.) — ignore.
  }
}

export function getDismissedPriorityIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

/**
 * Dismiss a priority. Writes locally (immediate UI feedback) AND posts to the server so
 * /today and other tabs/devices see the same state. Also busts the caches so the next
 * fetch round-trip pulls the new server-side filtered list.
 */
export function dismissPriority(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getDismissedPriorityIds();
    current.add(id);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...current]));
  } catch {
    // ignore
  }
  // Fire-and-forget server write. If it fails the local store still hides the card; the
  // server filter just won't apply until the next successful dismissal.
  try {
    void fetch('/api/agent/dismiss-priority', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, source: 'icp-audit' }),
    }).catch(() => {});
  } catch {
    // ignore network errors — local hide still works
  }
  // Bust both caches so /today and `/icps` refetch the filtered list next time.
  try {
    sessionStorage.removeItem(CACHE_KEY);
    sessionStorage.removeItem('arcova:today-priorities');
  } catch {
    // ignore
  }
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

/** Fetches the raw individual ICP-audit items used by the agent inbox on `/icps`. */
export async function fetchIcpPriorities(opts?: { forceRefresh?: boolean }): Promise<IcpPriority[]> {
  if (!opts?.forceRefresh) {
    const cached = readCache();
    if (cached) return cached.priorities;
  }
  try {
    const res = await fetch('/api/agent/icp-priorities', { method: 'POST' });
    if (!res.ok) return [];
    const data = await res.json() as { priorities?: IcpPriority[] };
    const priorities = Array.isArray(data.priorities) ? data.priorities : [];
    writeCache(priorities);
    return priorities;
  } catch {
    return [];
  }
}
