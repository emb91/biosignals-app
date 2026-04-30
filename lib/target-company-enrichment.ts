/**
 * Target company enrichment pipeline — for PROSPECT / EXAMPLE companies entered during setup.
 *
 * This is NOT for the seller's own company (that is lib/my-company-enrichment.ts → company_analyses).
 * Results from this pipeline are returned to the client and stored as example_company_enrichment
 * on the icps table alongside the taxonomy criteria derived from the analysis.
 *
 * Three sources, run in order:
 *   1. Claude web_search  — narrative analysis (description, customers, competitors, etc.)
 *   2. Apollo org enrich  — verified firmographics (headcount, funding, HQ)   ┐ parallel
 *   3. Apify LinkedIn     — social proof (follower count, logo, tagline)       ┘
 *   4. resolveCompanyTaxonomy — canonical taxonomy (company_type, TA, modalities, stages)
 */
import { enrichOrganizationWithApollo } from '@/lib/apollo';
import {
  analyseCompanyWithClaude,
  scrapeLinkedInCompany,
  extractApifyFirmographics,
  normalizeLinkedInCompanyUrl,
} from '@/lib/my-company-enrichment';
import { resolveCompanyTaxonomy } from '@/lib/company-monitor/taxonomy';

function normalizeDomain(value?: string | null): string | null {
  const trimmed = (value ?? '').trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

export type TargetCompanyEnrichmentResult = {
  // Identity
  company_name: string | null;
  website: string;
  domain: string | null;
  logo_url: string | null;
  tagline: string | null;
  linkedin_url: string | null;

  // Narrative (Claude)
  description: string[] | null;
  products: string[] | null;
  services: string[] | null;
  technologies: string[] | null;
  industries: string[] | null;
  unique_characteristics: string[] | null;
  business_model: string[] | null;
  operating_environment: string[] | null;
  market_summary: string[] | null;
  customers_we_serve: string[] | null;
  why_customers_buy: string[] | null;
  differentiated_value: string[] | null;
  status_quo: string[] | null;
  capabilities: string[] | null;
  challenges_addressed: string[] | null;
  customer_benefits: string[] | null;
  good_fit: string[] | null;
  bad_fit: string[] | null;
  value_propositions: string[] | null;
  competitors_enriched: { name: string; url?: string }[] | null;
  company_status: string | null;
  arr_estimate: string | null;

  // Firmographics (Apollo / Apify)
  employee_count: number | null;
  employee_range: string | null;
  follower_count: number | null;
  founded_year: number | null;
  funding_stage: string | null;
  total_funding_usd: number | null;
  hq_city: string | null;
  hq_country: string | null;
  industry: string | null;
  specialties: string[] | null;

  // Taxonomy (resolveCompanyTaxonomy — canonical Arcova values; PLANE A + PLANE B)
  company_type: string | null;
  company_type_display: string | null;
  therapeutic_areas: string[] | null;
  modalities: string[] | null;
  development_stages: string[] | null;
  customer_therapeutic_areas: string[] | null;
  customer_modalities: string[] | null;
  customer_development_stages: string[] | null;

  // Raw blobs for downstream re-processing
  apollo_firmographics: Record<string, unknown> | null;
  apify_firmographics: Record<string, unknown> | null;
};

export async function enrichTargetCompany(
  website: string,
): Promise<TargetCompanyEnrichmentResult> {
  const domain = normalizeDomain(website);

  // ── Step 1: Claude web_search + Apollo org enrich in parallel ──────────────
  const [claudeResult, apolloResult] = await Promise.allSettled([
    analyseCompanyWithClaude(website),
    enrichOrganizationWithApollo({ company_domain: domain }),
  ]);

  const narrative = claudeResult.status === 'fulfilled' ? claudeResult.value : {};
  const apollo = apolloResult.status === 'fulfilled' ? apolloResult.value : {};

  if (claudeResult.status === 'rejected') {
    console.error('[target-company-enrichment] Claude failed:', claudeResult.reason);
  }
  if (apolloResult.status === 'rejected') {
    console.error('[target-company-enrichment] Apollo failed:', apolloResult.reason);
  }

  // ── Step 2: Resolve LinkedIn URL — Apollo first, Claude fallback ────────────
  const linkedinUrl =
    normalizeLinkedInCompanyUrl(
      typeof apollo.company_linkedin_url === 'string' ? apollo.company_linkedin_url : null,
    ) ??
    normalizeLinkedInCompanyUrl(
      typeof narrative.linkedin_url === 'string' ? narrative.linkedin_url : null,
    );

  // ── Step 3: Apify LinkedIn scrape (sequential — needs LinkedIn URL) ──────────
  let apifyRaw: Record<string, unknown> | null = null;
  if (linkedinUrl) {
    console.log('[target-company-enrichment] Scraping LinkedIn:', linkedinUrl);
    apifyRaw = await scrapeLinkedInCompany(linkedinUrl).catch((err: unknown) => {
      console.error('[target-company-enrichment] Apify failed:', err);
      return null;
    });
  } else {
    console.log('[target-company-enrichment] No LinkedIn URL — skipping Apify');
  }

  const apify = extractApifyFirmographics(apifyRaw);

  // ── Step 4: Taxonomy classification ─────────────────────────────────────────
  const companyName =
    typeof narrative.company_name === 'string' ? narrative.company_name :
    typeof apollo.company_name === 'string' ? apollo.company_name : '';

  let taxonomy: Awaited<ReturnType<typeof resolveCompanyTaxonomy>> | null = null;
  if (companyName || domain) {
    console.log('[target-company-enrichment] Running taxonomy for', companyName || domain);
    taxonomy = await resolveCompanyTaxonomy({
      company_name: companyName,
      domain,
      apify_company_firmographics: apifyRaw,
      apollo_company_firmographics: Object.keys(apollo).length > 0
        ? (apollo as Record<string, unknown>)
        : null,
    }).catch((err: unknown) => {
      console.error('[target-company-enrichment] Taxonomy failed:', err);
      return null;
    });
  }

  // ── Step 5: Merge ─────────────────────────────────────────────────────────
  return {
    company_name: companyName || null,
    website,
    domain,
    logo_url: apify.logo_url ?? null,
    tagline: apify.tagline ?? null,
    linkedin_url: linkedinUrl ?? null,

    description: Array.isArray(narrative.description) ? narrative.description as string[] : null,
    products: Array.isArray(narrative.products) ? narrative.products as string[] : null,
    services: Array.isArray(narrative.services) ? narrative.services as string[] : null,
    technologies: Array.isArray(narrative.technologies) ? narrative.technologies as string[] : null,
    industries: Array.isArray(narrative.industries) ? narrative.industries as string[] : null,
    unique_characteristics: Array.isArray(narrative.unique_characteristics) ? narrative.unique_characteristics as string[] : null,
    business_model: Array.isArray(narrative.business_model) ? narrative.business_model as string[] : null,
    operating_environment: Array.isArray(narrative.operating_environment) ? narrative.operating_environment as string[] : null,
    market_summary: Array.isArray(narrative.market_summary) ? narrative.market_summary as string[] : null,
    customers_we_serve: Array.isArray(narrative.customers_we_serve) ? narrative.customers_we_serve as string[] : null,
    why_customers_buy: Array.isArray(narrative.why_customers_buy) ? narrative.why_customers_buy as string[] : null,
    differentiated_value: Array.isArray(narrative.differentiated_value) ? narrative.differentiated_value as string[] : null,
    status_quo: Array.isArray(narrative.status_quo) ? narrative.status_quo as string[] : null,
    capabilities: Array.isArray(narrative.capabilities) ? narrative.capabilities as string[] : null,
    challenges_addressed: Array.isArray(narrative.challenges_addressed) ? narrative.challenges_addressed as string[] : null,
    customer_benefits: Array.isArray(narrative.customer_benefits) ? narrative.customer_benefits as string[] : null,
    good_fit: Array.isArray(narrative.good_fit) ? narrative.good_fit as string[] : null,
    bad_fit: Array.isArray(narrative.bad_fit) ? narrative.bad_fit as string[] : null,
    value_propositions: Array.isArray(narrative.value_propositions) ? narrative.value_propositions as string[] : null,
    competitors_enriched: Array.isArray(narrative.competitors_enriched)
      ? narrative.competitors_enriched as { name: string; url?: string }[]
      : null,
    company_status: typeof narrative.company_status === 'string' ? narrative.company_status : null,
    arr_estimate: typeof narrative.arr_estimate === 'string' ? narrative.arr_estimate : null,

    employee_count: apollo.company_employee_count ?? apify.employee_count ?? null,
    employee_range: apify.employee_range ?? null,
    follower_count: apify.follower_count ?? null,
    founded_year: apollo.company_founded_year ?? apify.founded_year ?? null,
    funding_stage: apollo.company_funding_stage ?? null,
    total_funding_usd: apollo.company_total_funding_usd ?? null,
    hq_city: apollo.company_hq_city ?? apify.hq_city ?? null,
    hq_country: apollo.company_hq_country ?? apify.hq_country ?? null,
    industry: apollo.company_industry ?? apify.industry ?? null,
    specialties: apify.specialties ?? null,

    company_type: taxonomy?.company_type ?? null,
    company_type_display: taxonomy?.company_type_display ?? null,
    therapeutic_areas: taxonomy?.therapeutic_areas ?? null,
    modalities: taxonomy?.modalities ?? null,
    development_stages: taxonomy?.development_stages ?? null,
    customer_therapeutic_areas: taxonomy?.customer_therapeutic_areas ?? null,
    customer_modalities: taxonomy?.customer_modalities ?? null,
    customer_development_stages: taxonomy?.customer_development_stages ?? null,

    apollo_firmographics: Object.keys(apollo).length > 0 ? (apollo as Record<string, unknown>) : null,
    apify_firmographics: apifyRaw,
  };
}
