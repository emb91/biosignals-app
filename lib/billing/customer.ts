import { createAdminClient } from '@/lib/supabase-admin';
import { getStripe } from '@/lib/billing/stripe';

/**
 * Org ↔ Stripe Customer mapping. One Customer per organization, created
 * lazily on first checkout and persisted on organizations.stripe_customer_id.
 */

export async function getOrCreateStripeCustomerId(params: {
  orgId: string;
  /** Billing email shown on invoices — the acting owner/admin's email. */
  email: string | null;
}): Promise<string> {
  const admin = createAdminClient();

  const { data: org } = await admin
    .from('organizations')
    .select('stripe_customer_id, name')
    .eq('id', params.orgId)
    .maybeSingle<{ stripe_customer_id: string | null; name: string | null }>();

  if (org?.stripe_customer_id) return org.stripe_customer_id;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    name: org?.name ?? undefined,
    email: params.email ?? undefined,
    metadata: { org_id: params.orgId },
  });

  const { error } = await admin
    .from('organizations')
    .update({ stripe_customer_id: customer.id })
    .eq('id', params.orgId)
    .is('stripe_customer_id', null);
  if (error) {
    console.error('[billing] failed to persist stripe_customer_id:', error);
  }

  // If a concurrent request won the race, prefer the stored id.
  const { data: after } = await admin
    .from('organizations')
    .select('stripe_customer_id')
    .eq('id', params.orgId)
    .maybeSingle<{ stripe_customer_id: string | null }>();
  return after?.stripe_customer_id ?? customer.id;
}

export async function orgIdForStripeCustomer(customerId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('organizations')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}
