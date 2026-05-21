/**
 * SEC EDGAR HTTP client — throttled, validated User-Agent, halt-on-rate-limit.
 *
 * Rules SEC actively enforces (do NOT deviate):
 *  - User-Agent must contain a real contact email; placeholders 403.
 *  - Hard cap 10 req/sec per IP. We throttle to 8 req/sec for margin.
 *  - On 403/429: HALT THE RUN. Retry storms escalate the block from minutes to hours.
 *
 * The throttle is module-level so concurrent callers within a process share
 * the rate budget. Callers that want to skip "missing-day" 403s (e.g. when
 * fetching daily-index files on weekends/holidays — S3 returns 403 for missing
 * keys) should catch `SecHttpError` with status 403 themselves.
 *
 * See: reference_sec_edgar_ingest.md in memory for the full lore.
 */

const THROTTLE_INTERVAL_MS = 1000 / 8; // 8 req/sec
const DEFAULT_TIMEOUT_MS = 30_000;

let lastRequestAt = 0;

export class SecHttpError extends Error {
  status: number;
  url: string;
  isRateLimitHalt: boolean;
  constructor(status: number, url: string, message: string) {
    super(message);
    this.name = 'SecHttpError';
    this.status = status;
    this.url = url;
    // 429 is unambiguously rate limit. 403 can be either rate limit OR a
    // missing S3 key (daily-index on weekend/holiday). The caller decides
    // whether to treat it as a halt or a skip.
    this.isRateLimitHalt = status === 429;
  }
}

let cachedUserAgent: string | null = null;

/**
 * Validate and cache the SEC User-Agent string from env. Throws if missing,
 * a placeholder, or lacks an @. Read env at first use rather than module load
 * so tests/scripts can set the var after import.
 */
export function getSecUserAgent(): string {
  if (cachedUserAgent) return cachedUserAgent;
  const value = (process.env.SEC_REQUEST_HEADER ?? '').trim();
  if (!value) {
    throw new Error(
      'SEC_REQUEST_HEADER is not set. SEC will 403 every request. ' +
        'Set in .env.local as e.g.  SEC_REQUEST_HEADER="Arcova emma@arcova.bio"',
    );
  }
  const lower = value.toLowerCase();
  if (lower.includes('example.com') || lower.includes('example.org') || lower.includes('example.net')) {
    throw new Error(`SEC_REQUEST_HEADER contains a placeholder domain ("${value}"). SEC will 403.`);
  }
  if (!value.includes('@')) {
    throw new Error(`SEC_REQUEST_HEADER missing an email address ("${value}"). SEC will 403.`);
  }
  cachedUserAgent = value;
  return value;
}

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < THROTTLE_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, THROTTLE_INTERVAL_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'www.sec.gov';
  }
}

type FetchOpts = {
  timeoutMs?: number;
  // Accept header for content negotiation. Default covers HTML/JSON/XML.
  accept?: string;
};

async function rawFetch(url: string, opts: FetchOpts = {}): Promise<Response> {
  await throttle();
  const userAgent = getSecUserAgent();
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept-Encoding': 'gzip, deflate',
        Host: hostFromUrl(url),
        Accept: opts.accept ?? 'text/html,application/json,application/xml;q=0.9,*/*;q=0.5',
      },
      signal: controller.signal,
      // Node fetch auto-decodes gzip when Accept-Encoding is set.
    });
    if (response.status === 403 || response.status === 429) {
      throw new SecHttpError(
        response.status,
        url,
        `SEC returned ${response.status} for ${url}. ` +
          (response.status === 429 ? 'Rate limit — halting.' : 'Forbidden — could be rate limit or missing key.'),
      );
    }
    if (!response.ok) {
      throw new SecHttpError(response.status, url, `SEC returned ${response.status} for ${url}`);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export async function secFetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const response = await rawFetch(url, opts);
  return response.text();
}

export async function secFetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T> {
  const response = await rawFetch(url, { ...opts, accept: 'application/json' });
  return (await response.json()) as T;
}

/**
 * Convenience for daily-index URLs where a 403 = "this day's index doesn't
 * exist yet" (weekend, holiday, future date — S3 returns 403 for missing
 * keys when bucket listing is disabled). Returns null in that case so the
 * caller can skip the day. Any other error propagates.
 *
 * NOTE: this DOES NOT mask rate-limit 403s for arbitrary URLs. Use only for
 * daily-index URLs of known shape `…/master.YYYYMMDD.idx`.
 */
export async function secFetchDailyIndex(url: string, opts: FetchOpts = {}): Promise<string | null> {
  try {
    return await secFetchText(url, opts);
  } catch (error) {
    if (error instanceof SecHttpError && (error.status === 403 || error.status === 404)) {
      return null;
    }
    throw error;
  }
}

/**
 * Used by the cron orchestrator to detect "we've been blocked" without
 * coupling the halt logic to each call site.
 */
export function isRateLimitError(error: unknown): boolean {
  return error instanceof SecHttpError && (error.status === 403 || error.status === 429);
}
