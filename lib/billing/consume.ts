import { createAdminClient } from '@/lib/supabase-admin';
import { getOrgEntitlements, type OrgEntitlements } from '@/lib/billing/entitlements';

/**
 * Contact-meter consumption (Phase 4 of BILLING_PLAN.md). One helper, called
 * at every choke point that adds or first-enriches a contact:
 *   - lib/import-ingestion.ts (covers CSV imports AND data-acquisition jobs)
 *   - lib/enrichment-pipeline.ts (first-time enrichment of pre-existing contacts)
 *
 * SHADOW MODE: enforcement is off unless BILLING_ENFORCEMENT=true. In shadow
 * mode every contact is allowed and the meter still records, so real usage can
 * be validated against the billable-contact definition before anyone hits a
 * wall. Metering failures NEVER block work — all paths fail open.
 */

export type ConsumeOutcome =
  | 'already_billed'
  | 'allowed_included'
  | 'allowed_pack'
  | 'allowed_shadow'
  | 'denied'
  | 'skipped'; // metering unavailable (no org / lookup failure) — allowed

export type ConsumeResult = {
  allowed: boolean;
  outcome: ConsumeOutcome;
  /** True when this call consumed a unit of allowance (new billable contact). */
  consumedUnit: boolean;
};

/** Customer-facing denial copy — plain language, no internals. */
export const CONTACT_LIMIT_MESSAGE =
  'Your plan’s contact limit has been reached. Upgrade your plan or add more contacts in Settings to continue.';

export function billingEnforcementEnabled(): boolean {
  return process.env.BILLING_ENFORCEMENT === 'true';
}

/**
 * Read-only batch gate for callers that want to deny BEFORE creating rows
 * (import loop, job preflight). In shadow mode the gate is always open;
 * `remaining` still reports the truth for logging/UI.
 */
export async function getContactGate(orgId: string): Promise<{
  enforce: boolean;
  remaining: number;
  entitlements: OrgEntitlements;
}> {
  const entitlements = await getOrgEntitlements(orgId);
  const enforce = billingEnforcementEnabled();
  const pastGrace =
    entitlements.status === 'past_due' &&
    entitlements.graceUntil != null &&
    new Date(entitlements.graceUntil).getTime() < Date.now();
  return {
    enforce,
    // A lapsed grace period closes the gate entirely (when enforcing).
    remaining: pastGrace ? 0 : entitlements.contactAllowanceRemaining,
    entitlements,
  };
}

/**
 * Bill one contact to the org (idempotent per person — refreshes and
 * teammates re-adding the same person are free). Resolves person_id from
 * user_contacts when only the contact id is known.
 */
export async function consumeContactAllowance(params: {
  orgId: string | null;
  userId?: string | null;
  personId?: string | null;
  /** user_contacts.id (aka contacts.id) — used to resolve person_id. */
  userContactId?: string | null;
  source: 'import' | 'acquisition' | 'enrichment';
  /** Pass the gate's entitlements to skip a duplicate read in tight loops. */
  entitlements?: OrgEntitlements;
}): Promise<ConsumeResult> {
  try {
    const admin = createAdminClient();

    let orgId = params.orgId;
    if (!orgId && params.userId) {
      const { data } = await admin
        .from('org_members')
        .select('org_id')
        .eq('user_id', params.userId)
        .maybeSingle<{ org_id: string }>();
      orgId = data?.org_id ?? null;
    }
    if (!orgId) return { allowed: true, outcome: 'skipped', consumedUnit: false };

    let personId = params.personId ?? null;
    if (!personId && params.userContactId) {
      const { data } = await admin
        .from('user_contacts')
        .select('person_id')
        .eq('id', params.userContactId)
        .maybeSingle<{ person_id: string | null }>();
      personId = data?.person_id ?? null;
    }
    if (!personId) return { allowed: true, outcome: 'skipped', consumedUnit: false };

    const entitlements = params.entitlements ?? (await getOrgEntitlements(orgId));

    const { data, error } = await admin.rpc('billing_consume_contact', {
      p_org_id: orgId,
      p_person_id: personId,
      p_user_id: params.userId ?? null,
      p_user_contact_id: params.userContactId ?? null,
      p_source: params.source,
      p_included: entitlements.includedContacts,
      p_period_start: entitlements.lifetimeAllowance ? null : entitlements.currentPeriodStart,
      p_enforce: billingEnforcementEnabled(),
    });
    if (error) {
      console.error('[billing] consume RPC failed (allowing):', error);
      return { allowed: true, outcome: 'skipped', consumedUnit: false };
    }

    const outcome = (data as ConsumeOutcome) ?? 'skipped';
    return {
      allowed: outcome !== 'denied',
      outcome,
      consumedUnit:
        outcome === 'allowed_included' || outcome === 'allowed_pack' || outcome === 'allowed_shadow',
    };
  } catch (error) {
    console.error('[billing] consume failed (allowing):', error);
    return { allowed: true, outcome: 'skipped', consumedUnit: false };
  }
}
