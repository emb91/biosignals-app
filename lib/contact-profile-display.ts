/**
 * View-layer helpers for contact profile (location line, email list) on the leads UI.
 */

import type { ContactEmailCategory, ContactEmailRow } from './contact-emails';
import {
  DEFAULT_EMAIL_VERIFICATION_PRIORITY_MIN,
  contactHasStaleEmailStatus,
  emailRowAwaitingZeroBounceVerification,
  emailRowHasUserNonValidOverride,
  emailRowHasZeroBounceNonValidResult,
  emailsEqual,
  isEmailDomainAlignedWithCompany,
  isTrustedCurrentCompanyEmailRow,
  isTrustedVerifiedEmailRow,
  looksLikeEmail,
  meetsEmailVerificationPriorityThreshold,
  normalizeCompanyDomain,
} from './contact-emails';

const CATEGORY_ORDER: { cat: ContactEmailCategory; label: string }[] = [
  { cat: 'import', label: 'Imported' },
  { cat: 'enriched_work', label: 'Work' },
  { cat: 'enriched_personal', label: 'Personal' },
];

export function formatContactLocationDisplay(
  rawLocation: string | null | undefined,
  city: string | null | undefined,
  country: string | null | undefined,
): string | null {
  const loc = (rawLocation || '').trim();
  const c = (city || '').trim();
  const co = (country || '').trim();
  const ni = (s: string) => s.toLowerCase();

  if (!loc && !c && !co) return null;

  let place = '';
  if (loc && c) {
    const li = ni(loc);
    const ci = ni(c);
    if (li.includes(ci) || ci.includes(li)) {
      place = loc.length >= c.length ? loc : c;
    } else {
      place = `${loc}, ${c}`;
    }
  } else {
    place = loc || c;
  }

  if (co) {
    const bi = ni(place);
    const coi = ni(co);
    if (place && !bi.includes(coi)) {
      return `${place}, ${co}`;
    }
    if (!place) return co;
  }

  return place || co || null;
}

export type ContactLocationParts = {
  city: string | null;
  state: string | null;
  country: string | null;
};

/**
 * Split a contact's location into City / State / Country for display under
 * separate sub-headers.
 *
 * The `location` string is the RELIABLE source — it's the LinkedIn-style
 * "City, State, Country" (US) or "City, Country" form (e.g. "San Diego,
 * California, United States", "Dubai, United Arab Emirates"). The separate
 * `city` / `country` columns are NOT reliable: enrichment sometimes dumps the
 * same dash-joined blob into both (e.g. city = country = "Dubai - Dubai -
 * United Arab Emirates"). So we PARSE `location` first and only fall back to
 * the structured fields when `location` is empty.
 *
 * Comma-splitting heuristic (matches LinkedIn's format):
 *   3+ parts → [city, state, country]   ("San Diego, California, United States")
 *   2  parts → [city, country]          ("Dubai, United Arab Emirates")
 *   1  part  → [city]
 * (LinkedIn never includes a postal/zip code, so there's no zip to show.)
 */
export function parseContactLocation(
  rawLocation: string | null | undefined,
  city: string | null | undefined,
  country: string | null | undefined,
): ContactLocationParts {
  const dedupe = (parts: string[]): string[] => {
    const out: string[] = [];
    for (const p of parts) {
      const t = p.trim();
      if (t && !out.some((u) => u.toLowerCase() === t.toLowerCase())) out.push(t);
    }
    return out;
  };

  const loc = (rawLocation || '').trim();
  if (loc) {
    const parts = dedupe(loc.split(','));
    if (parts.length >= 3) {
      return { city: parts[0], state: parts[1], country: parts[parts.length - 1] };
    }
    if (parts.length === 2) return { city: parts[0], state: null, country: parts[1] };
    if (parts.length === 1) return { city: parts[0], state: null, country: null };
  }

  // Fallback: location is empty — clean the (possibly junky) structured fields.
  // Split on commas AND dashes, dedupe; city = first token, country = last token.
  const cityToks = dedupe((city || '').split(/[,-]/));
  const countryToks = dedupe((country || '').split(/[,-]/));
  return {
    city: cityToks[0] ?? null,
    state: null,
    country: countryToks.length ? countryToks[countryToks.length - 1] : null,
  };
}

export type ContactEmailDisplayRow = {
  id: string | null;
  label: string;
  email: string;
  email_deliverability: string | null;
  email_deliverability_provider: string | null;
};

