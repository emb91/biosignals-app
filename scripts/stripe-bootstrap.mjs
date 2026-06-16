#!/usr/bin/env node
/**
 * One-shot Stripe catalog bootstrap. Creates the products and prices for
 * Starter/Growth per-seat plans (monthly + annual) and the enrichment overage
 * pack, then prints the env lines to paste into .env.local / Vercel.
 *
 * Idempotent: prices are looked up by lookup_key first; existing ones are
 * reused, never duplicated. Safe to re-run.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-bootstrap.mjs
 *   (or just `node scripts/stripe-bootstrap.mjs` — it reads .env.local)
 *
 * Price points mirror lib/billing/config.ts — change them there first, then
 * update unitAmount here and re-run (Stripe prices are immutable; a new
 * lookup_key creates a new price).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Stripe from 'stripe';

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
// All plans are pure per-seat (Stripe quantity = seat count). No flat base fee.
const CATALOG = [
  // Starter — $149/seat/month
  {
    env: 'STRIPE_PRICE_STARTER_SEAT',
    lookupKey: 'arcova_starter_seat_monthly',
    product: 'Arcova Starter',
    description: 'Per seat, monthly — 1,000 enrichments + 25 net-new leads per seat/month',
    unitAmount: 14900,
    recurring: { interval: 'month' },
  },
  // Starter — $1,490/seat/year (2 months free)
  {
    env: 'STRIPE_PRICE_STARTER_SEAT_ANNUAL',
    lookupKey: 'arcova_starter_seat_annual',
    product: 'Arcova Starter — Annual',
    description: 'Per seat, annual — 1,000 enrichments + 25 net-new leads per seat/month, billed yearly',
    unitAmount: 149000,
    recurring: { interval: 'year' },
  },
  // Growth — $299/seat/month (min 2 seats)
  {
    env: 'STRIPE_PRICE_GROWTH_SEAT',
    lookupKey: 'arcova_growth_seat_monthly',
    product: 'Arcova Growth',
    description: 'Per seat, monthly — 3,000 enrichments + 100 net-new leads per seat/month',
    unitAmount: 29900,
    recurring: { interval: 'month' },
  },
  // Growth — $2,988/seat/year (2 months free)
  {
    env: 'STRIPE_PRICE_GROWTH_SEAT_ANNUAL',
    lookupKey: 'arcova_growth_seat_annual',
    product: 'Arcova Growth — Annual',
    description: 'Per seat, annual — 3,000 enrichments + 100 net-new leads per seat/month, billed yearly',
    unitAmount: 298800,
    recurring: { interval: 'year' },
  },
  // Enrichment overage pack — $100/1,000 enrichments, never expires
  {
    env: 'STRIPE_PRICE_ENRICH_PACK',
    lookupKey: 'arcova_enrich_pack_1000',
    product: 'Arcova Enrichment Pack',
    description: '1,000 additional enrichments (never expires, drawn after monthly quota)',
    unitAmount: 10000,
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

console.log('\nAdd these to .env.local and Vercel → Settings → Environment Variables:\n');
console.log(envLines.join('\n'));
console.log('\nAlso set:');
console.log('  STRIPE_WEBHOOK_SECRET=whsec_...  (from `stripe listen` or the Stripe dashboard webhook)');
console.log('  BILLING_ENFORCEMENT=true          (when ready to enforce; shadow mode until then)');
