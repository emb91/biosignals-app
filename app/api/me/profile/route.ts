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
import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url-resolver';
import { enrichSelfProfile } from '@/lib/profile-enrichment-by-email';

type ProfileRow = {
  user_id: string;
  org_id: string | null;
  person_id: string | null;
  email: string | null;
  full_name: string | null;
  role_title: string | null;
  linkedin_url: string | null;
  phone: string | null;
  location: string | null;
  company_name: string | null;
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
    .select('user_id, org_id, person_id, email, full_name, role_title, linkedin_url, phone, location, company_name, edited_fields, enriched_at, enrichment_attempted_at')
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
    phone: profile?.phone ?? null,
    location: profile?.location ?? person?.location ?? null,
    company_name: profile?.company_name ?? person?.resolved_current_company_name ?? null,
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
    phone?: string;
    location?: string;
    company_name?: string;
  } | null;
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('user_profiles')
    .select('edited_fields, linkedin_url, full_name, company_name')
    .eq('user_id', ctx.user.id)
    .maybeSingle<{ edited_fields: Record<string, boolean> | null; linkedin_url: string | null; full_name: string | null; company_name: string | null }>();

  const edited = { ...(existing?.edited_fields ?? {}) };
  const patch: Record<string, unknown> = {
    user_id: ctx.user.id,
    org_id: ctx.orgId,
    email: ctx.user.email,
    updated_at: new Date().toISOString(),
  };

  // LinkedIn URL is handled separately below (it's verified, not blindly saved).
  // Only fields the user actually sent become source-of-truth (marked in edited_fields).
  for (const key of ['full_name', 'role_title', 'phone', 'location', 'company_name'] as const) {
    if (typeof body[key] === 'string') {
      const v = body[key]!.trim();
      patch[key] = v || null;
      if (v) edited[key] = true;
    }
  }

  // LinkedIn URL: don't trust it on faith. If the user changes it, verify the link
  // resolves to a real, scrapeable profile (and re-enrich off it). If it's malformed or
  // dead, keep their previous URL and tell them — never silently store a bogus link.
  const oldLinkedin = existing?.linkedin_url ?? null;
  let linkedinWarning: string | null = null;
  let reEnriched = false;
  if (typeof body.linkedin_url === 'string') {
    const raw = body.linkedin_url.trim();
    const normNew = normalizeLinkedinProfileUrl(raw);
    const normOld = normalizeLinkedinProfileUrl(oldLinkedin);
    const changed = (normNew ?? (raw || null)) !== (normOld ?? oldLinkedin ?? null);

    if (!raw) {
      // Cleared on purpose — allowed, no verification needed.
      patch.linkedin_url = null;
      delete edited.linkedin_url;
    } else if (!changed) {
      // Same link as before — keep it, no need to re-scrape.
      patch.linkedin_url = normNew ?? raw;
      edited.linkedin_url = true;
    } else if (!normNew) {
      // Doesn't even look like a LinkedIn profile URL — reject, keep the old one.
      linkedinWarning = "That doesn't look like a LinkedIn profile URL, so we kept your previous link.";
    } else {
      // Looks valid — verify it's a real profile by re-enriching off it.
      const result = await enrichSelfProfile({
        userId: ctx.user.id,
        email: ctx.user.email ?? null,
        fullName: (typeof body.full_name === 'string' ? body.full_name.trim() : null) || existing?.full_name || null,
        companyName: (typeof body.company_name === 'string' ? body.company_name.trim() : null) || existing?.company_name || null,
        companyDomain: ctx.user.email?.split('@')[1] ?? null,
        linkedinUrl: normNew,
      });
      if (result.ok) {
        // enrichSelfProfile already wrote linkedin_url + relinked the person + refreshed
        // the bio. Just mark it edited so future auto-enrichment won't override it.
        patch.linkedin_url = result.linkedinUrl;
        edited.linkedin_url = true;
        reEnriched = true;
      } else {
        linkedinWarning =
          "We couldn't find a LinkedIn profile at that link, so we kept your previous one. Double-check the URL and try again.";
      }
    }
  }

  patch.edited_fields = edited;

  const { error } = await admin.from('user_profiles').upsert(patch, { onConflict: 'user_id' });
  if (error) {
    console.error('[me/profile PUT] upsert failed:', error);
    return NextResponse.json({ error: 'Could not save profile' }, { status: 500 });
  }
  // Other fields saved fine, but the LinkedIn change was rejected — surface that so the UI
  // can reset the field to the previous value and show the reason.
  if (linkedinWarning) {
    return NextResponse.json(
      { ok: true, linkedinReverted: true, linkedin_url: oldLinkedin, warning: linkedinWarning },
      { status: 200 },
    );
  }
  return NextResponse.json({ ok: true, reEnriched });
}
