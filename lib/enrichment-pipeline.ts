// Enrichment pipeline — three steps:
// contact discovery   = Apollo identity/contact (already stored before this runs)
// linkedin resolution = Claude web search for LinkedIn URL
// profile enrichment  = Apify LinkedIn profile scrape + company scrape + Apollo company enrich + LLM bio summary
import Anthropic from '@anthropic-ai/sdk';
import { recordLlmUsageEvent } from '@/lib/llm-usage';
import {
  enrichOrganizationWithApollo,
  tryApolloPersonalEmailRevealForLookup,
  type ApolloLookupInput,
} from '@/lib/apollo';
import { trimEmail as trimContactEmail, ensureEnrichedEmailEntry, emailsEqual } from '@/lib/contact-emails';
import {
  writeApolloPhonesToContact,
  attemptApolloPhoneRevealForContact,
} from '@/lib/contact-phone-enrichment';
import type { ApolloPhoneEntry } from '@/lib/apollo';
import { syncContactFitForContact } from '@/lib/contact-fit';
import { syncCompanyFitForCompany } from '@/lib/company-fit';
import { resolveLinkedinUrl, type LinkedinResolutionResult } from '@/lib/linkedin-url-resolver';
import { classifyContacts } from '@/lib/contact-classification';
import { runCompanyMonitor } from '@/lib/company-monitor';
import { employeeCountToSizeBucket } from '@/lib/arcova-taxonomy';
import { emitExternalContactSignalsFromEnrichment } from '@/lib/signals/readiness-external-contacts';
import { ensureCompanyAliases } from '@/lib/signals/company-aliases';
import { ensureCompanyCik } from '@/lib/signals/company-cik';
import { backfillRecentMentionsForCompany } from '@/lib/companies/backfill-mentions-for-company';
import { createAdminClient } from '@/lib/supabase-admin';

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
  company_id?: string | null;
  job_title?: string | null;
  seniority_level?: string | null;
  business_area?: string | null;
  resolved_current_company_name?: string | null;
  resolved_current_company_domain?: string | null;
  resolved_current_job_title?: string | null;
  profile_enrichment_status?: string | null;
  apollo_person_raw: Record<string, unknown> | null;
  apollo_organization_raw: Record<string, unknown> | null;
};

type Pass2Result = {
  status: 'completed' | 'ambiguous' | 'failed' | 'cancelled';
  linkedinResolution?: LinkedinResolutionResult;
  alignment?: Record<string, unknown> | null;
  apifyProfile?: Record<string, unknown> | null;
  emittedSignalTypes?: string[];
  recomputedCompanyIds?: string[];
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

function formatSupabaseErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;

  const candidate = error as {
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };

  const parts = [candidate.message, candidate.details, candidate.hint]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);

  return parts.length > 0 ? parts.join(' | ') : null;
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  const message = formatSupabaseErrorMessage(error) || '';
  return message.includes('column') && message.includes('does not exist') && message.includes(columnName);
}

const OPTIONAL_CONTACT_REFRESH_JOB_FIELDS = new Set([
  'enrichment_refresh_status',
  'enrichment_refresh_last_error',
  'enrichment_refresh_started_at',
  'enrichment_refresh_finished_at',
]);

