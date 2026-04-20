// Enrichment pipeline — three steps:
// contact discovery   = Apollo identity/contact (already stored before this runs)
// linkedin resolution = Claude web search for LinkedIn URL
// profile enrichment  = Apify LinkedIn profile scrape
import { resolveLinkedinUrl, type LinkedinResolutionResult } from '@/lib/linkedin-url-resolver';

type MinimalSupabase = {
  from: (table: string) => any;
};

type RawUploadRow = {
  raw_data?: Record<string, unknown> | null;
};

type ContactRow = {
  id: string;
  user_id: string;
  raw_upload_id: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  linkedin_url: string | null;
  location: string | null;
  company_name: string | null;
  company_domain: string | null;
  apollo_person_raw: Record<string, unknown> | null;
  apollo_organization_raw: Record<string, unknown> | null;
};

type Pass2Result = {
  status: 'completed' | 'ambiguous' | 'failed';
  linkedinResolution: LinkedinResolutionResult;
  alignment?: Record<string, unknown> | null;
  apifyProfile?: Record<string, unknown> | null;
};

type NormalizedEmployment = {
  company_name: string | null;
  title: string | null;
  start_date: string | null;
  end_date: string | null;
  current: boolean;
};

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLower(value: unknown): string {
  return normalizeString(value).toLowerCase();
}

