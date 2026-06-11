/**
 * POST /api/me/profile/enrich — controlled self-profile enrichment ("Find my profile").
 *
 * Resolves the caller's LinkedIn from their email + the org's company domain, scrapes
 * the public profile, upserts a canonical `people` row, and links it to user_profiles.
 * Button-triggered only — spends Apify + LLM credits.
 */
import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/org-context';
import { createAdminClient } from '@/lib/supabase-admin';
import { getDisplayName } from '@/lib/auth-helpers';
import { enrichSelfProfile } from '@/lib/profile-enrichment-by-email';

export async function POST() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  // Existing self-profile (for an already-entered LinkedIn URL + name).
  const { data: profile } = await admin
    .from('user_profiles')
    .select('full_name, linkedin_url')
    .eq('user_id', ctx.user.id)
    .maybeSingle<{ full_name: string | null; linkedin_url: string | null }>();

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

  const displayName = getDisplayName(ctx.user);
  const result = await enrichSelfProfile({
    userId: ctx.user.id,
    email: ctx.user.email ?? null,
    fullName: profile?.full_name ?? (displayName !== 'User' ? displayName : null),
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
