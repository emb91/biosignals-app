/**
 * Apollo async phone-reveal correlation.
 *
 * Apollo's reveal_phone_number=true is asynchronous: the revealed numbers are
 * POSTed to the webhook_url we supply, minutes after the people/match call (the
 * sync response carries at most an employer phone). To match that async delivery
 * back to the right (user, contact) we:
 *
 *   1. Mint a single-use random token, store a pending row in
 *      apollo_phone_reveal_requests, and embed the token in the webhook URL path
 *      (.../api/apollo/phone-webhook/<token>) — see buildPhoneRevealWebhookUrl.
 *   2. On the inbound webhook, look the request up by token (path), extract the
 *      phones from a tolerant set of payload shapes, write them to contact_phones,
 *      and mark the row received. Idempotent — Apollo may retry, and the
 *      contact_phones UNIQUE(user_id, contact_id, phone) constraint dedups.
 *
 * The token doubles as the bearer secret: Apollo sends no signature/header on
 * these webhooks, so an unguessable, single-use, server-stored token in the path
 * is the only credential a caller could present.
 */
import { randomUUID } from 'crypto';
import type { ApolloPhoneEntry } from '@/lib/apollo';
import {
  ensureEnrichedPhoneEntry,
  classifyEnrichedPhone,
  normalizePhone,
  type ContactPhoneCategory,
} from '@/lib/contact-phones';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseFrom = { from: (table: string) => any };

const TABLE = 'apollo_phone_reveal_requests';

export type PhoneRevealRequestRow = {
  id: string;
  token: string;
  user_id: string;
  contact_id: string;
  linkedin_url: string | null;
  email: string | null;
  full_name: string | null;
  status: 'pending' | 'received' | 'failed';
  phones_written: number;
  created_at: string;
  received_at: string | null;
};

/**
 * Base URL of the phone webhook receiver, WITHOUT the token segment. Set in prod
 * to the public app URL, e.g. https://app.example.com/api/apollo/phone-webhook.
 * Apollo cannot reach localhost, so this is necessarily unset in local dev — when
 * it's unset we don't request the async reveal at all (see lib/apollo.ts).
 */
export function phoneWebhookBaseUrl(): string | null {
  const raw = (process.env.APOLLO_PHONE_WEBHOOK_URL || '').trim();
  return raw ? raw.replace(/\/+$/, '') : null;
}

/** Full per-call webhook URL with the correlation token in the path. */
export function buildPhoneRevealWebhookUrl(token: string): string | null {
  const base = phoneWebhookBaseUrl();
  if (!base) return null;
  return `${base}/${encodeURIComponent(token)}`;
}

/**
 * Insert a pending reveal request and return its token (to embed in the webhook
 * URL). Returns null if the receiver isn't configured (local dev) or the insert
 * fails — callers treat null as "don't fire the async reveal".
 */
export async function registerPhoneRevealRequest(
  supabase: SupabaseFrom,
  params: {
    userId: string;
    contactId: string;
    linkedinUrl?: string | null;
    email?: string | null;
    fullName?: string | null;
  },
): Promise<{ token: string; id: string } | null> {
  if (!phoneWebhookBaseUrl()) return null;
  const token = randomUUID();
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        token,
        user_id: params.userId,
        contact_id: params.contactId,
        linkedin_url: params.linkedinUrl ?? null,
        email: params.email ?? null,
        full_name: params.fullName ?? null,
        status: 'pending',
      })
      .select('id, token')
      .single();
    if (error || !data) {
      console.error('[apollo-phone-webhook] failed to register reveal request:', error);
      return null;
    }
    return { token: (data as { token: string }).token, id: (data as { id: string }).id };
  } catch (err) {
    console.error('[apollo-phone-webhook] registerPhoneRevealRequest unexpected:', err);
    return null;
  }
}

/** Look up a pending/received request by its token (the path segment Apollo echoes). */
export async function findPhoneRevealRequestByToken(
  supabase: SupabaseFrom,
  token: string,
): Promise<PhoneRevealRequestRow | null> {
  const cleaned = (token || '').trim();
  if (!cleaned) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('token', cleaned)
    .maybeSingle();
  if (error) {
    console.error('[apollo-phone-webhook] findPhoneRevealRequestByToken failed:', error);
    return null;
  }
  return (data as PhoneRevealRequestRow) ?? null;
}

/**
 * Identity-based fallback: if a token ever fails to round-trip, match the
 * incoming person to the most recent pending request by normalized linkedin_url,
 * then by email. Best-effort.
 */
