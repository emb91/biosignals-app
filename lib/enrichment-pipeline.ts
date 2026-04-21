// Enrichment pipeline — three steps:
// contact discovery   = Apollo identity/contact (already stored before this runs)
// linkedin resolution = Claude web search for LinkedIn URL
// profile enrichment  = Apify LinkedIn profile scrape + company scrape + Apollo company enrich + LLM bio summary
import Anthropic from '@anthropic-ai/sdk';
import { enrichOrganizationWithApollo } from '@/lib/apollo';
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
const HARVESTAPI_COMPANY_ACTOR = 'harvestapi~linkedin-company';

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

async function runApifyCompanyEnrichment(
  companyLinkedinUrl: string
): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) throw new Error('Missing APIFY_API_KEY');

  const response = await fetch(
    `https://api.apify.com/v2/acts/${HARVESTAPI_COMPANY_ACTOR}/run-sync-get-dataset-items`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ companies: [companyLinkedinUrl] }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Apify company enrichment failed (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const payload = (await response.json()) as unknown;
  if (Array.isArray(payload)) return getObject(payload[0]);
  return getObject(payload);
}

function extractCompanyFirmographics(raw: Record<string, unknown> | null): Record<string, unknown> {
  if (!raw) return {};

  const locations = arrayFromUnknown(raw.locations || raw.officeLocations);
  const hq = locations
    .map((l) => getObject(l))
    .find((l) => l?.isHeadquarter || l?.headquarter) || getObject(locations[0]);

  // raw.url is the LinkedIn company page URL — do not use it as the company website.
  const website = normalizeString(raw.website || raw.websiteUrl || '');
  const domain = website ? normalizeDomain(website) : null;

  const specialties = arrayFromUnknown(raw.specialties || raw.specialities)
    .map((s) => normalizeString(s))
    .filter(Boolean);

  return {
    description: normalizeString(raw.description || raw.overview || raw.about || '') || null,
    tagline: normalizeString(raw.tagline || raw.slogan || '') || null,
    website: website || null,
    domain: domain || null,
    logo_url: normalizeString(raw.logo || raw.logoUrl || raw.logoResolutionResult || '') || null,
    follower_count: typeof raw.followerCount === 'number' ? raw.followerCount
      : typeof raw.followersCount === 'number' ? raw.followersCount
      : null,
    employee_count: typeof raw.employeeCount === 'number' ? raw.employeeCount
      : typeof raw.staffCount === 'number' ? raw.staffCount
      : null,
    employee_range: normalizeString(raw.employeeCountRange || raw.staffCountRange || '') || null,
    industry: normalizeString(raw.industry || raw.industries || '') || null,
    founded_year: typeof raw.foundedYear === 'number' ? raw.foundedYear
      : typeof raw.founded === 'number' ? raw.founded
      : null,
    hq_city: getFirstString(hq, ['city', 'cityName']) || null,
    hq_country: getFirstString(hq, ['country', 'countryName', 'countryCode']) || null,
    specialties: specialties.length > 0 ? specialties : null,
    linkedin_url: normalizeString(raw.url || raw.linkedinUrl || '') || null,
  };
}

function buildPreferredCompanyFirmographics(params: {
  apifyFirmographics: Record<string, unknown>;
  apolloFirmographics: Record<string, unknown> | null;
}): Record<string, unknown> {
  const { apifyFirmographics, apolloFirmographics } = params;

  // Apollo is preferred only for selected structured firmographics that are
  // generally stronger there. Apify remains the preferred source for company
  // bio/presentation fields such as description, bio summary, tagline, LinkedIn
  // URL, followers, logo, website, specialties, and the LinkedIn-derived
  // company identity itself.
  return {
    ...apifyFirmographics,
    industry:
      (apolloFirmographics?.industry as string | null) ||
      (apifyFirmographics.industry as string | null) ||
      null,
    employee_count:
      (apolloFirmographics?.employee_count as number | null) ??
      (apifyFirmographics.employee_count as number | null) ??
      null,
    founded_year:
      (apolloFirmographics?.founded_year as number | null) ??
      (apifyFirmographics.founded_year as number | null) ??
      null,
    hq_city:
      (apolloFirmographics?.hq_city as string | null) ||
      (apifyFirmographics.hq_city as string | null) ||
      null,
    hq_country:
      (apolloFirmographics?.hq_country as string | null) ||
      (apifyFirmographics.hq_country as string | null) ||
      null,
    funding_stage:
      (apolloFirmographics?.funding_stage as string | null) ||
      (apifyFirmographics.funding_stage as string | null) ||
      null,
    total_funding_usd:
      (apolloFirmographics?.total_funding_usd as number | null) ??
      (apifyFirmographics.total_funding_usd as number | null) ??
      null,
    latest_funding_date:
      (apolloFirmographics?.latest_funding_date as string | null) ||
      (apifyFirmographics.latest_funding_date as string | null) ||
      null,
  };
}

