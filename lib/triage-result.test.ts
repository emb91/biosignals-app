import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseTriageCompletion,
  readTriageReason,
  TRIAGE_AUTO_FAILURE_REASON,
  withTriageReason,
} from './triage-result';

test('parseTriageCompletion reads customer-facing reasons from object arrays', () => {
  const parsed = parseTriageCompletion(
    JSON.stringify([
      { group: 'low', reason: 'Medical device vendor is outside target buyer profile' },
      { group: 'high', reason: 'Senior manufacturing leader at relevant biotech company' },
    ]),
    2,
  );

  assert.deepEqual(parsed, [
    { group: 'low', reason: 'Medical device vendor is outside target buyer profile' },
    { group: 'high', reason: 'Senior manufacturing leader at relevant biotech company' },
  ]);
});

test('parseTriageCompletion marks malformed rows as automatic classification failures', () => {
  const parsed = parseTriageCompletion(
    JSON.stringify([{ group: 'unclear', reason: 'Maybe' }]),
    2,
  );

  assert.deepEqual(parsed, [
    { group: 'low', reason: TRIAGE_AUTO_FAILURE_REASON },
    { group: 'low', reason: TRIAGE_AUTO_FAILURE_REASON },
  ]);
});

test('parseTriageCompletion ignores prose after the first complete JSON array', () => {
  const parsed = parseTriageCompletion(
    '```json\n[{"group":"medium","reason":"Company fit is plausible but role is unclear"}]\n```\nNote: [ignored]',
    1,
  );

  assert.deepEqual(parsed, [
    { group: 'medium', reason: 'Company fit is plausible but role is unclear' },
  ]);
});

test('parseTriageCompletion sanitizes internal wording before UI persistence', () => {
  const parsed = parseTriageCompletion(
    JSON.stringify([{ group: 'medium', reason: 'Model followed the ICP taxonomy key' }]),
    1,
  );

  assert.equal(parsed[0]?.group, 'medium');
  assert.equal(parsed[0]?.reason, 'Available details suggest a possible fit but need review');
});

test('triage reason helpers preserve existing raw data', () => {
  const raw = withTriageReason({ company_domain: 'example.com' }, 'Relevant operator role');

  assert.deepEqual(raw, {
    company_domain: 'example.com',
    triage_reason: 'Relevant operator role',
  });
  assert.equal(readTriageReason(raw), 'Relevant operator role');
  assert.deepEqual(withTriageReason(raw, null), { company_domain: 'example.com' });
});
