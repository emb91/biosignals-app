/**
 * POST /api/stripe/webhook — Stripe event sink. Stripe is the source of truth
 * for billing state; this handler syncs it into org_subscriptions and
 * fulfills credit-pack purchases.
 *
 * Handled events:
 *  - checkout.session.completed       → fulfill credit packs
 *  - customer.subscription.created/updated/deleted → upsert org_subscriptions
 *  - invoice.payment_failed           → past_due + grace window
 *  - invoice.paid                     → recover to active
 *
 * Delivery is at-least-once: every event id is recorded in
 * stripe_webhook_events first, and duplicates are acknowledged without
 * reprocessing. Credit grants are additionally idempotent on the payment
 * intent reference stored with each bucket.
 *
 * Local dev: stripe listen --forward-to localhost:3000/api/stripe/webhook
 */
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase-admin';
import { reconcileMonitoringAfterBillingChange } from '@/lib/billing/monitoring';
import { getStripe, isBillingConfigured } from '@/lib/billing/stripe';
import { orgIdForStripeCustomer } from '@/lib/billing/customer';
import { invoiceSubscriptionCreditPeriod, invoiceSubscriptionId } from '@/lib/billing/stripe-invoice';
import { expireFreeCreditBucketsForPaidPlan } from '@/lib/billing/credits';
import {
  CREDIT_PACK_SIZE,
  PAYMENT_GRACE_DAYS,
  PLANS,
  isPlanKey,
  intervalForPriceId,
  planForPriceId,
  type BillingInterval,
  type PlanConfig,
} from '@/lib/billing/config';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const webhookSecrets = stripeWebhookSecrets();
  if (!isBillingConfigured() || webhookSecrets.length === 0) {
    return NextResponse.json({ error: 'Billing is not configured' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });

  // Signature verification needs the exact raw body.
  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = constructStripeEvent(payload, signature, webhookSecrets);
  } catch (error) {
    console.error('[stripe-webhook] signature verification failed:', error);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Idempotency: claim the event by inserting a 'processing' row. On a duplicate
  // delivery we inspect the existing row — a 'done' row is a true duplicate we
  // ack and drop; a 'processing' row means a prior attempt died mid-flight, so we
  // reprocess. Reprocessing is safe because every handler is idempotent (credit
  // grants key on external_reference; subscription state is upserted by org).
  const { error: dedupeError } = await admin
    .from('stripe_webhook_events')
    .insert({ id: event.id, type: event.type, status: 'processing' });
  if (dedupeError) {
    if (dedupeError.code === '23505') {
      const { data: existing } = await admin
        .from('stripe_webhook_events')
        .select('status')
        .eq('id', event.id)
        .maybeSingle();
      if (existing?.status === 'done') {
        return NextResponse.json({ received: true, duplicate: true });
      }
      // status 'processing' (or row vanished): fall through and reprocess.
    } else {
      console.error('[stripe-webhook] dedupe insert failed:', dedupeError);
      return NextResponse.json({ error: 'Storage error' }, { status: 500 });
    }
  }

  try {
    let monitoringOrgId: string | null = null;
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        monitoringOrgId = await syncSubscription(event.data.object);
        break;
      case 'invoice.payment_failed':
        monitoringOrgId = await handleInvoice(event.data.object, 'failed');
        break;
      case 'invoice.paid':
        monitoringOrgId = await handleInvoice(event.data.object, 'paid');
        break;
      default:
        break;
    }
    if (monitoringOrgId) {
      await reconcileMonitoringAfterBillingChange(monitoringOrgId, event.type);
    }
  } catch (error) {
    console.error(`[stripe-webhook] handler failed for ${event.type} (${event.id}):`, error);
    // Leave the row as 'processing' (do NOT delete) so Stripe's retry re-enters
    // and reprocesses via the idempotent handlers above. Deleting here risked a
    // partially-applied handler being re-run from scratch and double-applying.
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }

  // Mark done so future duplicate deliveries short-circuit.
  await admin
    .from('stripe_webhook_events')
    .update({ status: 'done', processed_at: new Date().toISOString() })
    .eq('id', event.id);

  return NextResponse.json({ received: true });
}

