import test from 'node:test';
import assert from 'node:assert/strict';
import { companyEnrichmentCreditDisposition } from './company-enrichment-credits';

test('company enrichment credits settle only after successful enrichment', () => {
  assert.equal(
    companyEnrichmentCreditDisposition({ status: 'succeeded' }),
    'settle',
  );
});

test('company enrichment credits refund failed enrichment reservations', () => {
  assert.equal(
    companyEnrichmentCreditDisposition({ status: 'failed' }),
    'refund',
  );
});
