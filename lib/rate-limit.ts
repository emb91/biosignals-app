import { createAdminClient } from '@/lib/supabase-admin';

/**
 * DB-backed fixed-window rate limit. Serverless functions have no shared
 * memory, so an in-process counter can't enforce a global limit — this uses a
 * Postgres counter (api_rate_limits) incremented atomically per window.
 *
 * Fails OPEN: any error → allowed. A rate limiter must never take down a
 * feature when its own store hiccups.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  options: { failOpen?: boolean } = {},
): Promise<{ allowed: boolean; hits: number }> {
  const failOpen = options.failOpen ?? true;
  try {
    const windowId = Math.floor(Date.now() / 1000 / windowSeconds);
    const bucket = `${key}:${windowId}`;
    const expires = new Date((windowId + 1) * windowSeconds * 1000).toISOString();

    const admin = createAdminClient();
    const { data, error } = await admin.rpc('api_rate_limit_hit', { p_bucket: bucket, p_expires: expires });
    if (error) {
      console.error(`[rate-limit] hit failed (${failOpen ? 'allowing' : 'blocking'}):`, error);
      return { allowed: failOpen, hits: 0 };
    }
    const hits = typeof data === 'number' ? data : 0;
    return { allowed: hits <= limit, hits };
  } catch (error) {
    console.error(`[rate-limit] failed (${failOpen ? 'allowing' : 'blocking'}):`, error);
    return { allowed: failOpen, hits: 0 };
  }
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}
