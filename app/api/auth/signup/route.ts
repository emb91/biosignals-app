/**
 * POST /api/auth/signup — create an account and send our own confirmation email.
 *
 * Mirrors the invite/reset pattern: we generate the Supabase signup link
 * ourselves (admin generateLink -> token_hash -> short ?code -> /auth/confirm)
 * and deliver it through Resend from the verified domain, instead of letting
 * supabase.auth.signUp trigger Supabase's templated email. generateLink never
 * sends an email, so there is no double-send, and "Enable email confirmations"
 * stays ON, so the new user is unconfirmed until they click the link.
 *
 * Captcha: admin generateLink bypasses Supabase's Turnstile check, so we verify
 * the Turnstile token here ourselves (same as the contact form).
 *
 * Falls back to Supabase's own signUp + sender when Resend is not configured.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';
import { isResendConfigured, sendAuthEmail, buildSignupConfirmEmail } from '@/lib/auth-email';
import { createAuthLinkCode } from '@/lib/auth-links';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ALREADY_EXISTS =
  'An account with this email already exists. Try signing in instead, or use Google if you signed up that way.';

async function verifyTurnstile(token: string | undefined, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  // Enforced in production only (parity with the contact form and prior signup).
  if (process.env.NODE_ENV !== 'production' || !secret) return true;
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: ip,
        idempotency_key: crypto.randomUUID(),
      }),
      signal: AbortSignal.timeout(8_000),
    }).then((r) => r.json() as Promise<{ success?: boolean }>);
    return Boolean(res.success);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { email?: string; password?: string; captchaToken?: string; fullName?: string }
    | null;
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password ?? '';
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  // Per-IP rate limit (anti mass-signup / email-bomb). Fail open so an infra
  // hiccup never blocks a real sign-up.
  const ip = clientIp(request);
  const rate = await checkRateLimit(`signup:${ip}`, 10, 60 * 60, { failOpen: true });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many sign-up attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  if (isResendConfigured()) {
    if (!(await verifyTurnstile(body?.captchaToken, ip))) {
      return NextResponse.json({ error: 'Please complete the security check and try again.' }, { status: 400 });
    }

    const admin = createAdminClient();
    // generateLink(type:'signup') creates the unconfirmed user and returns the
    // confirmation token_hash, without sending any email.
    const { data: gen, error } = await admin.auth.admin.generateLink({
      type: 'signup',
      email,
      password,
    });
    if (error || !gen?.properties?.hashed_token) {
      const msg = (error?.message || '').toLowerCase();
      if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
        return NextResponse.json({ error: ALREADY_EXISTS }, { status: 409 });
      }
      // Surface password-policy / validation errors to the user.
      return NextResponse.json({ error: error?.message || 'Could not create the account.' }, { status: 400 });
    }

    const code = await createAuthLinkCode({
      tokenHash: gen.properties.hashed_token,
      otpType: 'signup',
      next: '/today',
      email,
    });
    const confirmUrl = `${appUrl}/auth/confirm?code=${code}`;
    const mail = buildSignupConfirmEmail({ confirmUrl });
    const sent = await sendAuthEmail({ to: email, subject: mail.subject, html: mail.html });
    if (!sent.ok) {
      console.error('[auth/signup] confirmation email failed:', sent.error);
      // Roll back the just-created unconfirmed user so the customer can retry cleanly.
      if (gen.user?.id) await admin.auth.admin.deleteUser(gen.user.id).catch(() => {});
      return NextResponse.json({ error: 'Could not send the confirmation email. Please try again.' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, needsConfirm: true });
  }

  // Fallback: let Supabase create the user and send its own confirmation email
  // (passes the captcha through to Supabase's Turnstile check).
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      ...(body?.captchaToken ? { captchaToken: body.captchaToken } : {}),
      ...(body?.fullName?.trim() ? { data: { full_name: body.fullName.trim() } } : {}),
    },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // Supabase returns a user with no identities when the email already exists.
  if (data?.user?.identities?.length === 0) {
    return NextResponse.json({ error: ALREADY_EXISTS }, { status: 409 });
  }
  return NextResponse.json({ ok: true, needsConfirm: !data.session });
}
