/**
 * Email-pattern inference: derive a company domain's address pattern from
 * verified emails we already hold, then synthesize candidate addresses for
 * contacts at that domain who have none.
 *
 * Synthesized addresses are NEVER presented as real: they get
 * email_deliverability = 'pattern_guessed' (provider 'pattern') so every
 * surface shows a "guessed, not verified" warning, ZeroBounce verification
 * still offers to check them, and outreach dispatch holds them by default.
 *
 * TENANCY: pattern derivation reads only the requesting user's own contacts
 * (everything here is scoped by user_id). It never reads other tenants'
 * verified emails from the shared people table — one tenant's address book
 * must not shape another tenant's guesses, even as metadata.
 */

import {
  looksLikeEmail,
  normalizeCompanyDomain,
  trimEmail,
} from './contact-emails';

// ─── Deliverability constants ─────────────────────────────────────────────────

/** Stamped on synthesized addresses; pairs with provider 'pattern'. */
export const PATTERN_GUESSED_DELIVERABILITY = 'pattern_guessed';
export const PATTERN_PROVIDER = 'pattern';

// ─── Free-mail / shared domains: never infer a pattern here ──────────────────

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'msn.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com',
  'pm.me', 'gmx.com', 'gmx.de', 'web.de', 'mail.com', 'mail.ru', 'yandex.com',
  'yandex.ru', 'zoho.com', 'fastmail.com', 'hey.com', 'qq.com', '163.com',
  '126.com', 'sina.com', 'rediffmail.com', 'comcast.net', 'verizon.net',
  'att.net', 'btinternet.com', 'sky.com', 'orange.fr', 'wanadoo.fr', 'free.fr',
  't-online.de', 'libero.it', 'duck.com',
]);

export function isFreeMailDomain(domain: string | null | undefined): boolean {
  const d = normalizeCompanyDomain(domain);
  return Boolean(d && FREE_MAIL_DOMAINS.has(d));
}

// ─── Name normalization ───────────────────────────────────────────────────────

/** Lowercase, strip diacritics/apostrophes/hyphens/spaces → bare a-z0-9. */
export function normalizeNamePart(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// ─── Pattern templates ────────────────────────────────────────────────────────

/**
 * Recognized local-part templates, most specific first. Tokens:
 * {first} full first name, {last} full last name, {f}/{l} initials.
 */
export const EMAIL_PATTERNS = [
  '{first}.{last}',
  '{first}_{last}',
  '{first}-{last}',
  '{first}{last}',
  '{f}.{last}',
  '{f}_{last}',
  '{f}{last}',
  '{first}.{l}',
  '{first}{l}',
  '{last}.{first}',
  '{last}{first}',
  '{last}{f}',
  '{l}{first}',
  '{first}',
  '{last}',
] as const;

export type EmailPattern = (typeof EMAIL_PATTERNS)[number];

function renderPattern(
  pattern: string,
  first: string,
  last: string,
): string | null {
  const needsFirst = pattern.includes('{first}');
  const needsLast = pattern.includes('{last}');
  const needsF = pattern.includes('{f}');
  const needsL = pattern.includes('{l}');
  if ((needsFirst || needsF) && !first) return null;
  if ((needsLast || needsL) && !last) return null;
  return pattern
    .replace('{first}', first)
    .replace('{last}', last)
    .replace('{f}', first.charAt(0))
    .replace('{l}', last.charAt(0));
}

/** All templates whose rendering of this name matches the email's local part. */
export function classifyEmailPattern(
  email: string,
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): EmailPattern[] {
  const trimmed = trimEmail(email);
  if (!trimmed || !looksLikeEmail(trimmed)) return [];
  const local = trimmed.slice(0, trimmed.indexOf('@')).toLowerCase();
  const first = normalizeNamePart(firstName);
  const last = normalizeNamePart(lastName);
  if (!first && !last) return [];

  const matches: EmailPattern[] = [];
  for (const pattern of EMAIL_PATTERNS) {
    const rendered = renderPattern(pattern, first, last);
    if (rendered && rendered === local) matches.push(pattern);
  }
  return matches;
}

// ─── Pattern derivation ───────────────────────────────────────────────────────

export type PatternSample = {
  email: string;
  firstName: string | null;
  lastName: string | null;
};

export type DerivedPattern = {
  pattern: EmailPattern;
  /** Samples consistent with the winning pattern. */
  sampleCount: number;
  /** Samples that matched any pattern at all. */
  totalSamples: number;
};

/**
 * Pick the dominant pattern across verified samples.
 * - 0 informative samples → null.
 * - All samples agree on a common pattern → pick it (1 sample is enough).
 * - Samples conflict → require the winner to have ≥2 votes, else null.
 */
export function deriveDominantPattern(samples: PatternSample[]): DerivedPattern | null {
  const votes = new Map<EmailPattern, number>();
  let informative = 0;

  const seenEmails = new Set<string>();
  for (const sample of samples) {
    const key = (trimEmail(sample.email) ?? '').toLowerCase();
    if (!key || seenEmails.has(key)) continue;
    seenEmails.add(key);

    const matches = classifyEmailPattern(sample.email, sample.firstName, sample.lastName);
    if (matches.length === 0) continue;
    informative += 1;
    for (const pattern of matches) {
      votes.set(pattern, (votes.get(pattern) ?? 0) + 1);
    }
  }

  if (informative === 0) return null;

  // Winner = most votes; ties broken by template specificity (EMAIL_PATTERNS order).
  let winner: EmailPattern | null = null;
  let winnerVotes = 0;
  for (const pattern of EMAIL_PATTERNS) {
    const count = votes.get(pattern) ?? 0;
    if (count > winnerVotes) {
      winner = pattern;
      winnerVotes = count;
    }
  }
  if (!winner) return null;

  // Conflict = some informative sample is inconsistent with the winner.
  const conflicted = winnerVotes < informative;
  if (conflicted && winnerVotes < 2) return null;

  return { pattern: winner, sampleCount: winnerVotes, totalSamples: informative };
}

// ─── Synthesis ────────────────────────────────────────────────────────────────

export function synthesizeEmailFromPattern(
  pattern: string,
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  domain: string | null | undefined,
): string | null {
  const d = normalizeCompanyDomain(domain);
  if (!d || isFreeMailDomain(d)) return null;
  const first = normalizeNamePart(firstName);
  const last = normalizeNamePart(lastName);
  const local = renderPattern(pattern, first, last);
  if (!local) return null;
  const email = `${local}@${d}`;
  return looksLikeEmail(email) ? email : null;
}

// ─── DB application ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseFrom = { from: (table: string) => any };

function isMissingPatternTableError(error: unknown): boolean {
  const msg =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : '';
  return msg.includes('email_domain_patterns') && (msg.includes('does not exist') || msg.includes('relation'));
}

type VerifiedSampleRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  email_deliverability: string | null;
};

