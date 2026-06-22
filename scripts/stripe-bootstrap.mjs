#!/usr/bin/env node
/**
 * One-shot Stripe catalog bootstrap. Creates the products and prices for
 * Starter/Growth workspace plans (monthly + annual) and tier-specific credit
 * packs, then prints the env lines to paste into .env.local / Vercel.
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
// All subscriptions are fixed-price workspaces (Stripe quantity is always one).
const CATALOG = [
  {
    env: 'STRIPE_PRICE_STARTER_WORKSPACE',
    lookupKey: 'arcova_starter_workspace_monthly',
    product: 'Arcova Starter',
    description: 'Workspace, monthly — 2,000 included credits and 5,000 lead capacity',
    unitAmount: 14900,
    recurring: { interval: 'month' },
  },
  {
    env: 'STRIPE_PRICE_STARTER_WORKSPACE_ANNUAL',
    lookupKey: 'arcova_starter_workspace_annual',
    product: 'Arcova Starter — Annual',
    description: 'Workspace, annual — 24,000 included credits upfront and 5,000 lead capacity',
    unitAmount: 149000,
    recurring: { interval: 'year' },
  },
  {
    env: 'STRIPE_PRICE_GROWTH_WORKSPACE',
    lookupKey: 'arcova_growth_workspace_monthly',
    product: 'Arcova Growth',
    description: 'Workspace, monthly — 8,000 included credits, 10,000 lead capacity and weekly monitoring',
    unitAmount: 79900,
    recurring: { interval: 'month' },
  },
  {
    env: 'STRIPE_PRICE_GROWTH_WORKSPACE_ANNUAL',
    lookupKey: 'arcova_growth_workspace_annual',
    product: 'Arcova Growth — Annual',
    description: 'Workspace, annual — 96,000 included credits upfront, 10,000 lead capacity and weekly monitoring',
    unitAmount: 799000,
    recurring: { interval: 'year' },
  },
  {
    env: 'STRIPE_PRICE_STARTER_CREDITS_1000',
    lookupKey: 'arcova_starter_credits_1000',
    product: 'Arcova Starter Credit Pack',
    description: '1,000 purchased rollover credits for any paid action, valid for 12 months',
    unitAmount: 10000,
    recurring: null,
  },
  {
    env: 'STRIPE_PRICE_GROWTH_CREDITS_1000',
    lookupKey: 'arcova_growth_credits_1000',
    product: 'Arcova Growth Credit Pack',
    description: '1,000 purchased rollover credits for any paid action, valid for 12 months',
    unitAmount: 7000,
    recurring: null,
  },
];

async function ensurePrice(entry) {
  const existing = await stripe.prices.list({ lookup_keys: [entry.lookupKey], limit: 1 });
  if (existing.data[0]) {
    const price = existing.data[0];
    await stripe.prices.update(price.id, {
      metadata: { description: entry.description },
    });
    if (typeof price.product === 'string') {
      await stripe.products.update(price.product, {
        name: entry.product,
        description: entry.description,
        metadata: { description: entry.description },
      });
    }
    return { price, created: false };
  }

  const price = await stripe.prices.create({
    lookup_key: entry.lookupKey,
    currency: 'usd',
    unit_amount: entry.unitAmount,
    ...(entry.recurring ? { recurring: entry.recurring } : {}),
    product_data: {
      name: entry.product,
      description: entry.description,
      metadata: { description: entry.description },
    },
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
console.log('  ARCOVA_CREDIT_ENFORCEMENT=true    (when reconciliation is complete)');
