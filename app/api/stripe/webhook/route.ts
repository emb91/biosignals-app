/**
 * POST /api/stripe/webhook — Stripe event sink. Stripe is the source of truth
 * for billing state; this handler syncs it into org_subscriptions and
 * fulfills contact-pack purchases.
 *
 * Handled events:
 *  - checkout.session.completed       → fulfill contact packs
 *  - customer.subscription.created/updated/deleted → upsert org_subscriptions
 *  - invoice.payment_failed           → past_due + grace window
 *  - invoice.paid                     → recover to active
 *
 * Delivery is at-least-once: every event id is recorded in
 * stripe_webhook_events first, and duplicates are acknowledged without
 * reprocessing. Pack fulfillment is additionally idempotent on
 * stripe_payment_intent_id (unique column).
 *
 * Local dev: stripe listen --forward-to localhost:3000/api/stripe/webhook
 */
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase-admin';
import { getStripe, isBillingConfigured } from '@/lib/billing/stripe';
import { orgIdForStripeCustomer } from '@/lib/billing/customer';
import { PAYMENT_GRACE_DAYS, PLANS, isPlanKey, planForPriceId, type PlanConfig } from '@/lib/billing/config';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isBillingConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Billing is not configured' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });

  // Signature verification needs the exact raw body.
  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error('[stripe-webhook] signature verification failed:', error);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Idempotency: first insert wins; a duplicate delivery is acked and dropped.
  const { error: dedupeError } = await admin
    .from('stripe_webhook_events')
    .insert({ id: event.id, type: event.type });
  if (dedupeError) {
    if (dedupeError.code === '23505') return NextResponse.json({ received: true, duplicate: true });
    console.error('[stripe-webhook] dedupe insert failed:', dedupeError);
    return NextResponse.json({ error: 'Storage error' }, { status: 500 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(event.data.object);
        break;
      case 'invoice.payment_failed':
        await handleInvoice(event.data.object, 'failed');
        break;
      case 'invoice.paid':
        await handleInvoice(event.data.object, 'paid');
        break;
      default:
        break;
    }
  } catch (error) {
    console.error(`[stripe-webhook] handler failed for ${event.type} (${event.id}):`, error);
    // Free the event id so Stripe's retry can reprocess it.
    await admin.from('stripe_webhook_events').delete().eq('id', event.id);
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.metadata?.kind !== 'contact_pack') return; // subscriptions sync via their own events

  const orgId = session.metadata?.org_id || session.client_reference_id;
  const contacts = Number.parseInt(session.metadata?.contacts ?? '', 10);
  const paymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (!orgId || !Number.isFinite(contacts) || contacts <= 0 || !paymentIntentId) {
    console.error('[stripe-webhook] contact_pack session missing org/contacts/payment_intent:', session.id);
    return;
  }

  const admin = createAdminClient();
  const { error } = await admin.from('org_contact_packs').insert({
    org_id: orgId,
    stripe_payment_intent_id: paymentIntentId,
    contacts_purchased: contacts,
    contacts_remaining: contacts,
  });
  // 23505 = this payment was already fulfilled (duplicate delivery) — fine.
  if (error && error.code !== '23505') {
    throw new Error(`pack fulfillment failed: ${error.message}`);
  }
}

async function syncSubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const orgId = sub.metadata?.org_id || (await orgIdForStripeCustomer(customerId));
  if (!orgId) {
    console.error('[stripe-webhook] could not resolve org for subscription:', sub.id);
    return;
  }

  // Find the plan item (there's now only one price per subscription — the
  // per-seat price at quantity = seat count).
  const items = sub.items?.data ?? [];
  let plan: PlanConfig | null = null;
  let seats = 1;

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
  // Seat count is the subscription item quantity (pure per-seat model).
  const planItem = items.find((item) => planForPriceId(item.price?.id) !== null);
  if (planItem?.quantity) seats = planItem.quantity;

  // Compute org-wide quotas from seats × per-seat config.
  const includedSeats = seats;
  const includedMonthlyContacts = plan ? plan.enrichmentsPerSeat * seats : 0;

  // Newer Stripe API versions keep period bounds on the items, older on the
  // subscription itself — accept either.
  const legacy = sub as unknown as { current_period_start?: number; current_period_end?: number };
  const periodStart = items[0]?.current_period_start ?? legacy.current_period_start ?? null;
  const periodEnd = items[0]?.current_period_end ?? legacy.current_period_end ?? null;

  const admin = createAdminClient();
  const { error } = await admin.from('org_subscriptions').upsert(
    {
      org_id: orgId,
      stripe_subscription_id: sub.id,
      status: sub.status,
      plan_key: plan?.key ?? 'unknown',
      included_seats: includedSeats,
      included_monthly_contacts: includedMonthlyContacts,
      current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: Boolean(sub.cancel_at_period_end),
      ...(sub.status === 'active' || sub.status === 'trialing' ? { grace_until: null } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id' },
  );
  if (error) throw new Error(`subscription sync failed: ${error.message}`);
}

async function handleInvoice(invoice: Stripe.Invoice, outcome: 'paid' | 'failed') {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;
  const orgId = await orgIdForStripeCustomer(customerId);
  if (!orgId) return;

  const admin = createAdminClient();
  if (outcome === 'failed') {
    const graceUntil = new Date(Date.now() + PAYMENT_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await admin
      .from('org_subscriptions')
      .update({ status: 'past_due', grace_until: graceUntil, updated_at: new Date().toISOString() })
      .eq('org_id', orgId)
      .is('grace_until', null); // don't extend an already-running grace window
    if (error) throw new Error(`past_due update failed: ${error.message}`);
    return;
  }

  // Recovery: a paid invoice on a past_due org restores access. The
  // subsequent customer.subscription.updated event refreshes the rest.
  const { error } = await admin
    .from('org_subscriptions')
    .update({ status: 'active', grace_until: null, updated_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('status', 'past_due');
  if (error) throw new Error(`recovery update failed: ${error.message}`);
}
