import test from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';
import { invoiceSubscriptionId } from './stripe-invoice';

function invoice(payload: Record<string, unknown>): Stripe.Invoice {
  return payload as unknown as Stripe.Invoice;
}

test('invoiceSubscriptionId reads the legacy invoice.subscription string', () => {
  assert.equal(invoiceSubscriptionId(invoice({ subscription: 'sub_123' })), 'sub_123');
});

test('invoiceSubscriptionId reads expanded subscription objects', () => {
  assert.equal(invoiceSubscriptionId(invoice({ subscription: { id: 'sub_expanded' } })), 'sub_expanded');
});

test('invoiceSubscriptionId reads parent subscription details', () => {
  assert.equal(
    invoiceSubscriptionId(invoice({
      parent: { subscription_details: { subscription: 'sub_parent' } },
    })),
    'sub_parent',
  );
});

test('invoiceSubscriptionId returns null for one-time invoices', () => {
  assert.equal(invoiceSubscriptionId(invoice({ id: 'in_one_time', parent: null })), null);
});
