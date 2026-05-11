import { ROUTES, withQuery } from './routes';

export type JourneyStage =
  | 'setup'
  | 'import'
  | 'enrichment_pending'
  | 'leads_contact_quality'
  | 'accounts_coverage'
  | 'health_icp_gap'
  | 'data_ready'
  | 'signals_ready';

export interface JourneySetupState {
  company_profile_complete: boolean;
  company_name: string | null;
  icps_defined: number;
  personas_defined: number;
  setup_complete: boolean;
}

export interface JourneyImportState {
  has_imported_contacts: boolean;
  recent_batches: Array<Record<string, unknown>>;
  hubspot_last_job: Record<string, unknown> | null;
}

export interface JourneyLeadState {
  total: number;
  status_counts: {
    ready: number;
    monitor: number;
    source: number;
    deprioritized: number;
  };
  source_contacts_at_high_fit_companies: Array<Record<string, unknown>>;
}

export interface JourneyAccountGap {
  id: string;
  name: string;
  icpId: string | null;
  icp: string | null;
  contact_count: number;
  best_contact_fit: number | null;
  issue: string;
}

export interface JourneyAccountState {
  total: number;
  coverage: {
    covered: number;
    opportunity: number;
    weak: number;
    unscored: number;
  };
  high_fit_poor_coverage_examples: JourneyAccountGap[];
}

export interface JourneyIcpRow {
  id: string;
  label: string;
  company_count: number;
  opportunity_accounts: number;
  average_contact_fit: number | string | null;
}

export interface JourneyIcpState {
  rows: JourneyIcpRow[];
  low_company_coverage: JourneyIcpRow[];
  poor_average_contact_fit: JourneyIcpRow[];
}

export interface JourneyRecommendedAction {
  reason: string;
  label: string;
  href: string;
  mode?: string;
  icpId?: string;
  batchCompanies?: { id: string; name: string; icpId?: string | null }[];
}

export interface WorkspaceJourneyStateInput {
  setup: JourneySetupState;
  import_state: JourneyImportState;
  leads: JourneyLeadState;
  accounts: JourneyAccountState;
  icps: JourneyIcpState;
}

export interface WorkspaceJourneyState extends WorkspaceJourneyStateInput {
  journey_stage: JourneyStage;
  recommended_next_action: JourneyRecommendedAction | null;
  narrative_instruction: string;
}

function numericContactFit(value: number | string | null): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.endsWith('%')) {
    const n = Number(value.slice(0, -1));
    return Number.isFinite(n) ? n / 100 : null;
  }
  return null;
}

function icpContactBatch(icpId: string, accounts: JourneyAccountGap[]) {
  return accounts
    .filter((account) => account.icpId === icpId)
    .slice(0, 50)
    .map((account) => ({
      id: account.id,
      name: account.name,
      icpId: account.icpId,
    }));
}

export function buildWorkspaceJourneyState(input: WorkspaceJourneyStateInput): WorkspaceJourneyState {
  const { setup, import_state: importState, leads, accounts, icps } = input;
  const lowCompanyCoverageIcps = [...icps.low_company_coverage].sort((a, b) => a.company_count - b.company_count);
  const poorContactFitIcps = [...icps.poor_average_contact_fit].sort(
    (a, b) => (numericContactFit(a.average_contact_fit) ?? 0) - (numericContactFit(b.average_contact_fit) ?? 0),
  );

  let journeyStage: JourneyStage = 'signals_ready';
  let recommendedNextAction: JourneyRecommendedAction | null = null;

  if (!setup.setup_complete) {
    journeyStage = 'setup';
    recommendedNextAction = {
      reason: !setup.company_profile_complete
        ? 'The product needs the user company profile before scoring and enrichment are useful.'
        : 'The product needs at least one ICP before it can score companies and contacts.',
      label: !setup.company_profile_complete ? 'Complete company profile' : 'Define ICPs',
      href: !setup.company_profile_complete ? ROUTES.setup.company : ROUTES.setup.icps,
    };
  } else if (!importState.has_imported_contacts) {
    journeyStage = 'import';
    recommendedNextAction = {
      reason: 'Setup is done, but there are no imported contacts yet.',
      label: 'Import contacts',
      href: ROUTES.import,
    };
  } else if (leads.total === 0 && accounts.total === 0) {
    journeyStage = 'enrichment_pending';
    recommendedNextAction = {
      reason: 'Contacts have been imported, but scored leads and accounts are not available yet.',
      label: 'Check imports',
      href: ROUTES.import,
    };
  } else if (lowCompanyCoverageIcps.length > 0) {
    const icp = lowCompanyCoverageIcps[0];
    journeyStage = 'health_icp_gap';
    recommendedNextAction = {
      reason: `${icp.label} has very low company coverage.`,
      label: `Find companies for ${icp.label}`,
      href: withQuery(ROUTES.leads.data, `mode=companies&icpId=${encodeURIComponent(icp.id)}`),
      mode: 'companies',
      icpId: icp.id,
    };
  } else if (accounts.high_fit_poor_coverage_examples.length > 0) {
    journeyStage = 'accounts_coverage';
    const batchCompanies = accounts.high_fit_poor_coverage_examples.slice(0, 50).map((account) => ({
      id: account.id,
      name: account.name,
      icpId: account.icpId,
    }));
    recommendedNextAction = {
      reason: 'Some high-fit accounts have no strong buyer-persona contact.',
      label: `Source contacts for ${batchCompanies.length} accounts`,
      href: withQuery(ROUTES.leads.data, 'mode=contacts_at_companies'),
      mode: 'contacts_at_companies',
      batchCompanies,
    };
  } else if (leads.status_counts.source > 0) {
    journeyStage = 'leads_contact_quality';
    recommendedNextAction = {
      reason: 'Some contacts are at good companies but are not the right people to target.',
      label: 'Source better contacts',
      href: ROUTES.leads.data,
    };
  } else if (poorContactFitIcps.length > 0) {
    const icp = poorContactFitIcps[0];
    const batchCompanies = icpContactBatch(icp.id, accounts.high_fit_poor_coverage_examples);
    journeyStage = 'health_icp_gap';
    recommendedNextAction = {
      reason: `${icp.label} has enough companies, but weak average contact quality.`,
      label: `Source contacts for ${icp.label}`,
      href: withQuery(ROUTES.leads.data, 'mode=contacts_at_companies'),
      mode: 'contacts_at_companies',
      icpId: icp.id,
      ...(batchCompanies.length > 0 ? { batchCompanies } : {}),
    };
  } else if (accounts.coverage.opportunity > 0) {
    journeyStage = 'data_ready';
    recommendedNextAction = {
      reason: 'There are still accounts that would benefit from better contacts.',
      label: 'Open Data',
      href: ROUTES.leads.data,
    };
  } else {
    journeyStage = 'signals_ready';
    recommendedNextAction = {
      reason: 'Setup, import, and coverage look healthy enough that timing and intent become the next layer.',
      label: 'Review signals',
      href: ROUTES.signals,
    };
  }

  return {
    ...input,
    journey_stage: journeyStage,
    recommended_next_action: recommendedNextAction,
    narrative_instruction:
      'Explain the current stage in plain language, name the main gap, and only then suggest the next action. If recommended_next_action has an href, use suggest_navigation after the explanation.',
  };
}
