import { randomBytes } from 'crypto';
import { createAdminClient } from '@/lib/supabase-admin';

/**
 * Short-code indirection for emailed auth links.
 *
 * A Supabase token_hash is 56 hex chars; embedded in a URL it makes a ~120-char
 * link that quoted-printable line-wrapping corrupts in email (the `=` separator
 * and adjacent token chars get mangled, breaking the link). So we never email
 * the token: we store it against a short opaque code and email `?code=<8char>`,
 * which is short enough to never wrap. The code is single-use and expiring.
 */

export type AuthLinkPayload = { tokenHash: string; otpType: string; next: string };

export async function createAuthLinkCode(params: {
  tokenHash: string;
  otpType: string;
  next?: string;
  email?: string | null;
}): Promise<string> {
  const admin = createAdminClient();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    // 6 bytes → 8 base64url chars, no '=' padding, URL-path safe.
    const code = randomBytes(6).toString('base64url');
    const { error } = await admin.from('auth_email_codes').insert({
      code,
      token_hash: params.tokenHash,
      otp_type: params.otpType,
      next: params.next ?? '/today',
      email: params.email ?? null,
    });
    if (!error) return code;
    if (error.code !== '23505') throw new Error(error.message || 'auth link code insert failed');
    // 23505 = code collision (astronomically rare) → retry with a new code
  }
  throw new Error('could not allocate an auth link code');
}

/** Look up + delete (single-use). Returns null if unknown or expired. */
export async function consumeAuthLinkCode(code: string): Promise<AuthLinkPayload | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('auth_email_codes')
    .select('token_hash, otp_type, next, expires_at')
    .eq('code', code)
    .maybeSingle<{ token_hash: string; otp_type: string; next: string; expires_at: string }>();
  if (!data) return null;

  await admin.from('auth_email_codes').delete().eq('code', code);
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return { tokenHash: data.token_hash, otpType: data.otp_type, next: data.next };
}
