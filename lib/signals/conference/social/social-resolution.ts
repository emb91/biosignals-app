/**
 * Pure resolution helpers for the Phase 3 social-intent monitor.
 *
 * Split out of run-social-monitor.ts so they can be unit-tested without pulling in
 * Supabase / readiness-service. No IO. The monitor imports these for its per-user
 * author → contact cross-match (token + employer guard, or profile-URL match).
 */
import { normalizeCompanyForMatching } from '../../company-name-variants';

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word substring check; haystack assumed lowercase. */
export function containsWholeWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = escapeForRegex(needle.toLowerCase());
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack);
}

/** Min alias length to trust — short aliases (BMS, MSD) false-match too often. */
export const MIN_ALIAS_LENGTH = 4;

/**
 * Employer cross-check: does the contact's company name (or a qualifying alias)
 * appear as a whole word in the attendee's stated employer string? The
 * disambiguation guard on top of the "last f" token — a common token alone is too
 * noisy. Returns the matched employer text on success, else null.
 */
export function employerMatches(
  companyName: string,
  aliases: string[],
  attendeeCompany: string | null | undefined,
): string | null {
  const haystack = (attendeeCompany ?? '').toLowerCase();
  if (!haystack || !companyName) return null;
  const normName = normalizeCompanyForMatching(companyName);
  if (normName && containsWholeWord(haystack, normName)) return attendeeCompany ?? null;
  for (const alias of aliases ?? []) {
    const normAlias = normalizeCompanyForMatching(alias ?? '');
    if (normAlias.length < MIN_ALIAS_LENGTH) continue;
    if (containsWholeWord(haystack, normAlias)) return attendeeCompany ?? null;
  }
  return null;
}

/** Normalize a LinkedIn profile URL to a comparable key (only /in/ profiles). */
export function normalizeLinkedinKey(value: string | null | undefined): string {
  const v = (value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
  return v.includes('/in/') ? v : '';
}