/**
 * Derive the user's address pattern for a domain from their own verified
 * contacts and persist it (upsert on user_id+domain). Returns null when the
 * domain is free-mail/unknown or there is no consistent verified sample.
 */
export async function derivePatternForDomain(
  supabase: SupabaseFrom,
  params: { userId: string; domain: string; excludeContactId?: string },
): Promise<DerivedPattern | null> {
  const domain = normalizeCompanyDomain(params.domain);
  if (!domain || isFreeMailDomain(domain)) return null;

  // Verified primary emails on the user's own contacts. ilike on the domain
  // suffix keeps the scan server-side; exact domain match re-checked below.
  const { data, error } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, email, email_deliverability')
    .eq('user_id', params.userId)
    .eq('email_deliverability', 'verified')
    .ilike('email', `%@${domain}`);

  if (error) throw error;

  const samples: PatternSample[] = [];
  for (const row of (data ?? []) as VerifiedSampleRow[]) {
    if (params.excludeContactId && row.id === params.excludeContactId) continue;
    const email = trimEmail(row.email);
    if (!email || !looksLikeEmail(email)) continue;
    if (!email.toLowerCase().endsWith(`@${domain}`)) continue;
    samples.push({ email, firstName: row.first_name, lastName: row.last_name });
  }

  const derived = deriveDominantPattern(samples);
  if (!derived) return null;

  try {
    const { error: upsertErr } = await supabase
      .from('email_domain_patterns')
      .upsert(
        {
          user_id: params.userId,
          domain,
          pattern: derived.pattern,
          sample_count: derived.sampleCount,
          total_samples: derived.totalSamples,
          derived_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,domain' },
      );
    if (upsertErr) throw upsertErr;
  } catch (e: unknown) {
    // Pattern storage is an optimization — synthesis still works without it.
    if (!isMissingPatternTableError(e)) {
      console.warn('[email-pattern] failed to persist domain pattern (non-fatal):', e);
    }
  }

  return derived;
}

export type PatternGuessResult = {
  email: string;
  pattern: EmailPattern;
  sampleCount: number;
};

/**
 * Fallback after provider enrichment returned no email: derive the domain
 * pattern from the user's verified contacts and synthesize a candidate
 * address for this contact. Records it in the contact_emails directory as
 * 'pattern_guessed'. Returns the guess (or null when not derivable).
 */
export async function applyPatternGuessedEmail(
  supabase: SupabaseFrom,
  params: {
    userId: string;
    contactId: string;
    domain: string | null | undefined;
    firstName: string | null | undefined;
    lastName: string | null | undefined;
  },
): Promise<PatternGuessResult | null> {
  const domain = normalizeCompanyDomain(params.domain);
  if (!domain || isFreeMailDomain(domain)) return null;

  const derived = await derivePatternForDomain(supabase, {
    userId: params.userId,
    domain,
    excludeContactId: params.contactId,
  });
  if (!derived) return null;

  const guess = synthesizeEmailFromPattern(derived.pattern, params.firstName, params.lastName, domain);
  if (!guess) return null;

  // Record in the email directory (same domain → work address by construction).
  const { data: existing, error: selErr } = await supabase
    .from('contact_emails')
    .select('id, email')
    .eq('contact_id', params.contactId);
  if (selErr && !String((selErr as { message?: string }).message || '').includes('contact_emails')) throw selErr;

  const alreadyListed = ((existing ?? []) as Array<{ email: string }>).some(
    (row) => row.email?.trim().toLowerCase() === guess.toLowerCase(),
  );

  if (!alreadyListed) {
    const { error: insErr } = await supabase.from('contact_emails').insert({
      contact_id: params.contactId,
      user_id: params.userId,
      email: guess,
      category: 'enriched_work',
      label: null,
      source_provider: PATTERN_PROVIDER,
      apollo_email_status: null,
      email_deliverability: PATTERN_GUESSED_DELIVERABILITY,
      email_deliverability_provider: PATTERN_PROVIDER,
      email_deliverability_checked_at: null,
      email_deliverability_metadata: {
        pattern: derived.pattern,
        sample_count: derived.sampleCount,
        total_samples: derived.totalSamples,
        domain,
      },
      updated_at: new Date().toISOString(),
    });
    // Unique violation = another writer beat us to it; fine.
    if (insErr && (insErr as { code?: string }).code !== '23505') {
      console.warn('[email-pattern] failed to record guessed email (non-fatal):', insErr);
    }
  }

  return { email: guess, pattern: derived.pattern, sampleCount: derived.sampleCount };
}
