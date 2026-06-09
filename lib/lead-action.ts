/**
 * Recommended lead action from company and contact ICP fit plus contact-scope buying signals.
 * Reach out only applies when readiness_score reflects signal events; otherwise strong fits stay on Monitor.
 * Keeps Leads UI, CSV export, HubSpot push, and import summary aligned.
 */

export type LeadAction =
  | 'source_contact'
  | 'reach_out'
  | 'send_outreach'
  | 'await_reply'
  | 'monitor'
  | 'deprioritize'
  // Data-quality overlay (contacts only): can't sync to HubSpot until the
  // contact's email is fixed. Never produced by getActionFromScores — applied
  // as an overlay via applyFixOverride. See its doc for the override rules.
  | 'fix';

/**
 * Dispatch status of the contact's most recent outreach_sequences row.
 * Used by applyOutreachOverride to bump the score-driven action up the
 * outreach funnel once the user has actually staged or sent something.
 */
export type SequenceDispatchStatus = 'draft' | 'sent' | 'replied' | 'failed' | null;

/**
 * The single "high" threshold (0–1) for fit and readiness. The action model is
 * a binary high/low gate per axis (company fit → contact fit → readiness), so
 * one threshold drives everything. Tunable — raise/lower to make the model
 * stricter/looser. (Was a multi-band 0.45/0.5/0.65 scheme; collapsed to 0.7.)
 */
export const HIGH_SCORE = 0.7;

// Legacy constant names kept for existing callers. All now collapse to the
// single HIGH_SCORE threshold.
export const DEPRIORITIZE_COMPANY_BELOW = HIGH_SCORE;
export const SOURCE_COMPANY_MIN = HIGH_SCORE;
export const SOURCE_CONTACT_MAX = HIGH_SCORE;
export const DEPRIORITIZE_FIT_BELOW = HIGH_SCORE;
export const REACH_OUT_READINESS_MIN = HIGH_SCORE;

/**
 * CRM-resolved suppression cooldown, in days. A closed-won (customer) or
 * closed-lost (dormant) deal "nullifies" the contact's readiness — floored to
 * ~0.01 so priority drops and the action reads as Deprioritise — but only
 * WITHIN this window. Once it passes, the suppressor lifts and the contact can
 * resurface on new signals (renewal/upsell for won; re-engagement for lost).
 *
 * Closed-lost re-opens faster (6mo) than closed-won (1yr): a lost deal can turn
 * around on a trigger event sooner than a fresh customer needs a renewal motion.
 * MVP values — tune as you learn. See the CRM suppression policy memory.
 */
export const CRM_SUPPRESSION_DAYS = { won: 365, lost: 180 } as const;

/**
 * Is a CRM-resolved (won/lost) contact still inside its suppression cooldown?
 *
 * `leadState` — HubSpot lead state (only 'customer' / 'dormant' suppress).
 * `closedAtIso` — when the deal closed; we use the deal's last-modified date as
 *   a proxy (hubspot_latest_deal_updated_at). Unknown date on a won/lost contact
 *   → treated as suppressed (safe default: don't reach out to a known closed deal
 *   just because we lost the timestamp).
 * `asOfMs` — current time in ms (injectable for tests; defaults to now).
 *
 * Returns false for any non-closed state, so normal fit/readiness logic applies.
 */
export function isCrmSuppressed(
  leadState: 'active' | 'customer' | 'dormant' | 'context_only' | 'none' | null | undefined,
  closedAtIso: string | null | undefined,
  asOfMs: number = Date.now(),
): boolean {
  if (leadState !== 'customer' && leadState !== 'dormant') return false;
  const windowDays = leadState === 'customer' ? CRM_SUPPRESSION_DAYS.won : CRM_SUPPRESSION_DAYS.lost;
  const closedMs = closedAtIso ? new Date(closedAtIso).getTime() : null;
  if (closedMs == null || !Number.isFinite(closedMs)) return true;
  const ageDays = (asOfMs - closedMs) / 86_400_000;
  return ageDays < windowDays;
}

