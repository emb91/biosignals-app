import type { CompanyMentionMatch } from '../companies/mention-provenance';
import type { SignalKey } from './readiness-types';
import { rejectedAdmission, type SignalAdmissionResult } from './signal-admission';

export type ClinicalTrialCompanyRole = 'lead_sponsor' | 'collaborator';

const HIGH_IMPACT_CLINICAL_SIGNALS = new Set<SignalKey>([
  'clinical_trial_sponsor_change',
  'phase_transition',
  'trial_site_expansion',
  'trial_failure_or_halt',
  'program_discontinuation',
  'principal_investigator_new_trial',
]);

function sourceFieldRole(sourceField: string | null | undefined): ClinicalTrialCompanyRole | null {
  const normalized = (sourceField ?? '').trim().toLowerCase();
  if (normalized === 'lead_sponsor') return 'lead_sponsor';
  if (normalized === 'collaborator' || normalized === 'collaborators') return 'collaborator';
  return null;
}

function verifiedMatchesForCompany(
  matches: unknown,
  companyId: string,
): Array<CompanyMentionMatch & { source_field: string }> {
  if (!Array.isArray(matches)) return [];
  return matches.filter((match): match is CompanyMentionMatch & { source_field: string } => {
    if (!match || typeof match !== 'object') return false;
    const row = match as Partial<CompanyMentionMatch>;
    return row.verified === true && row.company_id === companyId && typeof row.source_field === 'string';
  });
}

function bestTrialRole(matches: Array<CompanyMentionMatch & { source_field: string }>): {
  role: ClinicalTrialCompanyRole;
  match: CompanyMentionMatch;
} | null {
  const lead = matches.find((match) => sourceFieldRole(match.source_field) === 'lead_sponsor');
  if (lead) return { role: 'lead_sponsor', match: lead };

  const collaborator = matches.find((match) => sourceFieldRole(match.source_field) === 'collaborator');
  if (collaborator) return { role: 'collaborator', match: collaborator };

  return null;
}

export function hasAdmittedClinicalTrialCompanyRole(matches: unknown, companyId: string): boolean {
  return Boolean(bestTrialRole(verifiedMatchesForCompany(matches, companyId)));
}

export function clinicalTrialCompanyAdmission(input: {
  companyId: string;
  signalKey: SignalKey;
  mentionedCompanyMatches: unknown;
}): SignalAdmissionResult {
  const verifiedMatches = verifiedMatchesForCompany(input.mentionedCompanyMatches, input.companyId);
  const best = bestTrialRole(verifiedMatches);
  const highImpact = HIGH_IMPACT_CLINICAL_SIGNALS.has(input.signalKey);

  if (!best) {
    const verifiedFields = verifiedMatches.map((match) => match.source_field).filter(Boolean);
    return rejectedAdmission({
      entityScope: 'company',
      companyId: input.companyId,
      matchType: 'clinical_trial_role_rejected',
      reason:
        verifiedFields.length > 0
          ? 'Tracked company was verified only in non-sponsor trial fields.'
          : 'Tracked company was not verified as trial lead sponsor or collaborator.',
      metadata: {
        role_gate: 'rejected',
        role_gate_reason:
          verifiedFields.length > 0
            ? 'tracked entity appeared only outside lead sponsor/collaborator fields'
            : 'no verified lead sponsor or collaborator match',
        verified_source_fields: verifiedFields,
      },
    });
  }

  const collaboratorDerived = best.role === 'collaborator';
  const reason = collaboratorDerived
    ? 'Tracked company is explicitly listed as a verified trial collaborator.'
    : 'Tracked company is explicitly listed as the verified trial lead sponsor.';

  return {
    admitted: true,
    reason,
    confidence: collaboratorDerived ? 'medium' : 'high',
    entityScope: 'company',
    companyId: input.companyId,
    matchType: collaboratorDerived ? 'verified_collaborator' : 'verified_lead_sponsor',
    metadata: {
      clinical_role: best.role,
      collaborator_derived: collaboratorDerived,
      role_gate: 'passed',
      role_gate_reason: reason,
      high_impact_role_verified: highImpact ? true : undefined,
      matched_source_field: best.match.source_field,
      matched_source_text: best.match.source_text,
      matched_company_name: best.match.company_name,
      verification_reason: best.match.verification_reason,
      match_confidence: best.match.confidence,
    },
  };
}