function stripeWebhookSecrets(): string[] {
  return [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_WEBHOOK_SECRET_TEST,
  ].filter((secret): secret is string => Boolean(secret?.trim()));
}

function constructStripeEvent(payload: string, signature: string, webhookSecrets: string[]): Stripe.Event {
  let lastError: unknown;
  for (const secret of webhookSecrets) {
    try {
      return getStripe().webhooks.constructEvent(payload, signature, secret);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('No Stripe webhook signing secrets configured');
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.metadata?.kind !== 'credit_pack') return; // subscriptions sync via their own events

  const orgId = session.metadata?.org_id || session.client_reference_id;
  const credits = Number.parseInt(session.metadata?.credits ?? '', 10);
  const paymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (!orgId || !Number.isFinite(credits) || credits <= 0 || !paymentIntentId) {
    console.error('[stripe-webhook] credit_pack session missing org/credits/payment_intent:', session.id);
    return;
  }

  // Only grant against money actually received. `credits` comes from checkout
  // metadata, so guard it: require a paid session with a positive total, and a
  // sane pack count (1–20 packs, matching the checkout cap). Promo codes are
  // allowed, so we bound the count rather than match an exact amount.
  if (session.payment_status !== 'paid' || (session.amount_total ?? 0) <= 0) {
    console.error('[stripe-webhook] credit_pack session not paid; skipping grant:', session.id, session.payment_status);
    return;
  }
  if (credits % CREDIT_PACK_SIZE !== 0 || credits > CREDIT_PACK_SIZE * 20) {
    console.error('[stripe-webhook] credit_pack credits out of expected range; skipping grant:', session.id, credits);
    return;
  }

  const admin = createAdminClient();
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
  const { error } = await admin.rpc('grant_org_credit_bucket', {
    p_org_id: orgId,
    p_source: 'purchased',
    p_credits: credits,
    p_valid_from: now.toISOString(),
    p_expires_at: expiresAt.toISOString(),
    p_external_reference: `stripe-payment:${paymentIntentId}`,
    p_metadata: { checkoutSessionId: session.id, planKey: session.metadata?.plan_key ?? null },
  });
  if (error) throw new Error(`credit pack fulfillment failed: ${error.message}`);
}

async function syncSubscription(sub: Stripe.Subscription): Promise<string | null> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const orgId = sub.metadata?.org_id || (await orgIdForStripeCustomer(customerId));
  if (!orgId) {
    console.error('[stripe-webhook] could not resolve org for subscription:', sub.id);
    return null;
  }

  // Find the workspace plan item. Subscription quantity is always one; paid
  // workspaces include unlimited users.
  const items = sub.items?.data ?? [];
  let plan: PlanConfig | null = null;
  let interval: BillingInterval = 'monthly';

  // Prefer metadata plan_key (set at checkout) for reliability.
  const metaPlanKey = sub.metadata?.plan_key;
  if (isPlanKey(metaPlanKey)) {
    plan = PLANS[metaPlanKey];
  }
  // Fall back to price-id reverse-lookup.
  if (!plan) {
    for (const item of items) {
      const found = planForPriceId(item.price?.id);
      if (found) { plan = found; break; }
    }
  }
  const planItem = items.find((item) => planForPriceId(item.price?.id) !== null);
  interval = sub.metadata?.billing_interval === 'annual'
    ? 'annual'
    : intervalForPriceId(planItem?.price?.id);

  // Stripe API versions differ on whether period bounds live on the item or
  // subscription object, so accept either shape.
  const subscriptionWithPeriods = sub as unknown as {
    current_period_start?: number;
    current_period_end?: number;
  };
  const periodStart = items[0]?.current_period_start ?? subscriptionWithPeriods.current_period_start ?? null;
  const periodEnd = items[0]?.current_period_end ?? subscriptionWithPeriods.current_period_end ?? null;

  const admin = createAdminClient();
  const { error } = await admin.from('org_subscriptions').upsert(
    {
      org_id: orgId,
      stripe_subscription_id: sub.id,
      status: sub.status,
      plan_key: plan?.key ?? 'unknown',
      billing_interval: interval,
      stripe_price_id: planItem?.price?.id ?? null,
      current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: Boolean(sub.cancel_at_period_end),
      ...(sub.status === 'active' || sub.status === 'trialing' ? { grace_until: null } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id' },
  );
  if (error) throw new Error(`subscription sync failed: ${error.message}`);

  if (plan && (sub.status === 'active' || sub.status === 'trialing')) {
    const { error: orgError } = await admin
      .from('organizations')
      .update({ billing_exempt: false })
      .eq('id', orgId)
      .eq('billing_exempt', true);
    if (orgError) throw new Error(`billing exemption update failed: ${orgError.message}`);
  }
  return orgId;
}

async function handleInvoice(invoice: Stripe.Invoice, outcome: 'paid' | 'failed'): Promise<string | null> {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return null;

  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (!customerId) return null;
  const orgId = await orgIdForStripeCustomer(customerId);
  if (!orgId) return null;

  const admin = createAdminClient();
  if (outcome === 'failed') {
    const graceUntil = new Date(Date.now() + PAYMENT_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await admin
      .from('org_subscriptions')
      .update({ status: 'past_due', grace_until: graceUntil, updated_at: new Date().toISOString() })
      .eq('org_id', orgId)
      .eq('stripe_subscription_id', subscriptionId)
      .is('grace_until', null); // don't extend an already-running grace window
    if (error) throw new Error(`past_due update failed: ${error.message}`);
    return orgId;
  }

  // Recovery: a paid invoice on a past_due org restores access. The
  // subsequent customer.subscription.updated event refreshes the rest.
  const { error } = await admin
    .from('org_subscriptions')
    .update({ status: 'active', grace_until: null, updated_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('stripe_subscription_id', subscriptionId)
    .eq('status', 'past_due');
  if (error) throw new Error(`recovery update failed: ${error.message}`);

  const { data: subscription } = await admin
    .from('org_subscriptions')
    .select('plan_key, billing_interval, current_period_start, current_period_end, stripe_subscription_id')
    .eq('org_id', orgId)
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle<{
      plan_key: string;
      billing_interval: string;
      current_period_start: string | null;
      current_period_end: string | null;
      stripe_subscription_id: string | null;
    }>();
  if (!subscription || !isPlanKey(subscription.plan_key)) return orgId;
  const plan = PLANS[subscription.plan_key];
  const annual = subscription.billing_interval === 'annual';
  const { validFrom, expiresAt } = invoiceSubscriptionCreditPeriod({
    invoice,
    subscriptionPeriodStart: subscription.current_period_start,
    subscriptionPeriodEnd: subscription.current_period_end,
    fallbackDays: annual ? 366 : 32,
  });
  await expireFreeCreditBucketsForPaidPlan(orgId, validFrom);
  const { error: grantError } = await admin.rpc('grant_org_credit_bucket', {
    p_org_id: orgId,
    p_source: annual ? 'annual' : 'paid_monthly',
    p_credits: annual ? plan.annualCredits : plan.monthlyCredits,
    p_valid_from: validFrom,
    p_expires_at: expiresAt,
    p_external_reference: subscription.stripe_subscription_id
      ? `subscription:${subscription.stripe_subscription_id}:${validFrom}`
      : `stripe-invoice:${invoice.id}`,
    p_metadata: {
      planKey: plan.key,
      billingInterval: annual ? 'annual' : 'monthly',
      stripeInvoiceId: invoice.id,
    },
  });
  if (grantError) throw new Error(`invoice credit grant failed: ${grantError.message}`);
  return orgId;
}
