/**
 * Self-profile enrichment: resolve a person's LinkedIn from their email + company domain,
 * scrape their public profile, and upsert a canonical `people` row — WITHOUT creating a
 * contact (a teammate isn't a sales lead). Used by the "Find my profile" action on the
 * My-details page.
 *
 * Reuses the existing building blocks: resolveLinkedinUrl (lib/linkedin-url-resolver) and
 * runApifyProfileEnrichment (lib/enrichment-pipeline). Writes `people` directly by its
 * canonical key (linkedin_url) via the service-role client. Cost (Apify) is metered.
 *
 * Controlled action only — never auto-run; it spends Apify + LLM credits.
 */
import { createAdminClient } from '@/lib/supabase-admin';
import { resolveLinkedinUrl, normalizeLinkedinProfileUrl } from '@/lib/linkedin-url-resolver';
import { runApifyProfileEnrichment } from '@/lib/enrichment-pipeline';
import { recordProviderUsage } from '@/lib/provider-usage';

export type SelfEnrichResult =
  | { ok: true; personId: string; linkedinUrl: string }
  | { ok: false; reason: 'no_linkedin' | 'scrape_failed' | 'write_failed' };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Pull the fields we store on `people` out of the HarvestAPI profile payload. */
function mapProfile(raw: Record<string, unknown>) {
  const currentPosition = Array.isArray(raw.currentPosition) ? (raw.currentPosition[0] as Record<string, unknown> | undefined) : undefined;
  const fullName =
    str(raw.fullName) ?? ([str(raw.firstName), str(raw.lastName)].filter(Boolean).join(' ') || null);
  return {
    full_name: fullName,
    first_name: str(raw.firstName),
    last_name: str(raw.lastName),
    headline: str(raw.headline),
    profile_photo_url: str(raw.profilePhotoUrl) ?? str(raw.profilePicture),
    location: str(raw.location),
    job_title: str(currentPosition?.position) ?? str(raw.headline),
    resolved_current_job_title: str(currentPosition?.position),
    resolved_current_company_name: str(currentPosition?.companyName),
    company_linkedin_url: str(currentPosition?.companyLinkedinUrl),
  };
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
  // company NAME as well as the domain — the name is a much stronger search signal and is
  // what the org already knows about this person; without it the search often can't
  // confidently identify the right profile.
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

  // 3. Upsert the canonical people row by linkedin_url (fill identity fields).
  const admin = createAdminClient();
  const fields = mapProfile(raw);
  const { data: person, error } = await admin
    .from('people')
    .upsert(
      {
        linkedin_url: normalized,
        ...fields,
        profile_enrichment_status: 'completed',
        profile_enrichment_provider: 'harvestapi',
        profile_enrichment_completed_at: new Date().toISOString(),
        apify_profile_raw: raw,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'linkedin_url' },
    )
    .select('id')
    .single();

  if (error || !person) {
    console.error('[enrichSelfProfile] people upsert failed:', error);
    return { ok: false, reason: 'write_failed' };
  }

  // 4. Link the person to the user's profile + stamp enriched_at. Do NOT clobber fields
  //    the user edited by hand (edited_fields); only fill what they haven't set.
  const { data: existing } = await admin
    .from('user_profiles')
    .select('edited_fields, full_name, role_title')
    .eq('user_id', params.userId)
    .maybeSingle<{ edited_fields: Record<string, boolean> | null; full_name: string | null; role_title: string | null }>();
  const edited = existing?.edited_fields ?? {};

  const profilePatch: Record<string, unknown> = {
    user_id: params.userId,
    person_id: person.id,
    linkedin_url: normalized,
    enriched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (!edited.full_name && fields.full_name) profilePatch.full_name = fields.full_name;
  if (!edited.role_title && fields.resolved_current_job_title) profilePatch.role_title = fields.resolved_current_job_title;

  await admin.from('user_profiles').upsert(profilePatch, { onConflict: 'user_id' });

  return { ok: true, personId: person.id, linkedinUrl: normalized };
}