function sortByCreated(list: ContactEmailRow[]): ContactEmailRow[] {
  return [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * @param mode full — primary + directory; enrichmentOnly — import + enriched only (edit form read-only box).
 */
export function buildContactEmailDisplayRows(
  primaryEmail: string | null | undefined,
  contactEmails: ContactEmailRow[] | null | undefined,
  mode: 'full' | 'enrichmentOnly' = 'full',
): ContactEmailDisplayRow[] {
  const rows: ContactEmailDisplayRow[] = [];
  const primary = (primaryEmail || '').trim();
  const list = sortByCreated(contactEmails ?? []);

  const alreadyListed = (email: string) => rows.some((r) => emailsEqual(r.email, email));
  const primaryDirectoryRow = primary
    ? list.find((r) => emailsEqual(r.email, primary))
    : null;

  if (mode === 'full' && primary) {
    rows.push({
      id: primaryDirectoryRow?.id ?? null,
      label: 'Primary',
      email: primary,
      email_deliverability: primaryDirectoryRow?.email_deliverability ?? null,
      email_deliverability_provider: primaryDirectoryRow?.email_deliverability_provider ?? null,
    });
  }

  for (const { cat, label } of CATEGORY_ORDER) {
    for (const r of list.filter((x) => x.category === cat)) {
      const em = r.email.trim();
      if (!em) continue;
      if (primary && emailsEqual(em, primary)) continue;
      if (alreadyListed(em)) continue;
      rows.push({
        id: r.id,
        label,
        email: em,
        email_deliverability: r.email_deliverability ?? null,
        email_deliverability_provider: r.email_deliverability_provider ?? null,
      });
    }
  }

  if (mode === 'full') {
    let userSlot = 2;
    for (const r of list.filter((x) => x.category === 'user')) {
      const em = r.email.trim();
      if (!em) continue;
      if (alreadyListed(em)) continue;
      rows.push({
        id: r.id,
        label: `Email ${userSlot}`,
        email: em,
        email_deliverability: r.email_deliverability ?? null,
        email_deliverability_provider: r.email_deliverability_provider ?? null,
      });
      userSlot += 1;
    }
  }

  return rows;
}

export type RefreshEmailCandidate = {
  email: string;
  contactEmailId: string | null;
  isPrimary: boolean;
  email_deliverability: string | null;
  email_deliverability_provider: string | null;
};

/** Primary first, then import/work/personal/user slots — same order as the contact panel. */
export function buildRefreshEmailCandidates(
  primaryEmail: string | null | undefined,
  contactEmails: ContactEmailRow[] | null | undefined,
): RefreshEmailCandidate[] {
  return buildContactEmailDisplayRows(primaryEmail, contactEmails, 'full').map((row) => ({
    email: row.email,
    contactEmailId: row.id,
    isPrimary: row.label === 'Primary',
    email_deliverability: row.email_deliverability,
    email_deliverability_provider: row.email_deliverability_provider,
  }));
}

/**
 * Offer email finder when ZeroBounce (or the user) has rejected on-file addresses,
 * when there is no usable email yet, or when verified emails belong to a prior employer.
 * Apollo "not verified" still needs ZeroBounce validate first.
 */
export function shouldOfferFindNewEmailForContact(
  priorityScore: number | null | undefined,
  primaryEmail: string | null | undefined,
  contactEmails: ContactEmailRow[] | null | undefined,
  options?: {
    emailStatus?: string | null;
    currentCompanyDomain?: string | null;
    priorityMin?: number;
  },
): boolean {
  const priorityMin = options?.priorityMin ?? DEFAULT_EMAIL_VERIFICATION_PRIORITY_MIN;
  if (!meetsEmailVerificationPriorityThreshold(priorityScore, priorityMin)) return false;

  const emailRows = buildContactEmailDisplayRows(primaryEmail, contactEmails, 'full');
  const currentCompanyDomain = normalizeCompanyDomain(options?.currentCompanyDomain);

  if (emailRows.some((row) => isTrustedCurrentCompanyEmailRow(row, currentCompanyDomain))) {
    return false;
  }

  const hasEmailAtCurrentCompany = currentCompanyDomain
    ? emailRows.some(
        (row) => looksLikeEmail(row.email) && isEmailDomainAlignedWithCompany(row.email, currentCompanyDomain),
      )
    : false;

  if (contactHasStaleEmailStatus(options?.emailStatus) && !hasEmailAtCurrentCompany) {
    return true;
  }

  if (emailRows.some(isTrustedVerifiedEmailRow)) return false;

  const usableRows = emailRows.filter((row) => looksLikeEmail(row.email));
  if (usableRows.length === 0) return true;

  if (usableRows.some(emailRowAwaitingZeroBounceVerification)) return false;

  return usableRows.some(
    (row) => emailRowHasZeroBounceNonValidResult(row) || emailRowHasUserNonValidOverride(row),
  );
}
