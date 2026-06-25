import {
  canonicalizeBusinessArea,
  canonicalizeSeniorityLevel,
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

export function normalizePersonaTaxonomyPayload(body: Record<string, unknown>) {
  return {
    functions: canonicalArray(body.functions, canonicalizeBusinessArea),
    seniority_levels: canonicalArray(
      body.seniorityLevels ?? body.seniority_levels,
      canonicalizeSeniorityLevel,
    ),
  };
}
