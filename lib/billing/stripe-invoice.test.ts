import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceSubscriptionId } from './stripe-invoice';

test('invoiceSubscriptionId reads the legacy invoice.subscription string', () => {
  assert.equal(invoiceSubscriptionId({ subscription: 'sub_123' }), 'sub_123');
});

test('invoiceSubscriptionId reads expanded subscription objects', () => {
  assert.equal(invoiceSubscriptionId({ subscription: { id: 'sub_expanded' } }), 'sub_expanded');
});

test('invoiceSubscriptionId reads parent subscription details', () => {
  assert.equal(
    invoiceSubscriptionId({
      parent: { subscription_details: { subscription: 'sub_parent' } },
    }),
    'sub_parent',
  );
});

test('invoiceSubscriptionId returns null for one-time invoices', () => {
  assert.equal(invoiceSubscriptionId({ id: 'in_one_time', parent: null }), null);
});
