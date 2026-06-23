import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkspaceJourneyState,
  type WorkspaceJourneyStateInput,
} from './agent-journey-state';
import { ROUTES, withQuery } from './routes';

function baseInput(overrides: Partial<WorkspaceJourneyStateInput> = {}): WorkspaceJourneyStateInput {
  return {
    setup: {
      company_profile_complete: true,
      company_name: 'Arcova',
      icps_defined: 1,
      personas_defined: 1,
      setup_complete: true,
    },
    import_state: {
      has_imported_contacts: true,
      recent_batches: [{ filename: 'contacts.csv' }],
      hubspot_last_job: null,
    },
    leads: {
      total: 4,
      status_counts: {
        ready: 1,
        monitor: 1,
        source: 0,
        deprioritized: 2,
      },
      source_contacts_at_high_fit_companies: [],
    },
    accounts: {
      total: 3,
      coverage: {
        covered: 2,
        opportunity: 0,
        weak: 1,
        unscored: 0,
      },
      high_fit_poor_coverage_examples: [],
    },
    icps: {
      rows: [
        {
          id: 'icp-1',
          label: 'ICP 1',
          company_count: 8,
          opportunity_accounts: 0,
          average_contact_fit: 0.85,
        },
      ],
      low_company_coverage: [],
      poor_average_contact_fit: [],
    },
    ...overrides,
  };
}

test('setup incomplete points to company profile', () => {
  const state = buildWorkspaceJourneyState(baseInput({
    setup: {
      company_profile_complete: false,
      company_name: null,
      icps_defined: 0,
      personas_defined: 0,
      setup_complete: false,
    },
  }));

  assert.equal(state.journey_stage, 'setup');
  assert.equal(state.recommended_next_action?.href, ROUTES.setup.company);
});

test('setup complete with no imports points to Import', () => {
  const state = buildWorkspaceJourneyState(baseInput({
    import_state: {
      has_imported_contacts: false,
      recent_batches: [],
      hubspot_last_job: null,
    },
    leads: {
      total: 0,
      status_counts: { ready: 0, monitor: 0, source: 0, deprioritized: 0 },
      source_contacts_at_high_fit_companies: [],
    },
    accounts: {
      total: 0,
      coverage: { covered: 0, opportunity: 0, weak: 0, unscored: 0 },
      high_fit_poor_coverage_examples: [],
    },
  }));

  assert.equal(state.journey_stage, 'import');
  assert.equal(state.recommended_next_action?.href, ROUTES.import);
});

test('existing accounts without import history still recommend account coverage work', () => {
  const state = buildWorkspaceJourneyState(baseInput({
    import_state: {
      has_imported_contacts: false,
      recent_batches: [],
      hubspot_last_job: null,
    },
    leads: {
      total: 0,
      status_counts: { ready: 0, monitor: 0, source: 0, deprioritized: 0 },
      source_contacts_at_high_fit_companies: [],
    },
    accounts: {
      total: 1,
      coverage: { covered: 0, opportunity: 1, weak: 0, unscored: 0 },
      high_fit_poor_coverage_examples: [
        {
          id: 'company-1',
          name: 'PhenoVista',
          icpId: 'icp-1',
          icp: 'ICP 1',
          contact_count: 0,
          best_contact_fit: null,
          issue: 'no contacts',
        },
      ],
    },
  }));

  assert.equal(state.journey_stage, 'accounts_coverage');
  assert.equal(state.recommended_next_action?.mode, 'contacts_at_companies');
});

test('source contacts recommend contact sourcing in Data', () => {
  const state = buildWorkspaceJourneyState(baseInput({
    leads: {
      total: 5,
      status_counts: { ready: 1, monitor: 1, source: 3, deprioritized: 0 },
      source_contacts_at_high_fit_companies: [
        { name: 'Aisling', company_name: 'PhenoVista' },
      ],
    },
  }));

  assert.equal(state.journey_stage, 'leads_contact_quality');
  assert.equal(state.recommended_next_action?.href, ROUTES.data);
});

test('low ICP company coverage recommends company sourcing for that ICP', () => {
  const state = buildWorkspaceJourneyState(baseInput({
    icps: {
      rows: [
        { id: 'icp-1', label: 'Biologics CDMO ICP', company_count: 1, opportunity_accounts: 0, average_contact_fit: 0.8 },
      ],
      low_company_coverage: [
        { id: 'icp-1', label: 'Biologics CDMO ICP', company_count: 1, opportunity_accounts: 0, average_contact_fit: 0.8 },
      ],
      poor_average_contact_fit: [],
    },
  }));

  assert.equal(state.journey_stage, 'health_icp_gap');
  assert.equal(state.recommended_next_action?.mode, 'companies');
  assert.equal(state.recommended_next_action?.href, withQuery(ROUTES.data, 'mode=companies&icpId=icp-1'));
});

test('high-fit accounts with poor contacts recommend batch contact sourcing', () => {
  const state = buildWorkspaceJourneyState(baseInput({
    accounts: {
      total: 2,
      coverage: { covered: 0, opportunity: 2, weak: 0, unscored: 0 },
      high_fit_poor_coverage_examples: [
        {
          id: 'company-1',
          name: 'PhenoVista',
          icpId: 'icp-1',
          icp: 'ICP 1',
          contact_count: 1,
          best_contact_fit: 0.3,
          issue: 'contacts exist but none fully match the buyer persona',
        },
        {
          id: 'company-2',
          name: 'BioOra',
          icpId: 'icp-1',
          icp: 'ICP 1',
          contact_count: 0,
          best_contact_fit: null,
          issue: 'no contacts',
        },
      ],
    },
  }));

  assert.equal(state.journey_stage, 'accounts_coverage');
  assert.equal(state.recommended_next_action?.mode, 'contacts_at_companies');
  assert.equal(state.recommended_next_action?.batchCompanies?.length, 2);
});
