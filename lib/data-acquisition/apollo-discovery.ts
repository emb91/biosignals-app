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
  source: 'apollo';
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

export async function discoverApolloCompanies(params: {
  recipes: ApolloCompanySearchRecipe[];
  targetCompanyCount: number;
  maxScreenedCompanies: number;
  perPage?: number;
  onScreened?: (count: number, recipe: ApolloCompanySearchRecipe) => Promise<void>;
}): Promise<{ companies: DiscoveredCompany[]; screenedCount: number }> {
  const perPage = params.perPage ?? 25;
  const seen = new Set<string>();
  const companies: DiscoveredCompany[] = [];
  let screenedCount = 0;

  for (const recipe of params.recipes) {
    for (let page = 1; page <= 20; page += 1) {
      if (companies.length >= params.targetCompanyCount) break;
      if (screenedCount >= params.maxScreenedCompanies) break;

      const result = await searchOrganizationsWithApollo({
        page,
        perPage,
        keywords: recipe.keywords,
        employeeRanges: recipe.employeeRanges,
        fundingStages: recipe.fundingStages,
      });

      const rawOrgs = result.organizations || [];
      screenedCount += rawOrgs.length;
      await params.onScreened?.(rawOrgs.length, recipe);

      for (const org of rawOrgs) {
        const company = normalizeOrganization(org);
        if (!company) continue;
        const key = company.domain || company.linkedin_url || company.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        companies.push(company);
        if (companies.length >= params.targetCompanyCount) break;
      }

      if (rawOrgs.length < perPage) break;
    }
  }

  return { companies, screenedCount };
}

export async function discoverApolloPeopleForCompanies(params: {
  companies: DiscoveredCompany[];
  recipe: ApolloPeopleSearchRecipe;
  contactsPerCompany: number;
  onSearchResult?: (count: number, company: DiscoveredCompany) => Promise<void>;
}): Promise<DiscoveredPerson[]> {
  const people: DiscoveredPerson[] = [];
  const seen = new Set<string>();

  for (const company of params.companies) {
    const result = await searchPeopleWithApollo({
      page: 1,
      perPage: Math.max(params.contactsPerCompany * 2, 5),
      organizationIds: company.source_id ? [company.source_id] : undefined,
      organizationDomains: company.domain ? [company.domain] : undefined,
      personTitles: params.recipe.titles,
      personSeniorities: params.recipe.seniorities,
    });

    await params.onSearchResult?.(result.people.length, company);

    let addedForCompany = 0;
    for (const raw of result.people) {
      const person = normalizePerson(raw, company);
      if (!person) continue;
      const key = person.linkedin_url || person.email || `${person.full_name}:${person.company_domain}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      people.push(person);
      addedForCompany += 1;
      if (addedForCompany >= params.contactsPerCompany) break;
    }
  }

  return people;
}