async function updateContactWithOptionalRefreshJobFields(
  supabase: MinimalSupabase,
  params: {
    contactId: string;
    userId: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const { contactId, userId, payload } = params;

  const executeUpdate = async (updatePayload: Record<string, unknown>) =>
    supabase
      .from('contacts')
      .update(updatePayload)
      .eq('user_id', userId)
      .eq('id', contactId);

  const { error } = await executeUpdate(payload);
  if (!error) return;

  const missingOptionalColumn = [...OPTIONAL_CONTACT_REFRESH_JOB_FIELDS].some((field) =>
    isMissingColumnError(error, field),
  );

  if (!missingOptionalColumn) {
    throw error;
  }

  const fallbackPayload = Object.fromEntries(
    Object.entries(payload).filter(([key]) => !OPTIONAL_CONTACT_REFRESH_JOB_FIELDS.has(key)),
  );

  const { error: fallbackError } = await executeUpdate(fallbackPayload);
  if (fallbackError) {
    throw fallbackError;
  }
}

export class LeadEnrichmentCancelledError extends Error {
  readonly name = 'LeadEnrichmentCancelledError';

  constructor() {
    super('Lead enrichment was stopped by user');
  }
}

async function throwIfLeadRefreshCancelled(
  supabase: MinimalSupabase,
  contactId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('contacts')
    .select('enrichment_refresh_status')
    .eq('user_id', userId)
    .eq('id', contactId)
    .maybeSingle();

  if (error) {
    console.warn('[enrichment-pipeline] Cancel check failed:', error);
    return;
  }

  if ((data as { enrichment_refresh_status?: string | null } | null)?.enrichment_refresh_status === 'cancelled') {
    throw new LeadEnrichmentCancelledError();
  }
}

/**
 * Applies terminal state after the user stops an in-flight lead enrichment (API DELETE or cooperative cancel).
 */
export async function applyUserCancellationToLeadEnrichment(
  supabase: MinimalSupabase,
  params: { contactId: string; userId: string },
): Promise<void> {
  const { contactId, userId } = params;

  const { data: row, error } = await supabase
    .from('contacts')
    .select(
      'linkedin_resolution_status, profile_enrichment_status, enrichment_refresh_finished_at',
    )
    .eq('user_id', userId)
    .eq('id', contactId)
    .maybeSingle();

  if (error || !row) {
    return;
  }

  const now = new Date().toISOString();
  const typed = row as {
    linkedin_resolution_status: string | null;
    profile_enrichment_status: string | null;
    enrichment_refresh_finished_at: string | null;
  };

  const payload: Record<string, unknown> = {
    enrichment_refresh_status: 'cancelled',
    enrichment_refresh_last_error: null,
    enrichment_refresh_finished_at: typed.enrichment_refresh_finished_at || now,
    updated_at: now,
  };

  if ((typed.linkedin_resolution_status || '') === 'processing') {
    payload.linkedin_resolution_status = 'failed';
    payload.linkedin_resolution_completed_at = now;
    payload.linkedin_resolution_last_error = 'Stopped by user.';
    payload.profile_enrichment_status = 'blocked';
    payload.profile_enrichment_last_error = 'Enrichment was stopped before completion.';
    payload.profile_enrichment_completed_at = now;
  } else if ((typed.profile_enrichment_status || '') === 'processing') {
    payload.profile_enrichment_status = 'blocked';
    payload.profile_enrichment_last_error = 'Stopped by user.';
    payload.profile_enrichment_completed_at = now;
  }

  await updateContactWithOptionalRefreshJobFields(supabase, {
    contactId,
    userId,
    payload,
  });
}

type CanonicalCompanyRow = {
  id: string;
  company_name: string | null;
  website: string | null;
  linkedin_url: string | null;
  description: string | null;
  bio_summary: string | null;
  tagline: string | null;
  logo_url: string | null;
  follower_count: number | string | null;
  industry: string | null;
  employee_count: number | string | null;
  employee_range: string | null;
  founded_year: number | string | null;
  headquarters_city: string | null;
  headquarters_state: string | null;
  headquarters_country: string | null;
  specialties: string[] | null;
};

function pickCanonicalString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return null;
}

function pickCanonicalNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(/[$,]/g, '').trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function pickCanonicalStringArray(...values: unknown[]): string[] | null {
  for (const value of values) {
    if (!Array.isArray(value)) continue;

    const normalized = value
      .map((item) => normalizeString(item))
      .filter(Boolean);

    if (normalized.length > 0) {
      return normalized;
    }
  }

  return null;
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
    hq_state: getFirstString(hq, ['state', 'stateName', 'stateCode']) || null,
    hq_country: getFirstString(hq, ['country', 'countryName', 'countryCode']) || null,
    specialties: specialties.length > 0 ? specialties : null,
    linkedin_url: normalizeString(raw.url || raw.linkedinUrl || '') || null,
  };
}

