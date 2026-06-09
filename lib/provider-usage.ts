import { createAdminClient } from '@/lib/supabase-admin';

/**
 * Cost metering for paid data providers (Apify LinkedIn scraping, Apollo
 * enrichment). Powers /admin/llm-usage's "Data & enrichment cost" section.
 *
 * Two data sources back that dashboard:
 *  - Retroactive counts from already-enriched rows (the
 *    `data_provider_usage_by_user` view) → authoritative "usage to date".
 *  - Forward per-call events recorded here via recordProviderUsage() →
 *    the "recent activity" feed + captures re-enrichment the counts miss.
 *
 * All prices live in this file so they're trivial to correct.
 */

export type ProviderUsageProvider = 'apify' | 'apollo';

export type ProviderUsageEventType =
  | 'apify_profile_scrape'
  | 'apify_company_scrape'
  | 'apollo_person_enrichment'
  | 'apollo_company_enrichment';

// ── Pricing — edit here ──────────────────────────────────────────────────
// Apify HarvestAPI actors bill per result. The profile scraper's input mode
// is literally labelled "Profile details no email ($4 per 1k)" in
// lib/enrichment-pipeline.ts → $0.004 per profile. The company actor
// (harvestapi~linkedin-company) rate is an ESTIMATE — confirm on the Apify
// console (Actors → runs → cost) and update.
export const APIFY_PROFILE_SCRAPE_USD = 0.004;
export const APIFY_COMPANY_SCRAPE_USD = 0.004; // estimate — confirm

// Apollo bills in credits bundled into the plan rather than per-$, so we track
// consumption, not dollars. people/match (person enrichment) and
// organizations/enrich each cost ~1 credit; a phone reveal costs ~1 export
// credit. people/company *search* results (~0.05 / 0.1 credits) aren't
// persisted per-result, so they're not counted here.
export const APOLLO_CREDITS = {
  person_enrichment: 1,
  company_enrichment: 1,
  phone_reveal: 1,
} as const;

// Your Apollo plan — shown as context on the dashboard. Edit to match reality.
export const APOLLO_PLAN = {
  name: 'Basic ($50/mo)', // set to 'Free' if you drop to the free tier
  monthlyUsd: 50 as number | null,
} as const;

export function apifyEventCostUsd(eventType: ProviderUsageEventType, quantity = 1): number | null {
  if (eventType === 'apify_profile_scrape') return APIFY_PROFILE_SCRAPE_USD * quantity;
  if (eventType === 'apify_company_scrape') return APIFY_COMPANY_SCRAPE_USD * quantity;
  return null;
}

export function apolloEventCredits(eventType: ProviderUsageEventType, quantity = 1): number | null {
  if (eventType === 'apollo_person_enrichment') return APOLLO_CREDITS.person_enrichment * quantity;
  if (eventType === 'apollo_company_enrichment') return APOLLO_CREDITS.company_enrichment * quantity;
  return null;
}

type RecordProviderUsageInput = {
  userId?: string | null;
  provider: ProviderUsageProvider;
  eventType: ProviderUsageEventType;
  quantity?: number;
  contactId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Fire-and-forget metering for a single provider call. Mirrors
 * recordLlmUsageEvent: it NEVER throws — a metering failure must never break
 * enrichment. Call it without awaiting, e.g.
 *   recordProviderUsage({ ... }).catch(() => {});
 */
export async function recordProviderUsage(input: RecordProviderUsageInput): Promise<void> {
  try {
    const quantity = input.quantity ?? 1;
    const costUsd = input.provider === 'apify' ? apifyEventCostUsd(input.eventType, quantity) : null;
    const creditUnits = input.provider === 'apollo' ? apolloEventCredits(input.eventType, quantity) : null;
    const unitCostUsd = input.provider === 'apify' ? apifyEventCostUsd(input.eventType, 1) : null;

    const supabase = createAdminClient();
    const { error } = await supabase.from('provider_usage_events').insert({
      user_id: input.userId ?? null,
      provider: input.provider,
      event_type: input.eventType,
      quantity,
      unit_cost_usd: unitCostUsd,
      cost_usd: costUsd,
      credit_units: creditUnits,
      contact_id: input.contactId ?? null,
      metadata: input.metadata ?? {},
    });
    if (error) console.error('[provider-usage] failed to record event:', error);
  } catch (error) {
    console.error('[provider-usage] failed to initialise recording:', error);
  }
}
