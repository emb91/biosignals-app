type FiberLookupInput = {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  company_domain?: string;
  job_title?: string;
  email?: string;
  linkedin_url?: string;
  company_linkedin_url?: string;
  location?: string;
};

type FiberConfig = {
  apiKey: string;
  baseUrl: string;
  emailToPersonUrl: string;
  companySearchUrl: string;
  peopleSearchUrl: string;
  liveProfileUrl: string;
  liveCompanyUrl: string;
};

type FiberExperience = {
  linkedin_company_id?: string | null;
  company_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  title?: string | null;
  locality?: string | null;
  is_current?: boolean | null;
  seniority?: string | null;
  job_function?: string[] | null;
};

type FiberPersonRecord = {
  first_name?: string;
  last_name?: string;
  name?: string;
  headline?: string;
  locality?: string;
  profile_pic?: string;
  url?: string;
  email?: string;
  current_job?: {
    linkedin_company_id?: string | null;
    company_name?: string | null;
    title?: string | null;
    start_date?: string | null;
    seniority?: string | null;
    job_function?: string[] | null;
    locality?: string | null;
  } | null;
  experiences?: FiberExperience[] | null;
};

type FiberCompanyRecord = {
  company_name?: string;
  name?: string;
  domain?: string;
  domains?: string[];
  linkedin_url?: string;
  li_org_id?: string;
  description?: string;
  industry?: string;
  sub_industry?: string;
  employee_count?: number;
  employee_range?: string;
  founded_year?: number;
  headquarters_city?: string;
  headquarters_state?: string;
  headquarters_country?: string;
  funding_stage?: string;
  total_funding_usd?: number;
  latest_funding_date?: string;
  therapeutic_areas?: string[];
  modalities?: string[];
  clinical_stage?: string;
  industries?: Array<{ id?: string; name?: string; primary?: boolean | null }> | null;
  inferred_location?: {
    city?: string | null;
    country_name?: string | null;
  } | null;
};

type FiberEnvelope = {
  output?: unknown;
};

export type FiberAssessment = {
  phase1Verdict: 'yes_with_arcova_normalization';
  confirmedFields: string[];
  missingFieldsArcovaMustDerive: string[];
  linkedinUrlResolution: string;
  companyClassificationGap: string;
  phase2Potential: string;
  notes: string[];
};

export type FiberEnrichmentResult = {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  linkedin_url?: string;
  profile_photo_url?: string;
  job_title?: string;
  headline?: string;
  location?: string;
  company_name?: string;
  company_domain?: string;
  company_linkedin_url?: string;
  company_description?: string;
  company_industry?: string;
  company_sub_industry?: string;
  company_employee_count?: number;
  company_employee_range?: string;
  company_founded_year?: number;
  company_hq_city?: string;
  company_hq_state?: string;
  company_hq_country?: string;
  company_funding_stage?: string;
  company_total_funding_usd?: number;
  company_latest_funding_date?: string;
  company_therapeutic_areas?: string[];
  company_modalities?: string[];
  company_clinical_stage?: string;
  raw_person_response?: unknown;
  raw_company_response?: unknown;
  raw_person?: unknown;
  raw_company?: unknown;
  fiber_lookup_metadata?: {
    person_lookup_source?:
      | 'linkedin'
      | 'email'
      | 'company_people_domain'
      | 'company_people_name'
      | 'people_search_current_company'
      | 'people_search_broad'
      | null;
    company_lookup_source?: 'orgId' | 'liUrl' | null;
    matched_role_source?: 'current_job' | 'experiences' | null;
    normalized_linkedin_url?: boolean;
    resolution_attempts?: string[];
  };
};

function getFiberConfig(): FiberConfig {
  const apiKey = process.env.FIBER_AI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing FIBER_AI_API_KEY');
  }

  const baseUrl = process.env.FIBER_AI_BASE_URL || 'https://api.fiber.ai/v1';
  return {
    apiKey,
    baseUrl,
    emailToPersonUrl: `${baseUrl}/email-to-person/single`,
    companySearchUrl: process.env.FIBER_AI_COMPANY_SEARCH_URL || `${baseUrl}/company-search`,
    peopleSearchUrl: process.env.FIBER_AI_PEOPLE_SEARCH_URL || `${baseUrl}/people-search`,
    liveProfileUrl: process.env.FIBER_AI_LIVE_PROFILE_URL || `${baseUrl}/linkedin-live-fetch/profile/single`,
    liveCompanyUrl: process.env.FIBER_AI_LIVE_COMPANY_URL || `${baseUrl}/linkedin-live-fetch/company/single`,
  };
}