async function summariseCompanyBio(description: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !description.trim()) return null;

  try {
    const client = new Anthropic({ apiKey });
    // Synthesizes a short factual sentence from external (Apollo / Apify) data —
    // Haiku is plenty for this. See memory/llm_cost_concerns.md.
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: `Write a single plain sentence (10–20 words) describing what this company does, in a B2B sales context. Be factual and specific — name the category, product, or service. No preamble, no punctuation beyond the closing period.\n\n${description}`,
        },
      ],
    });
    await recordLlmUsageEvent({
      provider: 'anthropic',
      feature: 'company_bio_summarization',
      route: 'lib/enrichment-pipeline#summariseCompanyBio',
      model: 'claude-haiku-4-5',
      usage: message.usage,
      metadata: {
        description_length: description.length,
      },
    });

    const block = message.content[0];
    if (block.type !== 'text') return null;

    const sentence = block.text.trim().replace(/^[-•*\d.)]\s*/, '');
    return sentence || null;
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
}): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const { fullName, currentTitle, currentCompany, headline, employmentHistory } = params;
  if (!currentTitle && !currentCompany && employmentHistory.length === 0) return null;

  const historyText = employmentHistory
    .map(
      (e) =>
        `- ${e.title || 'Unknown role'} at ${e.company_name || 'Unknown'} (${[e.start_date, e.end_date].filter(Boolean).join(' – ')})`,
    )
    .join('\n');

  const sourceBlock = `Contact: ${fullName || 'Unknown'}
Current role: ${currentTitle || '—'} at ${currentCompany || '—'}
LinkedIn headline: ${headline || '—'}
Work history:
${historyText || '— No history available'}`;

  const instruction = `Write a single plain sentence (10–20 words) describing this person as a prospect in a B2B sales context — current role, organization, and why they are a relevant contact. Be factual and specific; use title, company, or domain of focus when the source material supports it. No preamble, no bullet points, no labels, no punctuation beyond the closing period.`;

  try {
    const client = new Anthropic({ apiKey });
    // Synthesizes a short factual sentence from Apollo + Apify employment data —
    // Haiku is plenty for this. See memory/llm_cost_concerns.md.
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [{ role: 'user', content: `${instruction}\n\n${sourceBlock}` }],
    });
    await recordLlmUsageEvent({
      provider: 'anthropic',
      feature: 'contact_bio_generation',
      route: 'lib/enrichment-pipeline#generateContactBio',
      model: 'claude-haiku-4-5',
      usage: message.usage,
      metadata: {
        full_name: fullName,
        current_company: currentCompany,
        employment_history_count: employmentHistory.length,
      },
    });

    const block = message.content[0];
    if (block.type !== 'text') return null;

    const firstLine = block.text.trim().split('\n')[0] ?? '';
    const sentence = firstLine.replace(/^[-•*\d.)]\s*/, '').trim();
    return sentence || null;
  } catch (err) {
    console.warn('Contact bio generation failed (non-fatal):', err instanceof Error ? err.message : err);
    return null;
  }
}

