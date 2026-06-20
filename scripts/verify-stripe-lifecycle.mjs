import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const required = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_PRICE_STARTER_WORKSPACE',
  'STRIPE_PRICE_STARTER_WORKSPACE_ANNUAL',
  'STRIPE_PRICE_GROWTH_WORKSPACE',
  'STRIPE_PRICE_GROWTH_WORKSPACE_ANNUAL',
  'STRIPE_PRICE_STARTER_CREDITS_1000',
  'STRIPE_PRICE_GROWTH_CREDITS_1000',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}
if (!process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
  throw new Error('Lifecycle verification refuses to run with a live Stripe key');
}

const baseUrl = process.env.STRIPE_LIFECYCLE_BASE_URL || 'http://localhost:3000';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const eventIds = [];
let orgId;
let customerId;
let subscriptionId;
let clockId;

try {
  await assertCatalog();

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({ name: `__stripe_lifecycle_${crypto.randomUUID()}` })
    .select('id')
    .single();
  if (orgError) throw orgError;
  orgId = org.id;

  const clock = await stripe.testHelpers.testClocks.create({
    frozen_time: Math.floor(Date.now() / 1000),
    name: `Arcova lifecycle ${orgId}`,
  });
  clockId = clock.id;

  const customer = await stripe.customers.create({
    name: 'Arcova lifecycle verification',
    metadata: { org_id: orgId, automated_verification: 'true' },
    test_clock: clock.id,
  });
  customerId = customer.id;

  const paymentMethod = await stripe.paymentMethods.create({
    type: 'card',
    card: { token: 'tok_visa' },
  });
  await stripe.paymentMethods.attach(paymentMethod.id, { customer: customer.id });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: paymentMethod.id },
  });
  await admin.from('organizations').update({ stripe_customer_id: customer.id }).eq('id', orgId);

  let subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: process.env.STRIPE_PRICE_STARTER_WORKSPACE, quantity: 1 }],
    default_payment_method: paymentMethod.id,
    metadata: { org_id: orgId, plan_key: 'starter', billing_interval: 'monthly' },
    expand: ['latest_invoice'],
  });
  subscriptionId = subscription.id;

  await deliver('customer.subscription.created', subscription);
  const initialInvoice = subscription.latest_invoice;
  assert(initialInvoice && typeof initialInvoice !== 'string', 'initial invoice expanded');
  await deliver('invoice.paid', initialInvoice);
  await assertSubscription('active', 'starter');
  await assertGrantedCredits(2_000, 'initial monthly subscription grant');

  const duplicate = await deliver('invoice.paid', initialInvoice, {
    eventId: eventIds[eventIds.length - 1],
  });
  assert(duplicate.duplicate === true, 'duplicate webhook acknowledged');
  await assertGrantedCredits(2_000, 'duplicate invoice did not double-grant');

  const firstPeriodEnd = subscription.items.data[0]?.current_period_end;
  assert(firstPeriodEnd, 'subscription period end available');
  await stripe.testHelpers.testClocks.advance(clock.id, {
    frozen_time: firstPeriodEnd + 120,
  });
  await waitForClock(clock.id);

  subscription = await stripe.subscriptions.retrieve(subscription.id, {
    expand: ['latest_invoice'],
  });
  await deliver('customer.subscription.updated', subscription);
  const renewalInvoice = subscription.latest_invoice;
  assert(renewalInvoice && typeof renewalInvoice !== 'string', 'renewal invoice expanded');
  await deliver('invoice.paid', renewalInvoice);
  await assertGrantedCredits(4_000, 'renewal granted the next monthly allowance once');

  const paymentIntent = await stripe.paymentIntents.create({
    amount: 10_000,
    currency: 'usd',
    customer: customer.id,
    payment_method: paymentMethod.id,
    confirm: true,
    off_session: true,
    metadata: { org_id: orgId, kind: 'credit_pack' },
  });
  assert(paymentIntent.status === 'succeeded', 'credit-pack payment succeeded');
  const checkoutSession = {
    id: `cs_test_arcova_${crypto.randomUUID().replaceAll('-', '')}`,
    object: 'checkout.session',
    client_reference_id: orgId,
    payment_intent: paymentIntent.id,
    payment_status: 'paid',
    amount_total: 10_000,
    metadata: {
      kind: 'credit_pack',
      org_id: orgId,
      credits: '1000',
      plan_key: 'starter',
    },
  };
  await deliver('checkout.session.completed', checkoutSession);
  await assertPurchasedCredits(1_000);

  const failedInvoice = {
    ...renewalInvoice,
    id: `in_test_failed_${crypto.randomUUID().replaceAll('-', '')}`,
    customer: customer.id,
  };
  await deliver('invoice.payment_failed', failedInvoice);
  await assertSubscription('past_due', 'starter', true);

  const recoveryInvoice = {
    ...renewalInvoice,
    id: `in_test_recovery_${crypto.randomUUID().replaceAll('-', '')}`,
    customer: customer.id,
  };
  await deliver('invoice.paid', recoveryInvoice);
  await assertSubscription('active', 'starter');
  await assertGrantedCredits(4_000, 'payment recovery did not duplicate the period grant');

  const canceled = await stripe.subscriptions.cancel(subscription.id);
  await deliver('customer.subscription.deleted', canceled);
  await assertSubscription('canceled', 'starter');

  console.log('Stripe lifecycle verification passed.');
  console.log('Covered: catalog, signup, initial grant, webhook replay, renewal, credit pack, failed payment, recovery, cancellation.');
} finally {
  await cleanup();
}

