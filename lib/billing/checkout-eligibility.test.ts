import test from 'node:test';
import assert from 'node:assert/strict';
import { canBuyCreditPacksWithStripe, creditPackBlockReason } from './checkout-eligibility';

test('credit packs require an active Stripe-backed paid subscription', () => {
  assert.equal(canBuyCreditPacksWithStripe({
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    subscriptionStatus: 'active',
    planKey: 'starter',
  }), true);

  assert.equal(canBuyCreditPacksWithStripe({
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    subscriptionStatus: 'trialing',
    planKey: 'growth',
  }), true);

  assert.equal(canBuyCreditPacksWithStripe({
    stripeCustomerId: null,
    stripeSubscriptionId: 'sub_123',
    subscriptionStatus: 'active',
    planKey: 'starter',
  }), false);

  assert.equal(canBuyCreditPacksWithStripe({
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: null,
    subscriptionStatus: 'active',
    planKey: 'starter',
  }), false);

  assert.equal(canBuyCreditPacksWithStripe({
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    subscriptionStatus: 'past_due',
    planKey: 'starter',
  }), false);
});

test('credit pack block reasons are clear for customer and payment issue states', () => {
  assert.equal(creditPackBlockReason({
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    planKey: 'free',
  }), 'Choose a paid Stripe plan before buying credit packs.');

  assert.equal(creditPackBlockReason({
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    subscriptionStatus: 'past_due',
    planKey: 'starter',
  }), 'Resolve the billing issue in Stripe before buying credit packs.');

  assert.equal(creditPackBlockReason({
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    subscriptionStatus: 'active',
    planKey: 'starter',
  }), null);
});
