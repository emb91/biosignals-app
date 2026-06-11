/**
 * GET/PUT /api/me/profile — the logged-in user's own profile ("My details").
 *
 * Backed by `user_profiles` (the per-user link) + an optional canonical `people` row
 * (shared identity, populated by enrichment). The user's manual edits are the source of
 * truth: PUT records which fields they set in `edited_fields` so a later re-enrichment
 * never clobbers a declared value (sticky-identity pattern).
 *
 * The linked `people` row is read via the admin client (people RLS only exposes contacts
 * you're linked to; a self-profile person isn't a contact), scoped to the caller's own
 * user_profiles.person_id.
 *
 * GET  → { email, full_name, role_title, linkedin_url, enriched, enriched_at, editedFields }
 * PUT  body { full_name?, role_title?, linkedin_url? } → { ok: true }
 */
import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/org-context';
import { createAdminClient } from '@/lib/supabase-admin';
import { getDisplayName } from '@/lib/auth-helpers';

type ProfileRow = {
  user_id: string;
  org_id: string | null;
  person_id: string | null;
  email: string | null;
  full_name: string | null;
  role_title: string | null;
  linkedin_url: string | null;
  edited_fields: Record<string, boolean> | null;
  enriched_at: string | null;
  enrichment_attempted_at: string | null;
};

type EmploymentEntry = { company_name: string | null; title: string | null; start_date: string | null; end_date: string | null; current: boolean };
type PersonRow = {
  full_name: string | null;
  headline: string | null;
  profile_photo_url: string | null;
  location: string | null;
  linkedin_url: string | null;
  job_title: string | null;
  resolved_current_company_name: string | null;
  resolved_current_job_title: string | null;
  contact_bio: string[] | null;
  resolved_employment_history: EmploymentEntry[] | null;
  seniority_level: string | null;
  business_area: string | null;
};

export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await ctx.supabase
    .from('user_profiles')
    .select('user_id, org_id, person_id, email, full_name, role_title, linkedin_url, edited_fields, enriched_at, enrichment_attempted_at')
    .eq('user_id', ctx.user.id)
    .maybeSingle<ProfileRow>();

  let person: PersonRow | null = null;
  if (profile?.person_id) {
    const { data } = await createAdminClient()
      .from('people')
      .select('full_name, headline, profile_photo_url, location, linkedin_url, job_title, resolved_current_company_name, resolved_current_job_title, contact_bio, resolved_employment_history, seniority_level, business_area')
      .eq('id', profile.person_id)
      .maybeSingle<PersonRow>();
    person = data;
  }

  const metadataName = getDisplayName(ctx.user) !== 'User' ? getDisplayName(ctx.user) : null;

  return NextResponse.json({
    email: profile?.email ?? ctx.user.email ?? null,
    full_name: profile?.full_name ?? person?.full_name ?? metadataName,
    role_title: profile?.role_title ?? person?.resolved_current_job_title ?? person?.job_title ?? null,
    linkedin_url: profile?.linkedin_url ?? person?.linkedin_url ?? null,
    enriched: person
      ? {
          headline: person.headline,
          photoUrl: person.profile_photo_url,
          location: person.location,
          companyName: person.resolved_current_company_name,
          jobTitle: person.resolved_current_job_title ?? person.job_title,
          bio: Array.isArray(person.contact_bio) ? person.contact_bio[0] ?? null : null,
          seniority: person.seniority_level,
          businessArea: person.business_area,
          employmentHistory: Array.isArray(person.resolved_employment_history)
            ? person.resolved_employment_history.map((e) => ({
                company: e.company_name,
                title: e.title,
                start: e.start_date,
                end: e.end_date,
                current: e.current,
              }))
            : [],
        }
      : null,
    enrichedAt: profile?.enriched_at ?? null,
    // Whether we've already tried to auto-find this person's profile (so the page only
    // auto-runs it once). Treated as "attempted" if there's already a linked profile.
    enrichmentAttempted: Boolean(profile?.enrichment_attempted_at || profile?.person_id),
    editedFields: profile?.edited_fields ?? {},
  });
}

export async function PUT(request: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    full_name?: string;
    role_title?: string;
    linkedin_url?: string;
  } | null;
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('user_profiles')
    .select('edited_fields')
    .eq('user_id', ctx.user.id)
    .maybeSingle<{ edited_fields: Record<string, boolean> | null }>();

  const edited = { ...(existing?.edited_fields ?? {}) };
  const patch: Record<string, unknown> = {
    user_id: ctx.user.id,
    org_id: ctx.orgId,
    email: ctx.user.email,
    updated_at: new Date().toISOString(),
  };

  // Only fields the user actually sent become source-of-truth (marked in edited_fields).
  for (const key of ['full_name', 'role_title', 'linkedin_url'] as const) {
    if (typeof body[key] === 'string') {
      const v = body[key]!.trim();
      patch[key] = v || null;
      if (v) edited[key] = true;
    }
  }
  patch.edited_fields = edited;

  const { error } = await admin.from('user_profiles').upsert(patch, { onConflict: 'user_id' });
  if (error) {
    console.error('[me/profile PUT] upsert failed:', error);
    return NextResponse.json({ error: 'Could not save profile' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
