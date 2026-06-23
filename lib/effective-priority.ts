/**
 * Canonical priority policy.
 *
 * Intrinsic scores describe fit + buying-signal strength and remain unchanged
 * in readiness snapshots. Effective scores answer "should this entity be
 * prioritised now?" and apply temporary CRM eligibility rules at read/export
 * time.
 */

export type CrmPriorityState =
  | 'active'
  | 'customer'
  | 'dormant'
  | 'context_only'
  | 'none'
  | null
  | undefined;

export const CRM_SUPPRESSION_DAYS = { won: 365, lost: 180 } as const;
export const CRM_SUPPRESSED_READINESS = 0.01;

export function normalizeScore01(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value > 1 && value <= 100) return value / 100;
  if (value >= 0 && value <= 1) return value;
  return null;
}

export function isCrmSuppressed(
  leadState: CrmPriorityState,
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

/** Strongest of company/contact readiness, with a small bump when both exist. */
export function effectiveReadiness(
  companyReadiness: number | null | undefined,
  contactReadiness: number | null | undefined,
): number | null {
  const company = normalizeScore01(companyReadiness);
  const contact = normalizeScore01(contactReadiness);
  if (company == null && contact == null) return null;
  const base = Math.max(company ?? 0, contact ?? 0);
  const bothPresent = (company ?? 0) > 0 && (contact ?? 0) > 0;
  const bumped = bothPresent ? base + 0.1 * Math.min(company ?? 0, contact ?? 0) : base;
  return Math.max(0, Math.min(1, bumped));
}

/** Fit floor with readiness boost. Contacts supply contactFit; accounts omit it. */
export function computeIntrinsicPriority(input: {
  companyFit: number | null | undefined;
  contactFit?: number | null | undefined;
  readiness: number | null | undefined;
}): number | null {
  const companyFit = normalizeScore01(input.companyFit);
  const readiness = normalizeScore01(input.readiness);
  if (companyFit == null || readiness == null) return null;

  const contactFit =
    input.contactFit === undefined ? 1 : normalizeScore01(input.contactFit);
  if (contactFit == null) return null;

  return Math.max(
    0,
    Math.min(1, companyFit * contactFit * (0.5 + 0.5 * readiness)),
  );
}

export type EffectivePriorityResult = {
  /** Stored/model score, without CRM eligibility rules. */
  intrinsicPriority: number | null;
  /** Signal-derived readiness, without CRM eligibility rules. */
  intrinsicReadiness: number | null;
  /** User-facing readiness after CRM eligibility rules. */
  effectiveReadiness: number | null;
  /** User-facing/ranking/export priority after CRM eligibility rules. */
  effectivePriority: number | null;
  isSuppressed: boolean;
};

/**
 * Resolve the intrinsic/effective score pair for every consumer.
 *
 * `crmIsSuppressed` is for denormalized SQL-side state. When omitted, live CRM
 * state + close time determine eligibility. A stored intrinsic priority is
 * preferred when unsuppressed; suppressed priority is always recomputed from
 * fit and the policy readiness floor.
 */
export function resolveEffectivePriority(input: {
  intrinsicPriority?: number | null;
  companyFit: number | null | undefined;
  contactFit?: number | null | undefined;
  intrinsicReadiness: number | null | undefined;
  crmState?: CrmPriorityState;
  crmClosedAt?: string | null;
  crmIsSuppressed?: boolean | null;
  asOfMs?: number;
}): EffectivePriorityResult {
  const intrinsicReadiness = normalizeScore01(input.intrinsicReadiness);
  const isSuppressed =
    typeof input.crmIsSuppressed === 'boolean'
      ? input.crmIsSuppressed
      : isCrmSuppressed(input.crmState, input.crmClosedAt, input.asOfMs);
  const policyReadiness = isSuppressed
    ? CRM_SUPPRESSED_READINESS
    : intrinsicReadiness;

  const computedIntrinsic = computeIntrinsicPriority({
    companyFit: input.companyFit,
    contactFit: input.contactFit,
    readiness: intrinsicReadiness,
  });
  const storedIntrinsic = normalizeScore01(input.intrinsicPriority);
  const intrinsicPriority = storedIntrinsic ?? computedIntrinsic;
  const effectivePriority = isSuppressed
    ? computeIntrinsicPriority({
        companyFit: input.companyFit,
        contactFit: input.contactFit,
        readiness: CRM_SUPPRESSED_READINESS,
      })
    : intrinsicPriority;

  return {
    intrinsicPriority,
    intrinsicReadiness,
    effectiveReadiness: policyReadiness,
    effectivePriority,
    isSuppressed,
  };
}

/** Suppressed or unverifiable entities must not produce action nudges. */
export function isEligibleForPriorityNudge(crmIsSuppressed: boolean | null | undefined): boolean {
  return crmIsSuppressed === false;
}
