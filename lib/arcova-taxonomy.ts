export const COMPANY_TYPE_OPTIONS = [
  {
    value: 'Biotech / Biopharma',
    description: 'Early to mid-stage companies developing novel therapeutics',
  },
  { value: 'Pharma', description: 'Large established pharmaceutical companies' },
  {
    value: 'CDMO',
    description: 'Contract development and manufacturing organisations',
  },
  { value: 'CRO', description: 'Contract research organisations' },
  { value: 'Medical Device', description: 'Device and diagnostics companies' },
  {
    value: 'Diagnostics',
    description: 'Companies developing diagnostic assays, tests, or testing platforms',
  },
  {
    value: 'Life Science Tools & Instruments',
    description: 'Equipment, reagents, consumables, and enabling technology for research and production',
  },
  {
    value: 'Digital Health & Informatics',
    description: 'Patient, clinical, care-delivery, or healthcare informatics software including digital therapeutics',
  },
  {
    value: 'Academic / Research Institute',
    description: 'Universities, research hospitals, and publicly-funded research organisations',
  },
  {
    value: 'Hospital / Health System',
    description: 'Hospital networks, health systems, and academic medical centres',
  },
  {
    value: 'Contract Lab & Testing Services',
    description: 'Contract analytical, bioanalytical, QC, stability, and environmental testing labs',
  },
  {
    value: 'SaaS',
    description: 'Software-as-a-service, data, workflow, CRM, sales intelligence, or market intelligence platforms',
  },
  {
    value: 'Other',
    description: 'Companies that do not fit any other life science or health technology category — use when the company is clearly identifiable but outside the standard taxonomy',
  },
] as const;

export const THERAPEUTIC_AREA_OPTIONS = [
  'Oncology',
  'Haematology',
  'Rare Disease',
  'Neuroscience',
  'Immunology',
  'Cardiovascular',
  'Infectious Disease',
  'Metabolic Disease',
  'Ophthalmology',
  'Respiratory',
  'Gastroenterology',
  'Dermatology',
  'Renal',
  'Women\'s Health',
  'Other',
] as const;

export const MODALITY_OPTIONS = [
  'Small Molecule',
  'Biologic (Antibody)',
  'Bispecific Antibody',
  'ADC',
  'Cell Therapy',
  'CAR-T',
  'TCR-T',
  'TIL Therapy',
  'NK Cell Therapy',
  'Stem Cell Therapy',
  'Gene Therapy',
  'Viral Vector',
  'RNA Therapy',
  'mRNA',
  'siRNA',
  'ASO',
  'Peptide',
  'Oligonucleotide',
  'Radiopharmaceutical',
  'Protein / Enzyme Replacement',
  'Gene Editing (CRISPR)',
  'Microbiome',
  'Biosimilar',
  'Vaccine',
  'Diagnostics',
  'Liquid Biopsy',
  'Digital Therapeutics',
  'Biomarker',
  'Imaging',
] as const;

export const MODALITY_PARENT_MAP: Partial<Record<Modality, Modality[]>> = {
  'CAR-T': ['Cell Therapy'],
  'TCR-T': ['Cell Therapy'],
  'TIL Therapy': ['Cell Therapy'],
  'NK Cell Therapy': ['Cell Therapy'],
  'Stem Cell Therapy': ['Cell Therapy'],
  'Viral Vector': ['Gene Therapy'],
  mRNA: ['RNA Therapy'],
  siRNA: ['RNA Therapy', 'Oligonucleotide'],
  ASO: ['RNA Therapy', 'Oligonucleotide'],
  'Bispecific Antibody': ['Biologic (Antibody)'],
  ADC: ['Biologic (Antibody)'],
  'Liquid Biopsy': ['Diagnostics'],
};

export const DEVELOPMENT_STAGE_OPTIONS = [
  'Preclinical',
  'Phase I',
  'Phase II',
  'Phase III',
  'Commercial',
  'All stages',
] as const;

export const COMPANY_SIZE_OPTIONS = ['1–10', '11–50', '51–200', '201–500', '500–1,000', '1,000–10,000', '10,000–50,000', '50,000+'] as const;

export const LI_FOLLOWER_OPTIONS = ['0–500', '500–1,000', '1,000–5,000', '5,000–10,000', '10,000–50,000', '50,000+'] as const;

