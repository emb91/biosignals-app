/** Email directory on contacts: import line, user-added, enriched work/personal. */

export type ContactEmailCategory = 'import' | 'user' | 'enriched_work' | 'enriched_personal';

export type ContactEmailRow = {
  id: string;
  contact_id: string;
  user_id: string;
  email: string;
  category: ContactEmailCategory;
  label: string | null;
  source_provider: string | null;
  apollo_email_status: string | null;
  email_deliverability: string | null;
  email_deliverability_provider: string | null;
  email_deliverability_checked_at: string | null;
  email_deliverability_metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseFrom = { from: (table: string) => any };

function isMissingContactEmailsTableError(error: unknown): boolean {
  const msg =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : '';
  return (
    (msg.includes('contact_emails') && msg.includes('does not exist')) ||
    (msg.includes('relation') && msg.includes('contact_emails'))
  );
}

function isPostgresUniqueViolation(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  return code === '23505';
}

export function trimEmail(value: string | null | undefined): string | null {
  const t = typeof value === 'string' ? value.trim() : '';
  return t ? t : null;
}

/**
 * True when the string plausibly looks like an email (not full RFC).
 * Used to reject obvious free-text junk before writes without relying on DB constraints.
 */
export function looksLikeEmail(value: string | null | undefined): boolean {
  const t = trimEmail(value);
  if (!t || t.length > 320) return false;
  const at = t.indexOf('@');
  if (at <= 0 || at !== t.lastIndexOf('@')) return false;
  const local = t.slice(0, at);
  const domain = t.slice(at + 1);
  if (!local || local.length > 64 || !domain || domain.length > 255) return false;
  if (local.startsWith('.') || local.endsWith('.')) return false;
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  if (!domain.includes('.')) return false;
  if (/[\s<>"(),]/.test(local) || /[\s<>"(),]/.test(domain)) return false;
  return true;
}

export function emailsEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Options users can pick when overriding provider verification in the contact editor. */
export const EMAIL_DELIVERABILITY_USER_OPTIONS = [
  { value: '', label: 'Not verified' },
  { value: 'verified', label: 'Verified' },
  { value: 'invalid', label: 'Not deliverable' },
  { value: 'catch-all', label: 'Catch-all' },
  { value: 'unknown', label: 'Unknown' },
] as const;

const ALLOWED_EMAIL_DELIVERABILITY = new Set([
  'verified',
  'invalid',
  'spamtrap',
  'abuse',
  'do_not_mail',
  'catch-all',
  'unknown',
  'extrapolated',
  'unavailable',
]);

export type EmailDeliverabilityOverride = {
  email: string;
  email_deliverability: string | null;
};

export function normalizeUserEmailDeliverability(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!ALLOWED_EMAIL_DELIVERABILITY.has(normalized)) return null;
  return normalized;
}

/** Skip ZeroBounce when the user manually set deliverability in the contact editor. */
export function isUserEmailDeliverabilityOverride(provider: string | null | undefined): boolean {
  return provider === 'user';
}

export function shouldRunAutomatedEmailVerification(
  deliverability: string | null | undefined,
  provider: string | null | undefined,
): boolean {
  if (isUserEmailDeliverabilityOverride(provider)) return false;
  return deliverability == null || deliverability === 'extrapolated' || deliverability === 'unavailable';
}

export type EmailDeliverabilityRow = {
  email: string;
  email_deliverability: string | null;
  email_deliverability_provider: string | null;
};

export function isZeroBounceDeliverabilityProvider(provider: string | null | undefined): boolean {
  return provider === 'zerobounce' || provider === 'zerobounce_finder';
}

/** ZeroBounce-validated or user-confirmed verified — do not offer email finder. */
export function isTrustedVerifiedEmailRow(row: EmailDeliverabilityRow): boolean {
  if (!looksLikeEmail(row.email)) return false;
  if (row.email_deliverability !== 'verified') return false;
  return isZeroBounceDeliverabilityProvider(row.email_deliverability_provider) || row.email_deliverability_provider === 'user';
}

