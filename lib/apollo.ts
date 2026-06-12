export type ApolloLookupInput = {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  company_domain?: string;
  job_title?: string;
  email?: string;
  linkedin_url?: string;
  location?: string;
};

type ApolloEmployment = {
  current?: boolean | null;
  end_date?: string | null;
  organization_id?: string | null;
  organization_name?: string | null;
  start_date?: string | null;
  title?: string | null;
};

export type ApolloOrganization = {
  id?: string;
  name?: string;
  website_url?: string | null;
  linkedin_url?: string | null;
  primary_domain?: string | null;
  industry?: string | null;
  estimated_num_employees?: number | null;
  founded_year?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  short_description?: string | null;
  total_funding?: number | null;
  latest_funding_round_date?: string | null;
  latest_funding_stage?: string | null;
  funding_events?: unknown[] | null;
  technology_names?: string[] | null;
  current_technologies?: unknown[] | null;
  organization_headcount_six_month_growth?: number | null;
  organization_headcount_twelve_month_growth?: number | null;
  organization_headcount_twenty_four_month_growth?: number | null;
};

type ApolloOrganizationEnrichResponse = {
  organization?: ApolloOrganization | null;
};

type ApolloSearchPagination = {
  page?: number;
  per_page?: number;
  total_entries?: number;
  total_pages?: number;
};

type ApolloOrganizationSearchResponse = {
  organizations?: ApolloOrganization[] | null;
  accounts?: ApolloOrganization[] | null;
  pagination?: ApolloSearchPagination | null;
};

export type ApolloPhoneEntry = {
  raw_number?: string | null;
  sanitized_number?: string | null;
  type?: string | null; // 'mobile' / 'work_direct' / 'home' / etc. per Apollo
  position?: number | null;
  status?: string | null;
  dnc_status?: string | null;
  dnc_other_info?: string | null;
};

export type ApolloPerson = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  linkedin_url?: string | null;
  title?: string | null;
  photo_url?: string | null;
  headline?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  formatted_address?: string | null;
  email?: string | null;
  email_status?: string | null;
  seniority?: string | null;
  employment_history?: ApolloEmployment[] | null;
  organization?: ApolloOrganization | null;
  // Apollo's people/match endpoint returns phones when available. The
  // higher-cost mobile reveal is gated by the reveal_phone_number request
  // param (not yet wired — only consume what comes back naturally for now).
  phone_numbers?: ApolloPhoneEntry[] | null;
};

type ApolloMatchResponse = {
  person?: ApolloPerson | null;
  request_id?: string | number;
};

type ApolloPeopleSearchResponse = {
  people?: ApolloPerson[] | null;
  contacts?: ApolloPerson[] | null;
  pagination?: ApolloSearchPagination | null;
};

type ApolloLookupRoute =
  | 'linkedin'
  | 'email_domain'
  | 'email_name'
  | 'email'
  | 'name_domain'
  | 'name_organization'
  | 'unknown';

export type ApolloEnrichmentResult = {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  linkedin_url?: string;
  profile_photo_url?: string;
  job_title?: string;
  headline?: string;
  location?: string;
  city?: string;
  country?: string;
  company_name?: string;
  company_domain?: string;
  company_linkedin_url?: string;
  company_description?: string;
  company_industry?: string;
  company_employee_count?: number;
  company_founded_year?: number;
  company_hq_city?: string;
  company_hq_state?: string;
  company_hq_country?: string;
  company_funding_stage?: string;
  company_total_funding_usd?: number;
  company_latest_funding_date?: string;
  raw_person_response?: unknown;
  raw_person?: unknown;
  raw_company?: unknown;
  apollo_person_response_raw?: unknown;
  apollo_person_raw?: unknown;
  apollo_organization_raw?: unknown;
  apollo_lookup_metadata?: {
    provider: 'apollo';
    lookup_route: ApolloLookupRoute;
    submitted_fields: string[];
    matched_role_source?: null;
    role_resolution_status?: 'pending';
    employment_history_count?: number;
    email_status?: string | null;
    request_id?: string | number | null;
    /** Second people/match with reveal_personal_emails ran after a matched person had no email. */
    personal_email_reveal_followup?: boolean;
    /** True when reveal follow-up returned a non-empty email on the merged person record. */
    personal_email_obtained_via_reveal?: boolean;
  };
};

