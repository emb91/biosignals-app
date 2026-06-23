import type { CompanyMentionMatch } from '../companies/mention-provenance';
import { rejectedAdmission, type SignalAdmissionResult } from './signal-admission';

function verifiedCompanyMatches(
  matches: unknown,
  companyId: string,
): CompanyMentionMatch[] {
  if (!Array.isArray(matches)) return [];
  return matches.filter((match): match is CompanyMentionMatch => {
    if (!match || typeof match !== 'object') return false;
    const row = match as Partial<CompanyMentionMatch>;
    return row.verified === true && row.company_id === companyId;
  });
}

function matchMetadata(match: CompanyMentionMatch): Record<string, unknown> {
  return {
    matched_source_field: match.source_field,
    matched_source_text: match.source_text,
    matched_company_name: match.company_name,
    verification_reason: match.verification_reason,
    match_confidence: match.confidence,
    resolver: match.resolved_by,
  };
}

export function companyMentionAdmission(input: {
  companyId: string;
  matches: unknown;
  matchType: string;
  acceptedSourceFields: string[];
  admittedReason: string;
  rejectedReason: string;
}): SignalAdmissionResult {
  const accepted = new Set(input.acceptedSourceFields);
  const matches = verifiedCompanyMatches(input.matches, input.companyId);
  const match = matches.find((candidate) => accepted.has(candidate.source_field));

  if (!match) {
    return rejectedAdmission({
      entityScope: 'company',
      companyId: input.companyId,
      matchType: `${input.matchType}_rejected`,
      reason: input.rejectedReason,
      metadata: {
        role_gate: 'rejected',
        role_gate_reason: input.rejectedReason,
        verified_source_fields: matches.map((candidate) => candidate.source_field),
      },
    });
  }

  return {
    admitted: true,
    reason: input.admittedReason,
    confidence: 'high',
    entityScope: 'company',
    companyId: input.companyId,
    matchType: input.matchType,
    metadata: {
      role_gate: 'passed',
      role_gate_reason: input.admittedReason,
      ...matchMetadata(match),
    },
  };
}

export function canonicalCompanyAdmission(input: {
  companyId: string;
  match: unknown;
  matchType: string;
  admittedReason: string;
  rejectedReason: string;
}): SignalAdmissionResult {
  const match = verifiedCompanyMatches([input.match], input.companyId)[0] ?? null;
  if (!match) {
    return rejectedAdmission({
      entityScope: 'company',
      companyId: input.companyId,
      matchType: `${input.matchType}_rejected`,
      reason: input.rejectedReason,
      metadata: {
        role_gate: 'rejected',
        role_gate_reason: input.rejectedReason,
      },
    });
  }

  return {
    admitted: true,
    reason: input.admittedReason,
    confidence: 'high',
    entityScope: 'company',
    companyId: input.companyId,
    matchType: input.matchType,
    metadata: {
      role_gate: 'passed',
      role_gate_reason: input.admittedReason,
      ...matchMetadata(match),
    },
  };
}
