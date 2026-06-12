#!/usr/bin/env node
/**
 * One-shot Stripe catalog bootstrap. Creates the products and prices for the
 * billing plans (Team, Scale, per-seat add-ons, contact pack) and prints the
 * env lines to paste into .env.local / Vercel.
 *
 * Idempotent: prices are looked up by lookup_key first; existing ones are
 * reused, never duplicated. Safe to re-run.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-bootstrap.mjs
 *   (or just `node scripts/stripe-bootstrap.mjs` — it reads .env.local)
 *
 * Price points mirror lib/billing/config.ts — change them there first, then
 * create NEW prices here (Stripe prices are immutable; this script only
 * creates a new price if none exists for the lookup_key).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Stripe from 'stripe';

// Minimal .env.local loader (no dotenv dependency).
if (!process.env.STRIPE_SECRET_KEY) {
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no .env.local */
  }
}

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('STRIPE_SECRET_KEY is not set (env or .env.local). Aborting.');
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const mode = process.env.STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'LIVE' : 'test';

// Keep in sync with lib/billing/config.ts.
const CATALOG = [
  {
    env: 'STRIPE_PRICE_TEAM',
    lookupKey: 'arcova_team_base_monthly',
    product: 'Arcova Team plan',
    description: '3 seats and 1,000 new enriched contacts per month',
    unitAmount: 19900,
    recurring: { interval: 'month' },
  },
  {
    env: 'STRIPE_PRICE_TEAM_SEAT',
    lookupKey: 'arcova_team_seat_monthly',
    product: 'Arcova Team — extra seat',
    description: 'Additional seat on the Team plan',
    unitAmount: 4900,
    recurring: { interval: 'month' },
  },
  {
    env: 'STRIPE_PRICE_SCALE',
    lookupKey: 'arcova_scale_base_monthly',
    product: 'Arcova Scale plan',
    description: '10 seats and 3,000 new enriched contacts per month',
    unitAmount: 49900,
    recurring: { interval: 'month' },
  },
  {
    env: 'STRIPE_PRICE_SCALE_SEAT',
    lookupKey: 'arcova_scale_seat_monthly',
    product: 'Arcova Scale — extra seat',
    description: 'Additional seat on the Scale plan',
    unitAmount: 3900,
    recurring: { interval: 'month' },
  },
  {
    env: 'STRIPE_PRICE_CONTACT_PACK',
    lookupKey: 'arcova_contact_pack_1000',
    product: 'Arcova contact pack',
    description: '1,000 additional enriched contacts (never expires)',
    unitAmount: 14900,
    recurring: null,
  },
];

async function ensurePrice(entry) {
  const existing = await stripe.prices.list({ lookup_keys: [entry.lookupKey], limit: 1 });
  if (existing.data[0]) return { price: existing.data[0], created: false };

  const price = await stripe.prices.create({
    lookup_key: entry.lookupKey,
    currency: 'usd',
    unit_amount: entry.unitAmount,
    ...(entry.recurring ? { recurring: entry.recurring } : {}),
    product_data: { name: entry.product },
    metadata: { description: entry.description },
  });
  return { price, created: true };
}

const envLines = [];
console.log(`Bootstrapping Stripe catalog (${mode} mode)…\n`);
for (const entry of CATALOG) {
  const { price, created } = await ensurePrice(entry);
  console.log(`${created ? 'created' : 'exists '}  ${entry.lookupKey}  $${(entry.unitAmount / 100).toFixed(2)}  → ${price.id}`);
  envLines.push(`${entry.env}=${price.id}`);
}

console.log('\nAdd these to .env.local (and Vercel):\n');
console.log(envLines.join('\n'));
console.log(
  '\nAlso set STRIPE_WEBHOOK_SECRET from `stripe listen` (dev) or the dashboard webhook endpoint (prod).',
);