export function followerCountToFollowerBucket(count: number | null | undefined): string[] {
  if (count == null || count < 0) return [];
  if (count <= 500)    return ['0–500'];
  if (count <= 1000)   return ['500–1,000'];
  if (count <= 5000)   return ['1,000–5,000'];
  if (count <= 10000)  return ['5,000–10,000'];
  if (count <= 50000)  return ['10,000–50,000'];
  return ['50,000+'];
}

/**
 * Maps a raw employee count (or a range string like "51-200") to the canonical
 * COMPANY_SIZE_OPTIONS bucket. Returns a single-element array so it can be
 * spread directly into companySizes[], or an empty array if both inputs are null.
 */
export function employeeCountToSizeBucket(
  count: number | null | undefined,
  range?: string | null,
): string[] {
  if (count != null && count > 0) {
    if (count <= 10)    return ['1–10'];
    if (count <= 50)    return ['11–50'];
    if (count <= 200)   return ['51–200'];
    if (count <= 500)   return ['201–500'];
    if (count <= 1000)  return ['500–1,000'];
    if (count <= 10000) return ['1,000–10,000'];
    if (count <= 50000) return ['10,000–50,000'];
    return ['50,000+'];
  }
  // Fall back to range string e.g. "51-200", "201-500", "1001-5000"
  if (range) {
    const lower = parseInt(range.split(/[-–]/)[0].replace(/[^0-9,]/g, '').replace(/,/g, ''), 10);
    if (!isNaN(lower)) {
      if (lower <= 10)    return ['1–10'];
      if (lower <= 50)    return ['11–50'];
      if (lower <= 200)   return ['51–200'];
      if (lower <= 500)   return ['201–500'];
      if (lower <= 1000)  return ['500–1,000'];
      if (lower <= 10000) return ['1,000–10,000'];
      if (lower <= 50000) return ['10,000–50,000'];
      return ['50,000+'];
    }
  }
  return [];
}

export const FUNDING_STAGE_OPTIONS = [
  'Bootstrapped',
  'Pre-seed',
  'Seed',
  'Series A',
  'Series B',
  'Series C',
  'Series D+',
  'Public',
  'Grant-funded',
  'Non-profit',
] as const;

/** LinkedIn-style industry buckets for firmographics (user company profile editing). */
export const INDUSTRY_OPTIONS = [
  'Biotechnology',
  'Pharmaceuticals',
  'Medical Devices',
  'Medical Practice',
  'Hospital & Health Care',
  'Life Science Research',
  'Higher Education',
  'Computer Software',
  'Information Technology & Services',
  'Internet',
  'Market Research',
  'Marketing & Advertising',
  'Management Consulting',
  'Computer & Network Security',
  'Health, Wellness & Fitness',
  'Venture Capital & Private Equity',
  'Law Practice',
  'Financial Services',
  'Chemicals',
  'Machinery',
  'Electrical/Electronic Manufacturing',
  'Insurance',
  'Non-profit Organization Management',
  'Government Administration',
  'Other',
] as const;

export const BUSINESS_AREA_OPTIONS = [
  'Executive Leadership',
  'Business Development',
  'Partnerships',
  'Clinical Operations',
  'Research & Development',
  'Regulatory Affairs',
  'Manufacturing & CMC',
  'Medical Affairs',
  'Commercial',
  'Sales Operations',
  'Procurement',
  'Strategy & Corporate Development',
  'Lab Operations',
  'Technology & Systems',
  'AI & Machine Learning',
  'Data & Informatics',
  'Library & Information Services',
  'Quality & Compliance',
  'Marketing',
] as const;

export const SENIORITY_LEVEL_OPTIONS = [
  'C-Level',
  'VP / SVP',
  'Director',
  'Head of / Senior Manager',
  'Manager',
  'Individual Contributor',
] as const;

export type CompanyType = (typeof COMPANY_TYPE_OPTIONS)[number]['value'];
export type TherapeuticArea = (typeof THERAPEUTIC_AREA_OPTIONS)[number];
export type Modality = (typeof MODALITY_OPTIONS)[number];
export type DevelopmentStage = (typeof DEVELOPMENT_STAGE_OPTIONS)[number];
export type CompanySize = (typeof COMPANY_SIZE_OPTIONS)[number];
export type LiFollowerSize = (typeof LI_FOLLOWER_OPTIONS)[number];
export type FundingStage = (typeof FUNDING_STAGE_OPTIONS)[number];
export type IndustryOption = (typeof INDUSTRY_OPTIONS)[number];
export type BusinessArea = (typeof BUSINESS_AREA_OPTIONS)[number];
export type SeniorityLevel = (typeof SENIORITY_LEVEL_OPTIONS)[number];

