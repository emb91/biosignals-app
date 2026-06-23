import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalCompanyAdmission,
  companyMentionAdmission,
} from './resolver-provenance-admission';

function match(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    company_id: 'co_1',
    company_name: 'Acme Bio',
    source_field: 'org_name',
    source_text: 'Acme Bio, Inc.',
    normalized_source_text: 'acme',
    resolved_by: 'exact',
    confidence: 1,
    verified: true,
    verification_reason: 'source phrase exactly matches company name or alias',
    ...overrides,
  };
}

test('admits verified mentions from accepted source fields', () => {
  const admission = companyMentionAdmission({
    companyId: 'co_1',
    matches: [match()],
    matchType: 'verified_awardee',
    acceptedSourceFields: ['org_name'],
    admittedReason: 'awardee verified',
    rejectedReason: 'awardee not verified',
  });

  assert.equal(admission.admitted, true);
  assert.equal(admission.matchType, 'verified_awardee');
  assert.equal(admission.metadata.matched_source_field, 'org_name');
});

test('rejects verified mentions from unaccepted source fields', () => {
  const admission = companyMentionAdmission({
    companyId: 'co_1',
    matches: [match({ source_field: 'project_title' })],
    matchType: 'verified_awardee',
    acceptedSourceFields: ['org_name'],
    admittedReason: 'awardee verified',
    rejectedReason: 'awardee not verified',
  });

  assert.equal(admission.admitted, false);
  assert.equal(admission.confidence, 'rejected');
});

test('admits verified canonical company matches', () => {
  const admission = canonicalCompanyAdmission({
    companyId: 'co_1',
    match: match({ source_field: 'assignee_name' }),
    matchType: 'verified_assignee',
    admittedReason: 'assignee verified',
    rejectedReason: 'assignee not verified',
  });

  assert.equal(admission.admitted, true);
  assert.equal(admission.metadata.matched_source_field, 'assignee_name');
});
