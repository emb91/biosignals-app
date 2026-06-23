type StripeObjectReference = string | { id?: unknown } | null | undefined;

type InvoiceWithSubscriptionReferences = {
  subscription?: StripeObjectReference;
  parent?: {
    subscription_details?: {
      subscription?: StripeObjectReference;
    } | null;
  } | null;
};

function stripeObjectId(value: StripeObjectReference): string | null {
  if (typeof value === 'string') return value;
  return typeof value?.id === 'string' ? value.id : null;
}

export function invoiceSubscriptionId(invoice: unknown): string | null {
  const invoiceWithRefs = invoice as InvoiceWithSubscriptionReferences;
  return (
    stripeObjectId(invoiceWithRefs.subscription) ??
    stripeObjectId(invoiceWithRefs.parent?.subscription_details?.subscription)
  );
}