export function isEmailDomainAlignedWithCompany(
  email: string | null | undefined,
  companyDomain: string | null | undefined,
): boolean {
  const emailDomain = extractDomainFromEmail(email || '');
  const company = normalizeCompanyDomain(companyDomain);
  return Boolean(emailDomain && company && emailDomain === company);
}

/** Contact-level heuristic: on-file email domain does not match resolved current company. */
export function contactHasStaleEmailStatus(emailStatus: string | null | undefined): boolean {
  return emailStatus === 'stale_suspected';
}

/** Shown in the contact panel when enrichment cannot confirm the email is still current. */
export function contactEmailMayBeOutdated(emailStatus: string | null | undefined): boolean {
  return emailStatus === 'stale_suspected' || emailStatus === 'candidate';
}

/** Verified with ZeroBounce/user and aligned to the resolved current company domain. */
export function isTrustedCurrentCompanyEmailRow(
  row: EmailDeliverabilityRow,
  companyDomain: string | null | undefined,
): boolean {
  return isTrustedVerifiedEmailRow(row) && isEmailDomainAlignedWithCompany(row.email, companyDomain);
}

/** Deliverability was verified, but the domain belongs to a prior employer. */
export function isVerifiedButOutdatedEmailRow(
  row: EmailDeliverabilityRow,
  companyDomain: string | null | undefined,
): boolean {
  if (!isTrustedVerifiedEmailRow(row)) return false;
  if (!normalizeCompanyDomain(companyDomain)) return false;
  return !isEmailDomainAlignedWithCompany(row.email, companyDomain);
}

export type EmailDeliverabilityDisplayMeta = {
  label: string;
  icon: 'check' | 'warning';
  className: string;
};

/** UI badge for a contact email row; downgrades verified when the domain is stale. */
export function getContactEmailDeliverabilityDisplayMeta(
  deliverability: string | null | undefined,
  options?: {
    email?: string;
    companyDomain?: string | null;
  },
): EmailDeliverabilityDisplayMeta {
  const companyDomain = normalizeCompanyDomain(options?.companyDomain);
  if (
    options?.email &&
    companyDomain &&
    deliverability === 'verified' &&
    !isEmailDomainAlignedWithCompany(options.email, companyDomain)
  ) {
    return { label: 'Outdated', icon: 'warning', className: 'text-amber-600' };
  }

  switch (deliverability) {
    case 'verified':
      return { label: 'Verified', icon: 'check', className: 'text-emerald-500' };
    case 'invalid':
    case 'spamtrap':
    case 'abuse':
    case 'do_not_mail':
      return { label: 'Not deliverable', icon: 'warning', className: 'text-rose-500' };
    case 'catch-all':
      return { label: 'Catch-all', icon: 'warning', className: 'text-amber-500' };
    case 'unknown':
      return { label: 'Unknown', icon: 'warning', className: 'text-amber-500' };
    case 'extrapolated':
    case 'unavailable':
    case null:
    case undefined:
    case '':
      return { label: 'Not verified', icon: 'warning', className: 'text-amber-500' };
    default:
      return { label: deliverability, icon: 'warning', className: 'text-amber-500' };
  }
}

/** Apollo-sourced or never checked — verify the on-file address with ZeroBounce first. */
export function emailRowAwaitingZeroBounceVerification(row: EmailDeliverabilityRow): boolean {
  if (!looksLikeEmail(row.email)) return false;
  if (isUserEmailDeliverabilityOverride(row.email_deliverability_provider)) return false;
  if (isZeroBounceDeliverabilityProvider(row.email_deliverability_provider)) return false;

  const provider = row.email_deliverability_provider;
  const status = row.email_deliverability;
  const isApolloOrUnchecked = provider === 'apollo' || provider == null;
  if (!isApolloOrUnchecked) return false;

  return status == null || status === 'extrapolated' || status === 'unavailable' || status === 'verified';
}