async function upsertResolvedCompany(
  supabase: MinimalSupabase,
  userId: string,
  input: {
    resolvedCompanyName?: string | null;
    resolvedCompanyDomain?: string | null;
    resolvedCompanyLinkedinUrl?: string | null;
    apifyFirmographics: Record<string, unknown>;
    apolloFirmographics: Record<string, unknown> | null;
    source: string;
  }
): Promise<string | null> {
  const domain =
    normalizeDomain(input.apifyFirmographics.domain as string | null) ||
    normalizeDomain(input.resolvedCompanyDomain);
  if (!domain) return null;

  const context = `user=${userId} domain=${domain}`;

  // Check if a canonical row already exists for this domain (companies is shared).
  const existing = await supabase
    .from('companies')
    .select(
      'id, company_name, website, linkedin_url, description, bio_summary, tagline, logo_url, follower_count, industry, employee_count, employee_range, founded_year, headquarters_city, headquarters_state, headquarters_country, specialties'
    )
    .eq('domain', domain)
    .maybeSingle();

  const existingError = formatSupabaseErrorMessage(existing?.error);
  if (existingError) {
    throw new Error(`[companies] Failed to look up existing company row (${context}): ${existingError}`);
  }

  const existingCompany = (existing?.data as CanonicalCompanyRow | null) || null;
  const existingId = existingCompany?.id;
  const apifyFirmographics = input.apifyFirmographics;
  const apolloFirmographics = input.apolloFirmographics || null;

  const payload: Record<string, unknown> = {
    domain,
    company_name: pickCanonicalString(input.resolvedCompanyName, existingCompany?.company_name),
    linkedin_url: pickCanonicalString(
      input.resolvedCompanyLinkedinUrl,
      apifyFirmographics.linkedin_url,
      existingCompany?.linkedin_url
    ),
    website: pickCanonicalString(apifyFirmographics.website, existingCompany?.website),
    description: pickCanonicalString(apifyFirmographics.description, existingCompany?.description),
    bio_summary: pickCanonicalString(apifyFirmographics.bio_summary, existingCompany?.bio_summary),
    tagline: pickCanonicalString(apifyFirmographics.tagline, existingCompany?.tagline),
    logo_url: pickCanonicalString(apifyFirmographics.logo_url, existingCompany?.logo_url),
    follower_count: pickCanonicalNumber(apifyFirmographics.follower_count, existingCompany?.follower_count),
    industry: pickCanonicalString(
      apolloFirmographics?.industry,
      apifyFirmographics.industry,
      existingCompany?.industry
    ),
    employee_count: pickCanonicalNumber(
      apolloFirmographics?.employee_count,
      apifyFirmographics.employee_count,
      existingCompany?.employee_count
    ),
    employee_range: pickCanonicalString(apifyFirmographics.employee_range, existingCompany?.employee_range),
    company_size_bucket: employeeCountToSizeBucket(
      pickCanonicalNumber(apolloFirmographics?.employee_count, apifyFirmographics.employee_count, existingCompany?.employee_count) ?? null,
      pickCanonicalString(apifyFirmographics.employee_range, existingCompany?.employee_range) ?? null,
    )[0] ?? null,
    founded_year: pickCanonicalNumber(
      apolloFirmographics?.founded_year,
      apifyFirmographics.founded_year,
      existingCompany?.founded_year
    ),
    headquarters_city: pickCanonicalString(
      apolloFirmographics?.hq_city,
      apifyFirmographics.hq_city,
      existingCompany?.headquarters_city
    ),
    headquarters_state: pickCanonicalString(
      apolloFirmographics?.hq_state,
      apifyFirmographics.hq_state,
      existingCompany?.headquarters_state
    ),
    headquarters_country: pickCanonicalString(
      apolloFirmographics?.hq_country,
      apifyFirmographics.hq_country,
      existingCompany?.headquarters_country
    ),
    specialties: pickCanonicalStringArray(apifyFirmographics.specialties, existingCompany?.specialties),
    last_enriched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (existingId) {
    // Update the existing row
    const updated = await supabase.from('companies').update(payload).eq('id', existingId);
    const updateError = formatSupabaseErrorMessage(updated?.error);
    if (updateError) {
      throw new Error(
        `[companies] Failed to update canonical company row (${context} id=${existingId}): ${updateError}`
      );
    }
    // Dual-write: ensure the user_companies link exists for this user. Upsert
    // so re-enrichment doesn't create dupes; the backfill should have already
    // populated this row, but newly-resolved users on existing companies need
    // it created.
    const upsertLink = await supabase
      .from('user_companies')
      .upsert(
        {
          user_id: userId,
          company_id: existingId,
          source: input.source,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,company_id' },
      );
    const linkError = formatSupabaseErrorMessage(upsertLink?.error);
    if (linkError) {
      console.error(`[user_companies] dual-write (update path) failed for ${existingId} (${context}): ${linkError}`);
    }
    return existingId;
  }

  // Insert a new row and return its id
  const inserted = await supabase
    .from('companies')
    .insert({ ...payload })
    .select('id')
    .maybeSingle();

  const insertError = formatSupabaseErrorMessage(inserted?.error);
  if (insertError) {
    throw new Error(`[companies] Failed to insert canonical company row (${context}): ${insertError}`);
  }

  const insertedId = inserted?.data?.id as string | undefined;
  if (!insertedId) {
    throw new Error(`[companies] Company upsert returned no id (${context})`);
  }

  // Dual-write: also create the per-user link in user_companies. This keeps
  // archived_at/source/added_at scoped per user, so a future refactor that
  // drops the per-user columns from companies has zero data loss to migrate.
  // For now both the old companies.user_id row and the user_companies link
  // exist — readers can use either source while we migrate read paths.
  const upsertLink = await supabase
    .from('user_companies')
    .upsert(
      {
        user_id: userId,
        company_id: insertedId,
        source: input.source,
        archived_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,company_id' },
    );
  const linkError = formatSupabaseErrorMessage(upsertLink?.error);
  if (linkError) {
    console.error(`[user_companies] dual-write failed for ${insertedId} (${context}): ${linkError}`);
  }

  // Eager: populate company aliases via Haiku in the background. Don't await —
  // alias generation takes ~1-2s and we don't want to block the insert path.
  // The monitors also have a lazy fallback that picks up any company with
  // empty aliases on first scan, so this is best-effort.
  void ensureCompanyAliases(createAdminClient(), insertedId).catch((err) => {
    console.error(`[companies] eager ensureCompanyAliases failed for ${insertedId} (${context}):`, err);
  });
  // Eager: resolve CIK in the background so funding signals use precise CIK
  // matching instead of fuzzy name matching from the first run.
  void ensureCompanyCik(createAdminClient(), insertedId).catch((err) => {
    console.warn(`[companies] eager ensureCompanyCik failed for ${insertedId} (${context}):`, err instanceof Error ? err.message : String(err));
  });
  // Phase 4: backfill mentioned_company_ids for the last 14 days of source
  // data so the user sees recent activity for the newly-added company
  // immediately, not just from the next sync cycle. Best-effort, runs after
  // aliases populate so we match against the freshest alias set. Chained off
  // ensureCompanyAliases to avoid racing it (aliases improve match quality).
  void ensureCompanyAliases(createAdminClient(), insertedId)
    .then(() => backfillRecentMentionsForCompany(createAdminClient(), insertedId))
    .then((bf) => {
      if (bf.total_updated > 0) {
        console.log(`[companies] phase-4 backfill: ${insertedId} matched ${bf.total_updated} rows across`, bf.updated_by_table);
      }
    })
    .catch((err) => {
      console.warn(`[companies] phase-4 backfill failed for ${insertedId} (${context}):`, err instanceof Error ? err.message : String(err));
    });

  return insertedId;
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
  params: { contactId: string; userId: string; emitExternalSignals?: boolean }
): Promise<Pass2Result> {
  const { contactId, userId } = params;
  const now = new Date().toISOString();

  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .select(
      'id, user_id, raw_upload_id, full_name, first_name, last_name, email, linkedin_url, location, company_name, company_domain, company_id, job_title, seniority_level, business_area, resolved_current_company_name, resolved_current_company_domain, resolved_current_job_title, profile_enrichment_status, apollo_person_raw, apollo_organization_raw'
    )
    .eq('user_id', userId)
    .eq('id', contactId)
    .maybeSingle();

  if (contactError || !contact) {
    throw new Error('Contact not found for contact resolution pipeline');
  }

  const typedContact = contact as ContactRow;
  let linkedinResolved = false;

  const cancelledSnap = await supabase
    .from('contacts')
    .select('enrichment_refresh_status')
    .eq('user_id', userId)
    .eq('id', contactId)
    .maybeSingle();

  if (
    !cancelledSnap.error &&
    (cancelledSnap.data as { enrichment_refresh_status?: string | null } | null)?.enrichment_refresh_status === 'cancelled'
  ) {
    await applyUserCancellationToLeadEnrichment(supabase, { contactId, userId });
    return { status: 'cancelled' };
  }

  await updateContactWithOptionalRefreshJobFields(supabase, {
    contactId,
    userId,
    payload: {
      linkedin_resolution_status: 'processing',
      linkedin_resolution_started_at: now,
      linkedin_resolution_last_error: null,
      profile_enrichment_status: 'pending',
      profile_enrichment_last_error: null,
      enrichment_refresh_status: 'running',
      enrichment_refresh_last_error: null,
      enrichment_refresh_started_at: now,
      enrichment_refresh_finished_at: null,
      updated_at: now,
    },
  });

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

    await throwIfLeadRefreshCancelled(supabase, contactId, userId);

    if (!resolvedLinkedin.linkedin_url) {
      const finishedAt = new Date().toISOString();
      const failureMessage = 'No credible LinkedIn profile URL found during LinkedIn resolution.';
      const failPayload = {
        linkedin_resolution_source: resolvedLinkedin.source,
        linkedin_resolution_confidence: resolvedLinkedin.confidence,
        linkedin_resolution_summary: resolvedLinkedin.search_summary || null,
        linkedin_resolution_status: 'failed',
        linkedin_resolution_completed_at: finishedAt,
        linkedin_resolution_last_error: failureMessage,
        profile_enrichment_status: 'blocked',
        profile_enrichment_last_error: 'Blocked because LinkedIn resolution could not find a credible profile URL.',
        enrichment_refresh_status: 'failed',
        enrichment_refresh_last_error: failureMessage,
        enrichment_refresh_finished_at: finishedAt,
        updated_at: finishedAt,
      };

      await updateContactWithOptionalRefreshJobFields(supabase, {
        contactId,
        userId,
        payload: failPayload,
      });
      return { status: 'failed', linkedinResolution: resolvedLinkedin };
    }

    linkedinResolved = true;

    await throwIfLeadRefreshCancelled(supabase, contactId, userId);

    if (!isProfileEnrichmentConfigured()) {
      const completedAt = new Date().toISOString();
      await updateContactWithOptionalRefreshJobFields(supabase, {
        contactId,
        userId,
        payload: {
          linkedin_url: resolvedLinkedin.linkedin_url,
          linkedin_resolution_source: resolvedLinkedin.source,
          linkedin_resolution_confidence: resolvedLinkedin.confidence,
          linkedin_resolution_summary: resolvedLinkedin.search_summary || null,
          linkedin_resolution_status: 'completed',
          linkedin_resolution_completed_at: completedAt,
          profile_enrichment_status: 'skipped',
          enrichment_refresh_status: 'succeeded',
          enrichment_refresh_last_error: null,
          enrichment_refresh_finished_at: completedAt,
          updated_at: completedAt,
        },
      });

      return {
        status: 'completed',
        linkedinResolution: resolvedLinkedin,
      };
    }

    await throwIfLeadRefreshCancelled(supabase, contactId, userId);

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

    await throwIfLeadRefreshCancelled(supabase, contactId, userId);

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
    const contactBioSentence = await generateContactBio({
      fullName: typedContact.full_name,
      currentTitle: resolved.currentJobTitle,
      currentCompany: resolved.currentCompanyName,
      headline: resolved.headline,
      employmentHistory: resolved.employmentHistory,
    });
    const contactBio = contactBioSentence ? [contactBioSentence] : null;

    // Step 3b: company enrichment — once we have an Apify-resolved profile,
    // use its current-company LinkedIn URL as the trigger for company scraping.
    // Apollo/Apify alignment is retained as debug metadata only, not a gate.
    let apifyCompanyFirmographics = resolved.firmographics;
    let apifyCompanyRaw: Record<string, unknown> | null = null;
    let apolloCompanyFirmographics: Record<string, unknown> | null = null;
    let apifyCompanyFirmographicsRefreshedAt: string | null = null;
    let apolloCompanyFirmographicsRefreshedAt: string | null = null;

    await throwIfLeadRefreshCancelled(supabase, contactId, userId);

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
          hq_state: apolloCompany.company_hq_state || null,
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

    // If company scrape returned a domain, use it for email alignment (never use the imported domain)
    const resolvedDomainFromCompany =
      normalizeDomain(apifyCompanyFirmographics.domain as string | null) ||
      resolved.resolvedCompanyDomainForEmailCheck;

    // Apollo mailbox is added via contact_emails only (work / personal). We do not replace contacts.email.
    let apolloMailbox = trimContactEmail(getFirstString(apolloPerson, ['email']));
    let apolloEmailStatusForDirectory = getFirstString(apolloPerson, ['email_status']) || null;

    const manualPrimaryEmail = trimContactEmail(typedContact.email);
    if (manualPrimaryEmail && !apolloMailbox) {
      try {
        const apolloRevealInput: ApolloLookupInput = {
          full_name: typedContact.full_name ?? undefined,
          first_name: typedContact.first_name ?? undefined,
          last_name: typedContact.last_name ?? undefined,
          company_name: resolved.currentCompanyName ?? typedContact.company_name ?? undefined,
          company_domain: resolvedDomainFromCompany || typedContact.company_domain || undefined,
          email: manualPrimaryEmail,
          linkedin_url: resolvedLinkedin.linkedin_url ?? undefined,
          location: resolved.location || typedContact.location || undefined,
        };
        const reveal = await tryApolloPersonalEmailRevealForLookup(apolloRevealInput);
        if (reveal.apolloEmail) {
          apolloMailbox = trimContactEmail(reveal.apolloEmail);
          apolloEmailStatusForDirectory = reveal.emailStatus;
        }
      } catch (apolloRevealErr) {
        console.warn(
          '[enrichment-pipeline] Apollo personal email reveal (manual primary, no stored Apollo email) failed (non-fatal):',
          apolloRevealErr instanceof Error ? apolloRevealErr.message : apolloRevealErr,
        );
      }
    }

    if (
      apolloMailbox &&
      !(manualPrimaryEmail && emailsEqual(apolloMailbox, manualPrimaryEmail))
    ) {
      await ensureEnrichedEmailEntry(supabase, {
        contactId,
        userId,
        email: apolloMailbox,
        companyDomain: resolvedDomainFromCompany || typedContact.company_domain,
        apolloEmailStatus: apolloEmailStatusForDirectory,
      });
    }

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
      resolvedCompanyName: resolved.currentCompanyName,
      resolvedCompanyDomain: resolved.currentCompanyDomain,
      resolvedCompanyLinkedinUrl: resolved.currentCompanyLinkedinUrl,
      apifyFirmographics: apifyCompanyFirmographics,
      apolloFirmographics: apolloCompanyFirmographics,
      source: companySource,
    });

    const canonicalCompanyDomainForFunding =
      normalizeDomain(apifyCompanyFirmographics.domain as string | null) ||
      normalizeDomain(resolved.currentCompanyDomain) ||
      null;

    await throwIfLeadRefreshCancelled(supabase, contactId, userId);

    // Resolve canonical funding before flipping the lead to completed so the UI
    // never settles on an intermediate Apollo funding stage.
    if (companyId) {
      await runCompanyMonitor(supabase, {
        company_id: companyId,
        company_name: resolved.currentCompanyName ?? '',
        domain: canonicalCompanyDomainForFunding,
        website: (apifyCompanyFirmographics?.website as string | null) ?? null,
        apollo_funding_stage: (apolloCompanyFirmographics?.funding_stage as string | null) ?? null,
        apollo_total_funding_usd: (apolloCompanyFirmographics?.total_funding_usd as number | null) ?? null,
        apollo_latest_funding_date: (apolloCompanyFirmographics?.latest_funding_date as string | null) ?? null,
        apify_company_firmographics: apifyCompanyFirmographics,
        apollo_company_firmographics: apolloCompanyFirmographics,
        apollo_organization_raw: apolloOrganization,
      });

      await syncCompanyFitForCompany(supabase, userId, companyId).catch((error) => {
        console.error('[enrichment-pipeline] Failed syncing company fit score:', error);
      });
    }

    const profileEnrichmentStatus = alignment.alignment === 'low' ? 'ambiguous' : 'completed';
    const completedAt = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      linkedin_url: resolvedLinkedin.linkedin_url,
      linkedin_resolution_source: resolvedLinkedin.source,
      linkedin_resolution_confidence: resolvedLinkedin.confidence,
      linkedin_resolution_summary: resolvedLinkedin.search_summary || null,
      linkedin_resolution_status: 'completed',
      profile_enrichment_status: profileEnrichmentStatus,
      profile_enrichment_provider: 'harvestapi',
      profile_enrichment_completed_at: completedAt,
      enrichment_refresh_status: 'succeeded',
      enrichment_refresh_last_error: null,
      enrichment_refresh_finished_at: completedAt,
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
      apify_company_raw: apifyCompanyRaw,
      // Pull fresher contact-level fields from LinkedIn scrape
      headline: resolved.headline,
      location: resolved.location || typedContact.location,
      profile_photo_url: resolved.profilePhotoUrl || null,
      contact_bio: contactBio,
      email_status: emailAssessment.status,
      email_status_reasoning: emailAssessment.reasoning,
      updated_at: completedAt,
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

    await throwIfLeadRefreshCancelled(supabase, contactId, userId);

    try {
      const previousTitles = (resolved.employmentHistory ?? [])
        .filter((h: { current?: boolean; title?: string | null }) => !h.current && h.title)
        .map((h: { title?: string | null }) => h.title as string)
        .slice(0, 5);

      const [classification] = await classifyContacts([{
        full_name: typedContact.full_name,
        job_title: resolved.currentJobTitle,
        headline: resolved.headline,
        company_name: resolved.currentCompanyName,
        previous_titles: previousTitles.length ? previousTitles : null,
      }], {
        userId,
      });
      if (classification) {
        updatePayload.job_title_standardised = classification.job_title_standardised;
        updatePayload.seniority_level = classification.seniority_level;
        updatePayload.business_area = classification.business_area;
      }
    } catch (err) {
      console.warn('[enrichment] contact classification failed (non-fatal):', err instanceof Error ? err.message : err);
    }

    await updateContactWithOptionalRefreshJobFields(supabase, {
      contactId,
      userId,
      payload: updatePayload,
    });

    await syncContactFitForContact(supabase, userId, contactId).catch((error) => {
      console.error('[enrichment-pipeline] Failed syncing contact fit score:', error);
    });

    // Phone enrichment — runs AFTER fit scoring so the gate sees fresh
    // contact_fit_score and company_fit_score. Two passes:
    //   1. Cheap pass: write phones the initial Apollo match already returned
    //   2. Expensive pass (only if (1) returned 0 phones): Apollo
    //      reveal_phone_number=true. Costs extra credits — gated by fit.
    try {
      const apolloPhones = Array.isArray((apolloPerson as Record<string, unknown> | null)?.phone_numbers)
        ? ((apolloPerson as Record<string, unknown>).phone_numbers as ApolloPhoneEntry[])
        : [];
      let initialWritten = 0;
      let initialGateAllowed = false;
      if (apolloPhones.length > 0) {
        const phoneResult = await writeApolloPhonesToContact(supabase, {
          userId,
          contactId,
          phones: apolloPhones,
        });
        initialWritten = phoneResult.written;
        initialGateAllowed = phoneResult.gateAllowed;
        if (!phoneResult.gateAllowed) {
          console.log(`[enrichment-pipeline] phone fit gate denied for ${contactId}`);
        }
      }
      // If the initial match returned no phones, pay the extra credit cost
      // to ask Apollo to reveal mobile/personal numbers. Same fit gate
      // applies — only fires for high-fit contacts.
      if (initialWritten === 0) {
        const lookupInput: ApolloLookupInput = {
          full_name: typedContact.full_name ?? undefined,
          first_name: typedContact.first_name ?? undefined,
          last_name: typedContact.last_name ?? undefined,
          company_name: resolved.currentCompanyName ?? typedContact.company_name ?? undefined,
          company_domain: resolvedDomainFromCompany || typedContact.company_domain || undefined,
          email: trimContactEmail(typedContact.email) ?? undefined,
          linkedin_url: resolvedLinkedin.linkedin_url ?? undefined,
          location: resolved.location || typedContact.location || undefined,
        };
        const revealResult = await attemptApolloPhoneRevealForContact(supabase, {
          userId,
          contactId,
          lookupInput,
        });
        if (revealResult.revealed > 0) {
          console.log(
            `[enrichment-pipeline] Apollo phone reveal recovered ${revealResult.revealed} phone(s) for ${contactId}`,
          );
        } else if (!revealResult.gateAllowed && initialGateAllowed === false) {
          // No log: gate already denied at first pass.
        }
      }
    } catch (err) {
      console.error('[enrichment-pipeline] phone enrichment failed (non-fatal):', err);
    }

    let externalSignalResult: { emittedSignalTypes: string[]; recomputedCompanies: string[] } | null = null;
    if (params.emitExternalSignals) {
      try {
        externalSignalResult = await emitExternalContactSignalsFromEnrichment(supabase as any, {
          previous: {
            userId,
            contactId,
            companyId: typedContact.company_id ?? null,
            fullName: typedContact.full_name,
            linkedinUrl: typedContact.linkedin_url,
            email: typedContact.email,
            companyName: typedContact.resolved_current_company_name ?? typedContact.company_name ?? null,
            companyDomain: typedContact.resolved_current_company_domain ?? typedContact.company_domain ?? null,
            jobTitle: typedContact.resolved_current_job_title ?? typedContact.job_title ?? null,
            seniorityLevel: typedContact.seniority_level ?? null,
            businessArea: typedContact.business_area ?? null,
            previouslyEnriched:
              (typedContact.profile_enrichment_status ?? '') === 'completed' ||
              (typedContact.profile_enrichment_status ?? '') === 'ambiguous',
          },
          current: {
            companyId: companyId ?? null,
            fullName: typedContact.full_name,
            linkedinUrl: resolvedLinkedin.linkedin_url,
            email: typedContact.email,
            companyName: resolved.currentCompanyName,
            companyDomain: resolvedDomainFromCompany ?? resolved.resolvedCompanyDomainForEmailCheck ?? null,
            jobTitle: resolved.currentJobTitle,
            seniorityLevel:
              typeof updatePayload.seniority_level === 'string' ? updatePayload.seniority_level : typedContact.seniority_level ?? null,
            businessArea:
              typeof updatePayload.business_area === 'string' ? updatePayload.business_area : typedContact.business_area ?? null,
            sourceProvider: 'apify / linkedin scrape',
            eventAt: completedAt,
          },
        });
      } catch (error) {
        console.error('[enrichment-pipeline] Failed emitting external contact signals:', error);
      }
    }

    return {
      status: profileEnrichmentStatus,
      linkedinResolution: resolvedLinkedin,
      alignment,
      apifyProfile,
      emittedSignalTypes: externalSignalResult?.emittedSignalTypes ?? [],
      recomputedCompanyIds: externalSignalResult?.recomputedCompanies ?? [],
    };
  } catch (error) {
    if (error instanceof LeadEnrichmentCancelledError) {
      await applyUserCancellationToLeadEnrichment(supabase, { contactId, userId });
      return { status: 'cancelled' };
    }

    const message = error instanceof Error ? error.message : 'Unknown contact resolution pipeline error';

    if (linkedinResolved) {
      const failedAt = new Date().toISOString();
      await updateContactWithOptionalRefreshJobFields(supabase, {
        contactId,
        userId,
        payload: {
          linkedin_resolution_status: 'completed',
          profile_enrichment_status: 'failed',
          profile_enrichment_completed_at: failedAt,
          profile_enrichment_last_error: message,
          enrichment_refresh_status: 'failed',
          enrichment_refresh_last_error: message,
          enrichment_refresh_finished_at: failedAt,
          updated_at: failedAt,
        },
      });
    } else {
      const failedAt = new Date().toISOString();
      await updateContactWithOptionalRefreshJobFields(supabase, {
        contactId,
        userId,
        payload: {
          linkedin_resolution_status: 'failed',
          linkedin_resolution_completed_at: failedAt,
          linkedin_resolution_last_error: message,
          profile_enrichment_status: 'blocked',
          profile_enrichment_last_error: 'Blocked because LinkedIn resolution did not complete successfully.',
          enrichment_refresh_status: 'failed',
          enrichment_refresh_last_error: message,
          enrichment_refresh_finished_at: failedAt,
          updated_at: failedAt,
        },
      });
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