export type ApolloOrganizationEnrichmentResult = {
  company_name?: string;
  company_domain?: string;
  company_linkedin_url?: string;
  company_description?: string;
  company_industry?: string;
  company_employee_count?: number;
  company_founded_year?: number;
  company_hq_city?: string;
  company_hq_state?: string;
  company_hq_country?: string;
  company_funding_stage?: string;
  company_total_funding_usd?: number;
  company_latest_funding_date?: string;
  raw_company?: unknown;
};

export type ApolloOrganizationSearchParams = {
  page?: number;
  perPage?: number;
  keywords?: string[];
  organizationLocations?: string[];
  employeeRanges?: string[];
  fundingStages?: string[];
  organizationIds?: string[];
};

export type ApolloOrganizationSearchResult = {
  organizations: ApolloOrganization[];
  pagination: ApolloSearchPagination | null;
  raw: unknown;
};

export type ApolloPeopleSearchParams = {
  page?: number;
  perPage?: number;
  organizationIds?: string[];
  organizationDomains?: string[];
  personTitles?: string[];
  personSeniorities?: string[];
  locations?: string[];
  /** Apollo people search exclusion list. Accepts owned emails / LinkedIn URLs. */
  personNotIn?: string[];
};

export type ApolloPeopleSearchResult = {
  people: ApolloPerson[];
  pagination: ApolloSearchPagination | null;
  raw: unknown;
};

function getApolloApiKey(): string {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    throw new Error('Missing APOLLO_API_KEY');
  }
  return apiKey;
}

/** When unset or not `false`, run a second people/match with reveal_personal_emails if Apollo matched someone but returned no email. */
function revealPersonalEmailsWhenMissing(): boolean {
  const v = process.env.APOLLO_REVEAL_PERSONAL_EMAILS_WHEN_MISSING;
  return v !== 'false';
}

function normalizeDomain(value?: string | null): string | undefined {
  if (!value) return undefined;
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

function compactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== '';
    }),
  );
}

function employeeRangeToApollo(value: string): string | null {
  const normalized = value.toLowerCase().replace(/\s+/g, '');
  const match = normalized.match(/(\d+)[–-](\d+)/);
  if (match) return `${match[1]},${match[2]}`;
  if (normalized.includes('500+')) return '501,1000000';
  if (normalized.includes('1') && normalized.includes('10')) return '1,10';
  return null;
}

