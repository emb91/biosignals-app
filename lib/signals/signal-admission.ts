import type { SignalScope } from './readiness-types';

export type SignalAdmissionConfidence = 'high' | 'medium' | 'rejected';

export type SignalAdmissionResult = {
  admitted: boolean;
  reason: string;
  confidence: SignalAdmissionConfidence;
  entityScope: SignalScope;
  companyId?: string;
  contactId?: string;
  matchType: string;
  metadata: Record<string, unknown>;
};

export function buildAdmissionMetadata(admission: SignalAdmissionResult): Record<string, unknown> {
  return {
    admission_guard: {
      passed: admission.admitted,
      confidence: admission.confidence,
      entity_scope: admission.entityScope,
      company_id: admission.companyId ?? null,
      contact_id: admission.contactId ?? null,
      match_type: admission.matchType,
      reason: admission.reason,
    },
    ...admission.metadata,
  };
}

export function rejectedAdmission(input: {
  reason: string;
  entityScope: SignalScope;
  companyId?: string;
  contactId?: string;
  matchType: string;
  metadata?: Record<string, unknown>;
}): SignalAdmissionResult {
  return {
    admitted: false,
    reason: input.reason,
    confidence: 'rejected',
    entityScope: input.entityScope,
    companyId: input.companyId,
    contactId: input.contactId,
    matchType: input.matchType,
    metadata: input.metadata ?? {},
  };
}
