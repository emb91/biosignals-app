/**
 * Billing catalog — single source of truth for plans, the enrichment pack,
 * and the free tier. Price POINTS live here; Stripe price IDs live in env
 * vars (created once by `node scripts/stripe-bootstrap.mjs`, which prints
 * them).
 *
 * Pricing model:
 *  - The organization is the billable entity.
 *  - Pure per-seat: one Stripe price, quantity = seat count.
 *    Org-wide quota = seats × per-seat constant (enrichments, leads, cap, exports).
 *  - Overage = prepaid enrichment packs (one-time purchase, rolls over).
 *  - Annual billing = 2 months free (~16% discount), billed upfront.
 *  - Free tier = 1 seat, 50 lifetime enrichments + 20 lifetime net-new leads.
 *
 * Copy rule: user-facing strings talk about "contacts", "seats", "plan" —
 * never internal credits or data vendors.
 */

export type PlanKey = 'starter' | 'growth';

export type PlanConfig = {
  key: PlanKey;
  name: string;
  perSeatMonthlyUsd: number;
  minSeats: number;
  // Per-seat monthly quotas (org total = seats × these)
  enrichmentsPerSeat: number;
  activeLeadsCapPerSeat: number;
  exportsPerDayPerSeat: number;
  netNewLeadsPerSeat: number;
  // Overage pricing
  overagePer1kEnrichments: number;
  overagePerLead: number;
  // Stripe env vars
  priceEnv: string;
  annualPriceEnv: string;
  lookupKey: string;
  annualLookupKey: string;
};

export const PLANS: Record<PlanKey, PlanConfig> = {
  starter: {
    key: 'starter',
    name: 'Starter',
    perSeatMonthlyUsd: 149,
    minSeats: 1,
    enrichmentsPerSeat: 1000,
    activeLeadsCapPerSeat: 8000,
    exportsPerDayPerSeat: 20,
    netNewLeadsPerSeat: 25,
    overagePer1kEnrichments: 100,
    overagePerLead: 1.0,
    priceEnv: 'STRIPE_PRICE_STARTER_SEAT',
    annualPriceEnv: 'STRIPE_PRICE_STARTER_SEAT_ANNUAL',
    lookupKey: 'arcova_starter_seat_monthly',
    annualLookupKey: 'arcova_starter_seat_annual',
  },
  growth: {
    key: 'growth',
    name: 'Growth',
    perSeatMonthlyUsd: 299,
    minSeats: 2,
    enrichmentsPerSeat: 3000,
    activeLeadsCapPerSeat: 20000,
    exportsPerDayPerSeat: 50,
    netNewLeadsPerSeat: 100,
    overagePer1kEnrichments: 70,
    overagePerLead: 0.7,
    priceEnv: 'STRIPE_PRICE_GROWTH_SEAT',
    annualPriceEnv: 'STRIPE_PRICE_GROWTH_SEAT_ANNUAL',
    lookupKey: 'arcova_growth_seat_monthly',
    annualLookupKey: 'arcova_growth_seat_annual',
  },
};

/** Enrichment overage pack — 1,000 enrichments that never expire. */
export const ENRICH_PACK = {
  enrichments: 1000,
  usd: 100,
  priceEnv: 'STRIPE_PRICE_ENRICH_PACK',
  lookupKey: 'arcova_enrich_pack_1000',
} as const;

/** Keep the old name as an alias so existing imports don't break immediately. */
export const CONTACT_PACK = ENRICH_PACK;

export const FREE_TIER = {
  seatLimit: 1,
  /** Lifetime (trial) — not monthly. */
  lifetimeEnrichments: 50,
  lifetimeLeads: 20,
  activeLeadsCap: 100,
  exportsPerDay: 10,
} as const;

/** Days an org keeps full access after a failed payment before soft-lock. */
export const PAYMENT_GRACE_DAYS = 7;

export function isPlanKey(value: unknown): value is PlanKey {
  return value === 'starter' || value === 'growth';
}

export function planPriceId(plan: PlanConfig): string | null {
  return process.env[plan.priceEnv] || null;
}

export function planAnnualPriceId(plan: PlanConfig): string | null {
  return process.env[plan.annualPriceEnv] || null;
}

export function enrichPackPriceId(): string | null {
  return process.env[ENRICH_PACK.priceEnv] || null;
}

/** Alias so existing callers of contactPackPriceId() keep working. */
export const contactPackPriceId = enrichPackPriceId;

/** Reverse-map a Stripe price id to our plan (checks both monthly and annual). */
export function planForPriceId(priceId: string | null | undefined): PlanConfig | null {
  if (!priceId) return null;
  for (const plan of Object.values(PLANS)) {
    if (planPriceId(plan) === priceId || planAnnualPriceId(plan) === priceId) return plan;
  }
  return null;
}