function normalizeDomain(value: unknown): string | null {
  const trimmed = normalizeLower(value);
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

function getEmailDomain(email: unknown): string | null {
  const trimmed = normalizeString(email);
  if (!trimmed.includes('@')) return null;
  return normalizeDomain(trimmed.split('@')[1]);
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getFirstString(record: Record<string, unknown> | null, keys: string[]): string {
  if (!record) return '';
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function isProfileEnrichmentConfigured(): boolean {
  return Boolean(process.env.APIFY_API_KEY);
}

// harvestapi returns dates as objects: { month: "Mar", year: 2026, text: "Mar 2026" }
// or for current roles: { text: "Present" }
function extractDateText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  const obj = getObject(value);
  return obj ? normalizeString(obj.text) : '';
}

function normalizeEmploymentHistory(items: unknown[]): NormalizedEmployment[] {
  return items
    .map((item) => getObject(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => {
      const startDate = extractDateText(item.startDate) || getFirstString(item, ['start_date', 'from']);
      const endDate = extractDateText(item.endDate) || getFirstString(item, ['end_date', 'to']);
      return {
        company_name: getFirstString(item, [
          'companyName',
          'organization_name',
          'company_name',
          'company',
          'subtitle',
        ]) || null,
        title: getFirstString(item, ['position', 'title', 'role']) || null,
        start_date: startDate || null,
        end_date: endDate || null,
        current:
          item.current === true ||
          normalizeLower(endDate) === 'present' ||
          normalizeLower(item.end_date) === 'present' ||
          normalizeLower(item.to) === 'present',
      };
    })
    .filter((item) => item.company_name || item.title);
}

function extractApifyEmploymentHistory(profile: Record<string, unknown> | null): NormalizedEmployment[] {
  if (!profile) return [];

  // harvestapi uses `experience`; fall back to other common field names
  const direct =
    arrayFromUnknown(profile.experience).length > 0
      ? arrayFromUnknown(profile.experience)
      : arrayFromUnknown(profile.experiences).length > 0
      ? arrayFromUnknown(profile.experiences)
      : arrayFromUnknown(profile.positions).length > 0
      ? arrayFromUnknown(profile.positions)
      : arrayFromUnknown(profile.jobs);

  return normalizeEmploymentHistory(direct);
}

function extractApolloEmploymentHistory(person: Record<string, unknown> | null): NormalizedEmployment[] {
  return normalizeEmploymentHistory(arrayFromUnknown(person?.employment_history));
}

function getCurrentEmployment(history: NormalizedEmployment[]): NormalizedEmployment | null {
  return history.find((item) => item.current) || history[0] || null;
}

function compareApolloAndApify(params: {
  contact: ContactRow;
  apolloPerson: Record<string, unknown> | null;
  apifyProfile: Record<string, unknown> | null;
}): Record<string, unknown> {
  const { contact, apolloPerson, apifyProfile } = params;
  const contactName =
    normalizeLower(contact.full_name) ||
    [normalizeLower(contact.first_name), normalizeLower(contact.last_name)].filter(Boolean).join(' ');
  const apolloName =
    getFirstString(apolloPerson, ['name']) ||
    [getFirstString(apolloPerson, ['first_name']), getFirstString(apolloPerson, ['last_name'])].filter(Boolean).join(' ');
  const apifyName =
    getFirstString(apifyProfile, ['fullName', 'full_name', 'name']) ||
    [getFirstString(apifyProfile, ['firstName', 'first_name']), getFirstString(apifyProfile, ['lastName', 'last_name'])]
      .filter(Boolean)
      .join(' ');

  const apolloHistory = extractApolloEmploymentHistory(apolloPerson);
  const apifyHistory = extractApifyEmploymentHistory(apifyProfile);

  const apolloCompanies = new Set(apolloHistory.map((item) => normalizeLower(item.company_name)).filter(Boolean));
  const apifyCompanies = new Set(apifyHistory.map((item) => normalizeLower(item.company_name)).filter(Boolean));
  const overlappingCompanies = [...apolloCompanies].filter((name) => apifyCompanies.has(name));

  const currentApollo = getCurrentEmployment(apolloHistory);
  const currentApify = getCurrentEmployment(apifyHistory);
  const currentCompanyMatch =
    Boolean(currentApollo?.company_name) &&
    Boolean(currentApify?.company_name) &&
    normalizeLower(currentApollo?.company_name) === normalizeLower(currentApify?.company_name);

  const namesMatch =
    Boolean(contactName) &&
    Boolean(apifyName) &&
    (contactName === normalizeLower(apifyName) ||
      normalizeLower(apifyName).includes(contactName) ||
      contactName.includes(normalizeLower(apifyName)));

  let alignment: 'high' | 'medium' | 'low' = 'low';
  let confidence = 0.35;

  if (namesMatch && (currentCompanyMatch || overlappingCompanies.length > 0)) {
    alignment = 'high';
    confidence = currentCompanyMatch ? 0.95 : 0.85;
  } else if (namesMatch) {
    alignment = 'medium';
    confidence = 0.7;
  }

  return {
    alignment,
    confidence,
    names_match: namesMatch,
    contact_name: contact.full_name,
    apollo_name: apolloName || null,
    apify_name: apifyName || null,
    overlapping_companies: overlappingCompanies,
    current_company_match: currentCompanyMatch,
  };
}

const HARVESTAPI_ACTOR = 'harvestapi~linkedin-profile-scraper';

async function runApifyProfileEnrichment(linkedinUrl: string): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) {
    throw new Error('Missing APIFY_API_KEY');
  }

  const input = {
    queries: [linkedinUrl],
    profileScraperMode: 'Profile details no email ($4 per 1k)',
  };

  const response = await fetch(
    `https://api.apify.com/v2/acts/${HARVESTAPI_ACTOR}/run-sync-get-dataset-items`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Apify profile enrichment failed (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const payload = (await response.json()) as unknown;
  if (Array.isArray(payload)) {
    return getObject(payload[0]);
  }

  return getObject(payload);
}

async function upsertResolvedCompany(
  supabase: MinimalSupabase,
  userId: string,
  input: {
    companyName?: string | null;
    companyDomain?: string | null;
    firmographics: Record<string, unknown>;
  }
): Promise<string | null> {
  const domain = normalizeDomain(input.companyDomain);
  if (!domain) return null;

  const payload = {
    user_id: userId,
    domain,
    company_name: input.companyName || null,
    website: `https://${domain}`,
    industry: getFirstString(input.firmographics, ['industry']) || null,
    employee_range: getFirstString(input.firmographics, ['employee_band']) || null,
    headquarters_city: getFirstString(input.firmographics, ['hq_city']) || null,
    headquarters_country: getFirstString(input.firmographics, ['hq_country']) || null,
    funding_stage: getFirstString(input.firmographics, ['funding_stage']) || null,
    source: 'harvestapi',
    last_enriched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const result = await supabase
    .from('companies')
    .upsert(payload, { onConflict: 'user_id,domain', ignoreDuplicates: false })
    .select('id')
    .maybeSingle();

  return (result?.data?.id as string | undefined) || null;
}

function buildResolvedContext(params: {
  contact: ContactRow;
  apifyProfile: Record<string, unknown> | null;
}): {
  currentCompanyName: string | null;
  currentCompanyDomain: string | null;
  currentJobTitle: string | null;
  currentCompanyLinkedinUrl: string | null;
  location: string | null;
  headline: string | null;
  profilePhotoUrl: string | null;
  employmentHistory: NormalizedEmployment[];
  firmographics: Record<string, unknown>;
} {
  const profile = params.apifyProfile;

  // harvestapi gives us a dedicated currentPosition array — use it as primary source
  const currentPositionArr = arrayFromUnknown(profile?.currentPosition);
  const currentPositionObj = getObject(currentPositionArr[0]);

  const history = extractApifyEmploymentHistory(profile);
  const currentFromHistory = getCurrentEmployment(history);

  const currentCompanyName =
    getFirstString(currentPositionObj, ['companyName']) ||
    currentFromHistory?.company_name ||
    null;

  const currentJobTitle =
    getFirstString(currentPositionObj, ['position']) ||
    currentFromHistory?.title ||
    null;

  const currentCompanyLinkedinUrl =
    getFirstString(currentPositionObj, ['companyLinkedinUrl']) || null;

  // harvestapi location is an object: { linkedinText: "United States", ... }
  const locationObj = getObject(profile?.location);
  const location =
    getFirstString(locationObj, ['linkedinText']) ||
    normalizeString(profile?.location) ||
    null;

  const headline = getFirstString(profile, ['headline']) || null;

  // harvestapi gives `photo` as the top-level profile photo URL
  const profilePhotoUrl = getFirstString(profile, ['photo']) || null;

  // Domain: harvestapi doesn't return it directly, fall back to contact/email
  const companyDomain =
    normalizeDomain(params.contact.company_domain) ||
    (params.contact.email ? normalizeDomain(params.contact.email.split('@')[1]) : null);

  return {
    currentCompanyName,
    currentCompanyDomain: companyDomain,
    currentJobTitle,
    currentCompanyLinkedinUrl,
    location,
    headline,
    profilePhotoUrl,
    employmentHistory: history,
    firmographics: {
      industry: getFirstString(profile, ['industry']) || null,
      employee_band: getFirstString(profile, ['companySize', 'company_size', 'employeeCountRange']) || null,
      hq_city: getFirstString(profile, ['companyCity', 'company_city']) || null,
      hq_country: getFirstString(profile, ['companyCountry', 'company_country']) || null,
      funding_stage: getFirstString(profile, ['fundingStage', 'funding_stage']) || null,
    },
  };
}

function assessEmailStatus(params: {
  email: string | null;
  resolvedCurrentCompanyName: string | null;
  resolvedCurrentCompanyDomain: string | null;
}): { status: string; reasoning: string } {
  const emailDomain = getEmailDomain(params.email);
  const currentDomain = normalizeDomain(params.resolvedCurrentCompanyDomain);
  const currentCompany = params.resolvedCurrentCompanyName || 'the resolved current company';

  if (!params.email) {
    return {
      status: 'missing',
      reasoning: 'No email is available for this contact.',
    };
  }

  if (!currentDomain) {
    return {
      status: 'candidate',
      reasoning: 'Candidate email found, but current-company alignment has not been resolved yet.',
    };
  }

  if (emailDomain && emailDomain === currentDomain) {
    return {
      status: 'aligned_current',
      reasoning: 'Email domain matches the resolved current company.',
    };
  }

  return {
    status: 'stale_suspected',
    reasoning: `Email domain does not match the resolved current company (${currentCompany}). Recommend not using this email until it is verified.`,
  };
}

export async function runContactResolutionPipelineForContact(
  supabase: MinimalSupabase,
  params: { contactId: string; userId: string }
): Promise<Pass2Result> {
  const { contactId, userId } = params;
  const now = new Date().toISOString();

  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .select(
      'id, user_id, raw_upload_id, full_name, first_name, last_name, email, linkedin_url, location, company_name, company_domain, apollo_person_raw, apollo_organization_raw'
    )
    .eq('user_id', userId)
    .eq('id', contactId)
    .maybeSingle();

  if (contactError || !contact) {
    throw new Error('Contact not found for contact resolution pipeline');
  }

  const typedContact = contact as ContactRow;
  let linkedinResolved = false;

  await supabase
    .from('contacts')
    .update({
      linkedin_resolution_status: 'processing',
      linkedin_resolution_started_at: now,
      linkedin_resolution_last_error: null,
      profile_enrichment_status: 'pending',
      profile_enrichment_last_error: null,
      updated_at: now,
    })
    .eq('user_id', userId)
    .eq('id', contactId);

  try {
    const rawUploadData =
      typedContact.raw_upload_id
        ? ((await supabase
            .from('raw_uploads')
            .select('raw_data')
            .eq('user_id', userId)
            .eq('id', typedContact.raw_upload_id)
            .maybeSingle())?.data as RawUploadRow | null)
        : null;

    const rawData = rawUploadData?.raw_data || {};
    const apolloPerson = getObject(typedContact.apollo_person_raw);
    const apolloOrganization = getObject(typedContact.apollo_organization_raw);
    const searchCompanyName =
      (rawData.company_name as string | undefined) ||
      typedContact.company_name ||
      getFirstString(apolloOrganization, ['name']) ||
      null;
    const searchCompanyDomain =
      (rawData.company_domain as string | undefined) ||
      typedContact.company_domain ||
      getFirstString(apolloOrganization, ['primary_domain', 'website_url']) ||
      getEmailDomain((rawData.email as string | undefined) || typedContact.email) ||
      null;

    const resolvedLinkedin = await resolveLinkedinUrl({
      // Prefer Apollo's returned values — these are what the LLM search should be based on.
      // The CSV's linkedin_url is intentionally not passed; if Apollo didn't return one,
      // the LLM search runs fresh without a CSV hint.
      full_name: getFirstString(apolloPerson, ['name']) || typedContact.full_name || (rawData.full_name as string | undefined) || null,
      first_name: getFirstString(apolloPerson, ['first_name']) || typedContact.first_name || (rawData.first_name as string | undefined) || null,
      last_name: getFirstString(apolloPerson, ['last_name']) || typedContact.last_name || (rawData.last_name as string | undefined) || null,
      email: getFirstString(apolloPerson, ['email']) || typedContact.email || (rawData.email as string | undefined) || null,
      linkedin_url: null,
      company_name: searchCompanyName,
      company_domain: searchCompanyDomain,
      location: getFirstString(apolloPerson, ['formatted_address', 'city']) || typedContact.location || (rawData.location as string | undefined) || null,
      apollo_person: apolloPerson as any,
    });

    if (!resolvedLinkedin.linkedin_url) {
      const failPayload = {
        linkedin_resolution_source: resolvedLinkedin.source,
        linkedin_resolution_confidence: resolvedLinkedin.confidence,
        linkedin_resolution_summary: resolvedLinkedin.search_summary || null,
        linkedin_resolution_status: 'failed',
        linkedin_resolution_completed_at: new Date().toISOString(),
        linkedin_resolution_last_error: 'No credible LinkedIn profile URL found during LinkedIn resolution.',
        profile_enrichment_status: 'blocked',
        profile_enrichment_last_error: 'Blocked because LinkedIn resolution could not find a credible profile URL.',
        updated_at: new Date().toISOString(),
      };

      await supabase.from('contacts').update(failPayload).eq('user_id', userId).eq('id', contactId);
      return { status: 'failed', linkedinResolution: resolvedLinkedin };
    }

    linkedinResolved = true;

    if (!isProfileEnrichmentConfigured()) {
      await supabase
        .from('contacts')
        .update({
          linkedin_url: resolvedLinkedin.linkedin_url,
          linkedin_resolution_source: resolvedLinkedin.source,
          linkedin_resolution_confidence: resolvedLinkedin.confidence,
          linkedin_resolution_summary: resolvedLinkedin.search_summary || null,
          linkedin_resolution_status: 'completed',
          linkedin_resolution_completed_at: new Date().toISOString(),
          profile_enrichment_status: 'pending',
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('id', contactId);

      return {
        status: 'completed',
        linkedinResolution: resolvedLinkedin,
      };
    }

    await supabase
      .from('contacts')
      .update({
        linkedin_url: resolvedLinkedin.linkedin_url,
        linkedin_resolution_source: resolvedLinkedin.source,
        linkedin_resolution_confidence: resolvedLinkedin.confidence,
        linkedin_resolution_summary: resolvedLinkedin.search_summary || null,
        linkedin_resolution_status: 'completed',
        linkedin_resolution_completed_at: new Date().toISOString(),
        profile_enrichment_status: 'processing',
        profile_enrichment_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('id', contactId);

    const apifyProfile = await runApifyProfileEnrichment(resolvedLinkedin.linkedin_url);
    const alignment = compareApolloAndApify({
      contact: typedContact,
      apolloPerson,
      apifyProfile,
    });
    const resolved = buildResolvedContext({
      contact: typedContact,
      apifyProfile,
    });
    const emailAssessment = assessEmailStatus({
      email: typedContact.email,
      resolvedCurrentCompanyName: resolved.currentCompanyName,
      resolvedCurrentCompanyDomain: resolved.currentCompanyDomain,
    });

    const companyId =
      alignment.alignment !== 'low'
        ? await upsertResolvedCompany(supabase, userId, {
            companyName: resolved.currentCompanyName,
            companyDomain: resolved.currentCompanyDomain,
            firmographics: resolved.firmographics,
          })
        : null;

    const profileEnrichmentStatus = alignment.alignment === 'low' ? 'ambiguous' : 'completed';
    const updatePayload: Record<string, unknown> = {
      linkedin_url: resolvedLinkedin.linkedin_url,
      linkedin_resolution_source: resolvedLinkedin.source,
      linkedin_resolution_confidence: resolvedLinkedin.confidence,
      linkedin_resolution_summary: resolvedLinkedin.search_summary || null,
      linkedin_resolution_status: 'completed',
      profile_enrichment_status: profileEnrichmentStatus,
      profile_enrichment_provider: 'harvestapi',
      profile_enrichment_completed_at: new Date().toISOString(),
      apify_profile_raw: apifyProfile,
      apify_lookup_metadata: {
        provider: 'harvestapi',
        actor: 'harvestapi/linkedin-profile-scraper',
        linkedin_url: resolvedLinkedin.linkedin_url,
        linkedin_resolution_source: resolvedLinkedin.source,
      },
      profile_enrichment_alignment_metadata: alignment,
      resolved_current_company_name: resolved.currentCompanyName,
      resolved_current_company_domain: resolved.currentCompanyDomain,
      resolved_current_job_title: resolved.currentJobTitle,
      resolved_employment_history: resolved.employmentHistory,
      resolved_company_firmographics: resolved.firmographics,
      // Pull fresher contact-level fields from LinkedIn scrape
      headline: resolved.headline,
      location: resolved.location || typedContact.location,
      profile_photo_url: resolved.profilePhotoUrl || null,
      email_status: emailAssessment.status,
      email_status_reasoning: emailAssessment.reasoning,
      updated_at: new Date().toISOString(),
    };

    if (alignment.alignment !== 'low') {
      updatePayload.job_title = resolved.currentJobTitle;
      updatePayload.company_name = resolved.currentCompanyName;
      updatePayload.company_domain = resolved.currentCompanyDomain;
      updatePayload.company_linkedin_url = resolved.currentCompanyLinkedinUrl;
      updatePayload.company_id = companyId;
    }

    await supabase.from('contacts').update(updatePayload).eq('user_id', userId).eq('id', contactId);

    return {
      status: profileEnrichmentStatus,
      linkedinResolution: resolvedLinkedin,
      alignment,
      apifyProfile,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown contact resolution pipeline error';

    if (linkedinResolved) {
      await supabase
        .from('contacts')
        .update({
          linkedin_resolution_status: 'completed',
          profile_enrichment_status: 'failed',
          profile_enrichment_completed_at: new Date().toISOString(),
          profile_enrichment_last_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('id', contactId);
    } else {
      await supabase
        .from('contacts')
        .update({
          linkedin_resolution_status: 'failed',
          linkedin_resolution_completed_at: new Date().toISOString(),
          linkedin_resolution_last_error: message,
          profile_enrichment_status: 'blocked',
          profile_enrichment_last_error: 'Blocked because LinkedIn resolution did not complete successfully.',
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('id', contactId);
    }

    return {
      status: 'failed',
      linkedinResolution: {
        linkedin_url: null,
        source: null,
        confidence: 0,
        search_summary: message,
      },
    };
  }
}

export { isProfileEnrichmentConfigured };