/** ZeroBounce ran on this address and did not return valid. */
export function emailRowHasZeroBounceNonValidResult(row: EmailDeliverabilityRow): boolean {
  if (!looksLikeEmail(row.email)) return false;
  if (!isZeroBounceDeliverabilityProvider(row.email_deliverability_provider)) return false;
  return row.email_deliverability !== 'verified';
}

/** User manually marked this address as not good enough to use. */
export function emailRowHasUserNonValidOverride(row: EmailDeliverabilityRow): boolean {
  if (!looksLikeEmail(row.email)) return false;
  if (!isUserEmailDeliverabilityOverride(row.email_deliverability_provider)) return false;
  return row.email_deliverability !== 'verified';
}

/** Minimum priority (strictly above) for bulk email verification and find-new-email. */
export const DEFAULT_EMAIL_VERIFICATION_PRIORITY_MIN = 0.6;

export function meetsEmailVerificationPriorityThreshold(
  priorityScore: number | null | undefined,
  min: number = DEFAULT_EMAIL_VERIFICATION_PRIORITY_MIN,
): boolean {
  return typeof priorityScore === 'number' && Number.isFinite(priorityScore) && priorityScore > min;
}

export function emailDeliverabilityEditKey(email: string): string {
  return email.trim().toLowerCase();
}

export type EmailVerificationBannerCategory = 'verified' | 'not_deliverable' | 'not_verified' | 'failed';

export type EmailVerificationResultItem = {
  contactId: string;
  contactName: string | null;
  companyName: string | null;
  email: string;
  category: EmailVerificationBannerCategory;
  error?: string;
};

/** Map stored deliverability to the user-facing banner pill groups. */
export function emailVerificationBannerCategory(
  deliverability: string | null | undefined,
): Exclude<EmailVerificationBannerCategory, 'failed'> {
  if (deliverability === 'verified') return 'verified';
  if (
    deliverability === 'invalid' ||
    deliverability === 'spamtrap' ||
    deliverability === 'abuse' ||
    deliverability === 'do_not_mail'
  ) {
    return 'not_deliverable';
  }
  return 'not_verified';
}

export function extractDomainFromEmail(email: string): string | null {
  const trimmed = trimEmail(email);
  if (!trimmed) return null;
  const at = trimmed.indexOf('@');
  if (at < 0) return null;
  const domain = trimmed.slice(at + 1).trim().toLowerCase().replace(/^www\./, '');
  return domain || null;
}

export function normalizeCompanyDomain(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
      .trim() || null
  );
}

export function classifyEnrichedEmail(
  email: string,
  companyDomain: string | null | undefined,
): 'enriched_work' | 'enriched_personal' {
  const emailDomain = extractDomainFromEmail(email);
  const company = normalizeCompanyDomain(companyDomain);
  if (emailDomain && company && emailDomain === company) return 'enriched_work';
  return 'enriched_personal';
}

async function hasEmailOnContact(
  supabase: SupabaseFrom,
  contactId: string,
  normalizedEmail: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('contact_emails')
    .select('email')
    .eq('contact_id', contactId);

  if (error) {
    if (isMissingContactEmailsTableError(error)) return false;
    throw error;
  }

  for (const row of data || []) {
    const stored = trimEmail((row as { email?: string }).email);
    if (stored && emailsEqual(stored, normalizedEmail)) return true;
  }

  return false;
}

