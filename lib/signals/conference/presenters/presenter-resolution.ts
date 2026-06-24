/**
 * Presenter → canonical person resolution helpers (Phase 2).
 *
 * The precedent is the publications monitor (lib/signals/run-publications-monitor.ts):
 * a bare "Last F" author token matches thousands of people, so admission requires
 * a TWO-FACTOR check — the token must match a person at a tracked company AND that
 * company's name must appear in the appearance's printed affiliation. This file
 * isolates that logic so the delta-sync resolver and the unit tests share one
 * implementation.
 *
 * NEW file — does not edit the publications monitor (its `authorQueryToken` /
 * `companyInAffiliations` are private locals; this re-states the same logic so
 * the conference pipeline does not reach into another monitor's internals).
 */
import { distinctiveTokens } from '../../../companies/match-helpers';
import { normalizeCompanyForMatching } from '../../company-name-variants';
import { rejectedAdmission, type SignalAdmissionResult } from '../../signal-admission';

/**
 * Extract a `"Last F"` token from a speaker display name, the canonical join key
 * for person matching. Returns null when extraction is not reliable (single-word
 * name, credential-only string, etc.). Credentials and pronouns are stripped by
 * the adapter before this runs, but we defend anyway.
 *
 * Mirrors run-publications-monitor.ts `authorQueryToken`.
 */
export function speakerNameToken(fullName: string): string | null {
  const trimmed = (fullName ?? '').trim();
  if (!trimmed) return null;

  // Drop a trailing parenthetical (pronouns) and a trailing credential clause
  // if any survived ("Sandra A.G Visser, PhD" → "Sandra A.G Visser").
  let base = trimmed.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const credMatch = base.match(/^(.*?),\s*[A-Za-z.]{2,}(?:\s*,\s*[A-Za-z.]{2,})*$/);
  if (credMatch) base = credMatch[1].trim();
  if (!base) return null;

  // "Last, First" format.
  const commaIdx = base.indexOf(',');
  if (commaIdx > 0) {
    const last = base.slice(0, commaIdx).trim();
    const rest = base.slice(commaIdx + 1).trim();
    const firstInitial = rest.charAt(0).toUpperCase();
    if (last && firstInitial && /[A-Za-z]/.test(last)) return `${last} ${firstInitial}`;
  }

  // "First [Middle] Last" format.
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  const firstInitial = parts[0].charAt(0).toUpperCase();
  if (!last || !firstInitial || !/[A-Za-z]/.test(last)) return null;
  return `${last} ${firstInitial}`;
}

/** Lowercased normalized token, the value stored in speaker_name_normalized. */
export function normalizedSpeakerToken(fullName: string): string | null {
  const token = speakerNameToken(fullName);
  return token ? token.toLowerCase() : null;
}

const MIN_ALIAS_LENGTH = 4;

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-word substring check. Word boundaries are non-alphanumeric, so "Pfizer"
 * matches "Pfizer," and "(Pfizer)" but NOT "PfizerPharma". `haystack` is assumed
 * lowercase; `needle` is lowercased here. Mirrors the publications monitor.
 */
export function containsWholeWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = escapeForRegex(needle.toLowerCase());
  const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
  return re.test(haystack);
}

/**
 * True if the company name (or a qualifying alias) appears in the affiliation
 * string, with the publications monitor's three guards: word-boundary match,
 * minimum alias length, and a distinctive-token floor (a name with no
 * distinctive token — "Bio Therapeutics" — refuses to match). This is the
 * affiliation half of the two-factor speaker admission.
 *
 * Mirrors run-publications-monitor.ts `companyInAffiliations`.
 */
export function affiliationMatchesCompany(
  companyName: string,
  aliases: string[],
  affiliationRaw: string | null | undefined,
): boolean {
  if (!companyName) return false;
  const haystack = (affiliationRaw ?? '').toLowerCase();
  if (!haystack) return false;

  const normalizedName = normalizeCompanyForMatching(companyName);
  const nameDistinct = distinctiveTokens(normalizedName);
  if (nameDistinct.size === 0) return false; // generic-only name → never match

  let anyDistinctiveTokenSeen = false;
  for (const tok of nameDistinct) {
    if (containsWholeWord(haystack, tok)) {
      anyDistinctiveTokenSeen = true;
      break;
    }
  }
  if (!anyDistinctiveTokenSeen) return false;

  if (containsWholeWord(haystack, normalizedName)) return true;

  for (const alias of aliases) {
    if (!alias) continue;
    const normalizedAlias = normalizeCompanyForMatching(alias);
    if (normalizedAlias.length < MIN_ALIAS_LENGTH) continue;
    if (distinctiveTokens(normalizedAlias).size === 0) continue;
    if (containsWholeWord(haystack, normalizedAlias)) return true;
  }

  return false;
}

