/**
 * POST /api/auth/reset — start a password reset.
 *
 * Body: { email }. Always responds { ok: true } regardless of whether the email
 * exists (no account enumeration). When Resend is configured we generate the
 * recovery link ourselves and email a short ?code to /auth/confirm (same path as
 * invites — bypasses Supabase's rate limit + broken template, delivers from the
 * verified domain). Falls back to Supabase's own sender otherwise.
 *
 * Rate-limited per email (counts recent unconsumed recovery codes) so the
 * endpoint can't be used to email-bomb a known address — a real concern given
 * this is public and unauthenticated.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';
import { isResendConfigured, sendAuthEmail, buildPasswordResetEmail } from '@/lib/auth-email';
import { createAuthLinkCode } from '@/lib/auth-links';

const MAX_RESETS_PER_HOUR = 5;
// Fresh response per call — a NextResponse body can only be consumed once, so a
// shared module-level instance would break across concurrent requests.
const genericOk = () => NextResponse.json({ ok: true });

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const admin = createAdminClient();

  // Per-email rate limit (anti email-bomb). Counts recovery codes minted in the
  // last hour; consumed codes are deleted, so clicking a real link frees a slot.
  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from('auth_email_codes')
    .select('code', { count: 'exact', head: true })
    .eq('email', email)
    .eq('otp_type', 'recovery')
    .gte('created_at', sinceIso);
  if ((count ?? 0) >= MAX_RESETS_PER_HOUR) return genericOk(); // silently drop; don't reveal

  if (isResendConfigured()) {
    // generateLink errors for unknown emails — swallow it so we don't enumerate.
    const { data: gen, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
    if (error || !gen?.properties?.hashed_token) return genericOk();

    const code = await createAuthLinkCode({
      tokenHash: gen.properties.hashed_token,
      otpType: 'recovery',
      next: '/reset-password',
      email,
    });
    const resetUrl = `${appUrl}/auth/confirm?code=${code}`;
    const mail = buildPasswordResetEmail({ resetUrl });
    await sendAuthEmail({ to: email, subject: mail.subject, html: mail.html });
    return genericOk();
  }

  // Fallback: Supabase's own sender (requires its recovery template to point at
  // /auth/confirm — see EMAIL_SETUP.md Part A).
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${appUrl}/reset-password` });
  return genericOk();
}
