/**
 * fetch() wrapper with timeout + automatic retry on transient failures.
 *
 * Retries on:
 *   - Network errors (AbortError from timeout, ECONNRESET, etc.)
 *   - HTTP 429 (rate-limited) — honors Retry-After header up to a cap
 *   - HTTP 5xx (server errors)
 *
 * Does NOT retry on 4xx other than 429 — those are usually our bug.
 *
 * Used by the clinical-trials and FDA signal monitors so a transient hiccup
 * doesn't fail the whole company permanently for that run.
 */

type FetchWithRetryOptions = RequestInit & {
  timeoutMs?: number;
  maxRetries?: number;
  /** Cap on how long we'll wait for a Retry-After header value, in ms. */
  maxRetryAfterMs?: number;
  /** Optional label for log lines so we can tell different callers apart. */
  label?: string;
  /**
   * Optional rate limiter — when set, the caller waits until a token is
   * available before making the request. Used by signal monitors to stay
   * under each upstream API's per-minute limit (OpenFDA: 240/min with key,
   * ClinicalTrials.gov: ~50/sec polite default).
   */
  rateLimiter?: TokenBucket;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_RETRY_AFTER_MS = 30_000;
const BASE_BACKOFF_MS = 500;

/**
 * Simple token-bucket limiter. Refills continuously at `refillPerSecond`
 * and caps stored tokens at `capacity`. Each `acquire()` consumes one token,
 * waiting if none are available.
 *
 * Per-process scope. If you ever run multiple Vercel function instances in
 * parallel, this is a soft limit — for true global rate limiting at scale,
 * swap in a Redis/Supabase-backed bucket. For current scale, in-process is
 * enough because each user-triggered run is serial.
 */
export class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private lastRefill: number;
  private readonly label: string;

  constructor(opts: { capacity: number; refillPerSecond: number; label?: string }) {
    this.capacity = opts.capacity;
    this.tokens = opts.capacity;
    this.refillPerSecond = opts.refillPerSecond;
    this.lastRefill = Date.now();
    this.label = opts.label ?? 'unnamed';
  }

  async acquire(): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.max(50, Math.ceil(1000 / this.refillPerSecond));
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
      this.lastRefill = now;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null, capMs: number): number | null {
  if (!header) return null;
  const asInt = Number(header);
  if (Number.isFinite(asInt)) {
    return Math.min(Math.max(0, asInt * 1000), capMs);
  }
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) {
    return Math.min(Math.max(0, asDate - Date.now()), capMs);
  }
  return null;
}

export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    maxRetryAfterMs = DEFAULT_MAX_RETRY_AFTER_MS,
    label,
    rateLimiter,
    ...fetchInit
  } = options;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (rateLimiter) await rateLimiter.acquire();
    let response: Response;
    try {
      response = await fetch(url, {
        ...fetchInit,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      lastError = err;
      // Network error / timeout — retry unless we're out of attempts.
      if (attempt === maxRetries) throw err;
      const wait = BASE_BACKOFF_MS * 2 ** attempt;
      if (label) console.warn(`[fetchWithRetry] ${label} attempt ${attempt + 1} failed (network): retrying in ${wait}ms`);
      await sleep(wait);
      continue;
    }

    if (response.ok) return response;

    // 429: honor Retry-After if present, else exponential backoff.
    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'), maxRetryAfterMs);
      const wait = retryAfter ?? BASE_BACKOFF_MS * 2 ** attempt;
      if (label) console.warn(`[fetchWithRetry] ${label} 429 rate-limited; sleeping ${wait}ms before retry`);
      await sleep(wait);
      continue;
    }

    // 5xx: server error — retry with backoff.
    if (response.status >= 500 && response.status < 600 && attempt < maxRetries) {
      const wait = BASE_BACKOFF_MS * 2 ** attempt;
      if (label) console.warn(`[fetchWithRetry] ${label} ${response.status} server error; retrying in ${wait}ms`);
      await sleep(wait);
      continue;
    }

    // Any other non-OK: don't retry, return the response so caller can decide.
    return response;
  }

  // Should be unreachable — loop either returns or throws — but TS doesn't know that.
  throw lastError instanceof Error ? lastError : new Error('fetchWithRetry exhausted retries');
}