async function deliver(type, object, options = {}) {
  const id = options.eventId || `evt_arcova_${crypto.randomUUID().replaceAll('-', '')}`;
  if (!options.eventId) eventIds.push(id);
  const payload = JSON.stringify({
    id,
    object: 'event',
    api_version: '2026-04-29.preview',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    type,
    data: { object },
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  });
  const response = await fetch(`${baseUrl}/api/stripe/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
    body: payload,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${type} webhook failed (${response.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

async function assertCatalog() {
  const expected = new Map([
    [process.env.STRIPE_PRICE_STARTER_WORKSPACE, { amount: 14_900, interval: 'month' }],
    [process.env.STRIPE_PRICE_STARTER_WORKSPACE_ANNUAL, { amount: 149_000, interval: 'year' }],
    [process.env.STRIPE_PRICE_GROWTH_WORKSPACE, { amount: 79_900, interval: 'month' }],
    [process.env.STRIPE_PRICE_GROWTH_WORKSPACE_ANNUAL, { amount: 799_000, interval: 'year' }],
    [process.env.STRIPE_PRICE_STARTER_CREDITS_1000, { amount: 10_000, interval: null }],
    [process.env.STRIPE_PRICE_GROWTH_CREDITS_1000, { amount: 7_000, interval: null }],
  ]);
  for (const [priceId, target] of expected) {
    const price = await stripe.prices.retrieve(priceId);
    assert(price.active, `${priceId} is active`);
    assert(price.currency === 'usd', `${priceId} uses USD`);
    assert(price.unit_amount === target.amount, `${priceId} has the expected amount`);
    assert((price.recurring?.interval ?? null) === target.interval, `${priceId} has the expected interval`);
  }
}

async function waitForClock(id) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const clock = await stripe.testHelpers.testClocks.retrieve(id);
    if (clock.status === 'ready') return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('Stripe test clock did not become ready');
}

async function assertSubscription(status, planKey, expectGrace = false) {
  const { data, error } = await admin
    .from('org_subscriptions')
    .select('status, plan_key, grace_until')
    .eq('org_id', orgId)
    .single();
  if (error) throw error;
  assert(data.status === status, `subscription status is ${status}`);
  assert(data.plan_key === planKey, `subscription plan is ${planKey}`);
  assert(Boolean(data.grace_until) === expectGrace, expectGrace ? 'grace window set' : 'grace window cleared');
}

async function assertGrantedCredits(expected, label) {
  const { data, error } = await admin
    .from('org_credit_buckets')
    .select('credits_granted, source')
    .eq('org_id', orgId)
    .in('source', ['paid_monthly', 'annual']);
  if (error) throw error;
  const total = (data ?? []).reduce((sum, row) => sum + Number(row.credits_granted), 0);
  assert(total === expected, label);
}

async function assertPurchasedCredits(expected) {
  const { data, error } = await admin
    .from('org_credit_buckets')
    .select('credits_granted')
    .eq('org_id', orgId)
    .eq('source', 'purchased');
  if (error) throw error;
  const total = (data ?? []).reduce((sum, row) => sum + Number(row.credits_granted), 0);
  assert(total === expected, 'credit-pack grant recorded once');
}

async function cleanup() {
  if (subscriptionId) {
    await stripe.subscriptions.cancel(subscriptionId).catch(() => {});
  }
  if (customerId) {
    await stripe.customers.del(customerId).catch(() => {});
  }
  if (clockId) {
    await stripe.testHelpers.testClocks.del(clockId).catch(() => {});
  }
  if (!orgId) return;

  if (eventIds.length) {
    await admin.from('stripe_webhook_events').delete().in('id', eventIds);
  }
  const { data: transactions } = await admin
    .from('org_credit_transactions')
    .select('id')
    .eq('org_id', orgId);
  const transactionIds = (transactions ?? []).map((row) => row.id);
  if (transactionIds.length) {
    await admin.from('org_credit_allocations').delete().in('transaction_id', transactionIds);
  }
  await admin.from('org_credit_transactions').delete().eq('org_id', orgId);
  await admin.from('org_credit_buckets').delete().eq('org_id', orgId);
  await admin.from('org_usage_events').delete().eq('org_id', orgId);
  await admin.from('org_subscriptions').delete().eq('org_id', orgId);
  await admin.from('organizations').delete().eq('id', orgId);
}

function assert(condition, message) {
  if (!condition) throw new Error(`Stripe lifecycle assertion failed: ${message}`);
}
