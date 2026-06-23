import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSkipFormDFundingSignal } from './sec-form-d-filters';

test('skips pooled investment fund Form D filings as company funding signals', () => {
  assert.equal(
    shouldSkipFormDFundingSignal({ industry_group_type: 'Pooled Investment Fund' }),
    true,
  );
  assert.equal(
    shouldSkipFormDFundingSignal({ industry_group_type: '  pooled   investment fund  ' }),
    true,
  );
});

test('keeps operating-company Form D industry groups eligible', () => {
  assert.equal(
    shouldSkipFormDFundingSignal({ industry_group_type: 'Pharmaceuticals' }),
    false,
  );
  assert.equal(
    shouldSkipFormDFundingSignal({ industry_group_type: 'Biotechnology' }),
    false,
  );
  assert.equal(
    shouldSkipFormDFundingSignal({ industry_group_type: null }),
    false,
  );
});