/** Drop case-insensitive duplicates; keep first occurrence (canonical list order). */
export function dedupeStringsCaseInsensitiveKeepOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const s = raw.trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/**
 * Build `<select>` option values: taxonomy list plus a custom stored value when missing.
 * Dedupes so API values that match case-insensitively (or repeat) do not appear twice.
 */
export function selectOptionsWithCurrentValue(
  options: readonly string[],
  current?: string | null,
): string[] {
  const c = (current ?? '').trim();
  const base = dedupeStringsCaseInsensitiveKeepOrder([...options]);
  if (!c) return base;
  if (base.some((o) => o.toLowerCase() === c.toLowerCase())) return base;
  return dedupeStringsCaseInsensitiveKeepOrder([c, ...base]);
}

/** Canonical industry label when legacy enrichment stored `"Research"` (ambiguous vs Market Research). */
export function normalizeIndustrySelectValue(raw: string | null | undefined): string {
  const t = (raw ?? '').trim();
  if (!t) return '';
  if (t.toLowerCase() === 'research') return 'Life Science Research';
  return t;
}

function normalizeTaxonomyText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalizeFromOptions<T extends string>(
  value: unknown,
  options: readonly T[]
): T | null {
  if (typeof value !== 'string') return null;

  const normalized = normalizeTaxonomyText(value);
  if (!normalized) return null;

  return (
    options.find((option) => normalizeTaxonomyText(option) === normalized) ??
    null
  );
}

export function canonicalizeCompanyType(value: unknown): CompanyType | null {
  if (typeof value !== 'string') return null;

  const aliases: Record<string, CompanyType> = {
    biotech: 'Biotech / Biopharma',
    biopharma: 'Biotech / Biopharma',
    'biotech biopharma': 'Biotech / Biopharma',
    pharmaceutical: 'Pharma',
    pharma: 'Pharma',
    spinout: 'Biotech / Biopharma',
    'university spinout': 'Biotech / Biopharma',
    'contract development manufacturing organisation': 'CDMO',
    'contract development manufacturing organization': 'CDMO',
    'contract research organisation': 'CRO',
    'contract research organization': 'CRO',
    diagnostic: 'Diagnostics',
    diagnostics: 'Diagnostics',
    'life science tools': 'Life Science Tools & Instruments',
    'life science tools and instruments': 'Life Science Tools & Instruments',
    instruments: 'Life Science Tools & Instruments',
    reagents: 'Life Science Tools & Instruments',
    platform: 'Life Science Tools & Instruments',
    tools: 'Life Science Tools & Instruments',
    'platform tools': 'Life Science Tools & Instruments',
    'digital health': 'Digital Health & Informatics',
    'digital health and informatics': 'Digital Health & Informatics',
    informatics: 'Digital Health & Informatics',
    'health tech': 'Digital Health & Informatics',
    healthtech: 'Digital Health & Informatics',
    software: 'SaaS',
    saas: 'SaaS',
    'software as a service': 'SaaS',
    'software platform': 'SaaS',
    'data platform': 'SaaS',
    'market intelligence': 'SaaS',
    'business intelligence': 'SaaS',
    'sales intelligence': 'SaaS',
    crm: 'SaaS',
    university: 'Academic / Research Institute',
    academic: 'Academic / Research Institute',
    'research institute': 'Academic / Research Institute',
    'research hospital': 'Academic / Research Institute',
    'contract lab': 'Contract Lab & Testing Services',
    'contract laboratory': 'Contract Lab & Testing Services',
    'testing lab': 'Contract Lab & Testing Services',
    'testing laboratory': 'Contract Lab & Testing Services',
    'lab services': 'Contract Lab & Testing Services',
    'analytical lab': 'Contract Lab & Testing Services',
    'bioanalytical lab': 'Contract Lab & Testing Services',
    'contract testing': 'Contract Lab & Testing Services',
    hospital: 'Hospital / Health System',
    'health system': 'Hospital / Health System',
    'hospital network': 'Hospital / Health System',
    'academic medical centre': 'Hospital / Health System',
    'academic medical center': 'Hospital / Health System',
    nhs: 'Hospital / Health System',
    'integrated delivery network': 'Hospital / Health System',
    idn: 'Hospital / Health System',
  };

  const normalized = normalizeTaxonomyText(value);
  return aliases[normalized] ?? canonicalizeFromOptions(value, COMPANY_TYPE_OPTIONS.map((option) => option.value));
}