async function summariseCompanyBio(description: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !description.trim()) return null;

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `Summarise the following company description into exactly 3 bullet points for a B2B sales context. Each bullet must be 10–15 words maximum — tight and factual. Cover: what the company does, who it serves, and their distinctive positioning or advantage. Return only the 3 bullets as plain text, one per line, no leading dashes or numbers, no preamble.\n\n${description}`,
        },
      ],
    });

    const block = message.content[0];
    if (block.type !== 'text') return null;

    const raw = block.text.trim();
    // Model sometimes returns newline-separated bullets, sometimes a paragraph.
    // Normalise to 3 newline-separated sentences either way.
    const lines = raw.includes('\n')
      ? raw.split('\n')
      : raw.split(/(?<=\.)\s+(?=[A-Z])/);

    const bullets = lines
      .map((l) => l.replace(/^[-•*\d.)]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 3);

    return bullets.length > 0 ? bullets.join('\n') : null;
  } catch (err) {
    console.warn('Company bio summarisation failed (non-fatal):', err instanceof Error ? err.message : err);
    return null;
  }
}

async function generateContactBio(params: {
  fullName: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  headline: string | null;
  employmentHistory: NormalizedEmployment[];
}): Promise<string[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const { fullName, currentTitle, currentCompany, headline, employmentHistory } = params;
  if (!currentTitle && !currentCompany && employmentHistory.length === 0) return null;

  const historyText = employmentHistory
    .map((e) => `- ${e.title || 'Unknown role'} at ${e.company_name || 'Unknown'} (${[e.start_date, e.end_date].filter(Boolean).join(' – ')})`)
    .join('\n');

  const prompt = `You are writing an ultra-concise prospect snapshot for a B2B sales team.

Contact: ${fullName || 'Unknown'}
Current role: ${currentTitle || '—'} at ${currentCompany || '—'}
LinkedIn headline: ${headline || '—'}
Work history:
${historyText || '— No history available'}

Write exactly 3 bullet points (plain text, no markdown bullet characters, no labels). Each bullet must be 10–14 words maximum — tight, factual, telegraphic. Cover:
1. Current role and focus
2. Relevant prior background
3. Why they are an interesting prospect

Return only the 3 bullets, one per line, no preamble, no punctuation at end.`;

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 120,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = message.content[0];
    if (block.type !== 'text') return null;

    const bullets = block.text
      .split('\n')
      .map((l) => l.replace(/^[-•*]\s*/, '').trim())
      .filter(Boolean);

    return bullets.length > 0 ? bullets : null;
  } catch (err) {
    console.warn('Contact bio generation failed (non-fatal):', err instanceof Error ? err.message : err);
    return null;
  }
}