async function postFiber<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const config = getFiberConfig();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: config.apiKey,
      ...body,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Fiber request failed (${response.status}): ${errorText.slice(0, 300)}`);
  }

  return response.json() as Promise<T>;
}

function normalizeDomain(value?: string | null): string | undefined {
  if (!value) return undefined;
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

function normalizeString(value?: string | null): string {
  return (value || '').trim().toLowerCase();
}

function getOutput(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return null;
  return (payload as FiberEnvelope).output ?? null;
}

function readFirstOutputData<T>(payload: unknown): T | null {
  const output = getOutput(payload);
  if (!output || typeof output !== 'object') return null;

  const data = (output as { data?: unknown }).data;
  if (Array.isArray(data)) return (data[0] as T) || null;
  if (data && typeof data === 'object') return data as T;
  return null;
}

function readProfile(payload: unknown): FiberPersonRecord | null {
  const output = getOutput(payload);
  if (!output || typeof output !== 'object') return null;

  if ((output as { found?: boolean }).found === false) return null;
  const profile = (output as { profile?: unknown }).profile;
  return profile && typeof profile === 'object' ? (profile as FiberPersonRecord) : null;
}

function readCompany(payload: unknown): FiberCompanyRecord | null {
  const output = getOutput(payload);
  if (!output || typeof output !== 'object') return null;

  const company = (output as { company?: unknown }).company;
  return company && typeof company === 'object' ? (company as FiberCompanyRecord) : null;
}

function fullNameFromInput(input: FiberLookupInput): string {
  if (input.full_name?.trim()) return input.full_name.trim();
  return `${input.first_name || ''} ${input.last_name || ''}`.trim();
}

function namesMatch(candidate: FiberPersonRecord, input: FiberLookupInput): boolean {
  const targetFull = normalizeString(fullNameFromInput(input));
  const targetFirst = normalizeString(input.first_name);
  const targetLast = normalizeString(input.last_name);

  const candidateFull = normalizeString(candidate.name);
  const candidateFirst = normalizeString(candidate.first_name);
  const candidateLast = normalizeString(candidate.last_name);

  if (targetFull && candidateFull && targetFull === candidateFull) return true;
  if (targetFirst && targetLast && candidateFirst === targetFirst && candidateLast === targetLast) return true;
  return false;
}

function dateWithinLastThreeYears(value?: string | null): boolean {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  return parsed >= threeYearsAgo;
}

function companyMatches(candidateCompany?: string | null, input?: string | null): boolean {
  const candidate = normalizeString(candidateCompany);
  const target = normalizeString(input);
  if (!candidate || !target) return false;
  return candidate === target || candidate.includes(target) || target.includes(candidate);
}

function nameLooseMatch(candidateName?: string | null, targetName?: string | null): boolean {
  const candidate = normalizeString(candidateName).replace(/[.,]/g, '');
  const target = normalizeString(targetName).replace(/[.,]/g, '');
  if (!candidate || !target) return false;
  return candidate === target || candidate.includes(target) || target.includes(candidate);
}

function shouldTrustInputCompanySignals(person: FiberPersonRecord | null, input: FiberLookupInput): boolean {
  if (!person?.current_job?.company_name || !input.company_name) return true;
  return companyMatches(person.current_job.company_name, input.company_name);
}

function parseDate(value?: string | null): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function scoreExperience(experience: FiberExperience, input: FiberLookupInput): number {
  let score = 0;
  if (experience.is_current) score += 100;
  if (!experience.end_date) score += 50;
  if (input.company_name && companyMatches(experience.company_name, input.company_name)) score += 25;
  if (dateWithinLastThreeYears(experience.end_date)) score += 15;
  score += parseDate(experience.end_date) / 1_000_000_000_000;
  score += parseDate(experience.start_date) / 10_000_000_000_000;
  return score;
}

function getBestRole(person: FiberPersonRecord | null, input: FiberLookupInput) {
  if (person?.current_job) return person.current_job;

  const experiences = [...(person?.experiences || [])];
  if (experiences.length === 0) return null;

  experiences.sort((a, b) => scoreExperience(b, input) - scoreExperience(a, input));
  const best = experiences[0];

  return best
    ? {
        linkedin_company_id: best.linkedin_company_id ?? null,
        company_name: best.company_name ?? null,
        title: best.title ?? null,
        start_date: best.start_date ?? null,
        seniority: best.seniority ?? null,
        job_function: best.job_function ?? null,
        locality: best.locality ?? null,
      }
    : null;
}

function candidateMatchesCompany(candidate: FiberPersonRecord, input: FiberLookupInput): boolean {
  const companyName = input.company_name;

  if (companyName && companyMatches(candidate.current_job?.company_name, companyName)) {
    return true;
  }

  const experiences = candidate.experiences || [];
  return experiences.some((experience) => {
    if (!companyMatches(experience.company_name, companyName)) return false;
    if (!experience.end_date) return true;
    return dateWithinLastThreeYears(experience.end_date);
  });
}

function selectBestCandidate(candidates: FiberPersonRecord[], input: FiberLookupInput): FiberPersonRecord | null {
  for (const candidate of candidates) {
    if (!namesMatch(candidate, input)) continue;
    if (candidateMatchesCompany(candidate, input)) return candidate;
  }
  return null;
}

function resolveCompanyName(company: FiberCompanyRecord): string | undefined {
  return company.company_name || company.name || undefined;
}

function resolveCompanyDomain(company: FiberCompanyRecord): string | undefined {
  return normalizeDomain(company.domain || company.domains?.[0]);
}

async function fetchByEmail(input: FiberLookupInput, config: FiberConfig) {
  if (!input.email) return null;
  const payload = await postFiber<unknown>(config.emailToPersonUrl, { email: input.email });
  return {
    person: readFirstOutputData<FiberPersonRecord>(payload),
    payload,
    source: 'email' as const,
  };
}

async function fetchByLinkedIn(input: FiberLookupInput, config: FiberConfig) {
  if (!input.linkedin_url) return null;
  const payload = await postFiber<unknown>(config.liveProfileUrl, {
    identifier: input.linkedin_url,
  });
  return {
    person: readProfile(payload),
    payload,
    source: 'linkedin' as const,
  };
}

async function searchPeople(input: FiberLookupInput, config: FiberConfig, options?: { currentCompanyOnly?: boolean }) {
  const fullName = fullNameFromInput(input);
  if (!fullName) return { candidates: [] as FiberPersonRecord[], payload: null as unknown };

  const currentCompanies =
    options?.currentCompanyOnly && (input.company_domain || input.company_name)
      ? [
          {
            domain: normalizeDomain(input.company_domain) || null,
            name: input.company_name || null,
          },
        ]
      : undefined;

  const payload = await postFiber<unknown>(config.peopleSearchUrl, {
    pageSize: 10,
    currentCompanies,
    searchParams: {
      keywords: {
        containsAll: [fullName],
      },
    },
  });

  const output = getOutput(payload);
  const data = output && typeof output === 'object' ? (output as { data?: unknown }).data : null;
  return {
    candidates: Array.isArray(data) ? (data as FiberPersonRecord[]) : [],
    payload,
  };
}

async function searchCompanies(input: FiberLookupInput, config: FiberConfig) {
  const searchTerms = [normalizeDomain(input.company_domain), input.company_name]
    .filter((term): term is string => Boolean(term && term.trim()));

  if (searchTerms.length === 0) {
    return { companies: [] as FiberCompanyRecord[], payload: null as unknown };
  }

  const payload = await postFiber<unknown>(config.companySearchUrl, {
    pageSize: 10,
    searchParams: {
      keywords: {
        containsAny: searchTerms,
      },
    },
  });

  const output = getOutput(payload);
  const data = output && typeof output === 'object' ? (output as { data?: unknown }).data : null;

  return {
    companies: Array.isArray(data) ? (data as FiberCompanyRecord[]) : [],
    payload,
  };
}

function selectBestCompany(companies: FiberCompanyRecord[], input: FiberLookupInput): FiberCompanyRecord | null {
  const targetDomain = normalizeDomain(input.company_domain);
  const targetName = input.company_name || null;

  if (targetDomain) {
    const exactDomainMatch = companies.find((company) => resolveCompanyDomain(company) === targetDomain);
    if (exactDomainMatch) return exactDomainMatch;
  }

  if (targetName) {
    const exactNameMatch = companies.find((company) =>
      companyMatches(resolveCompanyName(company), targetName)
    );
    if (exactNameMatch) return exactNameMatch;
  }

  return companies[0] || null;
}

async function searchPeopleAtCompany(company: FiberCompanyRecord, config: FiberConfig) {
  const payload = await postFiber<unknown>(config.peopleSearchUrl, {
    pageSize: 100,
    currentCompanies: [
      {
        domain: resolveCompanyDomain(company) || null,
        name: resolveCompanyName(company) || null,
        linkedinOrgID: company.li_org_id || null,
      },
    ],
    searchParams: {},
  });

  const output = getOutput(payload);
  const data = output && typeof output === 'object' ? (output as { data?: unknown }).data : null;

  return {
    candidates: Array.isArray(data) ? (data as FiberPersonRecord[]) : [],
    payload,
  };
}

function selectPersonFromCompanyPeople(candidates: FiberPersonRecord[], input: FiberLookupInput) {
  const fullName = fullNameFromInput(input);
  const exactName = candidates.find((candidate) => nameLooseMatch(candidate.name, fullName));
  if (exactName) return exactName;

  const exactFirstLast = candidates.find((candidate) => namesMatch(candidate, input));
  return exactFirstLast || null;
}

async function searchPerson(input: FiberLookupInput, config: FiberConfig) {
  const companySearch = await searchCompanies(input, config);
  const resolvedCompany = selectBestCompany(companySearch.companies, input);

  if (resolvedCompany) {
    const companyPeople = await searchPeopleAtCompany(resolvedCompany, config);
    const companyPerson = selectPersonFromCompanyPeople(companyPeople.candidates, input);

    if (companyPerson) {
      return {
        person: companyPerson,
        payload: {
          company_search: companySearch.payload,
          people_search: companyPeople.payload,
        },
        source: normalizeDomain(input.company_domain)
          ? ('company_people_domain' as const)
          : ('company_people_name' as const),
      };
    }
  }

  const currentCompanySearch = await searchPeople(input, config, { currentCompanyOnly: true });
  const exactCurrentMatch = selectBestCandidate(currentCompanySearch.candidates, input);
  if (exactCurrentMatch) {
    return {
      person: exactCurrentMatch,
      payload: currentCompanySearch.payload,
      source: 'people_search_current_company' as const,
    };
  }

  const broaderSearch = await searchPeople(input, config, { currentCompanyOnly: false });
  return {
    person: selectBestCandidate(broaderSearch.candidates, input),
    payload: broaderSearch.payload,
    source: 'people_search_broad' as const,
  };
}

async function fetchCompany(
  input: FiberLookupInput & { company_linkedin_org_id?: string | null },
  config: FiberConfig
) {
  if (input.company_linkedin_org_id) {
    const payload = await postFiber<unknown>(config.liveCompanyUrl, {
      type: 'orgId',
      value: input.company_linkedin_org_id,
    });
    return {
      company: readCompany(payload),
      payload,
      source: 'orgId' as const,
    };
  }

  if (input.company_linkedin_url) {
    const payload = await postFiber<unknown>(config.liveCompanyUrl, {
      type: 'liUrl',
      value: input.company_linkedin_url,
    });
    return {
      company: readCompany(payload),
      payload,
      source: 'liUrl' as const,
    };
  }

  return null;
}

export async function enrichContactWithFiber(input: FiberLookupInput): Promise<FiberEnrichmentResult> {
  const config = getFiberConfig();
  const resolutionAttempts: string[] = [];

  let personResult = null as
    | Awaited<ReturnType<typeof fetchByLinkedIn>>
    | Awaited<ReturnType<typeof fetchByEmail>>
    | Awaited<ReturnType<typeof searchPerson>>
    | null;

  if (input.linkedin_url?.trim()) {
    resolutionAttempts.push('linkedin');
    personResult = await fetchByLinkedIn(input, config);
  }

  if (!personResult?.person && input.email?.trim()) {
    resolutionAttempts.push('email');
    personResult = await fetchByEmail(input, config);
  }

  if (!personResult?.person && fullNameFromInput(input)) {
    if (normalizeDomain(input.company_domain)) {
      resolutionAttempts.push('full_name+company_domain');
    } else if (input.company_name?.trim()) {
      resolutionAttempts.push('full_name+company_name');
    } else {
      resolutionAttempts.push('full_name_only_fallback');
    }
    personResult = await searchPerson(input, config);
  }

  let person = personResult?.person || null;
  let personLookupSource = personResult?.source || null;
  let rawPersonResponse = personResult?.payload;
  let normalizedLinkedinUrl = false;

  if (person?.url && normalizeString(person.url) !== normalizeString(input.linkedin_url)) {
    const normalizedProfileResult = await fetchByLinkedIn({ ...input, linkedin_url: person.url }, config);
    if (normalizedProfileResult?.person) {
      person = normalizedProfileResult.person;
      personLookupSource = normalizedProfileResult.source;
      rawPersonResponse = normalizedProfileResult.payload;
      normalizedLinkedinUrl = true;
    }
  }

  const bestRole = getBestRole(person || null, input);

  let company: FiberCompanyRecord | null = null;
  let rawCompanyResponse: unknown = null;
  let companyLookupSource: 'orgId' | 'liUrl' | null = null;
  try {
    const companyResult = await fetchCompany(
      {
        ...input,
        company_name: bestRole?.company_name || input.company_name,
        company_linkedin_org_id: bestRole?.linkedin_company_id || null,
      },
      config
    );
    company = companyResult?.company || null;
    rawCompanyResponse = companyResult?.payload;
    companyLookupSource = companyResult?.source || null;
  } catch (error) {
    console.error('[fiber] Company enrichment failed, continuing with person-only result:', error);
  }

  const trustInputCompanySignals = shouldTrustInputCompanySignals(
    person ? { ...person, current_job: bestRole } : null,
    input
  );
  const fallbackCompanyDomain = trustInputCompanySignals ? input.company_domain : undefined;
  const fallbackCompanyLinkedinUrl = trustInputCompanySignals ? input.company_linkedin_url : undefined;

  return {
    full_name: person?.name || input.full_name,
    first_name: person?.first_name || input.first_name,
    last_name: person?.last_name || input.last_name,
    email: person?.email || input.email,
    linkedin_url: person?.url || input.linkedin_url,
    profile_photo_url: person?.profile_pic,
    job_title: bestRole?.title || input.job_title,
    headline: person?.headline,
    location: person?.locality || bestRole?.locality || input.location,
    company_name: company?.name || bestRole?.company_name || input.company_name,
    company_domain: normalizeDomain(company?.domain || fallbackCompanyDomain),
    company_linkedin_url: company?.linkedin_url || fallbackCompanyLinkedinUrl,
    company_description: company?.description,
    company_industry: company?.industry || company?.industries?.find((industry) => industry.primary)?.name || company?.industries?.[0]?.name,
    company_sub_industry: company?.sub_industry,
    company_employee_count: company?.employee_count,
    company_employee_range: company?.employee_range,
    company_founded_year: company?.founded_year,
    company_hq_city: company?.headquarters_city || company?.inferred_location?.city || undefined,
    company_hq_state: company?.headquarters_state || undefined,
    company_hq_country: company?.headquarters_country || company?.inferred_location?.country_name || undefined,
    company_funding_stage: company?.funding_stage,
    company_total_funding_usd: company?.total_funding_usd,
    company_latest_funding_date: company?.latest_funding_date,
    company_therapeutic_areas: company?.therapeutic_areas,
    company_modalities: company?.modalities,
    company_clinical_stage: company?.clinical_stage,
    raw_person_response: rawPersonResponse,
    raw_company_response: rawCompanyResponse,
    raw_person: person,
    raw_company: company,
    fiber_lookup_metadata: {
      person_lookup_source: personLookupSource,
      company_lookup_source: companyLookupSource,
      matched_role_source: person?.current_job ? 'current_job' : bestRole ? 'experiences' : null,
      normalized_linkedin_url: normalizedLinkedinUrl,
      resolution_attempts: resolutionAttempts,
    },
  };
}

export function getFiberAssessment(): FiberAssessment {
  return {
    phase1Verdict: 'yes_with_arcova_normalization',
    confirmedFields: [
      'first_name',
      'last_name',
      'name',
      'headline',
      'locality',
      'profile_pic',
      'url',
      'current_job.company_name',
      'current_job.title',
      'current_job.seniority',
      'current_job.job_function',
      'experiences.company_name',
      'experiences.end_date',
      'current_job.linkedin_company_id',
    ],
    missingFieldsArcovaMustDerive: [
      'job_title_standardised',
      'seniority_level (Arcova taxonomy)',
      'business_area (Arcova taxonomy)',
      'life-sciences company classification when missing from Fiber',
    ],
    linkedinUrlResolution:
      'Arcova should resolve people by LinkedIn URL first, then email, then Fiber people search using name plus company hints, and only accept matches where the person is at the target company now or left within the last 3 years.',
    companyClassificationGap:
      'Fiber provides general company enrichment, but Arcova should still own any life-sciences-specific normalization when fields are sparse or absent.',
    phase2Potential:
      'Strong Phase 2 potential because Fiber supports broader people and company search, but current scope is Phase 1 import enrichment only.',
    notes: [
      'The real Fiber response shape is nested under output.* rather than top-level data.',
      'LinkedIn profile live fetch should use identifier, not raw linkedin_url/url body fields.',
      'People search is best used for identity resolution, then Arcova should enrich the resolved profile directly.',
    ],
  };
}