export async function findPhoneRevealRequestByIdentity(
  supabase: SupabaseFrom,
  identity: { linkedinUrl?: string | null; email?: string | null },
): Promise<PhoneRevealRequestRow | null> {
  const linkedin = (identity.linkedinUrl || '').trim();
  const email = (identity.email || '').trim().toLowerCase();
  for (const filter of [
    linkedin ? { col: 'linkedin_url', val: linkedin } : null,
    email ? { col: 'email', val: email } : null,
  ]) {
    if (!filter) continue;
    const { data } = await supabase
      .from(TABLE)
      .select('*')
      .eq('status', 'pending')
      .ilike(filter.col, filter.val)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as PhoneRevealRequestRow;
  }
  return null;
}

/** Mark a request as received (or failed), recording the raw body + count. */
export async function markPhoneRevealRequestReceived(
  supabase: SupabaseFrom,
  params: {
    id: string;
    phonesWritten: number;
    rawResponse: unknown;
    status?: 'received' | 'failed';
  },
): Promise<void> {
  try {
    await supabase
      .from(TABLE)
      .update({
        status: params.status ?? 'received',
        phones_written: params.phonesWritten,
        raw_response: params.rawResponse ?? null,
        received_at: new Date().toISOString(),
      })
      .eq('id', params.id);
  } catch (err) {
    console.error('[apollo-phone-webhook] markPhoneRevealRequestReceived failed:', err);
  }
}

/**
 * Pull ApolloPhoneEntry[] out of an Apollo webhook body. The exact envelope is
 * undocumented and can't be tested against localhost, so we accept every shape
 * we can reasonably expect: { person }, { people: [...] }, { contacts: [...] },
 * { matches: [...] }, a bare person object, or a bare array of people. We also
 * surface the matched person's identity for the fallback correlation.
 */
export function extractApolloPhonesFromWebhookBody(body: unknown): {
  phones: ApolloPhoneEntry[];
  identity: { linkedinUrl: string | null; email: string | null };
} {
  const people = collectPeople(body);
  const phones: ApolloPhoneEntry[] = [];
  let linkedinUrl: string | null = null;
  let email: string | null = null;

  for (const person of people) {
    if (!person || typeof person !== 'object') continue;
    const rec = person as Record<string, unknown>;
    if (!linkedinUrl && typeof rec.linkedin_url === 'string') linkedinUrl = rec.linkedin_url;
    if (!email && typeof rec.email === 'string') email = rec.email;
    const list = rec.phone_numbers;
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (entry && typeof entry === 'object') phones.push(entry as ApolloPhoneEntry);
      }
    }
  }
  return { phones, identity: { linkedinUrl, email } };
}

function collectPeople(body: unknown): unknown[] {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if (typeof body !== 'object') return [];
  const rec = body as Record<string, unknown>;
  for (const key of ['people', 'contacts', 'matches', 'results']) {
    if (Array.isArray(rec[key])) return rec[key] as unknown[];
  }
  if (rec.person && typeof rec.person === 'object') return [rec.person];
  // A bare person object (has identifying / phone fields).
  if ('phone_numbers' in rec || 'linkedin_url' in rec || 'email' in rec) return [rec];
  return [];
}

/**
 * Write extracted phones to contact_phones for a resolved request. The fit gate
 * was already applied when the reveal was requested (only high-fit contacts get
 * here), so we don't re-gate. Idempotent — UNIQUE(user_id, contact_id, phone)
 * makes re-deliveries no-ops. Returns the number of phones written.
 */
export async function writeRevealedPhonesForRequest(
  supabase: SupabaseFrom,
  request: Pick<PhoneRevealRequestRow, 'user_id' | 'contact_id'>,
  phones: ApolloPhoneEntry[],
): Promise<number> {
  let written = 0;
  const seen = new Set<string>();
  for (const entry of phones) {
    const raw = entry.sanitized_number || entry.raw_number;
    const normalised = normalizePhone(raw);
    if (!normalised) continue;
    // Collapse in-payload duplicates so the count reflects distinct numbers and
    // we don't fire redundant inserts the UNIQUE constraint would reject anyway.
    if (seen.has(normalised)) continue;
    seen.add(normalised);
    const category: ContactPhoneCategory = classifyEnrichedPhone({
      field: entry.type,
      providerLabel: 'apollo_reveal',
    });
    try {
      const inserted = await ensureEnrichedPhoneEntry(supabase, {
        userId: request.user_id,
        contactId: request.contact_id,
        phone: normalised,
        category,
        label: entry.type ?? 'apollo_reveal',
        sourceProvider: 'apollo_reveal',
        phoneStatus: entry.status ?? null,
      });
      if (inserted) written += 1;
    } catch (err) {
      console.error('[apollo-phone-webhook] writeRevealedPhonesForRequest failed:', err);
    }
  }
  return written;
}
