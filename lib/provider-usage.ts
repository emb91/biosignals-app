import { createAdminClient } from '@/lib/supabase-admin';

/**
 * Cost metering for paid data providers (Apify LinkedIn scraping, Apollo
 * enrichment, ZeroBounce email verification/finder). Powers /admin/llm-usage's
 * "Data & enrichment cost" section.
 *
 * Two data sources back that dashboard:
 *  - Retroactive counts from already-enriched rows (the
 *    `data_provider_usage_by_user` view) → authoritative "usage to date".
 *  - Forward per-call events recorded here via recordProviderUsage() →
 *    the "recent activity" feed + captures re-enrichment the counts miss.
 *
 * All prices live in this file so they're trivial to correct.
 */

export type ProviderUsageProvider = 'apify' | 'apollo' | 'zerobounce';

export type ProviderUsageEventType =
  | 'apify_profile_scrape'
  | 'apify_company_scrape'
  | 'apify_jobs_result'
  | 'apollo_person_enrichment'
  | 'apollo_company_enrichment'
  | 'apollo_phone_reveal'
  | 'zerobounce_email_validate'
  | 'zerobounce_email_finder';

// ── Pricing — edit here ──────────────────────────────────────────────────
// Apify HarvestAPI actors bill per result. The profile scraper's input mode
// is literally labelled "Profile details no email ($4 per 1k)" in
// lib/enrichment-pipeline.ts → $0.004 per profile. The company actor
// harvestapi/linkedin-company is $4/1k on Free and $3/1k on Gold. The runtime
// default is the conservative Free rate; set APIFY_COMPANY_UNIT_PRICE_USD=.003
// when the workspace is on Gold. Jobs are billed per returned job, not input.
export const APIFY_PROFILE_SCRAPE_USD = 0.004;
export const APIFY_COMPANY_SCRAPE_USD = Number(process.env.APIFY_COMPANY_UNIT_PRICE_USD || 0.004);
export const APIFY_JOBS_RESULT_USD = 0.001;

// Apollo bills in credits bundled into the plan rather than per-$, so we track
// consumption, not dollars. people/match (person enrichment) and
// organizations/enrich each cost ~1 credit; a mobile phone reveal costs 8
// credits (Apollo charges mobile reveals far above email/enrichment). ICP
// sourcing search results are also counted in the admin API via
// data_acquisition_usage_events.
export const APOLLO_CREDITS = {
  person_enrichment: 1,
  company_enrichment: 1,
  phone_reveal: 8,
} as const;

// Your Apollo plan — shown as context on the dashboard. Edit to match reality.
// monthlyCredits = credits Apollo shows for the current monthly allowance.
// billingCycleAnchorDay/hour = Apollo renewal instant (your account shows Jun 10, 7:00 PM GMT+12 = 07:00 UTC).
// currentPeriodBaselineCredits = Apollo dashboard credits used at baselineRecordedAt; new app-side events after
// that timestamp are added on top until the next renewal period starts.
export const APOLLO_PLAN = {
  name: 'Free',
  monthlyUsd: 0 as number | null,
  monthlyCredits: 250 as number | null,
  billingCycleAnchorDay: 10,
  billingCycleAnchorUtcHour: 7,
  currentPeriodBaselineCredits: 116,
  baselineRecordedAt: '2026-06-10T02:45:00.000Z',
} as const;

// ZeroBounce bills in credits. Validate = 1 credit per billable result (unknown
// is free). Email Finder = 20 credits per successful find (undetermined is free).
export const ZEROBOUNCE_CREDITS = {
  email_validate: 1,
  email_finder: 20,
} as const;

// Optional context for the dashboard when live balance is unavailable.
export const ZEROBOUNCE_PLAN = {
  name: 'Pay as you go',
  purchasedCredits: null as number | null,
} as const;

export function apifyEventCostUsd(eventType: ProviderUsageEventType, quantity = 1): number | null {
  if (eventType === 'apify_profile_scrape') return APIFY_PROFILE_SCRAPE_USD * quantity;
  if (eventType === 'apify_company_scrape') return APIFY_COMPANY_SCRAPE_USD * quantity;
  if (eventType === 'apify_jobs_result') return APIFY_JOBS_RESULT_USD * quantity;
  return null;
}

export function apolloEventCredits(eventType: ProviderUsageEventType, quantity = 1): number | null {
  if (eventType === 'apollo_person_enrichment') return APOLLO_CREDITS.person_enrichment * quantity;
  if (eventType === 'apollo_company_enrichment') return APOLLO_CREDITS.company_enrichment * quantity;
  if (eventType === 'apollo_phone_reveal') return APOLLO_CREDITS.phone_reveal * quantity;
  return null;
}

export function zerobounceEventCredits(eventType: ProviderUsageEventType, quantity = 1): number | null {
  if (eventType === 'zerobounce_email_validate') return ZEROBOUNCE_CREDITS.email_validate * quantity;
  if (eventType === 'zerobounce_email_finder') return ZEROBOUNCE_CREDITS.email_finder * quantity;
  return null;
}

/** ZeroBounce does not bill validation when status is unknown. */
export function zerobounceValidationBillableQuantity(status: string | null | undefined): number {
  return String(status || '').trim().toLowerCase() === 'unknown' ? 0 : 1;
}

export async function fetchZeroBounceCreditsBalance(): Promise<number | null> {
  const apiKey = process.env.ZEROBOUNCE_API_KEY;
  if (!apiKey) return null;

  const baseUrl = process.env.ZEROBOUNCE_GET_CREDITS_API_BASE_URL || 'https://api.zerobounce.net/v2/getcredits';
  const url = new URL(baseUrl);
  url.searchParams.set('api_key', apiKey);

  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as { Credits?: number | string };
    const credits = typeof data.Credits === 'number' ? data.Credits : Number(data.Credits);
    if (!Number.isFinite(credits) || credits < 0) return null;
    return credits;
  } catch (error) {
    console.error('[provider-usage] failed to fetch ZeroBounce balance:', error);
    return null;
  }
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
    const creditUnits =
      input.provider === 'apollo'
        ? apolloEventCredits(input.eventType, quantity)
        : input.provider === 'zerobounce'
          ? zerobounceEventCredits(input.eventType, quantity)
          : null;
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