/** First-time import baseline; never overwritten by enrichment. */
export async function ensureImportEmailEntry(
  supabase: SupabaseFrom,
  params: {
    contactId: string;
    userId: string;
    email: string | null | undefined;
  },
): Promise<void> {
  const email = trimEmail(params.email);
  if (!email || !looksLikeEmail(email)) return;

  try {
    if (await hasEmailOnContact(supabase, params.contactId, email)) return;

    const { error } = await supabase.from('contact_emails').insert({
      contact_id: params.contactId,
      user_id: params.userId,
      email,
      category: 'import',
      label: null,
      source_provider: null,
      apollo_email_status: null,
      updated_at: new Date().toISOString(),
    });

    if (error) throw error;
  } catch (e: unknown) {
    if (isMissingContactEmailsTableError(e)) return;
    throw e;
  }
}

/** Enrichment-sourced inbox; merges without touching import/user rows when address already captured. */
export async function ensureEnrichedEmailEntry(
  supabase: SupabaseFrom,
  params: {
    contactId: string;
    userId: string;
    email: string | null | undefined;
    companyDomain: string | null | undefined;
    apolloEmailStatus?: string | null;
  },
): Promise<void> {
  const email = trimEmail(params.email);
  if (!email || !looksLikeEmail(email)) return;

  try {
    if (await hasEmailOnContact(supabase, params.contactId, email)) return;

    const category = classifyEnrichedEmail(email, params.companyDomain);
    const { error } = await supabase.from('contact_emails').insert({
      contact_id: params.contactId,
      user_id: params.userId,
      email,
      category,
      label: null,
      source_provider: 'apollo',
      apollo_email_status: params.apolloEmailStatus ?? null,
      email_deliverability: params.apolloEmailStatus ?? null,
      email_deliverability_provider: params.apolloEmailStatus ? 'apollo' : null,
      email_deliverability_checked_at: null,
      email_deliverability_metadata: null,
      updated_at: new Date().toISOString(),
    });

    if (error) throw error;
  } catch (e: unknown) {
    if (isMissingContactEmailsTableError(e)) return;
    throw e;
  }
}

export async function fetchContactEmailsForContacts(
  supabase: SupabaseFrom,
  contactIds: string[],
): Promise<Map<string, ContactEmailRow[]>> {
  const out = new Map<string, ContactEmailRow[]>();
  if (contactIds.length === 0) return out;

  const { data, error } = await supabase
    .from('contact_emails')
    .select(
      'id, contact_id, user_id, email, category, label, source_provider, apollo_email_status, email_deliverability, email_deliverability_provider, email_deliverability_checked_at, email_deliverability_metadata, created_at, updated_at',
    )
    .in('contact_id', contactIds)
    .order('created_at', { ascending: true });

  if (error) {
    if (isMissingContactEmailsTableError(error)) return out;
    throw error;
  }

  for (const row of (data || []) as ContactEmailRow[]) {
    const list = out.get(row.contact_id) ?? [];
    list.push(row);
    out.set(row.contact_id, list);
  }

  return out;
}

/**
 * Saves "additional" / user-typed email addresses for a contact.
 * Only rows with category `user` are removed and rewritten from `additionalEmails`.
 * Import lines and enriched work/personal addresses are left as-is.
 */
export async function syncUserAddedContactEmails(
  supabase: SupabaseFrom,
  params: {
    contactId: string;
    userId: string;
    /** Full list of extra addresses from the form (not the primary contacts.email). */
    additionalEmails: string[];
  },
): Promise<void> {
  const seenLower = new Set<string>();
  const deduped: string[] = [];
  for (const raw of params.additionalEmails) {
    const e = trimEmail(raw);
    if (!e) continue;
    const key = e.toLowerCase();
    if (seenLower.has(key)) continue;
    seenLower.add(key);
    deduped.push(e);
  }

  try {
    const { error: delErr } = await supabase
      .from('contact_emails')
      .delete()
      .eq('contact_id', params.contactId)
      .eq('category', 'user');

    if (delErr) throw delErr;

    const { data: blockingRows, error: selErr } = await supabase
      .from('contact_emails')
      .select('email')
      .eq('contact_id', params.contactId);

    if (selErr) throw selErr;

    const takenLower = new Set<string>();
    for (const row of blockingRows || []) {
      const em = trimEmail((row as { email?: string }).email);
      if (em) takenLower.add(em.toLowerCase());
    }

    const toInsert = deduped.filter(
      (e) => looksLikeEmail(e) && !takenLower.has(e.toLowerCase()),
    );

    if (toInsert.length === 0) return;

    const now = new Date().toISOString();
    for (const email of toInsert) {
      const { error: insErr } = await supabase.from('contact_emails').insert({
        contact_id: params.contactId,
        user_id: params.userId,
        email,
        category: 'user',
        label: null,
        source_provider: null,
        apollo_email_status: null,
        updated_at: now,
      });
      if (insErr && !isPostgresUniqueViolation(insErr)) throw insErr;
    }
  } catch (e: unknown) {
    if (isMissingContactEmailsTableError(e)) return;
    throw e;
  }
}

