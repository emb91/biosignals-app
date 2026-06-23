import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFormDScreenResult } from './sec-form-d-screen-result';

test('accepts only when same entity and operating-company financing are both yes', () => {
  assert.deepEqual(
    normalizeFormDScreenResult({
      decision: 'accept',
      same_entity: 'yes',
      operating_company_financing: 'yes',
      reason: 'Issuer is the tracked operating company.',
    }),
    {
      decision: 'accept',
      same_entity: 'yes',
      operating_company_financing: 'yes',
      reason: 'Issuer is the tracked operating company.',
    },
  );
});

test('rejects if the filing issuer is a different entity', () => {
  const result = normalizeFormDScreenResult({
    decision: 'accept',
    same_entity: 'no',
    operating_company_financing: 'yes',
    reason: 'Different company.',
  });
  assert.equal(result.decision, 'reject');
});

test('rejects pooled-fund or non-operating-company financing', () => {
  const result = normalizeFormDScreenResult({
    decision: 'accept',
    same_entity: 'yes',
    operating_company_financing: 'no',
    reason: 'Issuer is a hedge fund reporting cumulative fund sales.',
  });
  assert.equal(result.decision, 'reject');
});

test('defaults malformed model output to uncertain', () => {
  assert.deepEqual(
    normalizeFormDScreenResult({ decision: 'accept', same_entity: 'maybe' }),
    {
      decision: 'uncertain',
      same_entity: 'uncertain',
      operating_company_financing: 'uncertain',
      reason: 'No screening reason provided.',
    },
  );
});
