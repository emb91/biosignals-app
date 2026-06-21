import {
  type ApolloOrganization,
  type ApolloPerson,
  searchOrganizationsWithApollo,
  searchPeopleWithApollo,
} from '@/lib/apollo';
import type {
  ApolloCompanySearchRecipe,
  ApolloPeopleSearchRecipe,
} from '@/lib/data-acquisition/search-spec';

export type DiscoveredCompany = {
  source: 'apollo' | 'web_search';
  source_id: string | null;
  name: string;
  domain: string | null;
  linkedin_url: string | null;
  employee_count: number | null;
  raw: ApolloOrganization;
};

export type DiscoveredPerson = {
  source: 'apollo';
  source_id: string | null;
  full_name: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  email: string | null;
  linkedin_url: string | null;
  location: string | null;
  company_name: string;
  company_domain: string | null;
  company_linkedin_url: string | null;
  raw: ApolloPerson;
};

function normalizeDomain(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  return cleaned || null;
}

function splitFullName(value?: string | null): { first: string; last: string } {
  const tokens = (value || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { first: '', last: '' };
  if (tokens.length === 1) return { first: tokens[0], last: '' };
  return { first: tokens[0], last: tokens.slice(1).join(' ') };
}

function organizationName(org: ApolloOrganization): string {
  return (org.name || '').trim();
}

function normalizeOrganization(org: ApolloOrganization): DiscoveredCompany | null {
  const name = organizationName(org);
  const domain = normalizeDomain(org.primary_domain || org.website_url);
  if (!name || !domain) return null;

  return {
    source: 'apollo',
    source_id: org.id || null,
    name,
    domain,
    linkedin_url: org.linkedin_url || null,
    employee_count: typeof org.estimated_num_employees === 'number' ? org.estimated_num_employees : null,
    raw: org,
  };
}

function normalizePerson(person: ApolloPerson, company: DiscoveredCompany): DiscoveredPerson | null {
  const fullName = (person.name || [person.first_name, person.last_name].filter(Boolean).join(' ')).trim();
  if (!fullName) return null;
  const split = splitFullName(fullName);
  const organization = person.organization || null;
  const companyDomain = normalizeDomain(
    organization?.primary_domain || organization?.website_url || company.domain,
  );

  return {
    source: 'apollo',
    source_id: person.id || null,
    full_name: fullName,
    first_name: person.first_name?.trim() || split.first,
    last_name: person.last_name?.trim() || split.last,
    job_title: person.title || null,
    email: person.email || null,
    linkedin_url: person.linkedin_url || null,
    location: person.formatted_address || [person.city, person.state, person.country].filter(Boolean).join(', ') || null,
    company_name: organization?.name || company.name,
    company_domain: companyDomain,
    company_linkedin_url: organization?.linkedin_url || company.linkedin_url,
    raw: person,
  };
}

/** Caller verdict for a single normalized Apollo organization. */
export type CompanyEvaluation = 'qualified' | 'skip';

/**
 * Page through Apollo organization search results until `targetCompanyCount`
 * organizations have been accepted by `evaluate`, a page cap is hit, or
 * `shouldContinue` says to stop (usage cap reached).
 *
 * IMPORTANT ordering contract: every normalized org is handed to `evaluate`
 * BEFORE any screening is metered. The caller is responsible for (in order)
 * the owned-company dedup (free), the screened-organizations cache lookup
 * (free), and only then the metered keyword/fit screen. Apollo org search has
 * no domain exclusion list, so duplicates are discarded locally at zero cost
 * and we simply overfetch via pagination to make up the difference.
 */
export async function discoverApolloCompanies(params: {
  recipes: ApolloCompanySearchRecipe[];
  targetCompanyCount: number;
  perPage?: number;
  /** Hard cap on pages fetched per recipe so heavily-duplicated books cannot cause runaway searches. */
  maxPagesPerRecipe?: number;
  /** Checked before every Apollo page fetch. Return false to stop gracefully. */
  shouldContinue?: () => Promise<boolean>;
  evaluate: (company: DiscoveredCompany, recipe: ApolloCompanySearchRecipe) => Promise<CompanyEvaluation>;
}): Promise<{ companies: DiscoveredCompany[]; stoppedByGuard: boolean }> {
  const perPage = params.perPage ?? 25;
  const maxPages = params.maxPagesPerRecipe ?? 20;
  const seen = new Set<string>();
  const companies: DiscoveredCompany[] = [];
  let stoppedByGuard = false;

  outer: for (const recipe of params.recipes) {
    for (let page = 1; page <= maxPages; page += 1) {
      if (companies.length >= params.targetCompanyCount) break outer;
      if (params.shouldContinue && !(await params.shouldContinue())) {
        stoppedByGuard = true;
        break outer;
      }

      const result = await searchOrganizationsWithApollo({
        page,
        perPage,
        keywords: recipe.keywords,
        employeeRanges: recipe.employeeRanges,
        fundingStages: recipe.fundingStages,
      });

      const rawOrgs = result.organizations || [];

      for (const org of rawOrgs) {
        const company = normalizeOrganization(org);
        if (!company) continue;
        const key = company.domain || company.linkedin_url || company.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const verdict = await params.evaluate(company, recipe);
        if (verdict === 'qualified') {
          companies.push(company);
          if (companies.length >= params.targetCompanyCount) break;
        }
      }

      if (rawOrgs.length < perPage) break;
    }
  }

  return { companies, stoppedByGuard };
}

function normalizeEmailKey(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function normalizeLinkedinKey(value: string | null | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

/** One people search per company, scoped exclusions included. */
export type PeopleSearchTarget = {
  company: DiscoveredCompany;
  /** How many NEW contacts to fetch at this company (the pre-flight gap, not the raw request). */
  contactsTarget: number;
  /** Emails of contacts the user already owns at this company. Passed to Apollo person_not_in. */
  excludeEmails?: string[];
  /** LinkedIn URLs of contacts the user already owns at this company. Passed to Apollo person_not_in. */
  excludeLinkedinUrls?: string[];
};

/**
 * Search Apollo people per company. Owned emails / LinkedIn URLs are sent via
 * Apollo's person_not_in exclusion list before the paid search happens; local
 * exclusion filtering remains as a safety net for provider quirks and partial
 * exclusion support. The caller receives separate new/excluded counts so any
 * duplicate safety-net catches are metered at zero.
 */
export async function discoverApolloPeopleForCompanies(params: {
  targets: PeopleSearchTarget[];
  recipe: ApolloPeopleSearchRecipe;
  /** Checked before each company's Apollo call. Return false to stop gracefully. */
  shouldContinue?: () => Promise<boolean>;
  onSearchResult?: (newCount: number, excludedCount: number, company: DiscoveredCompany) => Promise<void>;
}): Promise<{ people: DiscoveredPerson[]; stoppedByGuard: boolean }> {
  const people: DiscoveredPerson[] = [];
  const seen = new Set<string>();
  let stoppedByGuard = false;

  for (const target of params.targets) {
    if (target.contactsTarget <= 0) continue;
    if (params.shouldContinue && !(await params.shouldContinue())) {
      stoppedByGuard = true;
      break;
    }

    const { company } = target;
    const excludedEmails = new Set((target.excludeEmails ?? []).map(normalizeEmailKey).filter(Boolean));
    const excludedLinkedins = new Set(
      (target.excludeLinkedinUrls ?? []).map(normalizeLinkedinKey).filter(Boolean),
    );
    const personNotIn = [
      ...(target.excludeEmails ?? []).map((value) => value.trim()).filter(Boolean),
      ...(target.excludeLinkedinUrls ?? []).map((value) => value.trim()).filter(Boolean),
    ];

    const result = await searchPeopleWithApollo({
      page: 1,
      perPage: Math.min(100, Math.max(target.contactsTarget * 2, 5)),
      organizationIds: company.source_id ? [company.source_id] : undefined,
      organizationDomains: company.domain ? [company.domain] : undefined,
      personTitles: params.recipe.titles,
      personSeniorities: params.recipe.seniorities,
      personNotIn,
    });

    const fresh: ApolloPerson[] = [];
    let excludedCount = 0;
    for (const raw of result.people) {
      const emailKey = normalizeEmailKey(raw.email);
      const linkedinKey = normalizeLinkedinKey(raw.linkedin_url);
      if ((emailKey && excludedEmails.has(emailKey)) || (linkedinKey && excludedLinkedins.has(linkedinKey))) {
        excludedCount += 1;
        continue;
      }
      fresh.push(raw);
    }

    await params.onSearchResult?.(fresh.length, excludedCount, company);

    let addedForCompany = 0;
    for (const raw of fresh) {
      const person = normalizePerson(raw, company);
      if (!person) continue;
      // Apollo person id first: api_search rows are obfuscated (no email/linkedin,
      // first-name-only), so without the id two different same-first-name people
      // at one company collide on `${full_name}:${domain}` and one is dropped.
      const key =
        (person.source_id && `apollo:${person.source_id}`) ||
        person.linkedin_url ||
        person.email ||
        `${person.full_name}:${person.company_domain}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      people.push(person);
      addedForCompany += 1;
      if (addedForCompany >= target.contactsTarget) break;
    }
  }

  return { people, stoppedByGuard };
}
