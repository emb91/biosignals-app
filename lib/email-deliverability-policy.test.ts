import test from 'node:test';
import assert from 'node:assert/strict';
import type { ContactEmailRow } from './contact-emails';
import { shouldOfferFindNewEmailForContact } from './contact-profile-display';

function row(
  partial: Pick<ContactEmailRow, 'email' | 'email_deliverability' | 'email_deliverability_provider'>,
): ContactEmailRow {
  return {
    id: 'row-1',
    contact_id: 'contact-1',
    user_id: 'user-1',
    category: 'import',
    label: null,
    source_provider: null,
    apollo_email_status: partial.email_deliverability,
    email_deliverability_checked_at: null,
    email_deliverability_metadata: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

test('Apollo not verified hides find-new-email until ZeroBounce runs', () => {
  assert.equal(
    shouldOfferFindNewEmailForContact(
      0.8,
      'kurt@example.com',
      [row({ email: 'kurt@example.com', email_deliverability: 'extrapolated', email_deliverability_provider: 'apollo' })],
    ),
    false,
  );
});

test('ZeroBounce invalid offers find-new-email', () => {
  assert.equal(
    shouldOfferFindNewEmailForContact(
      0.8,
      'kurt@example.com',
      [row({ email: 'kurt@example.com', email_deliverability: 'invalid', email_deliverability_provider: 'zerobounce' })],
    ),
    true,
  );
});

test('ZeroBounce verified hides find-new-email', () => {
  assert.equal(
    shouldOfferFindNewEmailForContact(
      0.8,
      'kurt@example.com',
      [row({ email: 'kurt@example.com', email_deliverability: 'verified', email_deliverability_provider: 'zerobounce' })],
    ),
    false,
  );
});

test('no usable email offers find-new-email', () => {
  assert.equal(shouldOfferFindNewEmailForContact(0.8, null, []), true);
});
