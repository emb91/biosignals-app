/**
 * Client-side fetcher for the /today priorities aggregator.
 *
 * Hash-based short-circuit: sends the cached hash on every call; server returns
 * `{ unchanged: true }` when the underlying inputs haven't moved, so the Claude audit is
 * skipped. The Claude call only fires when something has actually changed (a saved ICP,
 * a dismissal, an updated company profile).
 *
 * Cache is also busted by `clearIcpPrioritiesCache()` (in `icp-priorities-client.ts`)
 * when an agent mutation lands, so /today never shows stale "Review your ICPs" rows.
 */

import type { TodayPriority } from '@/lib/priorities/types';

const CACHE_KEY = 'arcova:today-priorities';
// Long TTL — the server-side hash check is the real freshness signal. TTL is the safety
// net for prompt changes / app updates / sessionStorage rot.
const TTL_MS = 24 * 60 * 60 * 1000;

interface CachedEntry {
  fetchedAt: number;
  /** Cheap sources are always refetched; this copy is only an offline/failure fallback. */
  cheap: TodayPriority[];
  /** The Claude ICP-audit row — the only source actually gated by the hash. */
  icp: TodayPriority | null;
  icpHash: string;
}

function readCache(): CachedEntry | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    if (!parsed || typeof parsed.fetchedAt !== 'number' || !Array.isArray(parsed.cheap)) return null;
    if (Date.now() - parsed.fetchedAt > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(cheap: TodayPriority[], icp: TodayPriority | null, icpHash: string): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CachedEntry = { fetchedAt: Date.now(), cheap, icp, icpHash };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // ignore
  }
}

function merge(cheap: TodayPriority[], icp: TodayPriority | null): TodayPriority[] {
  return icp ? [...cheap, icp] : cheap;
}

export async function fetchTodayPriorities(opts?: { forceRefresh?: boolean }): Promise<TodayPriority[]> {
  const cached = readCache();
  try {
    const url = new URL('/api/today/priorities', window.location.origin);
    // Send the cached icp-audit hash so the server can skip the Claude call when unchanged.
    if (!opts?.forceRefresh && cached?.icpHash) url.searchParams.set('h', cached.icpHash);
    const res = await fetch(url.toString(), { method: 'GET' });
    if (!res.ok) return cached ? merge(cached.cheap, cached.icp) : [];
    const data = await res.json() as {
      cheap?: TodayPriority[];
      icp?: TodayPriority | null;
      icpUnchanged?: boolean;
      icpHash?: string;
    };
    const cheap = Array.isArray(data.cheap) ? data.cheap : [];
    // When the audit is unchanged the server omits it — fall back to the cached row.
    const icp = data.icpUnchanged ? (cached?.icp ?? null) : (data.icp ?? null);
    const icpHash = typeof data.icpHash === 'string' ? data.icpHash : (cached?.icpHash ?? '');
    writeCache(cheap, icp, icpHash);
    return merge(cheap, icp);
  } catch {
    return cached ? merge(cached.cheap, cached.icp) : [];
  }
}
