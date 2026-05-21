/** Phone directory on contacts: import line, user-added, enriched work/mobile/personal.
 *
 * Mirrors lib/contact-emails.ts shape so callers move easily between the two.
 * Multiple entries per (user, contact) — re-enrichment never overwrites
 * existing phones; it adds new ones if they're different.
 */

export type ContactPhoneCategory =
  | 'import'
  | 'user'
  | 'enriched_work'
  | 'enriched_mobile'
  | 'enriched_personal'
  | 'enriched_other';

export type ContactPhoneRow = {
  id: string;
  contact_id: string;
  user_id: string;
  phone: string;
  category: ContactPhoneCategory;
  label: string | null;
  source_provider: string | null;
  phone_status: string | null;
  created_at: string;
  updated_at: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseFrom = { from: (table: string) => any };

function isMissingContactPhonesTableError(error: unknown): boolean {
  const msg =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : '';
  return (
    (msg.includes('contact_phones') && msg.includes('does not exist')) ||
    (msg.includes('relation') && msg.includes('contact_phones'))
  );
}

function isPostgresUniqueViolation(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  return code === '23505';
}

/**
 * Normalize a phone for storage + dedup. Strips whitespace, parentheses,
 * hyphens, dots. Keeps a leading `+`. Doesn't try to be a full E.164 parser
 * because providers return inconsistent shapes and we don't want to silently
 * reject a partial number.
 */
export function normalizePhone(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith('+');
  const digitsOnly = trimmed.replace(/[^\d]/g, '');
  if (digitsOnly.length < 4) return null;
  if (digitsOnly.length > 20) return null;
  return (hasPlus ? '+' : '') + digitsOnly;
}

export function looksLikePhone(value: string | null | undefined): boolean {
  return normalizePhone(value) != null;
}

export function phonesEqual(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na !== null && nb !== null && na === nb;
}

/**
 * Best-effort categorisation of an enriched phone based on provider hints
 * (work_phone, mobile_phone, personal_phone). Falls back to enriched_other.
 */
export function classifyEnrichedPhone(input: {
  field: string | null | undefined;
  providerLabel?: string | null;
}): ContactPhoneCategory {
  const field = (input.field ?? '').toLowerCase();
  if (field.includes('mobile') || field.includes('cell')) return 'enriched_mobile';
  if (field.includes('work') || field.includes('office') || field.includes('direct')) return 'enriched_work';
  if (field.includes('personal') || field.includes('home')) return 'enriched_personal';
  const label = (input.providerLabel ?? '').toLowerCase();
  if (label.includes('mobile')) return 'enriched_mobile';
  if (label.includes('work')) return 'enriched_work';
  return 'enriched_other';
}

/**
 * Ensure a phone collected at import time is recorded. No-op if the
 * (user, contact, phone) tuple already exists.
 */
export async function ensureImportPhoneEntry(
  supabase: SupabaseFrom,
  params: {
    userId: string;
    contactId: string;
    phone: string;
    label?: string | null;
    sourceProvider?: string | null;
  },
): Promise<void> {
  const normalized = normalizePhone(params.phone);
  if (!normalized) return;
  try {
    const { error } = await supabase.from('contact_phones').insert({
      user_id: params.userId,
      contact_id: params.contactId,
      phone: normalized,
      category: 'import',
      label: params.label ?? null,
      source_provider: params.sourceProvider ?? 'import',
    });
    if (error && !isPostgresUniqueViolation(error) && !isMissingContactPhonesTableError(error)) {
      console.error('[contact_phones] ensureImportPhoneEntry insert failed:', error);
    }
  } catch (error) {
    console.error('[contact_phones] ensureImportPhoneEntry unexpected:', error);
  }
}

/**
 * Ensure an enriched phone is recorded. Called from enrichment pipeline after
 * apollo/apify/fiber return phone data. Idempotent — re-enrichment that
 * returns the same phone is a no-op; new phones stack.
 */
export async function ensureEnrichedPhoneEntry(
  supabase: SupabaseFrom,
  params: {
    userId: string;
    contactId: string;
    phone: string;
    category: ContactPhoneCategory;
    label?: string | null;
    sourceProvider?: string | null;
    phoneStatus?: string | null;
  },
): Promise<void> {
  const normalized = normalizePhone(params.phone);
  if (!normalized) return;
  try {
    const { error } = await supabase.from('contact_phones').insert({
      user_id: params.userId,
      contact_id: params.contactId,
      phone: normalized,
      category: params.category,
      label: params.label ?? null,
      source_provider: params.sourceProvider ?? null,
      phone_status: params.phoneStatus ?? null,
    });
    if (error && !isPostgresUniqueViolation(error) && !isMissingContactPhonesTableError(error)) {
      console.error('[contact_phones] ensureEnrichedPhoneEntry insert failed:', error);
    }
  } catch (error) {
    console.error('[contact_phones] ensureEnrichedPhoneEntry unexpected:', error);
  }
}

/**
 * Saves "user-added" phone numbers for a contact (the manual-entry block
 * on the contact panel). Only rows with category `user` are removed and
 * rewritten from `additionalPhones`. Import / enriched rows are left alone.
 *
 * Mirrors syncUserAddedContactEmails — both functions read the form's full
 * list and treat it as the new source of truth for that category.
 */
export async function syncUserAddedContactPhones(
  supabase: SupabaseFrom,
  params: {
    contactId: string;
    userId: string;
    /** Full list of user-typed phones from the form (NOT contact-level primary). */
    additionalPhones: string[];
  },
): Promise<void> {
  const seenNorm = new Set<string>();
  const deduped: string[] = [];
  for (const raw of params.additionalPhones) {
    const normalised = normalizePhone(raw);
    if (!normalised) continue;
    if (seenNorm.has(normalised)) continue;
    seenNorm.add(normalised);
    deduped.push(normalised);
  }

  try {
    const { error: delErr } = await supabase
      .from('contact_phones')
      .delete()
      .eq('contact_id', params.contactId)
      .eq('user_id', params.userId)
      .eq('category', 'user');
    if (delErr) throw delErr;

    // Avoid colliding with rows already present in other categories (import
    // / enriched_*). The UNIQUE (user_id, contact_id, phone) constraint
    // wouldn't allow it anyway, but we want to skip silently rather than
    // error out.
    const { data: blockingRows, error: selErr } = await supabase
      .from('contact_phones')
      .select('phone')
      .eq('contact_id', params.contactId)
      .eq('user_id', params.userId);
    if (selErr) throw selErr;

    const takenNorm = new Set<string>();
    for (const row of blockingRows || []) {
      const normalised = normalizePhone((row as { phone?: string }).phone);
      if (normalised) takenNorm.add(normalised);
    }

    const toInsert = deduped.filter((p) => !takenNorm.has(p));
    if (toInsert.length === 0) return;

    const now = new Date().toISOString();
    for (const phone of toInsert) {
      const { error: insErr } = await supabase.from('contact_phones').insert({
        contact_id: params.contactId,
        user_id: params.userId,
        phone,
        category: 'user',
        label: null,
        source_provider: null,
        phone_status: null,
        updated_at: now,
      });
      if (insErr && !isPostgresUniqueViolation(insErr)) throw insErr;
    }
  } catch (e: unknown) {
    if (isMissingContactPhonesTableError(e)) return;
    throw e;
  }
}

/**
 * Load all phones for a set of contacts owned by one user. Used by the
 * contact side panel / leads list to render the phone stack.
 */
export async function fetchContactPhonesForContacts(
  supabase: SupabaseFrom,
  contactIds: string[],
): Promise<Map<string, ContactPhoneRow[]>> {
  // Signature mirrors fetchContactEmailsForContacts — relies on the caller
  // passing a user-context Supabase client so RLS filters to the user's rows.
  // Pass an admin client only when you've already enforced ownership.
  const out = new Map<string, ContactPhoneRow[]>();
  if (contactIds.length === 0) return out;
  try {
    const { data, error } = await supabase
      .from('contact_phones')
      .select('*')
      .in('contact_id', contactIds)
      .order('created_at', { ascending: true });
    if (error) {
      if (!isMissingContactPhonesTableError(error)) {
        console.error('[contact_phones] fetchContactPhonesForContacts failed:', error);
      }
      return out;
    }
    for (const row of (data ?? []) as ContactPhoneRow[]) {
      const list = out.get(row.contact_id) ?? [];
      list.push(row);
      out.set(row.contact_id, list);
    }
  } catch (error) {
    console.error('[contact_phones] fetchContactPhonesForContacts unexpected:', error);
  }
  return out;
}
