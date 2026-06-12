/**
 * Self-profile enrichment: find a person's LinkedIn from their email + company, scrape
 * their public profile, and upsert a canonical `people` row at the SAME depth a contact
 * gets — WITHOUT creating a contact (a teammate isn't a sales lead). Used by the My
 * Profile page.
 *
 * Reuses the exact contact-enrichment helpers (resolveLinkedinUrl,
 * runApifyProfileEnrichment, buildResolvedContext, generateContactBio, classifyContacts)
 * so the output matches a contact: identity, headline, location, photo, current role,
 * full work history, a generated bio, and standardised title / seniority / business area.
 * Company data is taken from the org's already-enriched profile rather than re-paying for
 * a company lookup. Writes `people` directly by its canonical key (linkedin_url).
 */
import { createAdminClient } from '@/lib/supabase-admin';
import { resolveLinkedinUrl, normalizeLinkedinProfileUrl } from '@/lib/linkedin-url-resolver';
import { runApifyProfileEnrichment, buildResolvedContext, generateContactBio } from '@/lib/enrichment-pipeline';
import { classifyContacts } from '@/lib/contact-classification';
import { recordProviderUsage } from '@/lib/provider-usage';

export type SelfEnrichResult =
  | { ok: true; personId: string; linkedinUrl: string }
  | { ok: false; reason: 'no_linkedin' | 'scrape_failed' | 'write_failed' };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export async function enrichSelfProfile(params: {
  userId: string;
  email: string | null;
  fullName?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  linkedinUrl?: string | null;
}): Promise<SelfEnrichResult> {
  // 1. Resolve LinkedIn (use a provided URL if the user already entered one). Pass the
  // company NAME as well as the domain — the name is a much stronger search signal.
  const provided = normalizeLinkedinProfileUrl(params.linkedinUrl);
  const linkedinUrl =
    provided ??
    (await resolveLinkedinUrl({
      email: params.email,
      full_name: params.fullName,
      company_name: params.companyName,
      company_domain: params.companyDomain,
    })).linkedin_url;

  const normalized = normalizeLinkedinProfileUrl(linkedinUrl);
  if (!normalized) return { ok: false, reason: 'no_linkedin' };

  // 2. Scrape the public profile (Apify). Meter the spend (non-blocking).
  let raw: Record<string, unknown> | null = null;
  try {
    raw = await runApifyProfileEnrichment(normalized);
  } catch {
    raw = null;
  }
  recordProviderUsage({ userId: params.userId, contactId: null, provider: 'apify', eventType: 'apify_profile_scrape' }).catch(() => {});
  if (!raw) return { ok: false, reason: 'scrape_failed' };

  // 2b. Guard against a structurally-valid-but-fake URL (e.g. /in/asdfgh). harvestapi
  //     returns an empty array (→ null above) for a non-existent profile, but can also
  //     return a stub with an `error` field or no identity. If the SCRAPE itself yields
  //     no name/headline/role/photo/history, treat it as not found rather than writing a
  //     blank profile. (Don't fall back to params.fullName here — that's the user's typed
  //     name, which would mask an empty scrape.)
  const currentPositionArr = (raw as { currentPosition?: unknown }).currentPosition;
  const scrapeHasIdentity = Boolean(
    str(raw.fullName) ||
      str(raw.firstName) ||
      str(raw.lastName) ||
      str(raw.headline) ||
      str(raw.photo) ||
      (Array.isArray(currentPositionArr) && currentPositionArr.length > 0),
  );
  if (raw.error || !scrapeHasIdentity) {
    return { ok: false, reason: 'scrape_failed' };
  }

  // 3. Build the same resolved context a contact gets (current role, work history,
  //    headline, location, photo) from the scraped profile.
  const resolved = buildResolvedContext({
    contact: { company_domain: params.companyDomain ?? null, email: params.email },
    apifyProfile: raw,
  });
  const fullName =
    str(raw.fullName) ?? ([str(raw.firstName), str(raw.lastName)].filter(Boolean).join(' ') || null) ?? params.fullName ?? null;

  // 4. Bio + title/seniority/business-area classification (cheap LLM, same as contacts).
  const [bio, classifications] = await Promise.all([
    generateContactBio({
      fullName,
      currentTitle: resolved.currentJobTitle,
      currentCompany: resolved.currentCompanyName ?? params.companyName ?? null,
      headline: resolved.headline,
      employmentHistory: resolved.employmentHistory,
      variant: 'self',
    }),
    classifyContacts(
      [
        {
          full_name: fullName,
          job_title: resolved.currentJobTitle,
          headline: resolved.headline,
          company_name: resolved.currentCompanyName ?? params.companyName ?? null,
          previous_titles: resolved.employmentHistory
            .map((e) => e.title)
            .filter((t): t is string => Boolean(t))
            .slice(0, 5),
        },
      ],
      { userId: params.userId },
    ).catch(() => []),
  ]);
  const classification = classifications[0] ?? null;

  // 5. Upsert the canonical people row by linkedin_url at full depth.
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data: person, error } = await admin
    .from('people')
    .upsert(
      {
        linkedin_url: normalized,
        full_name: fullName,
        first_name: str(raw.firstName),
        last_name: str(raw.lastName),
        headline: resolved.headline,
        location: resolved.location,
        profile_photo_url: resolved.profilePhotoUrl,
        job_title: resolved.currentJobTitle,
        job_title_standardised: classification?.job_title_standardised ?? null,
        seniority_level: classification?.seniority_level ?? null,
        business_area: classification?.business_area ?? null,
        contact_bio: bio ? [bio] : null,
        resolved_current_job_title: resolved.currentJobTitle,
        resolved_current_company_name: resolved.currentCompanyName ?? params.companyName ?? null,
        resolved_current_company_domain: params.companyDomain ?? null,
        resolved_employment_history: resolved.employmentHistory,
        company_name: resolved.currentCompanyName ?? params.companyName ?? null,
        company_domain: params.companyDomain ?? null,
        company_linkedin_url: resolved.currentCompanyLinkedinUrl,
        profile_enrichment_status: 'completed',
        profile_enrichment_provider: 'harvestapi',
        profile_enrichment_completed_at: nowIso,
        apify_profile_raw: raw,
        updated_at: nowIso,
      },
      { onConflict: 'linkedin_url' },
    )
    .select('id')
    .single();

  if (error || !person) {
    console.error('[enrichSelfProfile] people upsert failed:', error);
    return { ok: false, reason: 'write_failed' };
  }

  // 6. Link the person to the user's profile + stamp enriched_at. Do NOT clobber fields
  //    the user edited by hand (edited_fields); only fill what they haven't set.
  const { data: existing } = await admin
    .from('user_profiles')
    .select('edited_fields')
    .eq('user_id', params.userId)
    .maybeSingle<{ edited_fields: Record<string, boolean> | null }>();
  const edited = existing?.edited_fields ?? {};

  const profilePatch: Record<string, unknown> = {
    user_id: params.userId,
    person_id: person.id,
    linkedin_url: normalized,
    enriched_at: nowIso,
    updated_at: nowIso,
  };
  if (!edited.full_name && fullName) profilePatch.full_name = fullName;
  if (!edited.role_title && resolved.currentJobTitle) profilePatch.role_title = resolved.currentJobTitle;

  await admin.from('user_profiles').upsert(profilePatch, { onConflict: 'user_id' });

  return { ok: true, personId: person.id, linkedinUrl: normalized };
}
