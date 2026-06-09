/**
 * Company merge + identifier safety primitives.
 *
 * These exist to prevent two recurring, costly bug classes (both hit in
 * production — see memory/project_enrichment_safety.md):
 *
 *  1. DESTRUCTIVE IDENTITY CLOBBER — a later enrichment overwrites a canonical
 *     company's identity (name / domain / LinkedIn) with freshly-fetched values
 *     from a FUZZY provider match. Real example: enriching "Moderna"
 *     (moderna.com) let Apollo's fuzzy match return "Moderna Housewares"
 *     (modernahousewares.com) and clobber the biotech's row. Identity fields are
 *     STICKY: once a canonical row has them, existing wins.
 *
 *  2. OVERLY-PERMISSIVE EXTERNAL LOOKUP — passing several weak identifiers
 *     (especially a bare company name) to Apollo/Apify lets the provider fuzzy
 *     match the wrong entity. A single strong identifier (domain or LinkedIn)
 *     pins it exactly.
 *
 * Pure functions only (no DB/LLM deps) so they're unit-testable via node --test
 * (see lib/company-merge.test.ts).
 */

/**
 * Company IDENTITY fields. A later enrichment must NOT overwrite these on an
 * existing canonical row with freshly-fetched values — firmographics (employee
 * count, HQ, industry, …) are fine to refresh, identity is not.
 */
export const STICKY_COMPANY_IDENTITY_FIELDS = ['company_name', 'domain', 'linkedin_url'] as const;

function isPresent<T>(value: T | null | undefined): value is T {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

/**
 * Existing-wins coalesce for STICKY identity fields. Returns the existing value
 * when present; otherwise the first present fresh value; otherwise null.
 *
 *   stickyIdentity('Moderna', 'Moderna Housewares')      → 'Moderna'  (existing kept)
 *   stickyIdentity(null, 'Moderna Therapeutics')         → 'Moderna Therapeutics' (new row)
 */
export function stickyIdentity<T>(
  existing: T | null | undefined,
  ...fresh: Array<T | null | undefined>
): T | null {
  if (isPresent(existing)) return existing;
  for (const value of fresh) {
    if (isPresent(value)) return value;
  }
  return null;
}

export type CompanyIdentifier =
  | { kind: 'linkedin_url'; value: string }
  | { kind: 'domain'; value: string }
  | { kind: 'name'; value: string };

function cleanDomain(value?: string | null): string | null {
  const trimmed = (value ?? '').trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') || null;
}

/**
 * Pick the SINGLE strongest identifier for an external company lookup
 * (Apollo / Apify). Priority: linkedin_url > domain > name.
 *
 * Rationale: providers fuzzy-match. A bare name ("Moderna") returns whatever
 * they rank first ("Moderna Housewares"); a domain or LinkedIn URL pins the
 * exact entity. Callers should pass ONLY the returned identifier to the
 * provider, never name alongside domain.
 *
 * Returns null when nothing usable is available.
 */
export function pickStrongestIdentifier(input: {
  linkedinUrl?: string | null;
  domain?: string | null;
  name?: string | null;
}): CompanyIdentifier | null {
  const linkedin = (input.linkedinUrl ?? '').trim();
  if (linkedin) return { kind: 'linkedin_url', value: linkedin };

  const domain = cleanDomain(input.domain);
  if (domain) return { kind: 'domain', value: domain };

  const name = (input.name ?? '').trim();
  if (name) return { kind: 'name', value: name };

  return null;
}