/** A canonical person candidate keyed by its "Last F" token (lowercased). */
export type PersonTokenCandidate = {
  personId: string;
  companyId: string;
  companyName: string;
  companyAliases: string[];
};

export type ResolvedPresenterPerson = {
  personId: string;
  companyId: string;
  companyName: string;
  /** Why this person was admitted — for mentioned_contact_matches provenance. */
  verificationReason: string;
};

/**
 * The two-factor speaker admission. Given a speaker name + printed affiliation
 * and a token→candidates index of canonical people (each tied to a company),
 * admit a person ONLY when:
 *   (a) the speaker's "Last F" token matches a candidate person, AND
 *   (b) that candidate's company name appears in the printed affiliation.
 *
 * Returns every admitted person (a token can collide across companies; each is
 * verified independently by its own affiliation cross-check).
 */
export function resolvePresenterPeople(
  speakerName: string,
  affiliationRaw: string | null | undefined,
  candidatesByToken: Map<string, PersonTokenCandidate[]>,
): ResolvedPresenterPerson[] {
  const token = normalizedSpeakerToken(speakerName);
  if (!token) return [];
  const candidates = candidatesByToken.get(token);
  if (!candidates || candidates.length === 0) return [];

  const admitted: ResolvedPresenterPerson[] = [];
  const seen = new Set<string>();
  for (const cand of candidates) {
    if (seen.has(cand.personId)) continue;
    if (!affiliationMatchesCompany(cand.companyName, cand.companyAliases, affiliationRaw)) continue;
    seen.add(cand.personId);
    admitted.push({
      personId: cand.personId,
      companyId: cand.companyId,
      companyName: cand.companyName,
      verificationReason:
        'Speaker "Last F" token matched a tracked person and the printed affiliation matches that person\'s company.',
    });
  }
  return admitted;
}

/** A canonical person match as stored in mentioned_contact_matches. */
type ContactMentionMatch = {
  person_id?: string | null;
  source_field?: string;
  verified?: boolean;
  verification_reason?: string;
  company_id?: string | null;
};

/**
 * Contact analog of companyMentionAdmission (resolver-provenance-admission.ts):
 * admit a presenting_at_conference signal only when a VERIFIED person match for
 * this personId exists in the appearance's mentioned_contact_matches with an
 * accepted source field. Fail closed — no verified match → rejected.
 *
 * Pure (no DB/server deps) so the monitor and the unit tests share it.
 */
export function presenterContactAdmission(input: {
  personId: string;
  matches: unknown;
  acceptedSourceFields: string[];
}): SignalAdmissionResult {
  const accepted = new Set(input.acceptedSourceFields);
  const list = Array.isArray(input.matches) ? (input.matches as ContactMentionMatch[]) : [];
  const match = list.find(
    (m) =>
      m &&
      typeof m === 'object' &&
      m.verified === true &&
      m.person_id === input.personId &&
      accepted.has(m.source_field ?? ''),
  );

  if (!match) {
    return rejectedAdmission({
      entityScope: 'contact',
      contactId: input.personId,
      matchType: 'verified_presenter_rejected',
      reason: 'Speaker was not verified as the tracked person.',
      metadata: {
        role_gate: 'rejected',
        role_gate_reason: 'no verified speaker match for this person',
      },
    });
  }

  return {
    admitted: true,
    reason: 'Speaker name is verified as the tracked person (token + affiliation cross-check).',
    confidence: 'medium',
    entityScope: 'contact',
    contactId: input.personId,
    companyId: match.company_id ?? undefined,
    matchType: 'verified_presenter',
    metadata: {
      role_gate: 'passed',
      role_gate_reason: match.verification_reason ?? 'verified speaker match',
      matched_source_field: match.source_field,
    },
  };
}
