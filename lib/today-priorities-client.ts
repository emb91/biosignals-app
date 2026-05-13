/**
 * Client-side fetcher for the /today priorities aggregator.
 *
 * Same caching pattern as `icp-priorities-client.ts` — sessionStorage keyed entry with a
 * short TTL — so re-renders and navigation between pages don't re-run the server-side
 * aggregator (which may invoke Claude for the icp-audit source).
 *
 * Cache is busted from `clearIcpPrioritiesCache()` (in `icp-priorities-client.ts`) when an
 * agent mutation lands, so /today doesn't show stale "Review your ICPs" rows after an edit.
 */

import type { TodayPriority } from '@/lib/priorities/types';

const CACHE_KEY = 'arcova:today-priorities';
const TTL_MS = 15 * 60 * 1000;

interface CachedEntry {
  fetchedAt: number;
  priorities: TodayPriority[];
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

function writeCache(priorities: TodayPriority[]): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CachedEntry = { fetchedAt: Date.now(), priorities };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // ignore
  }
}

export async function fetchTodayPriorities(opts?: { forceRefresh?: boolean }): Promise<TodayPriority[]> {
  if (!opts?.forceRefresh) {
    const cached = readCache();
    if (cached) return cached.priorities;
  }
  try {
    const res = await fetch('/api/today/priorities', { method: 'GET' });
    if (!res.ok) return [];
    const data = await res.json() as { priorities?: TodayPriority[] };
    const priorities = Array.isArray(data.priorities) ? data.priorities : [];
    writeCache(priorities);
    return priorities;
  } catch {
    return [];
  }
}
