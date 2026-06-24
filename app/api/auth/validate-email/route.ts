/**
 * POST /api/auth/validate-email — { email } → { allow, status?, reason? }
 *
 * Pre-signup deliverability check (ZeroBounce). The signup form calls this
 * before creating the account, so we don't ask Supabase to email an
 * undeliverable address (bounces hurt sender reputation). Fails open.
 *
 * Public + spends ~1 ZeroBounce credit per conclusive check, so it's per-IP
 * rate-limited. Over the limit we SKIP validation (allow) rather than block —
 * the limit protects credits, not signup security (that's Supabase's job).
 */
import { NextResponse } from 'next/server';
import { validateSignupEmail } from '@/lib/email-validation';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

const MAX_PER_IP_PER_HOUR = 30;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ allow: false, reason: 'Please enter a valid email address.' });
  }
  if (process.env.NODE_ENV !== 'production') {
    return NextResponse.json({ allow: true, status: null });
  }

  const { allowed } = await checkRateLimit(`validate-email:${clientIp(request)}`, MAX_PER_IP_PER_HOUR, 3600);
  if (!allowed) return NextResponse.json({ allow: true, status: null }); // skip the paid check, don't block signup

  return NextResponse.json(await validateSignupEmail(email));
}
