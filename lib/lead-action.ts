/**
 * Recommended lead action from company and contact ICP fit plus contact-scope buying signals.
 * Reach out only applies when intent_score reflects signal events; otherwise strong fits stay on Monitor.
 * Keeps Leads UI, CSV export, HubSpot push, and import summary aligned.
 */

export type LeadAction = 'source_contact' | 'reach_out' | 'monitor' | 'deprioritize';

export const DEPRIORITIZE_COMPANY_BELOW = 0.45;
export const SOURCE_COMPANY_MIN = 0.5;
export const SOURCE_CONTACT_MAX = 0.65;

export type LeadLikeForAction = {
  company_fit_score?: number | null;
  fit_score?: number | null;
  contact_fit_score?: number | null;
  /** Non-null positive values imply contact-scope signal events contributed to intent. */
  intent_score?: number | null;
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

/** True when stored contact intent came from at least one signal event (see contacts.intent_score). */
export function hasContactBuyingSignal(intentScore: number | null | undefined): boolean {
  return typeof intentScore === 'number' && Number.isFinite(intentScore) && intentScore > 0;
}

/**
 * Strong company + persona fit, but no contact-scope buying signal yet: keep the account, wait to act.
 * Distinct from the lower-fit "watch" band, which still uses the Monitor label.
 */
export function isLeadReadyAwaitingContactSignal(lead: LeadLikeForAction): boolean {
  const company = resolveCompanyFitForLeadAction(lead);
  const contact = resolveContactFitForLeadAction(lead);
  if (company === null || company < SOURCE_COMPANY_MIN) return false;
  if (contact === null || contact < SOURCE_CONTACT_MAX) return false;
  return !hasContactBuyingSignal(lead.intent_score);
}

export function getLeadActionFromFits(
  company: number | null,
  contact: number | null,
  contactIntentScore?: number | null,
): LeadAction {
  if (company === null || company < DEPRIORITIZE_COMPANY_BELOW) return 'deprioritize';
  if (company >= SOURCE_COMPANY_MIN) {
    if (contact === null || contact < SOURCE_CONTACT_MAX) {
      return 'source_contact';
    }
    if (hasContactBuyingSignal(contactIntentScore)) return 'reach_out';
    return 'monitor';
  }
  return 'monitor';
}

export function getLeadAction(lead: LeadLikeForAction): LeadAction {
  return getLeadActionFromFits(
    resolveCompanyFitForLeadAction(lead),
    resolveContactFitForLeadAction(lead),
    lead.intent_score,
  );
}

/** Import and ICP coverage: any lead that is not Deprioritise (Monitor, Source, or Reach out). */
export function isMonitorOrReachOutAction(action: LeadAction): boolean {
  return action !== 'deprioritize';
}

/** Human-readable action for CSV, HubSpot, and integrations. */
export function formatLeadActionLabel(action: LeadAction): string {
  switch (action) {
    case 'deprioritize':
      return 'Deprioritise';
    case 'source_contact':
      return 'Source';
    case 'reach_out':
      return 'Reach out';
    case 'monitor':
      return 'Monitor';
  }
}

export type LeadActionPillConfig = {
  label: string;
  /** Default (resting) surface and text — also used when the row opens the action drawer (selection does not darken the pill). */
  className: string;
  /** Optional hover/active feedback — keeps the same lightness family as the resting pill. */
  interactiveClassName: string;
  /** Kept identical to resting pill visuals; callers may treat selection separately with layout only. */
  rowSelectedClassName: string;
};

/** Soft traffic-light semantics: pastel fills and rims; selection does not switch to inverted/solid fills. */
export const LEAD_ACTION_PILL_CLASS: Record<LeadAction, LeadActionPillConfig> = {
  reach_out: {
    label: 'Reach out',
    className:
      'bg-[#dcf5ec] text-[#0d5c54] ring-1 ring-[#aedbcc] font-medium',
    interactiveClassName:
      'hover:bg-[#caece0] hover:ring-[#9dd0bf] active:brightness-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-teal-500/40',
    rowSelectedClassName:
      'bg-[#dcf5ec] text-[#0d5c54] ring-1 ring-[#aedbcc] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-teal-500/40',
  },
  monitor: {
    label: 'Monitor',
    className:
      'bg-[#fbf0d8] text-[#784a12] ring-1 ring-[#ebd199] font-medium',
    interactiveClassName:
      'hover:bg-[#f7e8c9] hover:ring-[#e3c682] active:brightness-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-amber-500/40',
    rowSelectedClassName:
      'bg-[#fbf0d8] text-[#784a12] ring-1 ring-[#ebd199] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-amber-500/40',
  },
  source_contact: {
    label: 'Source',
    className:
      'bg-[#fce8ee] text-[#7f3f4f] ring-1 ring-[#eab3c5] font-medium',
    interactiveClassName:
      'hover:bg-[#fadce6] hover:ring-[#e4a6b9] active:brightness-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-rose-500/40',
    rowSelectedClassName:
      'bg-[#fce8ee] text-[#7f3f4f] ring-1 ring-[#eab3c5] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-rose-500/40',
  },
  deprioritize: {
    label: 'Deprioritise',
    className:
      'bg-[#dfeaf1] text-[#3f5562] ring-1 ring-[#c9d9e6] font-medium',
    interactiveClassName:
      'hover:bg-[#d3e4ed] hover:ring-[#b8cede] active:brightness-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-500/38',
    rowSelectedClassName:
      'bg-[#dfeaf1] text-[#3f5562] ring-1 ring-[#c9d9e6] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-500/38',
  },
};

/** Sort key for action columns (higher = more urgency). */
export const LEAD_ACTION_SORT_ORDER: Record<LeadAction, number> = {
  reach_out: 3,
  monitor: 2,
  source_contact: 1,
  deprioritize: 0,
};

function score01ForAction(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value > 1 && value <= 100) return value / 100;
  if (value >= 0 && value <= 1) return value;
  return null;
}

/**
 * Recommended action for an aggregated account row (company + best contact fit + any contact-level intent).
 */
export function getAccountRowAction(account: {
  company_fit_score?: number | null;
  best_contact_fit?: number | null;
  max_contact_intent_score?: number | null;
}): LeadAction {
  return getLeadActionFromFits(
    score01ForAction(account.company_fit_score ?? null),
    score01ForAction(account.best_contact_fit ?? null),
    account.max_contact_intent_score ?? null,
  );
}
