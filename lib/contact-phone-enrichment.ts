/**
 * Phone enrichment gate + writer.
 *
 * Gate: only enrich phones for high-fit contacts. Spending Apollo/Apify
 * credits on phone reveal for a contact whose fit_score < 0.5 is wasted
 * spend — they're not worth reaching out to. Same for a contact at a
 * low-fit company.
 *
 * Writer: takes Apollo's phone_numbers array (or any provider's), classifies
 * each entry, and writes via ensureEnrichedPhoneEntry — idempotent + stacks.
 */
import type { ApolloPhoneEntry, ApolloLookupInput } from '@/lib/apollo';
import { tryApolloPhoneRevealForLookup } from '@/lib/apollo';
import {
  ensureEnrichedPhoneEntry,
  classifyEnrichedPhone,
  normalizePhone,
  type ContactPhoneCategory,
} from '@/lib/contact-phones';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseFrom = { from: (table: string) => any };

/**
 * Threshold below which we skip phone enrichment for a contact. Stored as
 * 0–1 (normalised) because that's the canonical scale in user_companies +
 * contacts. Tune by changing this constant.
 */
export const PHONE_ENRICHMENT_FIT_THRESHOLD = 0.5;

export type PhoneEnrichmentGateInput = {
  contactFitScore?: number | null;
  companyFitScore?: number | null;
};

/**
 * Decision: enrich phones if EITHER the contact OR the company is high-fit.
 * High-fit company means the account matters even if a given contact's fit
 * is borderline; high-fit contact means the person matters even at a
 * lower-fit company. AND would be too restrictive — would skip phone work
 * on great contacts at marginal-fit accounts.
 */
export function shouldEnrichPhones(input: PhoneEnrichmentGateInput): boolean {
  const contact = typeof input.contactFitScore === 'number' ? input.contactFitScore : -1;
  const company = typeof input.companyFitScore === 'number' ? input.companyFitScore : -1;
  return contact >= PHONE_ENRICHMENT_FIT_THRESHOLD || company >= PHONE_ENRICHMENT_FIT_THRESHOLD;
}

/**
 * Look up the latest fit scores for a contact + its company, then apply the
 * gate. Use this from enrichment pipelines that don't already have the
 * scores in hand.
 */
export async function shouldEnrichPhonesFor(
  supabase: SupabaseFrom,
  params: { userId: string; contactId: string },
): Promise<{ allowed: boolean; reason: string }> {
  const { data: contact, error } = await supabase
    .from('contacts')
    .select('contact_fit_score, fit_score, company_id')
    .eq('user_id', params.userId)
    .eq('id', params.contactId)
    .maybeSingle();
  if (error || !contact) {
    return { allowed: false, reason: 'contact not found or load failed' };
  }
  const contactFit = (contact.contact_fit_score ?? contact.fit_score) as number | null;

  let companyFit: number | null = null;
  if (contact.company_id) {
    const { data: uc } = await supabase
      .from('user_companies')
      .select('company_fit_score')
      .eq('user_id', params.userId)
      .eq('company_id', contact.company_id)
      .maybeSingle();
    companyFit = (uc?.company_fit_score ?? null) as number | null;
  }

  const allowed = shouldEnrichPhones({ contactFitScore: contactFit, companyFitScore: companyFit });
  return {
    allowed,
    reason: allowed
      ? `fit gate passed (contact=${contactFit?.toFixed(2) ?? 'null'}, company=${companyFit?.toFixed(2) ?? 'null'})`
      : `fit gate failed (contact=${contactFit?.toFixed(2) ?? 'null'}, company=${companyFit?.toFixed(2) ?? 'null'}); both below ${PHONE_ENRICHMENT_FIT_THRESHOLD}`,
  };
}

/**
 * Ingest Apollo's phone_numbers payload into contact_phones. Skips silently
 * if the fit gate denies. Per-phone errors are logged and swallowed so a
 * single bad entry doesn't break the whole enrichment.
 */