export type LeadLikeForAction = {
  company_fit_score?: number | null;
  fit_score?: number | null;
  contact_fit_score?: number | null;
  /** Non-null positive values imply contact-scope signal events contributed to intent. */
  readiness_score?: number | null;
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
  // NOTE: deliberately do NOT fall back to lead.fit_score here — that's the
  // contact-level legacy fit column (now inert), never company fit. Using it
  // as company fit was a latent bug. No company fit → resolves null.
  return null;
}

export function resolveContactFitForLeadAction(lead: Pick<LeadLikeForAction, 'contact_fit_score'>): number | null {
  if (typeof lead.contact_fit_score === 'number' && Number.isFinite(lead.contact_fit_score)) {
    return lead.contact_fit_score;
  }
  return null;
}

/** True when stored contact intent came from at least one signal event (see contacts.readiness_score). */
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
  return !hasContactBuyingSignal(lead.readiness_score);
}

/**
 * Effective readiness for a CONTACT = the stronger of the company's readiness
 * and the contact's own, plus a small bump when both are meaningfully present.
 * Company momentum floors it (company signals are common, avg ~0.7); a personal
 * signal can lift it (rare but strong). All inputs/output are 0–1.
 *
 * Use this anywhere a contact's action/gate needs readiness — a great contact
 * at a hot company should read as ready even with no personal signal.
 */
export function effectiveReadiness(
  companyReadiness: number | null | undefined,
  contactReadiness: number | null | undefined,
): number | null {
  const c = score01ForAction(companyReadiness);
  const k = score01ForAction(contactReadiness);
  if (c == null && k == null) return null;
  const base = Math.max(c ?? 0, k ?? 0);
  const bothPresent = (c ?? 0) > 0 && (k ?? 0) > 0;
  const bumped = bothPresent ? base + 0.1 * Math.min(c ?? 0, k ?? 0) : base;
  return Math.max(0, Math.min(1, bumped));
}

/**
 * Canonical action core. Delegates to getActionFromScores (the single source of
 * truth for the three-gate tree). `readiness` here is the contact's effective
 * readiness (use effectiveReadiness() to combine company + contact first).
 */
export function getLeadActionFromFits(
  company: number | null,
  contact: number | null,
  readiness?: number | null,
): LeadAction {
  return getActionFromScores(company, contact, readiness ?? null, null);
}

export function getLeadAction(lead: LeadLikeForAction): LeadAction {
  return getLeadActionFromFits(
    resolveCompanyFitForLeadAction(lead),
    resolveContactFitForLeadAction(lead),
    lead.readiness_score,
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
    case 'send_outreach':
      return 'Send outreach';
    case 'await_reply':
      return 'Await reply';
    case 'monitor':
      return 'Monitor';
    case 'fix':
      return 'Fix';
  }
}

/**
 * Data-quality overlay (contacts only): a contact that can't be pushed to
 * HubSpot because its email is missing or malformed surfaces as "Fix", so the
 * user clears the blocker before trying to engage.
 *
 * Only overrides the "engage this contact" actions (reach_out / send_outreach /
 * await_reply / monitor). Deprioritise (not pursuing them) and Source (wrong
 * persona — go find a different contact) are left alone: fixing THIS contact's
 * email wouldn't change either call.
 */
export function applyFixOverride(baseAction: LeadAction, hasSyncIssue: boolean): LeadAction {
  if (!hasSyncIssue) return baseAction;
  if (baseAction === 'deprioritize' || baseAction === 'source_contact') return baseAction;
  return 'fix';
}

/**
 * Outreach-state overlay on the score-driven action. Once the user has staged
 * or sent a sequence, the action tracks the outreach funnel instead of the
 * scoring gates:
 *   - draft  → send_outreach (sequence ready, waiting for the user to dispatch)
 *   - sent   → await_reply   (dispatched, waiting on the prospect)
 *   - replied / failed → fall through to the score-driven action so the user
 *     can decide whether to engage further or retry.
 * CRM-resolved deprioritise (customer / dormant) still wins — the deal cycle
 * is closed and there's nothing to chase. SCORE-driven deprioritise does NOT
 * win: the rep already made a judgement call to engage despite the low fit, so
 * the funnel state is the relevant action to surface. Sequence absent
 * (sequenceStatus = null) leaves the base action alone.
 */
