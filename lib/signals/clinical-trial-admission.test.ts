import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clinicalTrialCompanyAdmission,
  hasAdmittedClinicalTrialCompanyRole,
} from './clinical-trial-admission';

function match(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    company_id: 'co_1',
    company_name: 'Acme Bio',
    source_field: 'lead_sponsor',
    source_text: 'Acme Bio',
    normalized_source_text: 'acme',
    resolved_by: 'exact',
    confidence: 1,
    verified: true,
    verification_reason: 'source phrase exactly matches company name or alias',
    ...overrides,
  };
}

test('admits verified lead sponsor clinical trial signals', () => {
  const admission = clinicalTrialCompanyAdmission({
    companyId: 'co_1',
    signalKey: 'phase_transition',
    mentionedCompanyMatches: [match()],
  });

  assert.equal(admission.admitted, true);
  assert.equal(admission.confidence, 'high');
  assert.equal(admission.matchType, 'verified_lead_sponsor');
  assert.equal(admission.metadata.clinical_role, 'lead_sponsor');
  assert.equal(admission.metadata.high_impact_role_verified, true);
});

test('admits verified collaborators but flags them as collaborator-derived', () => {
  const admission = clinicalTrialCompanyAdmission({
    companyId: 'co_1',
    signalKey: 'trial_site_expansion',
    mentionedCompanyMatches: [match({ source_field: 'collaborators', source_text: 'Acme Bio' })],
  });

  assert.equal(admission.admitted, true);
  assert.equal(admission.confidence, 'medium');
  assert.equal(admission.matchType, 'verified_collaborator');
  assert.equal(admission.metadata.clinical_role, 'collaborator');
  assert.equal(admission.metadata.collaborator_derived, true);
  assert.equal(admission.metadata.high_impact_role_verified, true);
});

test('rejects site or institution-only verified matches for company-level trial signals', () => {
  const admission = clinicalTrialCompanyAdmission({
    companyId: 'co_1',
    signalKey: 'trial_site_expansion',
    mentionedCompanyMatches: [match({ source_field: 'facility', source_text: "King's College London" })],
  });

  assert.equal(admission.admitted, false);
  assert.equal(admission.confidence, 'rejected');
  assert.equal(admission.metadata.role_gate, 'rejected');
});

test('does not treat unverified collaborators as admissible', () => {
  const admission = clinicalTrialCompanyAdmission({
    companyId: 'co_1',
    signalKey: 'clinical_trial_registered',
    mentionedCompanyMatches: [
      match({ source_field: 'collaborators', verified: false, verification_reason: 'ambiguous source text' }),
    ],
  });

  assert.equal(admission.admitted, false);
});

test('role helper admits only lead sponsor or collaborator roles', () => {
  assert.equal(hasAdmittedClinicalTrialCompanyRole([match()], 'co_1'), true);
  assert.equal(
    hasAdmittedClinicalTrialCompanyRole([match({ source_field: 'official_affiliation' })], 'co_1'),
    false,
  );
});
