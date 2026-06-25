import { isPlanKey } from './config';

const CREDIT_PACK_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

export type StripeBackedBillingAccount = {
  stripeCustomerId: string | null | undefined;
  stripeSubscriptionId: string | null | undefined;
  subscriptionStatus: string | null | undefined;
  planKey: string | null | undefined;
};

export function canBuyCreditPacksWithStripe(account: StripeBackedBillingAccount): boolean {
  return Boolean(
    account.stripeCustomerId &&
      account.stripeSubscriptionId &&
      CREDIT_PACK_SUBSCRIPTION_STATUSES.has(account.subscriptionStatus ?? '') &&
      isPlanKey(account.planKey),
  );
}

export function creditPackBlockReason(account: StripeBackedBillingAccount): string | null {
  if (canBuyCreditPacksWithStripe(account)) return null;
  if (!account.stripeCustomerId || !account.stripeSubscriptionId) {
    return 'Choose a paid Stripe plan before buying credit packs.';
  }
  if (account.subscriptionStatus === 'past_due') {
    return 'Resolve the billing issue in Stripe before buying credit packs.';
  }
  return 'Credit packs require an active paid Stripe subscription.';
}