export function canonicalizeTherapeuticArea(value: unknown): TherapeuticArea | null {
  if (typeof value !== 'string') return null;

  const aliases: Record<string, TherapeuticArea> = {
    hematology: 'Haematology',
    haematology: 'Haematology',
    blood: 'Haematology',
    'blood disorders': 'Haematology',
    'blood cancers': 'Haematology',
    cancer: 'Oncology',
    'immuno oncology': 'Oncology',
    'infectious diseases': 'Infectious Disease',
    metabolic: 'Metabolic Disease',
    ophthalmic: 'Ophthalmology',
    eye: 'Ophthalmology',
    kidney: 'Renal',
    nephrology: 'Renal',
    dermatologic: 'Dermatology',
    'respiratory disease': 'Respiratory',
  };

  const normalized = normalizeTaxonomyText(value);
  return aliases[normalized] ?? canonicalizeFromOptions(value, THERAPEUTIC_AREA_OPTIONS);
}

export function canonicalizeModality(value: unknown): Modality | null {
  if (typeof value !== 'string') return null;

  const aliases: Record<string, Modality> = {
    antibody: 'Biologic (Antibody)',
    antibodies: 'Biologic (Antibody)',
    mab: 'Biologic (Antibody)',
    'monoclonal antibody': 'Biologic (Antibody)',
    bispecific: 'Bispecific Antibody',
    'antibody drug conjugate': 'ADC',
    cart: 'CAR-T',
    'car t': 'CAR-T',
    'car t cell therapy': 'CAR-T',
    tcrt: 'TCR-T',
    'tcr t': 'TCR-T',
    til: 'TIL Therapy',
    'nk cells': 'NK Cell Therapy',
    'natural killer cell therapy': 'NK Cell Therapy',
    'gene editing': 'Gene Editing (CRISPR)',
    crispr: 'Gene Editing (CRISPR)',
    aav: 'Viral Vector',
    lentiviral: 'Viral Vector',
    'viral vectors': 'Viral Vector',
    sirna: 'siRNA',
    'small interfering rna': 'siRNA',
    antisense: 'ASO',
    aso: 'ASO',
    mrna: 'mRNA',
    'protein enzyme replacement': 'Protein / Enzyme Replacement',
    enzyme: 'Protein / Enzyme Replacement',
    biomarker: 'Biomarker',
    biomarkers: 'Biomarker',
    imaging: 'Imaging',
    diagnostic: 'Diagnostics',
    diagnostics: 'Diagnostics',
  };

  const normalized = normalizeTaxonomyText(value);
  return aliases[normalized] ?? canonicalizeFromOptions(value, MODALITY_OPTIONS);
}

export function canonicalizeDevelopmentStage(value: unknown): DevelopmentStage | null {
  if (typeof value !== 'string') return null;

  const aliases: Record<string, DevelopmentStage> = {
    'phase 1': 'Phase I',
    phase1: 'Phase I',
    'phase i': 'Phase I',
    'phase 2': 'Phase II',
    phase2: 'Phase II',
    'phase ii': 'Phase II',
    'phase 3': 'Phase III',
    phase3: 'Phase III',
    'phase iii': 'Phase III',
    approved: 'Commercial',
    marketed: 'Commercial',
    discovery: 'Preclinical',
    research: 'Preclinical',
    'research stage': 'Preclinical',
    'all stage': 'All stages',
    'all stages': 'All stages',
  };

  const normalized = normalizeTaxonomyText(value);
  return aliases[normalized] ?? canonicalizeFromOptions(value, DEVELOPMENT_STAGE_OPTIONS);
}

export function canonicalizeCompanySize(value: unknown): CompanySize | null {
  return canonicalizeFromOptions(value, COMPANY_SIZE_OPTIONS);
}

export function canonicalizeLiFollowerSize(value: unknown): LiFollowerSize | null {
  return canonicalizeFromOptions(value, LI_FOLLOWER_OPTIONS);
}

