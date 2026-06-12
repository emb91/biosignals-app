import Stripe from 'stripe';

/**
 * Lazy singleton Stripe client. Billing is optional infrastructure: every
 * caller must tolerate `isBillingConfigured() === false` (no STRIPE_SECRET_KEY
 * yet) — the app runs fine without it, orgs just stay on the free tier.
 */

let client: Stripe | null = null;

export function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not set — billing is not configured');
  }
  if (!client) {
    client = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return client;
}