export async function writeApolloPhonesToContact(
  supabase: SupabaseFrom,
  params: {
    userId: string;
    contactId: string;
    phones: ApolloPhoneEntry[] | null | undefined;
    fitScores?: PhoneEnrichmentGateInput;
  },
): Promise<{ written: number; skipped: number; gateAllowed: boolean }> {
  if (!Array.isArray(params.phones) || params.phones.length === 0) {
    return { written: 0, skipped: 0, gateAllowed: false };
  }
  // If caller provided scores, use those — otherwise look them up.
  const gate = params.fitScores
    ? { allowed: shouldEnrichPhones(params.fitScores), reason: 'caller-provided scores' }
    : await shouldEnrichPhonesFor(supabase, { userId: params.userId, contactId: params.contactId });
  if (!gate.allowed) {
    return { written: 0, skipped: params.phones.length, gateAllowed: false };
  }

  let written = 0;
  let skipped = 0;
  for (const entry of params.phones) {
    const raw = entry.sanitized_number || entry.raw_number;
    const normalised = normalizePhone(raw);
    if (!normalised) {
      skipped += 1;
      continue;
    }
    const category: ContactPhoneCategory = classifyEnrichedPhone({
      field: entry.type,
      providerLabel: null,
    });
    try {
      await ensureEnrichedPhoneEntry(supabase, {
        userId: params.userId,
        contactId: params.contactId,
        phone: normalised,
        category,
        label: entry.type ?? null,
        sourceProvider: 'apollo',
        phoneStatus: entry.status ?? null,
      });
      written += 1;
    } catch (err) {
      console.error('[contact-phone-enrichment] ensureEnrichedPhoneEntry failed:', err);
      skipped += 1;
    }
  }
  return { written, skipped, gateAllowed: true };
}

/**
 * Make a second Apollo people/match call with reveal_phone_number=true to
 * pull mobile / personal numbers that aren't returned by the standard match.
 * Costs additional Apollo credits — gated by fit score.
 *
 * Caller is responsible for deciding when to invoke this (typically: only
 * when the standard match returned no phones, or only on high-priority
 * accounts). We don't try to be clever about that here.
 */
export async function attemptApolloPhoneRevealForContact(
  supabase: SupabaseFrom,
  params: {
    userId: string;
    contactId: string;
    lookupInput: ApolloLookupInput;
    fitScores?: PhoneEnrichmentGateInput;
  },
): Promise<{ revealed: number; gateAllowed: boolean; error: string | null }> {
  const gate = params.fitScores
    ? { allowed: shouldEnrichPhones(params.fitScores) }
    : await shouldEnrichPhonesFor(supabase, { userId: params.userId, contactId: params.contactId });
  if (!gate.allowed) return { revealed: 0, gateAllowed: false, error: null };

  try {
    const { person } = await tryApolloPhoneRevealForLookup(params.lookupInput);
    const phones = Array.isArray(person?.phone_numbers) ? person.phone_numbers : [];
    if (phones.length === 0) return { revealed: 0, gateAllowed: true, error: null };

    let revealed = 0;
    for (const entry of phones) {
      const raw = entry.sanitized_number || entry.raw_number;
      const normalised = normalizePhone(raw);
      if (!normalised) continue;
      const category: ContactPhoneCategory = classifyEnrichedPhone({
        field: entry.type,
        providerLabel: 'apollo_reveal',
      });
      try {
        await ensureEnrichedPhoneEntry(supabase, {
          userId: params.userId,
          contactId: params.contactId,
          phone: normalised,
          category,
          label: entry.type ?? 'apollo_reveal',
          sourceProvider: 'apollo_reveal',
          phoneStatus: entry.status ?? null,
        });
        revealed += 1;
      } catch (err) {
        console.error('[contact-phone-enrichment] reveal write failed:', err);
      }
    }
    return { revealed, gateAllowed: true, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[contact-phone-enrichment] Apollo phone reveal failed:', msg);
    return { revealed: 0, gateAllowed: true, error: msg };
  }
}
