/**
 * Billing catalog — single source of truth for plans, the contact pack, and
 * the free tier. Price POINTS live here; Stripe price IDs live in env vars
 * (created once by `node scripts/stripe-bootstrap.mjs`, which prints them).
 *
 * Pricing model (see BILLING_PLAN.md):
 *  - The organization is the billable entity.
 *  - Paid plans = flat monthly fee including N seats + M new enriched
 *    contacts per month. Extra seats are a per-seat subscription item.
 *  - Overage = prepaid contact packs (one-time purchase, rolls over).
 *  - Free tier = 1 seat, 50 contacts LIFETIME (the trial).
 *
 * Copy rule: user-facing strings talk about "contacts", "seats", "plan" —
 * never internal credits or data vendors.
 */

export type PlanKey = 'team' | 'scale';

export type PlanConfig = {
  key: PlanKey;
  name: string;
  monthlyUsd: number;
  includedSeats: number;
  includedMonthlyContacts: number;
  extraSeatMonthlyUsd: number;
  /** Env var holding the Stripe price id for the base subscription. */
  priceEnv: string;
  /** Env var holding the Stripe price id for the per-extra-seat item. */
  seatPriceEnv: string;
  /** Stripe lookup_key for the base price (bootstrap idempotency). */
  lookupKey: string;
  seatLookupKey: string;
};

export const PLANS: Record<PlanKey, PlanConfig> = {
  team: {
    key: 'team',
    name: 'Team',
    monthlyUsd: 199,
    includedSeats: 3,
    includedMonthlyContacts: 1000,
    extraSeatMonthlyUsd: 49,
    priceEnv: 'STRIPE_PRICE_TEAM',
    seatPriceEnv: 'STRIPE_PRICE_TEAM_SEAT',
    lookupKey: 'arcova_team_base_monthly',
    seatLookupKey: 'arcova_team_seat_monthly',
  },
  scale: {
    key: 'scale',
    name: 'Scale',
    monthlyUsd: 499,
    includedSeats: 10,
    includedMonthlyContacts: 3000,
    extraSeatMonthlyUsd: 39,
    priceEnv: 'STRIPE_PRICE_SCALE',
    seatPriceEnv: 'STRIPE_PRICE_SCALE_SEAT',
    lookupKey: 'arcova_scale_base_monthly',
    seatLookupKey: 'arcova_scale_seat_monthly',
  },
};

export const CONTACT_PACK = {
  contacts: 1000,
  usd: 149,
  priceEnv: 'STRIPE_PRICE_CONTACT_PACK',
  lookupKey: 'arcova_contact_pack_1000',
} as const;

export const FREE_TIER = {
  seatLimit: 1,
  /** Lifetime, not monthly — this is the trial allowance. */
  lifetimeContacts: 50,
} as const;

/** Days an org keeps full access after a failed payment before soft-lock. */
export const PAYMENT_GRACE_DAYS = 7;

export function isPlanKey(value: unknown): value is PlanKey {
  return value === 'team' || value === 'scale';
}

export function planPriceId(plan: PlanConfig): string | null {
  return process.env[plan.priceEnv] || null;
}

export function planSeatPriceId(plan: PlanConfig): string | null {
  return process.env[plan.seatPriceEnv] || null;
}

export function contactPackPriceId(): string | null {
  return process.env[CONTACT_PACK.priceEnv] || null;
}

/** Reverse-map a Stripe price id from a webhook payload to our plan. */
export function planForPriceId(priceId: string | null | undefined): PlanConfig | null {
  if (!priceId) return null;
  for (const plan of Object.values(PLANS)) {
    if (planPriceId(plan) === priceId || planSeatPriceId(plan) === priceId) return plan;
  }
  return null;
}
