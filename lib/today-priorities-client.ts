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
  priorities: TodayPriority[];
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

function writeCache(priorities: TodayPriority[], hash: string): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CachedEntry = { fetchedAt: Date.now(), priorities, hash };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // ignore
  }
}

export async function fetchTodayPriorities(opts?: { forceRefresh?: boolean }): Promise<TodayPriority[]> {
  const cached = readCache();
  try {
    const url = new URL('/api/today/priorities', window.location.origin);
    if (!opts?.forceRefresh && cached?.hash) url.searchParams.set('h', cached.hash);
    const res = await fetch(url.toString(), { method: 'GET' });
    if (!res.ok) return cached?.priorities ?? [];
    const data = await res.json() as {
      priorities?: TodayPriority[];
      unchanged?: boolean;
      hash?: string;
    };
    if (data.unchanged && cached) {
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
