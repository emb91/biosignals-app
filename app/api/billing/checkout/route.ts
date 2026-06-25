/**
 * POST /api/billing/checkout — start a Stripe Checkout session.
 *
 * Body: { kind: 'plan', planKey: 'starter' | 'growth', billing?: 'monthly' | 'annual' }
 *     | { kind: 'pack', quantity?: number }   // quantity = number of packs
 *
 * Owner/admin only. Plans are fixed-price workspaces (quantity is always one).
 * Packs use payment mode; fulfillment happens in the
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
import { canBuyCreditPacksWithStripe, creditPackBlockReason } from '@/lib/billing/checkout-eligibility';
import {
  CREDIT_PACK_SIZE,
  PLANS,
  creditPackPriceId,
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
    | { kind?: string; planKey?: string; billing?: string; quantity?: number }
    | null;
  if (!body || (body.kind !== 'plan' && body.kind !== 'pack')) {
    return NextResponse.json({ error: 'kind must be "plan" or "pack"' }, { status: 400 });
  }

  const entitlements = await getOrgEntitlements(ctx.orgId);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const stripe = getStripe();

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

    const customerId = await getOrCreateStripeCustomerId({
      orgId: ctx.orgId,
      email: ctx.user.email ?? null,
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: ctx.orgId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: { org_id: ctx.orgId, plan_key: plan.key, billing_interval: annual ? 'annual' : 'monthly' },
      },
      metadata: {
        kind: 'plan',
        org_id: ctx.orgId,
        plan_key: plan.key,
        billing_interval: annual ? 'annual' : 'monthly',
      },
      success_url: `${appUrl}/settings?billing=success`,
      cancel_url: `${appUrl}/settings?billing=canceled`,
      allow_promotion_codes: true,
    });
    return NextResponse.json({ url: session.url });
  }

  // Credit pack (one-time payment).
  if (entitlements.unlimited) {
    return NextResponse.json({ error: 'Credit packs are not needed on complimentary workspaces. Choose a paid plan first.' }, { status: 400 });
  }
  if (!isPlanKey(entitlements.planKey)) {
    return NextResponse.json({ error: 'Credit packs are available on paid plans.' }, { status: 403 });
  }
  const packPrice = creditPackPriceId(entitlements.planKey);
  if (!packPrice) {
    return NextResponse.json({ error: 'Billing is not available yet' }, { status: 503 });
  }
  const quantity = Math.min(20, Math.max(1, Math.floor(body.quantity ?? 1)));
  const admin = createAdminClient();
  const [{ data: org }, { data: subscription }] = await Promise.all([
    admin
      .from('organizations')
      .select('stripe_customer_id')
      .eq('id', ctx.orgId)
      .maybeSingle<{ stripe_customer_id: string | null }>(),
    admin
      .from('org_subscriptions')
      .select('stripe_subscription_id, status, plan_key')
      .eq('org_id', ctx.orgId)
      .maybeSingle<{ stripe_subscription_id: string | null; status: string | null; plan_key: string | null }>(),
  ]);
  const account = {
    stripeCustomerId: org?.stripe_customer_id,
    stripeSubscriptionId: subscription?.stripe_subscription_id,
    subscriptionStatus: subscription?.status,
    planKey: subscription?.plan_key,
  };
  if (!canBuyCreditPacksWithStripe(account)) {
    return NextResponse.json(
      { error: creditPackBlockReason(account) ?? 'Credit packs require an active paid Stripe subscription.' },
      { status: 409 },
    );
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: org!.stripe_customer_id!,
    client_reference_id: ctx.orgId,
    line_items: [{ price: packPrice, quantity }],
    metadata: {
      kind: 'credit_pack',
      org_id: ctx.orgId,
      credits: String(CREDIT_PACK_SIZE * quantity),
      plan_key: entitlements.planKey,
    },
    success_url: `${appUrl}/settings?billing=pack_success`,
    cancel_url: `${appUrl}/settings?billing=canceled`,
  });
  return NextResponse.json({ url: session.url });
}
