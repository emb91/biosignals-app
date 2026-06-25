import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceSubscriptionCreditPeriod, invoiceSubscriptionId } from './stripe-invoice';

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

test('invoiceSubscriptionCreditPeriod prefers invoice line period over stale subscription period', () => {
  assert.deepEqual(
    invoiceSubscriptionCreditPeriod({
      invoice: {
        lines: {
          data: [
            {
              period: {
                start: 1_782_777_600,
                end: 1_785_369_600,
              },
            },
          ],
        },
      },
      subscriptionPeriodStart: '2026-05-01T00:00:00.000Z',
      subscriptionPeriodEnd: '2026-06-01T00:00:00.000Z',
      fallbackDays: 32,
    }),
    {
      validFrom: '2026-06-30T00:00:00.000Z',
      expiresAt: '2026-07-30T00:00:00.000Z',
    },
  );
});

test('invoiceSubscriptionCreditPeriod falls back to subscription period when invoice has no line period', () => {
  assert.deepEqual(
    invoiceSubscriptionCreditPeriod({
      invoice: { lines: { data: [] } },
      subscriptionPeriodStart: '2026-05-01T00:00:00.000Z',
      subscriptionPeriodEnd: '2026-06-01T00:00:00.000Z',
      now: new Date('2026-06-25T11:00:00.000Z'),
      fallbackDays: 32,
    }),
    {
      validFrom: '2026-05-01T00:00:00.000Z',
      expiresAt: '2026-06-01T00:00:00.000Z',
    },
  );
});
