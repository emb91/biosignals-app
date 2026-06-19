import type Stripe from 'stripe';

type InvoiceWithSubscriptionReferences = Stripe.Invoice & {
  subscription?: string | Stripe.Subscription | null;
  parent?: {
    subscription_details?: {
      subscription?: string | Stripe.Subscription | null;
    } | null;
  } | null;
};

function stripeObjectId(value: string | { id?: unknown } | null | undefined): string | null {
  if (typeof value === 'string') return value;
  return typeof value?.id === 'string' ? value.id : null;
}

export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const invoiceWithRefs = invoice as InvoiceWithSubscriptionReferences;
  return (
    stripeObjectId(invoiceWithRefs.subscription) ??
    stripeObjectId(invoiceWithRefs.parent?.subscription_details?.subscription)
  );
}
