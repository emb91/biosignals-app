/**
 * Shared fetch for conference adapters.
 *
 * Some platforms (a2z / Personify, DCAT) return 403 to a non-browser User-Agent,
 * so the default here is a realistic browser UA + Accept header. Adapters that
 * prefer an honest identifying UA (Conference Harvester works with one) can pass
 * their own headers — these are only defaults.
 *
 * NOTE: a browser UA only gets past UA-gating; it is NOT a license to ingest.
 * Permission is enforced per-show via the `conferences` registry `tos_status`
 * (some shows, e.g. PDA, prohibit list redistribution). That gate is the real
 * control — see docs/conference-sources.md.
 */
export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const DEFAULT_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

export function conferenceFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('User-Agent')) headers.set('User-Agent', BROWSER_UA);
  if (!headers.has('Accept')) headers.set('Accept', DEFAULT_ACCEPT);
  return fetch(url, { ...init, headers });
}
