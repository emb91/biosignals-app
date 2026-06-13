import { recordProviderUsage, zerobounceValidationBillableQuantity } from '@/lib/provider-usage';

/**
 * Pre-send deliverability check for signup, via ZeroBounce (same provider the
 * contact pipeline already uses). This is the real fix for signup bounces —
 * blocking undeliverable addresses before we ask Supabase to email them keeps
 * our sender reputation clean (a high bounce rate gets the sending domain
 * throttled/suspended, by Supabase OR Resend).
 *
 * Policy: block only what ZeroBounce is CONFIDENT is bad (invalid / spamtrap /
 * abuse / do_not_mail). Allow valid / catch-all / unknown — never reject a
 * legitimate user on an inconclusive result.
 *
 * FAILS OPEN: missing key, error, or timeout → allow. Validation reduces
 * bounces; it must never be the thing that blocks real signups when the
 * provider is down. Costs ~1 ZeroBounce credit per conclusive check.
 */

const BLOCK_STATUSES = new Set(['invalid', 'spamtrap', 'abuse', 'do_not_mail']);

export type SignupEmailCheck = { allow: boolean; status: string | null; reason?: string };

export async function validateSignupEmail(email: string): Promise<SignupEmailCheck> {
  const apiKey = process.env.ZEROBOUNCE_API_KEY;
  if (!apiKey) return { allow: true, status: null };

  try {
    const baseUrl = process.env.ZEROBOUNCE_API_BASE_URL || 'https://api.zerobounce.net/v2/validate';
    const url = new URL(baseUrl);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('email', email);
    url.searchParams.set('timeout', process.env.ZEROBOUNCE_TIMEOUT_SECONDS || '10');

    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
    if (!res.ok || data.error) return { allow: true, status: null }; // fail open

    const status = String(data.status || '').trim().toLowerCase();

    // Cost tracking (fire-and-forget) — unknown isn't billed by ZeroBounce.
    recordProviderUsage({
      provider: 'zerobounce',
      eventType: 'zerobounce_email_validate',
      quantity: zerobounceValidationBillableQuantity(status),
      metadata: { context: 'signup', status },
    }).catch(() => {});

    if (BLOCK_STATUSES.has(status)) {
      return { allow: false, status, reason: 'That email address looks undeliverable — please double-check it.' };
    }
    return { allow: true, status };
  } catch {
    return { allow: true, status: null }; // fail open
  }
}
