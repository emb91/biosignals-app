/**
 * Company name normalization helper used by the resolver
 * (lib/companies/resolve-mentions.ts) and by sync jobs to populate
 * `*_normalized` columns at ingest.
 *
 * Historical note: this file used to also export `buildCompanyQueryVariants`
 * which generated ILIKE substring variants for fuzzy DB matching. That whole
 * approach was replaced by the canonical-company resolver in Phase 2/3 —
 * each monitor now does indexed equality/overlap on `canonical_company_id`
 * or `mentioned_company_ids` instead of fuzzy text matching. Removed in
 * Phase 5.
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
