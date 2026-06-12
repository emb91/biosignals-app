/**
 * POST /api/billing/portal — open the Stripe Customer Portal (card update,
 * invoices, plan change, cancel). Owner/admin only.
 *
 * Returns: { url } to redirect the browser to.
 */
import { NextResponse } from 'next/server';
import { getOrgContext, canEditOrgSetup } from '@/lib/org-context';
import { createAdminClient } from '@/lib/supabase-admin';
import { getStripe, isBillingConfigured } from '@/lib/billing/stripe';

export async function POST(request: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canEditOrgSetup(ctx.role)) {
    return NextResponse.json({ error: 'Only an owner or admin can manage billing' }, { status: 403 });
  }
  if (!isBillingConfigured()) {
    return NextResponse.json({ error: 'Billing is not available yet' }, { status: 503 });
  }

  const admin = createAdminClient();
  const { data: org } = await admin
    .from('organizations')
    .select('stripe_customer_id')
    .eq('id', ctx.orgId)
    .maybeSingle<{ stripe_customer_id: string | null }>();

  if (!org?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing account yet — choose a plan first' }, { status: 404 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const session = await getStripe().billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${appUrl}/settings`,
  });
  return NextResponse.json({ url: session.url });
}