export function applyOutreachOverride(
  baseAction: LeadAction,
  sequenceStatus: SequenceDispatchStatus,
  crmState?: 'active' | 'customer' | 'dormant' | 'context_only' | 'none' | null,
): LeadAction {
  if (crmState === 'customer' || crmState === 'dormant') return 'deprioritize';
  if (sequenceStatus === 'sent') return 'await_reply';
  if (sequenceStatus === 'draft') return 'send_outreach';
  return baseAction;
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
  // Send outreach + Await reply share the teal "active-funnel" hue family with
  // Reach out, since they're successive stages of the same engagement track —
  // tinted slightly bluer so they read as "in progress" not "act now".
  send_outreach: {
    label: 'Send outreach',
    className:
      'bg-[#d5ecf3] text-[#0a4f63] ring-1 ring-[#a6d2e0] font-medium',
    interactiveClassName:
      'hover:bg-[#c4e2ec] hover:ring-[#95c5d6] active:brightness-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-cyan-500/40',
    rowSelectedClassName:
      'bg-[#d5ecf3] text-[#0a4f63] ring-1 ring-[#a6d2e0] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-cyan-500/40',
  },
  // Soft lavender — distinct from Deprioritise's slate-blue (same lightness
  // family was reading as the same pill at a glance). Sits between Send
  // outreach's cyan and any future "engaged" hues on the funnel.
  await_reply: {
    label: 'Await reply',
    className:
      'bg-[#ede0f8] text-[#5a3a86] ring-1 ring-[#d3bdee] font-medium',
    interactiveClassName:
      'hover:bg-[#e3d1f3] hover:ring-[#c4abe5] active:brightness-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-violet-500/40',
    rowSelectedClassName:
      'bg-[#ede0f8] text-[#5a3a86] ring-1 ring-[#d3bdee] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-violet-500/40',
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
  // Warm orange-red "needs attention" — distinct from Monitor's yellow and
  // Source's pink, and tied to the HubSpot-orange sync blocker it represents.
  fix: {
    label: 'Fix',
    className:
      'bg-[#ffe7dd] text-[#b34a26] ring-1 ring-[#f6c3ac] font-medium',
    interactiveClassName:
      'hover:bg-[#ffdbcc] hover:ring-[#efb295] active:brightness-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-orange-500/40',
    rowSelectedClassName:
      'bg-[#ffe7dd] text-[#b34a26] ring-1 ring-[#f6c3ac] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-orange-500/40',
  },
};

/** Sort key for action columns (higher = more urgency). */
// Outreach funnel stages (send → await) sort above plain Reach out, since they
// represent committed work already in motion that the user is more likely to
// want surfaced at the top of the table.
export const LEAD_ACTION_SORT_ORDER: Record<LeadAction, number> = {
  // Fix sorts top: it blocks an otherwise-actionable contact, so surface it for
  // resolution before the active-engagement funnel.
  fix: 6,
  send_outreach: 5,
  await_reply: 4,
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
 * New action logic driven by company fit + contact fit + readiness, with a
 * CRM override. Evaluated in this order:
 *
 *  1. CRM is closed-won ('customer') or closed-lost ('dormant') → Deprioritise
 *     (the deal cycle has resolved; nothing to action right now. The CRM
 *     column still shows "Won" / "Lost" so they're not confused with cold
 *     deprioritised leads.)
 *  2. Company fit < DEPRIORITIZE_COMPANY_BELOW → Deprioritise (wrong account
 *     entirely — no point sourcing a contact there).
 *  3. Company fit ≥ SOURCE_COMPANY_MIN AND contact fit < SOURCE_CONTACT_MAX →
 *     Source contact (right account, wrong persona — go find a better-fit
 *     contact at this company).
 *  4. Contact fit ≥ SOURCE_CONTACT_MAX AND readiness ≥ REACH_OUT_READINESS_MIN
 *     → Reach out (the contact is the right buyer and signals are firing).
 *  5. Otherwise → Monitor (borderline company fit, or good fits but no
 *     readiness signal yet — keep on the radar).
 *
 *  `contactFit` may be omitted on aggregate views (e.g. account rows that only
 *  carry a single fit score). In that case fits collapse to one axis: a strong
 *  company without persona context falls through to Monitor.
 */
export function getActionFromScores(
  companyFit: number | null | undefined,
  contactFit: number | null | undefined,
  readiness: number | null | undefined,
  crmState?: 'active' | 'customer' | 'dormant' | 'context_only' | 'none' | null,
): LeadAction {
  // 0. CRM resolved (won/lost) → nothing to action now.
  if (crmState === 'customer' || crmState === 'dormant') return 'deprioritize';
  // 1. Company fit is the hard gate. Below threshold, the contact is
  //    irrelevant — a perfect contact at a non-ICP company is worth nothing.
  const company = score01ForAction(companyFit);
  if (company == null || company < HIGH_SCORE) return 'deprioritize';
  // 2. Right account, wrong-persona contact → source a better contact.
  const contact = score01ForAction(contactFit);
  if (contact == null || contact < HIGH_SCORE) return 'source_contact';
  // 3. Right account + right contact: readiness decides reach out vs monitor.
  //    `readiness` should already be effective (max of company + contact).
  const ready = score01ForAction(readiness) ?? 0;
  if (ready >= HIGH_SCORE) return 'reach_out';
  return 'monitor';
}

/**
 * Recommended action for an aggregated account row. Uses the same fit/readiness/
 * CRM logic as `getActionFromScores`, but plugs in the account-shaped fields:
 * company_fit_score, best_contact_fit (the strongest persona we have on file),
 * readiness_score, and crm_status. Falls back to the old intent-based path only
 * when readiness has not yet been computed for the account.
 */
export function getAccountRowAction(account: {
  company_fit_score?: number | null;
  best_contact_fit?: number | null;
  max_contact_readiness_score?: number | null;
  readiness_score?: number | null;
  crm_status?: 'active' | 'customer' | 'dormant' | 'context_only' | 'none' | null;
  /** Close-date proxy for the account's winning deal — drives the suppression cooldown. */
  crm_closed_at?: string | null;
  contact_count?: number | null;
  /**
   * Highest-actionability outreach state across the account's contacts
   * ('draft' if any contact has a staged sequence, else 'sent' if any was
   * dispatched, else null). Mirrors the contact action's outreach overlay so an
   * account surfaces "Send outreach" / "Await reply" the same way a contact does.
   */
  latest_sequence_status?: SequenceDispatchStatus;
}): LeadAction {
  // No contacts on file → always source, regardless of CRM / outreach state.
  if (typeof account.contact_count === 'number' && account.contact_count === 0) {
    return 'source_contact';
  }

  // CRM-resolved (won/lost) only forces Deprioritise DURING the suppression
  // cooldown (won 1yr / lost 6mo). Past it, treat the account as non-resolved so
  // new signals can resurface it for renewal / re-engagement.
  const crmForAction = isCrmSuppressed(account.crm_status ?? null, account.crm_closed_at ?? null)
    ? account.crm_status ?? null
    : null;

  // If neither readiness nor an ACTIVE CRM signal exists, fall back to the legacy
  // intent-based logic so accounts still get a meaningful action before the
  // readiness pipeline has run for them.
  const base =
    account.readiness_score == null && (crmForAction == null || crmForAction === 'none')
      ? getLeadActionFromFits(
          score01ForAction(account.company_fit_score ?? null),
          score01ForAction(account.best_contact_fit ?? null),
          account.max_contact_readiness_score ?? null,
        )
      : getActionFromScores(
          account.company_fit_score ?? null,
          account.best_contact_fit ?? null,
          account.readiness_score ?? null,
          crmForAction,
        );

  // Mirror the contact action pipeline: overlay the outreach funnel state so a
  // staged/sent sequence at the account promotes to Send outreach / Await reply.
  // (Identical to contacts' applyOutreachOverride; null status leaves base as-is.)
  return applyOutreachOverride(base, account.latest_sequence_status ?? null, crmForAction);
}
