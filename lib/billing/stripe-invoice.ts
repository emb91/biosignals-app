type StripeObjectReference = string | { id?: unknown } | null | undefined;

type InvoiceWithSubscriptionReferences = {
  subscription?: StripeObjectReference;
  parent?: {
    subscription_details?: {
      subscription?: StripeObjectReference;
    } | null;
  } | null;
};

type InvoiceWithLinePeriods = {
  lines?: {
    data?: Array<{
      period?: {
        start?: unknown;
        end?: unknown;
      } | null;
    } | null>;
  } | null;
};

function stripeObjectId(value: StripeObjectReference): string | null {
  if (typeof value === 'string') return value;
  return typeof value?.id === 'string' ? value.id : null;
}

function stripeUnixSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stripeUnixSecondsToIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

export function invoiceSubscriptionId(invoice: unknown): string | null {
  const invoiceWithRefs = invoice as InvoiceWithSubscriptionReferences;
  return (
    stripeObjectId(invoiceWithRefs.subscription) ??
    stripeObjectId(invoiceWithRefs.parent?.subscription_details?.subscription)
  );
}

export function invoiceSubscriptionCreditPeriod(input: {
  invoice: unknown;
  subscriptionPeriodStart: string | null;
  subscriptionPeriodEnd: string | null;
  now?: Date;
  fallbackDays: number;
}): { validFrom: string; expiresAt: string } {
  const now = input.now ?? new Date();
  const invoiceWithLines = input.invoice as InvoiceWithLinePeriods;
  const linePeriod = invoiceWithLines.lines?.data?.[0]?.period;
  const lineStart = stripeUnixSeconds(linePeriod?.start);
  const lineEnd = stripeUnixSeconds(linePeriod?.end);

  return {
    validFrom: lineStart == null
      ? input.subscriptionPeriodStart ?? now.toISOString()
      : stripeUnixSecondsToIso(lineStart),
    expiresAt: lineEnd == null
      ? input.subscriptionPeriodEnd ?? new Date(now.getTime() + input.fallbackDays * 86_400_000).toISOString()
      : stripeUnixSecondsToIso(lineEnd),
  };
}
