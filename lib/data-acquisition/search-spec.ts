import type { PipelineDataRequestType } from '@/lib/pipeline-icp-health';

export type AcquisitionIcp = {
  id: string;
  name: string | null;
  company_type: string | null;
  platform_category: string | null;
  therapeutic_areas: string[] | null;
  modalities: string[] | null;
  development_stages: string[] | null;
  company_sizes: string[] | null;
  funding_stages: string[] | null;
  target_customers?: string[] | null;
  buyer_types?: string[] | null;
};

export type AcquisitionPersona = {
  id: string;
  name: string | null;
  functions: string[] | null;
  seniority_levels: string[] | null;
  job_titles: string[] | null;
};

export type ApolloCompanySearchRecipe = {
  name: string;
  keywords: string[];
  employeeRanges: string[];
  fundingStages: string[];
};

export type ApolloPeopleSearchRecipe = {
  titles: string[];
  seniorities: string[];
};

function cleanList(values: Array<string | null | undefined> | null | undefined, limit = 12): string[] {
  return [...new Set((values || []).map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
    .slice(0, limit);
}

function parseFunctionName(value: string): string {
  try {
    const parsed = JSON.parse(value) as { name?: unknown };
    return typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : value;
  } catch {
    return value;
  }
}

function companyTypeKeywords(companyType: string | null): string[] {
  if (!companyType) return [];
  const type = companyType.toLowerCase();
  if (type.includes('cro')) return ['CRO', 'contract research organization'];
  if (type.includes('cdmo')) return ['CDMO', 'contract development manufacturing'];
  if (type.includes('biotech') || type.includes('biopharma')) return ['biotech', 'biopharma'];
  if (type.includes('pharma')) return ['pharmaceutical'];
  if (type.includes('diagnostic')) return ['diagnostics'];
  if (type.includes('tools')) return ['life science tools'];
  if (type.includes('saas')) return ['life sciences software'];
  return [companyType];
}

export function buildApolloCompanySearchRecipes(
  icp: AcquisitionIcp,
  _requestType: PipelineDataRequestType,
): ApolloCompanySearchRecipe[] {
  const companyType = companyTypeKeywords(icp.company_type);
  const platform = cleanList([icp.platform_category]);
  const therapeuticAreas = cleanList(icp.therapeutic_areas, 5);
  const modalities = cleanList(icp.modalities, 5);
  const developmentStages = cleanList(icp.development_stages, 4);
  const customers = cleanList(icp.target_customers, 4);
  const buyerTypes = cleanList(icp.buyer_types, 4);
  const employeeRanges = cleanList(icp.company_sizes);
  const fundingStages = cleanList(icp.funding_stages);

  const core = cleanList([...companyType, ...platform]);
  const science = cleanList([...therapeuticAreas, ...modalities, ...developmentStages], 8);
  const market = cleanList([...customers, ...buyerTypes], 6);

  const recipes: ApolloCompanySearchRecipe[] = [
    {
      name: 'strict_icp',
      keywords: cleanList([...core, ...science], 10),
      employeeRanges,
      fundingStages,
    },
    {
      name: 'science_broad',
      keywords: cleanList([...science, ...market], 10),
      employeeRanges,
      fundingStages: [],
    },
    {
      name: 'company_type_broad',
      keywords: cleanList([...core, ...market], 10),
      employeeRanges,
      fundingStages,
    },
    {
      name: 'keyword_backfill',
      keywords: cleanList([...core, ...science, ...market], 12),
      employeeRanges: [],
      fundingStages: [],
    },
  ];

  return recipes.filter(
    (recipe, index, all) =>
      recipe.keywords.length > 0 &&
      all.findIndex((other) => other.keywords.join('|') === recipe.keywords.join('|')) === index,
  );
}

export function buildApolloPeopleSearchRecipe(personas: AcquisitionPersona[]): ApolloPeopleSearchRecipe {
  const titles = cleanList(
    personas.flatMap((persona) => [
      ...(persona.job_titles || []),
      ...(persona.functions || []).map(parseFunctionName),
      persona.name || '',
    ]),
    20,
  );

  const seniorities = cleanList(
    personas.flatMap((persona) => persona.seniority_levels || []),
    10,
  ).map((value) => value.toLowerCase().replace(/[^a-z]+/g, '_'));

  return {
    titles,
    seniorities,
  };
}

/** Lowercased keyword tokens from ICP-derived Apollo recipes, used to pre-filter org search results. */
export function icpKeywordCorpus(icp: AcquisitionIcp): string[] {
  const recipes = buildApolloCompanySearchRecipes(icp, 'expand_companies');
  const tokens = new Set<string>();
  for (const recipe of recipes) {
    for (const keyword of recipe.keywords) {
      const token = keyword.trim().toLowerCase();
      if (token.length >= 2) tokens.add(token);
    }
  }
  return [...tokens];
}

export function apolloOrganizationMatchesIcpKeywords(
  org: { name?: string | null; short_description?: string | null; industry?: string | null },
  keywords: string[],
): boolean {
  if (keywords.length === 0) return true;
  const haystack = [org.name, org.short_description, org.industry]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return keywords.some((keyword) => {
    const k = keyword.trim().toLowerCase();
    return k.length >= 2 && haystack.includes(k);
  });
}
