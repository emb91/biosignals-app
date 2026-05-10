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
      'id, contact_id, user_id, email, category, label, source_provider, apollo_email_status, created_at, updated_at',
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
 * Ensures contacts.email appears in the directory when it is neither import nor enriched.
 */
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
