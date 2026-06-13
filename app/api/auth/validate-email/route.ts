/**
 * POST /api/auth/validate-email — { email } → { allow, status?, reason? }
 *
 * Pre-signup deliverability check (ZeroBounce). The signup form calls this
 * before creating the account, so we don't ask Supabase to email an
 * undeliverable address (bounces hurt sender reputation). Fails open.
 *
 * Note: public + spends ~1 ZeroBounce credit per conclusive check. Add a
 * per-IP rate limit before public launch to bound credit drain (see
 * EMAIL_SETUP.md). Pre-launch there's no traffic to abuse it.
 */
import { NextResponse } from 'next/server';
import { validateSignupEmail } from '@/lib/email-validation';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ allow: false, reason: 'Please enter a valid email address.' });
  }
  return NextResponse.json(await validateSignupEmail(email));
}
