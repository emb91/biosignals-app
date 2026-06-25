import {
  canonicalizeCompanySize,
  canonicalizeCompanyType,
  canonicalizeDevelopmentStage,
  canonicalizeFundingStage,
  canonicalizeLiFollowerSize,
  canonicalizeModality,
  canonicalizeTherapeuticArea,
} from './arcova-taxonomy';

function canonicalArray<T extends string>(
  value: unknown,
  canonicalize: (item: unknown) => T | null,
): T[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const out: T[] = [];
  for (const item of items) {
    const canonical = canonicalize(item);
    if (canonical && !out.includes(canonical)) out.push(canonical);
  }
  return out;
}

export function normalizeIcpTaxonomyPayload(body: Record<string, unknown>) {
  return {
    company_type: canonicalizeCompanyType(body.companyType) ?? '',
    therapeutic_areas: canonicalArray(body.therapeuticAreas, canonicalizeTherapeuticArea),
    modalities: canonicalArray(body.modalities, canonicalizeModality),
    development_stages: canonicalArray(body.developmentStages, canonicalizeDevelopmentStage),
    customer_therapeutic_areas: canonicalArray(
      body.customerTherapeuticAreas,
      canonicalizeTherapeuticArea,
    ),
    customer_modalities: canonicalArray(body.customerModalities, canonicalizeModality),
    customer_development_stages: canonicalArray(
      body.customerDevelopmentStages,
      canonicalizeDevelopmentStage,
    ),
    company_sizes: canonicalArray(body.companySizes, canonicalizeCompanySize),
    li_follower_sizes: canonicalArray(body.liFollowerSizes, canonicalizeLiFollowerSize),
    funding_stages: canonicalArray(
      body.fundingStages,
      (value) => canonicalizeFundingStage(typeof value === 'string' ? value : null, null),
    ),
  };
}
