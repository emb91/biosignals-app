export const PLATFORM_CATEGORY_MAX_WORDS = 4;
export const PLATFORM_CATEGORY_MAX_CHARS = 48;

const PLATFORM_CATEGORY_ACRONYMS: Record<string, string> = {
  ai: 'AI',
  ml: 'ML',
  crm: 'CRM',
  lims: 'LIMS',
  gxp: 'GxP',
};

const LEGACY_PLATFORM_CATEGORY_ALIASES: Record<string, string> = {
  'ai ml platform': 'AI Platform',
  'ai platform': 'AI Platform',
  ai: 'AI Platform',
  ml: 'AI Platform',
  'machine learning': 'AI Platform',
  'machine learning platform': 'AI Platform',
  'drug discovery platform': 'Drug Discovery Platform',
  'sales intelligence': 'Sales Intelligence Platform',
  'sales intelligence platform': 'Sales Intelligence Platform',
  'sales platform': 'Sales Platform',
  'prospecting platform': 'Prospecting Platform',
  'lead generation platform': 'Lead Generation Platform',
  'market intelligence': 'Market Intelligence Platform',
  'market intelligence platform': 'Market Intelligence Platform',
  'commercial intelligence': 'Commercial Intelligence Platform',
  'scientific intelligence': 'Scientific Intelligence Platform',
  'scientific content and analytics': 'Scientific Content Platform',
  'scientific content and analytics platform': 'Scientific Content Platform',
  'business intelligence': 'Business Intelligence Platform',
  'intelligence platform': 'Intelligence Platform',
  'analytics platform': 'Analytics Platform',
  'scientific content platform': 'Scientific Content Platform',
};

/** Canonical SaaS platform buckets for constrained UI selects. */
export const PLATFORM_CATEGORY_OPTIONS: readonly string[] = Array.from(
  new Set(Object.values(LEGACY_PLATFORM_CATEGORY_ALIASES)),
).sort((a, b) => a.localeCompare(b));

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCaseWord(word: string): string {
  const acronym = PLATFORM_CATEGORY_ACRONYMS[word];
  if (acronym) return acronym;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function titleCasePhrase(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) =>
      word
        .split('-')
        .map((segment) => titleCaseWord(segment))
        .join('-')
    )
    .join(' ');
}

function validateNormalizedPhrase(value: string): string | null {
  if (!value) return null;
  if (value.includes(' and ')) return null;
  if (value.includes('/')) return null;

  const words = value.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > PLATFORM_CATEGORY_MAX_WORDS) return null;

  if (!words.every((word) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(word))) {
    return null;
  }

  return titleCasePhrase(words.join(' '));
}

export function normalizePlatformCategory(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim().replace(/[.,;:]+$/g, '');
  if (!trimmed) return null;

  const normalized = normalizeText(trimmed);
  if (!normalized) return null;

  const aliased = LEGACY_PLATFORM_CATEGORY_ALIASES[normalized];
  if (aliased) return aliased;

  return validateNormalizedPhrase(normalized);
}

function sanitizePlatformCategoryText(value: string): string {
  return value
    .trim()
    .replace(/[.,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePlatformCategoryForStorage(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const sanitized = sanitizePlatformCategoryText(value);
  if (!sanitized) return null;

  return normalizePlatformCategory(sanitized) ?? sanitized;
}

export function inferPlatformCategoryFromLegacyModalities(values: unknown): string | null {
  const items = Array.isArray(values) ? values : typeof values === 'string' ? [values] : [];

  for (const item of items) {
    if (typeof item !== 'string') continue;
    const normalized = normalizeText(item);
    const aliased = LEGACY_PLATFORM_CATEGORY_ALIASES[normalized];
    if (aliased) return aliased;
  }

  return null;
}

export function normalizePlatformTaxonomyFields<T extends Record<string, unknown>>(
  record: T,
  options?: {
    platformCategoryKey?: string;
    modalitiesKey?: string;
  },
): T & { platform_category?: string | null; modalities?: string[] } {
  const platformCategoryKey = options?.platformCategoryKey ?? 'platform_category';
  const modalitiesKey = options?.modalitiesKey ?? 'modalities';

  const rawPlatformCategory = record[platformCategoryKey];
  const rawModalities = record[modalitiesKey];
  const modalities = Array.isArray(rawModalities)
    ? rawModalities.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : typeof rawModalities === 'string' && rawModalities.trim()
      ? [rawModalities.trim()]
      : [];

  let platformCategory = normalizePlatformCategoryForStorage(rawPlatformCategory);
  const cleanedModalities: string[] = [];

  for (const modality of modalities) {
    const inferred = inferPlatformCategoryFromLegacyModalities(modality);
    if (inferred) {
      if (!platformCategory) platformCategory = inferred;
      continue;
    }
    cleanedModalities.push(modality);
  }

  return {
    ...record,
    [platformCategoryKey]: platformCategory,
    [modalitiesKey]: cleanedModalities,
  } as T & { platform_category?: string | null; modalities?: string[] };
}

export function parsePlatformCategoryInput(value: unknown): {
  value: string | null;
  error: string | null;
} {
  if (value == null) {
    return { value: null, error: null };
  }

  if (typeof value !== 'string') {
    return {
      value: null,
      error: `Platform category must be plain text with at most ${PLATFORM_CATEGORY_MAX_CHARS} characters.`,
    };
  }

  const sanitized = sanitizePlatformCategoryText(value);
  if (!sanitized) return { value: null, error: null };

  if (sanitized.length > PLATFORM_CATEGORY_MAX_CHARS) {
    return {
      value: null,
      error: `Platform category must be ${PLATFORM_CATEGORY_MAX_CHARS} characters or fewer.`,
    };
  }

  return { value: normalizePlatformCategoryForStorage(sanitized), error: null };
}