function fundingStageToApollo(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeString(value?: string | null): string {
  return (value || '').trim().toLowerCase();
}

function fullNameFromInput(input: ApolloLookupInput): string {
  if (input.full_name?.trim()) return input.full_name.trim();
  return `${input.first_name || ''} ${input.last_name || ''}`.trim();
}

function splitFullName(fullName?: string | null): { first_name?: string; last_name?: string } {
  const value = (fullName || '').trim();
  if (!value) return {};

  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return {};
  if (tokens.length === 1) return { first_name: tokens[0] };

  return {
    first_name: tokens[0],
    last_name: tokens.slice(1).join(' '),
  };
}

function normalizeNameToken(value?: string | null): string {
  return normalizeString(value).replace(/[^a-z]/g, '');
}

function resolveInputName(input: ApolloLookupInput) {
  const full_name = fullNameFromInput(input) || undefined;
  const split = splitFullName(full_name);

  return {
    full_name,
    first_name: input.first_name?.trim() || split.first_name,
    last_name: input.last_name?.trim() || split.last_name,
  };
}

function resolveApolloName(person?: ApolloPerson | null) {
  const full_name = person?.name?.trim() || undefined;
  const split = splitFullName(full_name);

  return {
    full_name,
    first_name: person?.first_name?.trim() || split.first_name,
    last_name: person?.last_name?.trim() || split.last_name,
  };
}

function shouldPreserveInputName(
  inputName: ReturnType<typeof resolveInputName>,
  apolloName: ReturnType<typeof resolveApolloName>
): boolean {
  if (!inputName.full_name || !inputName.last_name || !apolloName.full_name || !apolloName.last_name) {
    return false;
  }

  const inputLast = normalizeNameToken(inputName.last_name);
  const apolloLast = normalizeNameToken(apolloName.last_name);

  if (!inputLast || !apolloLast) return false;

  return inputLast.length > 1 && apolloLast.length === 1 && inputLast.startsWith(apolloLast);
}

function buildMatchParams(input: ApolloLookupInput): { params: URLSearchParams; submittedFields: string[] } {
  const params = new URLSearchParams();
  const submittedFields: string[] = [];
  const fullName = fullNameFromInput(input);
  const domain = normalizeDomain(input.company_domain);

  const addParam = (key: string, value?: string | null) => {
    if (!value?.trim()) return;
    params.set(key, value.trim());
    submittedFields.push(key);
  };

  addParam('email', input.email);
  addParam('linkedin_url', input.linkedin_url);
  addParam('name', fullName);
  addParam('domain', domain);
  addParam('organization_name', input.company_name);

  return { params, submittedFields };
}

function getLookupRoute(input: ApolloLookupInput): ApolloLookupRoute {
  const hasEmail = Boolean(input.email?.trim());
  const hasLinkedin = Boolean(input.linkedin_url?.trim());
  const hasName = Boolean(fullNameFromInput(input));
  const hasDomain = Boolean(normalizeDomain(input.company_domain));
  const hasCompanyName = Boolean(input.company_name?.trim());

  if (hasLinkedin) return 'linkedin';
  if (hasEmail && hasDomain) return 'email_domain';
  if (hasEmail && hasName) return 'email_name';
  if (hasEmail) return 'email';
  if (hasName && hasDomain) return 'name_domain';
  if (hasName && hasCompanyName) return 'name_organization';
  return 'unknown';
}

type MatchPersonOptions = {
  revealPersonalEmails?: boolean;
  /**
   * Pass true to ask Apollo for mobile/personal phone numbers it would
   * otherwise withhold. This costs additional Apollo credits per match —
   * only flip on for high-fit contacts (see lib/contact-phone-enrichment.ts).
   */
  revealPhoneNumber?: boolean;
  /**
   * Per-call webhook URL (with correlation token in the path) that Apollo POSTs
   * the async phone reveal to. When omitted we fall back to APOLLO_PHONE_WEBHOOK_URL
   * (no token — legacy/uncorrelated). When neither is set, the reveal isn't
   * requested at all (Apollo rejects reveal_phone_number without a webhook_url,
   * and there'd be no way to capture the async result).
   */
  phoneRevealWebhookUrl?: string;
};

async function matchPerson(input: ApolloLookupInput, options: MatchPersonOptions = {}) {
  const { params, submittedFields } = buildMatchParams(input);
  if (submittedFields.length === 0) {
    return {
      payload: null,
      person: null,
      submittedFields,
    };
  }

  if (options.revealPersonalEmails) {
    params.set('reveal_personal_emails', 'true');
  }
  if (options.revealPhoneNumber) {
    // Apollo's phone reveal is ASYNC: reveal_phone_number=true requires a
    // webhook_url and the number is delivered to that webhook later, not in this
    // response. The receiver lives at app/api/apollo/phone-webhook/[token] and
    // correlates the async delivery back to a contact via the token in the path
    // (see lib/apollo-phone-webhook.ts). Prefer the per-call tokenized URL from
    // the caller; fall back to the bare env URL. Only request the reveal when we
    // have a URL — otherwise Apollo rejects the whole call ("add a valid
    // 'webhook_url'") and there'd be no way to capture the async result. The
    // sync response still returns any phones Apollo includes inline.
    const phoneWebhookUrl = options.phoneRevealWebhookUrl || process.env.APOLLO_PHONE_WEBHOOK_URL;
    if (phoneWebhookUrl) {
      params.set('reveal_phone_number', 'true');
      params.set('webhook_url', phoneWebhookUrl);
    }
  }

  const url = `https://api.apollo.io/api/v1/people/match?${params.toString()}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': getApolloApiKey(),
      'cache-control': 'no-cache',
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Apollo people/match failed (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const payload = (await response.json()) as ApolloMatchResponse;
  return {
    payload,
    person: payload.person || null,
    submittedFields,
  };
}

function joinLocation(...parts: Array<string | null | undefined>): string | undefined {
  const cleaned = parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  return cleaned.length > 0 ? cleaned.join(', ') : undefined;
}

export async function enrichOrganizationWithApollo(input: {
  company_domain?: string | null;
  company_name?: string | null;
  company_linkedin_url?: string | null;
}): Promise<ApolloOrganizationEnrichmentResult> {
  const domain = normalizeDomain(input.company_domain);
  const name = input.company_name?.trim() || undefined;
  const linkedinUrl = input.company_linkedin_url?.trim() || undefined;
  if (!domain && !name && !linkedinUrl) {
    return {};
  }

  const params = new URLSearchParams();
  if (domain) params.set('domain', domain);
  if (name) params.set('name', name);
  if (linkedinUrl) params.set('linkedin_url', linkedinUrl);

  const response = await fetch(
    `https://api.apollo.io/api/v1/organizations/enrich?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-api-key': getApolloApiKey(),
        'cache-control': 'no-cache',
      },
    }
  );

  if (!response.ok) {
    // 404/422 mean Apollo doesn't have this org — treat as not found rather than error.
    if (response.status === 404 || response.status === 422) {
      return {};
    }
    const errorText = await response.text().catch(() => '');
    throw new Error(`Apollo organization enrich failed (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const payload = (await response.json()) as ApolloOrganizationEnrichResponse | ApolloOrganization | unknown;
  const payloadRecord = asRecord(payload);
  const organization =
    (payloadRecord?.organization as ApolloOrganization | null | undefined) ||
    (payloadRecord as ApolloOrganization | null);

  if (!organization) {
    return {};
  }

  return {
    company_name: organization.name || undefined,
    company_domain: normalizeDomain(organization.primary_domain || organization.website_url || domain),
    company_linkedin_url: organization.linkedin_url || undefined,
    company_description: organization.short_description || undefined,
    company_industry: organization.industry || undefined,
    company_employee_count: organization.estimated_num_employees ?? undefined,
    company_founded_year: organization.founded_year ?? undefined,
    company_hq_city: organization.city || undefined,
    company_hq_state: organization.state || undefined,
    company_hq_country: organization.country || undefined,
    company_funding_stage: organization.latest_funding_stage || undefined,
    company_total_funding_usd: organization.total_funding ?? undefined,
    company_latest_funding_date: organization.latest_funding_round_date || undefined,
    raw_company: organization,
  };
}

export async function searchOrganizationsWithApollo(
  input: ApolloOrganizationSearchParams,
): Promise<ApolloOrganizationSearchResult> {
  const payload = compactPayload({
    page: input.page ?? 1,
    per_page: input.perPage ?? 25,
    q_organization_keyword_tags: input.keywords,
    organization_locations: input.organizationLocations,
    organization_num_employees_ranges: input.employeeRanges
      ?.map(employeeRangeToApollo)
      .filter((value): value is string => Boolean(value)),
    organization_latest_funding_stage_cd: input.fundingStages?.map(fundingStageToApollo),
    organization_ids: input.organizationIds,
  });

  const response = await fetch('https://api.apollo.io/api/v1/mixed_companies/search', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': getApolloApiKey(),
      'cache-control': 'no-cache',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Apollo organization search failed (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const raw = (await response.json()) as ApolloOrganizationSearchResponse;
  return {
    organizations: raw.organizations || raw.accounts || [],
    pagination: raw.pagination || null,
    raw,
  };
}

export async function searchPeopleWithApollo(input: ApolloPeopleSearchParams): Promise<ApolloPeopleSearchResult> {
  const payload = compactPayload({
    page: input.page ?? 1,
    per_page: input.perPage ?? 25,
    organization_ids: input.organizationIds,
    q_organization_domains: input.organizationDomains,
    person_titles: input.personTitles,
    person_seniorities: input.personSeniorities,
    person_locations: input.locations,
    person_not_in: input.personNotIn,
  });

  const response = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': getApolloApiKey(),
      'cache-control': 'no-cache',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Apollo people search failed (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const raw = (await response.json()) as ApolloPeopleSearchResponse;
  return {
    people: raw.people || raw.contacts || [],
    pagination: raw.pagination || null,
    raw,
  };
}

type MatchPersonResult = Awaited<ReturnType<typeof matchPerson>>;

async function runApolloPeopleMatchTwoStep(
  input: ApolloLookupInput,
): Promise<{
  person: ApolloPerson | null;
  finalPayload: ApolloMatchResponse | null;
  firstMatch: MatchPersonResult;
  personalEmailRevealFollowup: boolean;
  personalEmailObtainedViaReveal: boolean;
}> {
  const match = await matchPerson(input, { revealPersonalEmails: false });
  let person = match.person;
  let finalPayload = match.payload;
  let personalEmailRevealFollowup = false;
  let personalEmailObtainedViaReveal = false;

  const apolloReturnedEmail = Boolean(person?.email?.trim());

  if (revealPersonalEmailsWhenMissing() && person && !apolloReturnedEmail) {
    personalEmailRevealFollowup = true;
    const revealMatch = await matchPerson(input, { revealPersonalEmails: true });
    finalPayload = revealMatch.payload ?? finalPayload;

    if (revealMatch.person) {
      const merged: ApolloPerson = { ...person, ...revealMatch.person };
      if (merged.email?.trim() && !person.email?.trim()) {
        personalEmailObtainedViaReveal = true;
      }
      person = merged;
    }
  }

  return {
    person,
    finalPayload,
    firstMatch: match,
    personalEmailRevealFollowup,
    personalEmailObtainedViaReveal,
  };
}

/**
 * Runs people/match and, when Apollo returns a person with no email (even if `input.email` was
 * supplied for matching), optionally a second match with reveal_personal_emails. Returns only
 * addresses on Apollo’s merged person record (never echoes `input.email` alone).
 */
/**
 * Run people/match with reveal_phone_number=true. Used for high-fit contacts
 * only (see fit gate in lib/contact-phone-enrichment.ts). Returns the merged
 * person record so the caller can read phone_numbers + any newly revealed
 * fields. Apollo charges extra credits per call — call sparingly.
 */
export async function tryApolloPhoneRevealForLookup(
  input: ApolloLookupInput,
  options: { phoneRevealWebhookUrl?: string } = {},
): Promise<{
  person: ApolloPerson | null;
  payload: ApolloMatchResponse | null;
}> {
  const match = await matchPerson(input, {
    revealPhoneNumber: true,
    phoneRevealWebhookUrl: options.phoneRevealWebhookUrl,
  });
  return { person: match.person, payload: match.payload };
}

export async function tryApolloPersonalEmailRevealForLookup(input: ApolloLookupInput): Promise<{
  apolloEmail: string | null;
  emailStatus: string | null;
  personalEmailRevealFollowup: boolean;
  personalEmailObtainedViaReveal: boolean;
}> {
  if (!revealPersonalEmailsWhenMissing()) {
    return {
      apolloEmail: null,
      emailStatus: null,
      personalEmailRevealFollowup: false,
      personalEmailObtainedViaReveal: false,
    };
  }

  const { person, personalEmailRevealFollowup, personalEmailObtainedViaReveal } =
    await runApolloPeopleMatchTwoStep(input);

  const apolloEmail = person?.email?.trim() || null;
  return {
    apolloEmail,
    emailStatus: person?.email_status ?? null,
    personalEmailRevealFollowup,
    personalEmailObtainedViaReveal,
  };
}

export async function enrichContactWithApollo(input: ApolloLookupInput): Promise<ApolloEnrichmentResult> {
  const { person, finalPayload, firstMatch, personalEmailRevealFollowup, personalEmailObtainedViaReveal } =
    await runApolloPeopleMatchTwoStep(input);

  const organization = person?.organization || null;
  const employmentHistory = person?.employment_history || [];
  const inputName = resolveInputName(input);
  const apolloName = resolveApolloName(person);
  const preserveInputName = shouldPreserveInputName(inputName, apolloName);

  return {
    full_name: preserveInputName ? inputName.full_name : apolloName.full_name || inputName.full_name,
    first_name: preserveInputName ? inputName.first_name : apolloName.first_name || inputName.first_name,
    last_name: preserveInputName ? inputName.last_name : apolloName.last_name || inputName.last_name,
    email: person?.email || input.email,
    linkedin_url: person?.linkedin_url || undefined,
    profile_photo_url: person?.photo_url || undefined,
    job_title: undefined,
    headline: person?.headline || undefined,
    location: person?.formatted_address || input.location,
    city: person?.city || undefined,
    country: person?.country || undefined,
    company_name: undefined,
    company_domain: undefined,
    company_linkedin_url: undefined,
    company_description: undefined,
    company_industry: undefined,
    company_employee_count: undefined,
    company_founded_year: undefined,
    company_hq_city: undefined,
    company_hq_state: undefined,
    company_hq_country: undefined,
    company_funding_stage: undefined,
    company_total_funding_usd: undefined,
    company_latest_funding_date: undefined,
    raw_person_response: finalPayload,
    raw_person: person,
    raw_company: organization,
    apollo_person_response_raw: finalPayload,
    apollo_person_raw: person,
    apollo_organization_raw: organization,
    apollo_lookup_metadata: {
      provider: 'apollo',
      lookup_route: getLookupRoute(input),
      submitted_fields: firstMatch.submittedFields,
      matched_role_source: null,
      role_resolution_status: 'pending',
      employment_history_count: employmentHistory.length,
      email_status: person?.email_status ?? null,
      request_id:
        ((finalPayload as ApolloMatchResponse | null)?.request_id ?? firstMatch.payload?.request_id) ??
        null,
      personal_email_reveal_followup: personalEmailRevealFollowup,
      personal_email_obtained_via_reveal: personalEmailObtainedViaReveal,
    },
  };
}
