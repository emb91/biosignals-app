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
  /** Default (resting) surface, text, and ring */
  className: string;
  /** Hover and active (pressed) feedback for interactive pills in Leads tables */
  interactiveClassName: string;
  /** Solid emphasis when the row is selected with the action detail open (matches semantic color, not generic teal) */
  rowSelectedClassName: string;
};

/** Pill styles: soft traffic-light semantics tuned to Arcova's pastel teal palette. */
export const LEAD_ACTION_PILL_CLASS: Record<LeadAction, LeadActionPillConfig> = {
  reach_out: {
    label: 'Reach out',
    className:
      'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80 font-semibold shadow-sm shadow-arcova-teal/10',
    interactiveClassName:
      'hover:bg-emerald-100 hover:ring-emerald-300/90 active:bg-emerald-800 active:text-white active:ring-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-700',
    rowSelectedClassName:
      'bg-emerald-800 text-white ring-2 ring-emerald-700/55 ring-offset-1 shadow-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-600',
  },
  monitor: {
    label: 'Monitor',
    className:
      'bg-amber-50 text-amber-800 ring-1 ring-amber-200/80 font-medium',
    interactiveClassName:
      'hover:bg-amber-100 hover:text-amber-900 hover:ring-amber-300/90 active:bg-amber-800 active:text-white active:ring-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-amber-700',
    rowSelectedClassName:
      'bg-amber-800 text-white ring-2 ring-amber-700/55 ring-offset-1 shadow-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-amber-600',
  },
  source_contact: {
    label: 'Source',
    className:
      'bg-rose-50 text-rose-800 ring-1 ring-rose-200/80 font-medium',
    interactiveClassName:
      'hover:bg-rose-100 hover:text-rose-950 hover:ring-rose-300/90 active:bg-rose-900 active:text-white active:ring-rose-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-rose-800',
    rowSelectedClassName:
      'bg-rose-900 text-white ring-2 ring-rose-800/55 ring-offset-1 shadow-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-rose-700',
  },
  deprioritize: {
    label: 'Deprioritise',
    className:
      'bg-slate-50 text-slate-600 ring-1 ring-slate-200/80 font-medium',
    interactiveClassName:
      'hover:bg-slate-100 hover:text-slate-800 hover:ring-slate-300/80 active:bg-slate-700 active:text-white active:ring-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-600',
    rowSelectedClassName:
      'bg-slate-700 text-white ring-2 ring-slate-600/55 ring-offset-1 shadow-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-500',
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