async function upsertResolvedCompany(
  supabase: MinimalSupabase,
  userId: string,
  input: {
    companyName?: string | null;
    companyDomain?: string | null;
    linkedinUrl?: string | null;
    firmographics: Record<string, unknown>;
    source: string;
  }
): Promise<string | null> {
  const domain =
    normalizeDomain(input.firmographics.domain as string | null) ||
    normalizeDomain(input.companyDomain);
  if (!domain) return null;

  const payload: Record<string, unknown> = {
    user_id: userId,
    domain,
    company_name: input.companyName || null,
    linkedin_url: input.linkedinUrl || null,
    website: (input.firmographics.website as string | null) || `https://${domain}`,
    description: (input.firmographics.description as string | null) || null,
    bio_summary: (input.firmographics.bio_summary as string | null) || null,
    tagline: (input.firmographics.tagline as string | null) || null,
    logo_url: (input.firmographics.logo_url as string | null) || null,
    follower_count: (input.firmographics.follower_count as number | null) || null,
    industry: (input.firmographics.industry as string | null) || null,
    employee_count: (input.firmographics.employee_count as number | null) || null,
    employee_range: (input.firmographics.employee_range as string | null) || null,
    funding_stage: (input.firmographics.funding_stage as string | null) || null,
    funding_amount: (input.firmographics.total_funding_usd as number | null) || null,
    founded_year: (input.firmographics.founded_year as number | null) || null,
    headquarters_city: (input.firmographics.hq_city as string | null) || null,
    headquarters_country: (input.firmographics.hq_country as string | null) || null,
    specialties: (input.firmographics.specialties as string[] | null) || null,
    source: input.source,
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
  /** Domain known from enrichment only — null when not returned by harvestapi. Used for email alignment. */
  resolvedCompanyDomainForEmailCheck: string | null;
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

  // Domain: harvestapi doesn't return company domain directly.
  // For email alignment we must NOT fall back to the imported contact domain — if we
  // don't know the current company's domain from enrichment, treat it as unknown so
  // assessEmailStatus returns 'candidate' rather than incorrectly 'aligned_current'.
  // For storage / company lookup we allow the imported domain as a best-effort fallback.
  const resolvedCompanyDomainForEmailCheck: string | null = null; // harvestapi never returns domain

  const companyDomain =
    normalizeDomain(params.contact.company_domain) ||
    (params.contact.email ? normalizeDomain(params.contact.email.split('@')[1]) : null);

  return {
    currentCompanyName,
    currentCompanyDomain: companyDomain,
    resolvedCompanyDomainForEmailCheck,
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
    const companyClause = params.resolvedCurrentCompanyName
      ? ` Current company appears to be ${params.resolvedCurrentCompanyName}, but domain is not confirmed — cannot verify alignment.`
      : ' Current-company domain has not been resolved yet.';
    return {
      status: 'candidate',
      reasoning: `Candidate email found.${companyClause}`,
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
    let apolloOrganization = getObject(typedContact.apollo_organization_raw);
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
          profile_enrichment_status: 'skipped',
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
    // Generate contact bio from profile data
    const contactBio = await generateContactBio({
      fullName: typedContact.full_name,
      currentTitle: resolved.currentJobTitle,
      currentCompany: resolved.currentCompanyName,
      headline: resolved.headline,
      employmentHistory: resolved.employmentHistory,
    });

    // Step 3b: company enrichment — once we have an Apify-resolved profile,
    // use its current-company LinkedIn URL as the trigger for company scraping.
    // Apollo/Apify alignment is retained as debug metadata only, not a gate.
    let apifyCompanyFirmographics = resolved.firmographics;
    let apifyCompanyRaw: Record<string, unknown> | null = null;
    let apolloCompanyFirmographics: Record<string, unknown> | null = null;
    let apifyCompanyFirmographicsRefreshedAt: string | null = null;
    let apolloCompanyFirmographicsRefreshedAt: string | null = null;
    if (resolved.currentCompanyLinkedinUrl) {
      try {
        apifyCompanyRaw = await runApifyCompanyEnrichment(resolved.currentCompanyLinkedinUrl);
        apifyCompanyFirmographicsRefreshedAt = new Date().toISOString();
        if (apifyCompanyRaw) {
          const extracted = extractCompanyFirmographics(apifyCompanyRaw);
          const bioSummary = extracted.description
            ? await summariseCompanyBio(extracted.description as string)
            : null;
          apifyCompanyFirmographics = {
            ...apifyCompanyFirmographics,
            ...extracted,
            bio_summary: bioSummary,
          };
        }
      } catch (companyErr) {
        // Non-fatal — log and continue without company data
        console.warn('Company enrichment failed (non-fatal):', companyErr instanceof Error ? companyErr.message : companyErr);
      }
    }

    // Step 3c: Apollo company enrichment — after Apify company enrichment, use the
    // resolved company domain to pull structured firmographics such as funding details.
    const apolloCompanyDomain =
      normalizeDomain(apifyCompanyFirmographics.domain as string | null) ||
      normalizeDomain(resolved.currentCompanyDomain) ||
      normalizeDomain(getFirstString(apolloOrganization, ['primary_domain', 'website_url'])) ||
      null;

    const BLOCKED_DOMAINS = new Set(['linkedin.com', 'facebook.com', 'twitter.com', 'instagram.com']);
    const apolloCompanyDomainClean =
      apolloCompanyDomain && !BLOCKED_DOMAINS.has(apolloCompanyDomain) ? apolloCompanyDomain : null;
    const apolloCompanyName = resolved.currentCompanyName || null;
    const apolloCompanyLinkedinUrl = resolved.currentCompanyLinkedinUrl || null;

    if (apolloCompanyLinkedinUrl || apolloCompanyDomainClean || apolloCompanyName) {
      try {
        const apolloCompany = await enrichOrganizationWithApollo({
          company_domain: apolloCompanyDomainClean,
          company_name: apolloCompanyName,
          company_linkedin_url: apolloCompanyLinkedinUrl,
        });
        apolloCompanyFirmographicsRefreshedAt = new Date().toISOString();
        apolloCompanyFirmographics = {
          name: apolloCompany.company_name || null,
          domain: apolloCompany.company_domain || null,
          linkedin_url: apolloCompany.company_linkedin_url || null,
          description: apolloCompany.company_description || null,
          industry: apolloCompany.company_industry || null,
          employee_count: apolloCompany.company_employee_count ?? null,
          founded_year: apolloCompany.company_founded_year ?? null,
          hq_city: apolloCompany.company_hq_city || null,
          hq_country: apolloCompany.company_hq_country || null,
          funding_stage: apolloCompany.company_funding_stage || null,
          total_funding_usd: apolloCompany.company_total_funding_usd ?? null,
          latest_funding_date: apolloCompany.company_latest_funding_date || null,
        };

        if (apolloCompany.raw_company) {
          apolloOrganization = getObject(apolloCompany.raw_company) || apolloOrganization;
        }
      } catch (apolloCompanyErr) {
        console.warn(
          'Apollo company enrichment failed (non-fatal):',
          apolloCompanyErr instanceof Error ? apolloCompanyErr.message : apolloCompanyErr
        );
      }
    }

    const companyFirmographics = buildPreferredCompanyFirmographics({
      apifyFirmographics: apifyCompanyFirmographics,
      apolloFirmographics: apolloCompanyFirmographics,
    });

    // If company scrape returned a domain, use it for email alignment (never use the imported domain)
    const resolvedDomainFromCompany =
      normalizeDomain(companyFirmographics.domain as string | null) ||
      resolved.resolvedCompanyDomainForEmailCheck;

    const emailAssessment = assessEmailStatus({
      email: typedContact.email,
      resolvedCurrentCompanyName: resolved.currentCompanyName,
      // Prefer domain from company scrape; fall back to profile enrichment result.
      // Never use the imported company_domain — that would cause false alignment.
      resolvedCurrentCompanyDomain: resolvedDomainFromCompany,
    });

    const companySource =
      apolloCompanyFirmographics !== null && apifyCompanyRaw !== null ? 'harvestapi+apollo' :
      apolloCompanyFirmographics !== null ? 'apollo' : 'harvestapi';

    const companyId = await upsertResolvedCompany(supabase, userId, {
      companyName: resolved.currentCompanyName,
      companyDomain: resolved.currentCompanyDomain,
      linkedinUrl: resolved.currentCompanyLinkedinUrl,
      firmographics: companyFirmographics,
      source: companySource,
    });

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
      apollo_organization_raw: apolloOrganization,
      profile_enrichment_alignment_metadata: alignment,
      resolved_current_company_name: resolved.currentCompanyName,
      // Only store a domain against the resolved company if we actually got one from enrichment.
      // The fallback (imported company_domain / email domain) lives on the contact row already
      // and must NOT be attributed to the resolved company — it would create false email alignment.
      resolved_current_company_domain: resolved.resolvedCompanyDomainForEmailCheck,
      resolved_current_job_title: resolved.currentJobTitle,
      resolved_employment_history: resolved.employmentHistory,
      apollo_company_firmographics: apolloCompanyFirmographics,
      apollo_company_firmographics_refreshed_at: apolloCompanyFirmographicsRefreshedAt,
      apify_company_firmographics: apifyCompanyFirmographics,
      apify_company_firmographics_refreshed_at: apifyCompanyFirmographicsRefreshedAt,
      resolved_company_firmographics: companyFirmographics,
      apify_company_raw: apifyCompanyRaw,
      // Pull fresher contact-level fields from LinkedIn scrape
      headline: resolved.headline,
      location: resolved.location || typedContact.location,
      profile_photo_url: resolved.profilePhotoUrl || null,
      contact_bio: contactBio,
      email_status: emailAssessment.status,
      email_status_reasoning: emailAssessment.reasoning,
      updated_at: new Date().toISOString(),
    };

    updatePayload.job_title = resolved.currentJobTitle;
    updatePayload.company_name = resolved.currentCompanyName;
    // Only overwrite company_domain if enrichment actually returned one.
    if (resolvedDomainFromCompany) {
      updatePayload.company_domain = resolvedDomainFromCompany;
      updatePayload.resolved_current_company_domain = resolvedDomainFromCompany;
    }
    updatePayload.company_linkedin_url = resolved.currentCompanyLinkedinUrl;
    updatePayload.company_id = companyId;

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
