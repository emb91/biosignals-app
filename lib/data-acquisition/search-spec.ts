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

function quoteKeyword(value: string): string {
  const cleaned = value.trim();
  return /\s/.test(cleaned) ? `"${cleaned}"` : cleaned;
}

function combineKeywordGroups(groups: string[][], limit = 8): string[] {
  const combos: string[] = [];
  const [first, second, third] = groups.map((group) => cleanList(group, 5));
  if (first?.length && second?.length) {
    for (const a of first) {
      for (const b of second) {
        combos.push(`${quoteKeyword(a)} ${quoteKeyword(b)}`);
        if (combos.length >= limit) return combos;
      }
    }
  }
  if (first?.length && third?.length) {
    for (const a of first) {
      for (const c of third) {
        combos.push(`${quoteKeyword(a)} ${quoteKeyword(c)}`);
        if (combos.length >= limit) return combos;
      }
    }
  }
  return combos;
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
  const strictCombos = combineKeywordGroups([core, science, market], 10);
  const marketCombos = combineKeywordGroups([core, market, science], 10);

  const recipes: ApolloCompanySearchRecipe[] = [
    {
      name: 'strict_icp',
      keywords: cleanList(strictCombos.length > 0 ? strictCombos : [...core, ...science], 10),
      employeeRanges,
      fundingStages,
    },
    {
      name: 'science_broad',
      keywords: cleanList([...science.slice(0, 4), ...marketCombos.slice(0, 4)], 10),
      employeeRanges,
      fundingStages: [],
    },
    {
      name: 'company_type_broad',
      keywords: cleanList(marketCombos.length > 0 ? marketCombos : [...core, ...market], 10),
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

function evidenceText(
  org: { name?: string | null; short_description?: string | null; industry?: string | null },
): string {
  return [org.name, org.short_description, org.industry]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');
}

function containsAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function offeringTerms(icp: AcquisitionIcp): string[] {
  const aliases: Record<string, string[]> = {
    oncology: ['oncology', 'cancer', 'tumor', 'tumour'],
    adc: ['adc', 'antibody-drug conjugate', 'antibody drug conjugate'],
    'biologic (antibody)': ['antibody', 'biologic'],
    radiopharmaceutical: ['radiopharmaceutical', 'radioligand', 'radioisotope'],
    diagnostics: ['diagnostic'],
    biomarker: ['biomarker'],
    imaging: ['imaging'],
    'liquid biopsy': ['liquid biopsy'],
    'cell therapy': ['cell therapy'],
    'gene therapy': ['gene therapy'],
    vaccine: ['vaccine'],
  };
  return cleanList([
    ...(icp.therapeutic_areas || []),
    ...(icp.modalities || []),
    icp.platform_category,
  ], 20).flatMap((value) => aliases[value.toLowerCase()] || [value.toLowerCase()]);
}

/**
 * Hard negative screen for pre-purchase company acquisition.
 *
 * This deliberately does NOT decide ICP fit. It only catches categories we
 * should not spend money on unless the ICP explicitly targets that account
 * type. Nuanced fit now belongs to the LLM screen in the job runner.
 */
export function apolloOrganizationHardRejectReason(
  org: { name?: string | null; short_description?: string | null; industry?: string | null },
  icp: AcquisitionIcp,
): string | null {
  const text = evidenceText(org);
  if (!text) return 'missing_company_evidence';

  const type = (icp.company_type || '').toLowerCase();
  const isCroTarget = type.includes('cro') || type.includes('contract research');
  const isCdmoTarget = type.includes('cdmo') || type.includes('contract development');
  const isHospitalTarget = type.includes('hospital') || type.includes('health system');
  const isAcademicTarget = type.includes('academic') || type.includes('research institute');

  const universalNonOperatingOrBuyer = [
    /\bprofessional (association|society)\b/,
    /\bnon-?profit (association|society|advocacy|foundation)\b/,
    /\bnews\b/,
    /\bmedia\b/,
    /\bpublishing\b/,
    /\bjournal\b/,
    /\bhealth (insurance|insurer|plan|plans|benefits?)\b/,
    /\binsurance (company|carrier|provider|plan|plans|services?)\b/,
    /\bmanaged care\b/,
    /\bmedicare\b/,
    /\bmedicaid\b/,
    /\bpayer(s)?\b/,
    /\bveterinary\b/,
    /\banimal (hospital|clinic|care|health|healthcare|medicine)\b/,
    /\bpet (care|health|healthcare|medicine|wellness|insurance|services?)\b/,
  ];
  if (containsAny(text, universalNonOperatingOrBuyer)) return 'explicit_non_target_category';

  const croEvidence = containsAny(text, [
    /\bcontract research organi[sz]ation\b/,
    /\bclinical research organi[sz]ation\b/,
    /\bcro\b/,
    /\bclinical trial services\b/,
  ]);
  const cdmoEvidence = containsAny(text, [
    /\bcdmo\b/,
    /\bcontract development\b/,
    /\bcontract manufacturing\b/,
  ]);
  const hospitalEvidence = containsAny(text, [
    /\bhospital\b/,
    /\bhealth system\b/,
    /\bhealthcare system\b/,
    /\bmedical center\b/,
    /\bmedical centre\b/,
    /\bclinic\b/,
  ]);
  const academicEvidence = containsAny(text, [
    /\buniversity\b/,
    /\bacademic (institute|institution|center|centre|organization|medical center|medical centre)\b/,
    /\bresearch (institute|institution|center|centre)\b/,
  ]);

  if (isCroTarget) return croEvidence ? null : 'not_a_cro';
  if (isCdmoTarget) return cdmoEvidence ? null : 'not_a_cdmo';
  if (isHospitalTarget) return hospitalEvidence ? null : 'not_a_hospital_or_health_system';
  if (isAcademicTarget) return academicEvidence ? null : 'not_an_academic_or_research_org';

  if (croEvidence) return 'cro_not_targeted_by_icp';
  if (cdmoEvidence) return 'cdmo_not_targeted_by_icp';
  if (hospitalEvidence) return 'hospital_not_targeted_by_icp';

  if (type.includes('biotech') || type.includes('biopharma') || type.includes('pharma')) {
    if (academicEvidence) return 'academic_org_not_targeted_by_biopharma_icp';
    return null;
  }

  if (type.includes('tools') || type.includes('instrument')) {
    const researchBuyerEvidence = containsAny(text, [
      /\blife sciences? research\b/,
      /\bbiomedical research\b/,
      /\bresearch (lab|labs|laboratory|laboratories|institute|institution|center|centre)\b/,
      /\bacademic (research|medical center|medical centre)\b/,
    ]);
    if (academicEvidence && !researchBuyerEvidence) return 'academic_admin_not_research_buyer';
    return null;
  }

  return null;
}

/**
 * Back-compat helper for tests and callers that still need a synchronous local
 * screen. `true` now means "not hard-rejected", not "confirmed ICP fit".
 */
export function apolloOrganizationMatchesIcp(
  org: { name?: string | null; short_description?: string | null; industry?: string | null },
  icp: AcquisitionIcp,
): boolean {
  return apolloOrganizationHardRejectReason(org, icp) == null;
}
