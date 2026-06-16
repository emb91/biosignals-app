/**
 * POST /api/billing/checkout — start a Stripe Checkout session.
 *
 * Body: { kind: 'plan', planKey: 'starter' | 'growth', seats?: number, billing?: 'monthly' | 'annual' }
 *     | { kind: 'pack', quantity?: number }   // quantity = number of packs
 *
 * Owner/admin only. Plans use subscription mode with a pure per-seat price
 * (quantity = seat count). Packs use payment mode; fulfillment happens in the
 * webhook on checkout.session.completed.
 *
 * Returns: { url } to redirect the browser to.
 */
import { NextResponse } from 'next/server';
import { getOrgContext, canEditOrgSetup } from '@/lib/org-context';
import { createAdminClient } from '@/lib/supabase-admin';
import { getStripe, isBillingConfigured } from '@/lib/billing/stripe';
import { getOrCreateStripeCustomerId } from '@/lib/billing/customer';
import { getOrgEntitlements } from '@/lib/billing/entitlements';
import {
  ENRICH_PACK,
  PLANS,
  enrichPackPriceId,
  isPlanKey,
  planPriceId,
  planAnnualPriceId,
} from '@/lib/billing/config';

export async function POST(request: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canEditOrgSetup(ctx.role)) {
    return NextResponse.json({ error: 'Only an owner or admin can manage billing' }, { status: 403 });
  }
  if (!isBillingConfigured()) {
    return NextResponse.json({ error: 'Billing is not available yet' }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as
    | { kind?: string; planKey?: string; seats?: number; billing?: string; quantity?: number }
    | null;
  if (!body || (body.kind !== 'plan' && body.kind !== 'pack')) {
    return NextResponse.json({ error: 'kind must be "plan" or "pack"' }, { status: 400 });
  }

  const entitlements = await getOrgEntitlements(ctx.orgId);
  if (entitlements.unlimited) {
    return NextResponse.json({ error: 'This workspace has no limits — there is nothing to purchase' }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const stripe = getStripe();
  const customerId = await getOrCreateStripeCustomerId({
    orgId: ctx.orgId,
    email: ctx.user.email ?? null,
  });

  if (body.kind === 'plan') {
    if (!isPlanKey(body.planKey)) {
      return NextResponse.json({ error: 'planKey must be "starter" or "growth"' }, { status: 400 });
    }
    const plan = PLANS[body.planKey];
    const annual = body.billing === 'annual';
    const priceId = annual ? planAnnualPriceId(plan) : planPriceId(plan);
    if (!priceId) {
      return NextResponse.json({ error: 'Billing is not available yet' }, { status: 503 });
    }

    // Clamp seat count to [minSeats, 100].
    const seats = Math.min(100, Math.max(plan.minSeats, Math.floor(body.seats ?? plan.minSeats)));

    // Plan changes for an existing active subscription go through the portal.
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from('org_subscriptions')
      .select('stripe_subscription_id, status')
      .eq('org_id', ctx.orgId)
      .maybeSingle<{ stripe_subscription_id: string | null; status: string }>();
    if (
      existing?.stripe_subscription_id &&
      ['active', 'trialing', 'past_due'].includes(existing.status)
    ) {
      return NextResponse.json(
        { error: 'You already have a plan — use "Manage billing" to change it' },
        { status: 409 },
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: ctx.orgId,
      line_items: [{ price: priceId, quantity: seats }],
      subscription_data: {
        metadata: { org_id: ctx.orgId, plan_key: plan.key },
      },
      metadata: { kind: 'plan', org_id: ctx.orgId, plan_key: plan.key },
      success_url: `${appUrl}/settings?billing=success`,
      cancel_url: `${appUrl}/settings?billing=canceled`,
      allow_promotion_codes: true,
    });
    return NextResponse.json({ url: session.url });
  }

  // Enrichment pack (one-time payment).
  const packPrice = enrichPackPriceId();
  if (!packPrice) {
    return NextResponse.json({ error: 'Billing is not available yet' }, { status: 503 });
  }
  const quantity = Math.min(20, Math.max(1, Math.floor(body.quantity ?? 1)));

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    client_reference_id: ctx.orgId,
    line_items: [{ price: packPrice, quantity }],
    metadata: {
      kind: 'contact_pack',
      org_id: ctx.orgId,
      contacts: String(ENRICH_PACK.enrichments * quantity),
    },
    success_url: `${appUrl}/settings?billing=pack_success`,
    cancel_url: `${appUrl}/settings?billing=canceled`,
  });
  return NextResponse.json({ url: session.url });
}
