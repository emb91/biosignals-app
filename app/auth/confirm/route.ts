import { createClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'

/**
 * GET /auth/confirm — lands all Supabase EMAIL links (invite, signup
 * confirmation, magic link, recovery).
 *
 * Why this exists: the default {{ .ConfirmationURL }} email links go through
 * supabase.co/auth/v1/verify, which redirects with the session in the URL
 * FRAGMENT — invisible to any server route, so /auth/callback (built for
 * OAuth's ?code) dropped every email login on the floor and users dead-ended
 * at /login. This route implements the token_hash pattern instead: the email
 * template links HERE directly with ?token_hash={{ .TokenHash }}&type=…, and
 * verifyOtp() establishes the session server-side via cookies.
 *
 * REQUIRES the Supabase email templates (dashboard → Auth → Email Templates)
 * to link to:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/today   (Invite user)
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/today    (Confirm signup)
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password (Reset password)
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/today'

  if (tokenHash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    console.error('[auth/confirm] verifyOtp failed:', error.message)
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