export function canonicalizeBusinessArea(value: unknown): BusinessArea | null {
  return canonicalizeFromOptions(value, BUSINESS_AREA_OPTIONS);
}

export function canonicalizeSeniorityLevel(value: unknown): SeniorityLevel | null {
  return canonicalizeFromOptions(value, SENIORITY_LEVEL_OPTIONS);
}

export function expandModalitiesWithParents(values: readonly Modality[]): Modality[] {
  const expanded: Modality[] = [];

  for (const value of values) {
    for (const parent of MODALITY_PARENT_MAP[value] ?? []) {
      if (!expanded.includes(parent)) expanded.push(parent);
    }
    if (!expanded.includes(value)) expanded.push(value);
  }

  return expanded;
}

/**
 * Maps an Apollo funding stage string and/or total funding amount to a
 * canonical FUNDING_STAGE_OPTIONS value.
 *
 * Apollo returns snake_case strings (e.g. "series_a", "pre_seed", "public").
 * When stage is absent but total_funding_usd is known, the amount is bucketed.
 */
export function canonicalizeFundingStage(
  stage: string | null | undefined,
  totalFundingUsd: number | null | undefined,
  companyStatus?: string | null,
): FundingStage | null {
  if (stage) {
    const exact = canonicalizeFromOptions(stage, FUNDING_STAGE_OPTIONS);
    if (exact) return exact;

    const normalized = stage.trim().toLowerCase().replace(/[\s-]+/g, '_');
    const stageMap: Record<string, FundingStage> = {
      bootstrapped: 'Bootstrapped',
      bootstrap: 'Bootstrapped',
      self_funded: 'Bootstrapped',
      self_financed: 'Bootstrapped',
      pre_seed: 'Pre-seed',
      preseed: 'Pre-seed',
      angel: 'Pre-seed',
      seed: 'Seed',
      series_a: 'Series A',
      series_b: 'Series B',
      series_c: 'Series C',
      series_d: 'Series D+',
      series_e: 'Series D+',
      series_f: 'Series D+',
      series_g: 'Series D+',
      series_h: 'Series D+',
      private_equity: 'Series D+',
      growth: 'Series D+',
      late_stage: 'Series D+',
      ipo: 'Public',
      public: 'Public',
      post_ipo: 'Public',
      grant: 'Grant-funded',
      government_grant: 'Grant-funded',
      sbir: 'Grant-funded',
      sttr: 'Grant-funded',
      non_profit: 'Non-profit',
      nonprofit: 'Non-profit',
      donation: 'Non-profit',
      charity: 'Non-profit',
      foundation: 'Non-profit',
    };
    if (stageMap[normalized]) return stageMap[normalized];
  }

  // Explicit zero or sub-$1M means bootstrapped — at that scale it's typically founder/F&F money, not an institutional round
  if (totalFundingUsd === 0) return 'Bootstrapped';
  if (totalFundingUsd != null && totalFundingUsd > 0 && totalFundingUsd < 1_000_000) return 'Bootstrapped';

  // Amount-based fallback when stage is absent or unmapped
  if (totalFundingUsd != null && totalFundingUsd > 0) {
    if (totalFundingUsd < 3_000_000)   return 'Pre-seed';
    if (totalFundingUsd < 10_000_000)  return 'Seed';
    if (totalFundingUsd < 30_000_000)  return 'Series A';
    if (totalFundingUsd < 100_000_000) return 'Series B';
    if (totalFundingUsd < 300_000_000) return 'Series C';
    return 'Series D+';
  }

  // Final fallback: scan free-text company_status for stage keywords
  if (companyStatus) {
    const s = companyStatus.toLowerCase();
    if (/bootstrapp|self[\s-]?fund|self[\s-]?financ/.test(s)) return 'Bootstrapped';
    if (/series\s*d|series\s*e|series\s*f|series\s*g|late[\s-]?stage|growth\s+(round|equity)/.test(s)) return 'Series D+';
    if (/series\s*c\b/.test(s)) return 'Series C';
    if (/series\s*b\b/.test(s)) return 'Series B';
    if (/series\s*a\b/.test(s)) return 'Series A';
    if (/\bseed\b/.test(s)) return 'Seed';
    if (/pre[\s-]?seed|angel/.test(s)) return 'Pre-seed';
    if (/\bipo\b|publicly\s+(traded|listed)|\bpublic\b/.test(s)) return 'Public';
    if (/grant[\s-]?fund|sbir|sttr|government\s+grant/.test(s)) return 'Grant-funded';
    if (/non[\s-]?profit|nonprofit|donation[\s-]?fund|charity|foundation/.test(s)) return 'Non-profit';
  }

  return null;
}

