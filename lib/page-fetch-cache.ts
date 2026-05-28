/**
 * Module-level fetch cache for list-page data (accounts, contacts).
 *
 * Problem solved: pages like /leads/accounts and /leads/contacts re-fetch
 * their entire data set on every mount. Switching tabs and coming back
 * forces a full network round-trip even when the data hasn't changed.
 *
 * This cache lives at module scope, so it survives component unmount /
 * remount on client-side navigation. Hard refresh or new tab still bypasses
 * it (cache is in-memory only, not persisted).
 *
 * Default TTL is 60s. Pages should call `invalidateCache(prefix)` after
 * mutations so the next fetch is fresh.
 */

type Entry<T> = { data: T; fetchedAt: number };

const store = new Map<string, Entry<unknown>>();

const DEFAULT_TTL_MS = 60_000;

export type CachedJsonResult<T> = {
  data: T;
  /** True if served from cache (no network round-trip). */
  fromCache: boolean;
};

/**
 * Fetch a JSON endpoint with module-level caching. Returns cached data if
 * the entry exists and is younger than `ttlMs`, otherwise fetches and stores.
 *
 * Caller is responsible for handling non-OK responses (this function throws
 * on `res.ok === false` so the page's try/catch still works).
 */
export async function cachedJson<T>(
  url: string,
  opts: { ttlMs?: number; init?: RequestInit } = {},
): Promise<CachedJsonResult<T>> {
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();
  const hit = store.get(url) as Entry<T> | undefined;

  if (hit && now - hit.fetchedAt < ttl) {
    return { data: hit.data, fromCache: true };
  }

  const res = await fetch(url, opts.init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const data = (await res.json()) as T;
  store.set(url, { data, fetchedAt: now });
  return { data, fromCache: false };
}

/**
 * Drop cache entries whose URL starts with `prefix`. Call after mutations
 * (edit, archive, etc.) to ensure the next page load shows fresh data.
 *
 * Examples:
 *   invalidateCache('/api/accounts')   // all accounts list responses
 *   invalidateCache('/api/leads')      // all leads list responses
 *   invalidateCache()                  // everything
 */
export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const k of [...store.keys()]) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}
