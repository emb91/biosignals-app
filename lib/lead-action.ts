/**
 * Recommended lead action from company and contact ICP fit.
 * Keeps Leads UI, CSV export, HubSpot push, and import summary aligned.
 */

export type LeadAction = 'source_contact' | 'monitor' | 'deprioritize';

export const DEPRIORITIZE_COMPANY_BELOW = 0.45;
export const SOURCE_COMPANY_MIN = 0.5;
export const SOURCE_CONTACT_MAX = 0.65;

export type LeadLikeForAction = {
  company_fit_score?: number | null;
  fit_score?: number | null;
  contact_fit_score?: number | null;
  companies?:
    | { company_fit_score?: number | null }
    | { company_fit_score?: number | null }[]
    | null;
};

function joinedCompanyRow(lead: LeadLikeForAction): { company_fit_score?: number | null } | null {
  const c = lead.companies;
  if (c == null) return null;
  if (Array.isArray(c)) return c[0] ?? null;
  return c;
}

export function resolveCompanyFitForLeadAction(lead: LeadLikeForAction): number | null {
  if (typeof lead.company_fit_score === 'number' && Number.isFinite(lead.company_fit_score)) {
    return lead.company_fit_score;
  }
  const companyObj = joinedCompanyRow(lead);
  const nested =
    companyObj &&
    typeof companyObj.company_fit_score === 'number' &&
    Number.isFinite(companyObj.company_fit_score)
      ? companyObj.company_fit_score
      : null;
  if (nested != null) return nested;
  if (typeof lead.fit_score === 'number' && Number.isFinite(lead.fit_score)) {
    return lead.fit_score;
  }
  return null;
}

export function resolveContactFitForLeadAction(lead: Pick<LeadLikeForAction, 'contact_fit_score'>): number | null {
  if (typeof lead.contact_fit_score === 'number' && Number.isFinite(lead.contact_fit_score)) {
    return lead.contact_fit_score;
  }
  return null;
}

export function getLeadActionFromFits(company: number | null, contact: number | null): LeadAction {
  if (company === null || company < DEPRIORITIZE_COMPANY_BELOW) return 'deprioritize';
  if (company >= SOURCE_COMPANY_MIN && (contact === null || contact < SOURCE_CONTACT_MAX)) {
    return 'source_contact';
  }
  return 'monitor';
}

export function getLeadAction(lead: LeadLikeForAction): LeadAction {
  return getLeadActionFromFits(
    resolveCompanyFitForLeadAction(lead),
    resolveContactFitForLeadAction(lead),
  );
}

/** Monitor or Reach out (formerly Source): worth working (not deprioritised on company fit). */
export function isMonitorOrReachOutAction(action: LeadAction): boolean {
  return action === 'monitor' || action === 'source_contact';
}

/** Human-readable action for CSV, HubSpot, and integrations. */
export function formatLeadActionLabel(action: LeadAction): string {
  switch (action) {
    case 'deprioritize':
      return 'Deprioritise';
    case 'source_contact':
      return 'Reach out';
    case 'monitor':
      return 'Monitor';
  }
}
