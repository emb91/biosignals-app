/**
 * Client-side fetcher for the /today priorities aggregator.
 *
 * Every source is now a cheap DB read (the ICP row reads a persisted note rather than
 * running an audit), so there's no LLM cost to avoid and no hash short-circuit needed.
 * We just fetch fresh each load and keep a small sessionStorage copy as an offline /
 * failed-request fallback.
 *
 * The cache is also cleared by `clearIcpPrioritiesCache()` (in `icp-priorities-client.ts`)
 * when an agent mutation lands.
 */

import type { TodayPriority } from '@/lib/priorities/types';

// Version the cache when priority eligibility rules change so an old fallback
// cannot resurrect items the server now deliberately excludes.
const CACHE_KEY = 'arcova:today-priorities:v2';
// Just a stale-bound for the offline fallback copy; the server read is the real freshness.
const TTL_MS = 24 * 60 * 60 * 1000;

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
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), priorities }));
  } catch {
    // ignore
  }
}

export async function fetchTodayPriorities(): Promise<TodayPriority[]> {
  const cached = readCache();
  try {
    const res = await fetch('/api/today/priorities', { method: 'GET', cache: 'no-store' });
    if (!res.ok) return cached?.priorities ?? [];
    const data = (await res.json()) as { priorities?: TodayPriority[] };
    const priorities = Array.isArray(data.priorities) ? data.priorities : [];
    writeCache(priorities);
    return priorities;
  } catch {
    return cached?.priorities ?? [];
  }
}
