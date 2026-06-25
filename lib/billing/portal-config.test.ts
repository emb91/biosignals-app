import test from 'node:test';
import assert from 'node:assert/strict';
import { billingPortalConfigurationId, isBillingPortalConfigured } from './portal-config';

test('billing portal configuration can use an explicit configuration id', () => {
  const originalConfig = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION;
  const originalUseDefault = process.env.STRIPE_BILLING_PORTAL_USE_DEFAULT;
  try {
    process.env.STRIPE_BILLING_PORTAL_CONFIGURATION = ' bpc_123 ';
    delete process.env.STRIPE_BILLING_PORTAL_USE_DEFAULT;

    assert.equal(billingPortalConfigurationId(), 'bpc_123');
    assert.equal(isBillingPortalConfigured(), true);
  } finally {
    restoreEnv('STRIPE_BILLING_PORTAL_CONFIGURATION', originalConfig);
    restoreEnv('STRIPE_BILLING_PORTAL_USE_DEFAULT', originalUseDefault);
  }
});

test('billing portal default must be explicitly opted into', () => {
  const originalConfig = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION;
  const originalUseDefault = process.env.STRIPE_BILLING_PORTAL_USE_DEFAULT;
  try {
    delete process.env.STRIPE_BILLING_PORTAL_CONFIGURATION;
    delete process.env.STRIPE_BILLING_PORTAL_USE_DEFAULT;
    assert.equal(isBillingPortalConfigured(), false);

    process.env.STRIPE_BILLING_PORTAL_USE_DEFAULT = 'true';
    assert.equal(isBillingPortalConfigured(), true);
  } finally {
    restoreEnv('STRIPE_BILLING_PORTAL_CONFIGURATION', originalConfig);
    restoreEnv('STRIPE_BILLING_PORTAL_USE_DEFAULT', originalUseDefault);
  }
});

test('billing portal configuration ignores non-portal ids', () => {
  const originalConfig = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION;
  const originalUseDefault = process.env.STRIPE_BILLING_PORTAL_USE_DEFAULT;
  try {
    process.env.STRIPE_BILLING_PORTAL_CONFIGURATION = 'price_123';
    delete process.env.STRIPE_BILLING_PORTAL_USE_DEFAULT;

    assert.equal(billingPortalConfigurationId(), undefined);
    assert.equal(isBillingPortalConfigured(), false);
  } finally {
    restoreEnv('STRIPE_BILLING_PORTAL_CONFIGURATION', originalConfig);
    restoreEnv('STRIPE_BILLING_PORTAL_USE_DEFAULT', originalUseDefault);
  }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