/**
 * Applies manual deliverability overrides from the contact editor.
 * Updates contact_emails rows and the primary contacts.email_deliverability when matched.
 * Provider metadata from ZeroBounce/Apollo is left intact; provider is set to `user`.
 */
export async function syncEmailDeliverabilityOverrides(
  supabase: SupabaseFrom,
  params: {
    contactId: string;
    userId: string;
    primaryEmail: string | null;
    overrides: EmailDeliverabilityOverride[];
  },
): Promise<void> {
  if (params.overrides.length === 0) return;

  const now = new Date().toISOString();
  const primaryEmail = trimEmail(params.primaryEmail);
  let primaryDeliverability: string | null | undefined;

  const { data: rows, error: selErr } = await supabase
    .from('contact_emails')
    .select('id, email')
    .eq('contact_id', params.contactId)
    .eq('user_id', params.userId);

  if (selErr) {
    if (isMissingContactEmailsTableError(selErr)) return;
    throw selErr;
  }

  const directoryRows = (rows ?? []) as Array<{ id: string; email: string }>;

  for (const item of params.overrides) {
    const email = trimEmail(item.email);
    if (!email || !looksLikeEmail(email)) continue;

    const status = normalizeUserEmailDeliverability(item.email_deliverability);
    const matching = directoryRows.find((row) => emailsEqual(row.email, email));

    if (matching) {
      const { error: updErr } = await supabase
        .from('contact_emails')
        .update({
          email_deliverability: status,
          email_deliverability_provider: 'user',
          email_deliverability_checked_at: now,
          updated_at: now,
        })
        .eq('id', matching.id)
        .eq('user_id', params.userId);

      if (updErr) throw updErr;
    }

    if (primaryEmail && emailsEqual(primaryEmail, email)) {
      primaryDeliverability = status;
    }
  }

  if (primaryDeliverability !== undefined && primaryEmail) {
    const { error: contactErr } = await supabase
      .from('contacts')
      .update({ email_deliverability: primaryDeliverability, updated_at: now })
      .eq('id', params.contactId)
      .eq('user_id', params.userId);

    if (contactErr) throw contactErr;
  }
}

/** Ensures contacts.email appears in the directory when it is neither import nor enriched. */
export async function syncPrimaryEmailAsUserRowIfNeeded(
  supabase: SupabaseFrom,
  params: { contactId: string; userId: string; primaryEmail: string | null },
): Promise<void> {
  const email = trimEmail(params.primaryEmail);
  if (!email || !looksLikeEmail(email)) return;

  try {
    if (await hasEmailOnContact(supabase, params.contactId, email)) return;

    const { error } = await supabase.from('contact_emails').insert({
      contact_id: params.contactId,
      user_id: params.userId,
      email,
      category: 'user',
      label: null,
      source_provider: null,
      apollo_email_status: null,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      if (isPostgresUniqueViolation(error)) return;
      throw error;
    }
  } catch (e: unknown) {
    if (isMissingContactEmailsTableError(e)) return;
    throw e;
  }
}