/**
 * Returns a human-readable funding bracket string from a raw USD amount.
 * Used to give the buying-team LLM richer context about company scale.
 * e.g. 800_000 → "< $2M (Pre-seed / Bootstrapped)"
 */
export function totalFundingToBracket(totalFundingUsd: number | null | undefined): string | null {
  if (totalFundingUsd == null) return null;
  if (totalFundingUsd === 0)         return 'Bootstrapped (no external funding recorded)';
  if (totalFundingUsd < 2_000_000)   return `< $2M (Pre-seed / early angel)`;
  if (totalFundingUsd < 10_000_000)  return `$2M–$10M (Seed)`;
  if (totalFundingUsd < 30_000_000)  return `$10M–$30M (Series A)`;
  if (totalFundingUsd < 100_000_000) return `$30M–$100M (Series B)`;
  if (totalFundingUsd < 300_000_000) return `$100M–$300M (Series C)`;
  return `$300M+ (Series D+ / late-stage)`;
}

/**
 * Returns a clean dollar-range label for UI display.
 * Unlike totalFundingToBracket, omits stage-name hints that can conflict with
 * the separately-displayed funding stage (e.g. a Series C company at $50M
 * shouldn't show "$30M–$100M (Series B)").
 */
export function fundingAmountDisplayBucket(totalFundingUsd: number | null | undefined): string | null {
  if (totalFundingUsd == null) return null;
  if (totalFundingUsd === 0)         return 'Bootstrapped';
  if (totalFundingUsd < 2_000_000)   return '< $2M raised';
  if (totalFundingUsd < 10_000_000)  return '$2M–$10M raised';
  if (totalFundingUsd < 30_000_000)  return '$10M–$30M raised';
  if (totalFundingUsd < 100_000_000) return '$30M–$100M raised';
  if (totalFundingUsd < 300_000_000) return '$100M–$300M raised';
  return '$300M+ raised';
}

export const ARR_BUCKET_OPTIONS = [
  'Pre-revenue',
  '< $1M ARR',
  '$1M–$5M ARR',
  '$5M–$20M ARR',
  '$20M–$50M ARR',
  '$50M–$100M ARR',
  '$100M+ ARR',
] as const;

export type ArrBucket = (typeof ARR_BUCKET_OPTIONS)[number];

/**
 * Parses Claude's free-text ARR estimate (e.g. "~$5M", "<$1M", "$10M–$20M")
 * into a canonical ARR bucket. Returns null if the input can't be parsed.
 */
export function arrEstimateToBucket(estimate: string | null | undefined): ArrBucket | null {
  if (!estimate) return null;
  const s = estimate.toLowerCase().replace(/,/g, '');

  // Pre-revenue signals
  if (/pre[\s-]?revenue|no\s+revenue|not\s+yet\s+generat/.test(s)) return 'Pre-revenue';

  // Extract the first meaningful dollar figure
  const match = s.match(/([<>~≈]?\s*\$?\s*[\d.]+\s*[mbk]?)/i);
  if (!match) return null;

  const raw = match[1].replace(/\s/g, '');
  const isLessThan = raw.startsWith('<');
  const numStr = raw.replace(/[^0-9.]/g, '');
  let value = parseFloat(numStr);
  if (isNaN(value)) return null;

  // Normalise to dollars
  const lower = raw.toLowerCase();
  if (lower.includes('b')) value *= 1_000_000_000;
  else if (lower.includes('m')) value *= 1_000_000;
  else if (lower.includes('k')) value *= 1_000;

  // If "<$1M" treat as upper bound, shift down a bracket
  if (isLessThan) value = value * 0.5;

  if (value < 1_000_000)   return '< $1M ARR';
  if (value < 5_000_000)   return '$1M–$5M ARR';
  if (value < 20_000_000)  return '$5M–$20M ARR';
  if (value < 50_000_000)  return '$20M–$50M ARR';
  if (value < 100_000_000) return '$50M–$100M ARR';
  return '$100M+ ARR';
}
