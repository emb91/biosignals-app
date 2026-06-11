/**
 * POST /api/me/profile/enrich — self-profile enrichment.
 *
 * Finds the caller's LinkedIn from their email + the org's company domain (+ a name
 * derived from the email if we don't have one), scrapes the public profile, and saves it.
 * Runs once per user automatically the first time (it sets enrichment_attempted_at);
 * pass ?force=1 to re-run on demand. The minimum we need is the email — company comes
 * from the email domain (or the org profile), and a name candidate from the email itself.
 */
import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/org-context';
import { createAdminClient } from '@/lib/supabase-admin';
import { enrichSelfProfile } from '@/lib/profile-enrichment-by-email';

/** "jane.doe@co.com" → "Jane Doe" — a usable name candidate when we only have an email. */
function nameFromEmail(email: string | null | undefined): string | null {
  const local = email?.split('@')[0]?.trim();
  if (!local) return null;
  const words = local
    .replace(/\d+/g, ' ')
    .split(/[._\-+]+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.length ? words.join(' ') : null;
}

export async function POST(request: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const force = new URL(request.url).searchParams.get('force') === '1';
  const admin = createAdminClient();

  // Existing self-profile (for an already-entered LinkedIn URL + name).
  const { data: profile } = await admin
    .from('user_profiles')
    .select('full_name, linkedin_url, enrichment_attempted_at, person_id')
    .eq('user_id', ctx.user.id)
    .maybeSingle<{ full_name: string | null; linkedin_url: string | null; enrichment_attempted_at: string | null; person_id: string | null }>();

  // Idempotent: we only auto-run this once. If it's already been attempted (or a profile
  // is linked), no-op unless the caller explicitly forces a refresh. Safe to call from
  // multiple triggers (first login, profile page).
  if (!force && (profile?.enrichment_attempted_at || profile?.person_id)) {
    return NextResponse.json({ ok: true, skipped: 'already_attempted' });
  }

  // Company domain: the org's profile (any member's user_company), else the email domain.
  const { data: members } = await admin.from('org_members').select('user_id').eq('org_id', ctx.orgId);
  const memberIds = (members ?? []).map((m) => (m as { user_id: string }).user_id);
  let companyDomain: string | null = null;
  if (memberIds.length > 0) {
    const { data: uc } = await admin
      .from('user_company')
      .select('domain')
      .in('user_id', memberIds)
      .not('domain', 'is', null)
      .limit(1)
      .maybeSingle<{ domain: string | null }>();
    companyDomain = uc?.domain ?? null;
  }
  if (!companyDomain && ctx.user.email?.includes('@')) {
    companyDomain = ctx.user.email.split('@')[1] ?? null;
  }

  // Mark the attempt up front so an empty result doesn't auto-retry on every page load
  // (the user can still trigger a manual refresh).
  await admin
    .from('user_profiles')
    .upsert(
      { user_id: ctx.user.id, org_id: ctx.orgId, email: ctx.user.email, enrichment_attempted_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );

  // Name: the user's own edit > a real name on the account > a candidate from the email.
  // Email alone is enough — the name just helps the web search confirm the right person.
  const metaFull = (ctx.user.user_metadata?.full_name as string | undefined)?.trim() || null;
  const result = await enrichSelfProfile({
    userId: ctx.user.id,
    email: ctx.user.email ?? null,
    fullName: profile?.full_name ?? metaFull ?? nameFromEmail(ctx.user.email),
    companyDomain,
    linkedinUrl: profile?.linkedin_url ?? null,
  });

  if (!result.ok) {
    const messages: Record<string, string> = {
      no_linkedin: "Couldn't find your LinkedIn. Add your LinkedIn URL and try again.",
      scrape_failed: "Found your LinkedIn but couldn't read the profile. Try again shortly.",
      write_failed: 'Could not save your profile.',
    };
    return NextResponse.json({ error: messages[result.reason] ?? 'Enrichment failed' }, { status: 422 });
  }

  return NextResponse.json({ ok: true });
}
