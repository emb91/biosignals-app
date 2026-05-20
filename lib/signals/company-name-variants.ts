/**
 * Shared helpers for generating company name variants used to match
 * external data sources (patent assignees, FDA sponsor names, ClinicalTrials.gov
 * sponsors, etc.) where the same company can appear under different legal
 * entity names, subsidiaries, and minor formatting variations.
 *
 * For high-quality matching, populate a per-company `aliases TEXT[]` column
 * via LLM lookup (see lib/signals/company-aliases.ts) and pass those aliases
 * here as `extraAliases`.
 */

const ENTITY_SUFFIX_PATTERN =
  /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|gmbh|ag|sa|nv|pty|holdings|holding|group|international|intl)\b/g;

/**
 * Lowercase, strip common entity suffixes ("Inc", "Corp", "Ltd", …), collapse
 * whitespace. Used to compare two names for "are they the same company".
 */
export function normalizeCompanyForMatching(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
    .replace(ENTITY_SUFFIX_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build a list of plausible search variants for a single company name.
 *
 * Returns variants in roughly decreasing specificity (original first,
 * normalized last). Filters out variants shorter than 4 characters because
 * those produce too many false positives.
 *
 * Pass `extraAliases` to include LLM-derived legal entity names and
 * subsidiaries. Those are inserted near the top so source searches prefer
 * them — usually they're more accurate than text-derived variants.
 */
export function buildCompanyQueryVariants(
  companyName: string,
  extraAliases: string[] = [],
): string[] {
  const variants: string[] = [];
  const original = companyName.trim();
  if (original) variants.push(original);
  for (const alias of extraAliases) {
    const trimmed = (alias ?? '').trim();
    if (trimmed) variants.push(trimmed);
  }
  const normalized = normalizeCompanyForMatching(companyName);
  if (normalized && normalized !== original.toLowerCase()) variants.push(normalized);
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length >= 2) variants.push(tokens.slice(0, 2).join(' '));
  if (tokens.length >= 3) variants.push(tokens.slice(0, 3).join(' '));

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const v of variants) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    if (key.length < 4) continue;
    seen.add(key);
    deduped.push(v);
  }
  return deduped;
}
