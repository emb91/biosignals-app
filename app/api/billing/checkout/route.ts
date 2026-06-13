/**
 * POST /api/billing/checkout — start a Stripe Checkout session.
 *
 * Body: { kind: 'plan', planKey: 'team' | 'scale' }
 *     | { kind: 'pack', quantity?: number }   // quantity = number of packs
 *
 * Owner/admin only. Plans use subscription mode (one base price; seat
 * add-ons are synced separately when members join). Packs use payment mode;
 * fulfillment happens in the webhook on checkout.session.completed.
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
  CONTACT_PACK,
  PLANS,
  contactPackPriceId,
  isPlanKey,
  planPriceId,
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
    | { kind?: string; planKey?: string; quantity?: number }
    | null;
  if (!body || (body.kind !== 'plan' && body.kind !== 'pack')) {
    return NextResponse.json({ error: 'kind must be "plan" or "pack"' }, { status: 400 });
  }

  // Billing-exempt workspaces have nothing to buy.
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
      return NextResponse.json({ error: 'planKey must be "team" or "scale"' }, { status: 400 });
    }
    const plan = PLANS[body.planKey];
    const priceId = planPriceId(plan);
    if (!priceId) {
      return NextResponse.json({ error: 'Billing is not available yet' }, { status: 503 });
    }

    // Plan changes for an existing subscription go through the portal, not a
    // second checkout (which would create a duplicate subscription).
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
      line_items: [{ price: priceId, quantity: 1 }],
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

  // Contact pack (one-time payment).
  const packPrice = contactPackPriceId();
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
      contacts: String(CONTACT_PACK.contacts * quantity),
    },
    success_url: `${appUrl}/settings?billing=pack_success`,
    cancel_url: `${appUrl}/settings?billing=canceled`,
  });
  return NextResponse.json({ url: session.url });
}
