import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySourceCompanyNameAgainstCandidates } from './signal-entity-guards';

test('verifies exact normalized source company names', () => {
  const match = verifySourceCompanyNameAgainstCandidates('Moderna, Inc.', [
    { id: 'moderna', company_name: 'Moderna', aliases: [] },
  ]);

  assert.equal(match?.companyId, 'moderna');
});

test('verifies known aliases without raw substring matching', () => {
  const match = verifySourceCompanyNameAgainstCandidates('ModernaTX, Inc.', [
    { id: 'moderna', company_name: 'Moderna', aliases: ['ModernaTX, Inc.'] },
  ]);

  assert.equal(match?.companyId, 'moderna');
});

test('rejects short generic company names embedded in unrelated longer names', () => {
  const match = verifySourceCompanyNameAgainstCandidates('The Beauty Tech Group', [
    { id: 'mt', company_name: 'The MT Group', aliases: [] },
  ]);

  assert.equal(match, null);
});

test('rejects ambiguous verified matches', () => {
  const match = verifySourceCompanyNameAgainstCandidates('Acme Bio', [
    { id: 'one', company_name: 'Acme Bio', aliases: [] },
    { id: 'two', company_name: 'Acme Bio Inc.', aliases: [] },
  ]);

  assert.equal(match, null);
});
