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

function normalizeLinkedinKey(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '');
}

/**
 * Which of these LinkedIn URLs map to a person ALREADY billed to the org (a
 * free re-import — e.g. a teammate already added them). Used by the import gate
 * so at-limit users can still re-upload CSVs containing existing contacts:
 * only genuinely NEW contacts count against the allowance. Returns normalized
 * keys. Best-effort — returns empty on any failure (gate then treats all as new).
 */
export async function getOrgBilledContactKeys(
  orgId: string,
  linkedinUrls: Array<string | null | undefined>,
): Promise<Set<string>> {
  try {
    const urls = [...new Set(linkedinUrls.filter(Boolean).map((u) => normalizeLinkedinKey(u as string)))];
    if (urls.length === 0) return new Set();
    const admin = createAdminClient();

    const { data: people } = await admin.from('people').select('id, linkedin_url').in('linkedin_url', urls);
    const personByUrl = new Map<string, string>();
    for (const p of (people ?? []) as Array<{ id: string; linkedin_url: string | null }>) {
      if (p.linkedin_url) personByUrl.set(normalizeLinkedinKey(p.linkedin_url), p.id);
    }
    if (personByUrl.size === 0) return new Set();

    const personIds = [...personByUrl.values()];
    const { data: billed } = await admin
      .from('org_billable_contact_events')
      .select('person_id')
      .eq('org_id', orgId)
      .in('person_id', personIds);
    const billedPersons = new Set((billed ?? []).map((b) => (b as { person_id: string }).person_id));

    const result = new Set<string>();
    for (const [url, personId] of personByUrl) if (billedPersons.has(personId)) result.add(url);
    return result;
  } catch (error) {
    console.error('[billing] getOrgBilledContactKeys failed (treating all as new):', error);
    return new Set();
  }
}

/**
 * Batch contact billing for bulk imports — one person-id lookup + one bulk
 * insert + at most a few pack updates, instead of one RPC round-trip per
 * contact. Idempotent per (org, person) via the unique constraint, so already-
 * billed persons are silently skipped. Draws prepaid packs for any overage
 * beyond the included allowance, matching the per-contact RPC. Never denies —
 * callers gate over-limit creation up front (see lib/import-ingestion.ts).
 * Fails open (records nothing) on error; never throws.
 */
export async function recordBillableContactsBatch(params: {
  orgId: string;
  userId?: string | null;
  userContactIds: string[];
  source: 'import' | 'acquisition' | 'enrichment';
  entitlements: OrgEntitlements;
}): Promise<{ newlyBilled: number }> {
  try {
    const ids = [...new Set(params.userContactIds)];
    if (ids.length === 0) return { newlyBilled: 0 };
    const admin = createAdminClient();

    // Resolve person_ids; one billable event per unique person.
    const { data: rows } = await admin.from('user_contacts').select('id, person_id').in('id', ids);
    const personToContact = new Map<string, string>();
    for (const r of (rows ?? []) as Array<{ id: string; person_id: string | null }>) {
      if (r.person_id && !personToContact.has(r.person_id)) personToContact.set(r.person_id, r.id);
    }
    if (personToContact.size === 0) return { newlyBilled: 0 };

    const eventRows = [...personToContact.entries()].map(([personId, contactId]) => ({
      org_id: params.orgId,
      person_id: personId,
      user_id: params.userId ?? null,
      user_contact_id: contactId,
      source: params.source,
    }));
    // ignoreDuplicates → ON CONFLICT (org_id, person_id) DO NOTHING; the returned
    // rows are only the ones actually inserted = newly billed.
    const { data: inserted, error } = await admin
      .from('org_billable_contact_events')
      .upsert(eventRows, { onConflict: 'org_id,person_id', ignoreDuplicates: true })
      .select('person_id');
    if (error) {
      console.error('[billing] batch record failed (allowing):', error);
      return { newlyBilled: 0 };
    }
    const newlyBilled = inserted?.length ?? 0;

    // Draw prepaid packs for the slice that exceeds the included allowance.
    const includedRemaining = Math.max(
      0,
      params.entitlements.includedContacts - params.entitlements.contactsUsedThisPeriod,
    );
    const overage = Math.max(0, newlyBilled - includedRemaining);
    if (overage > 0) await drawPacks(admin, params.orgId, overage);

    return { newlyBilled };
  } catch (error) {
    console.error('[billing] batch record failed (allowing):', error);
    return { newlyBilled: 0 };
  }
}

async function drawPacks(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  count: number,
): Promise<void> {
  let remaining = count;
  const { data: packs } = await admin
    .from('org_contact_packs')
    .select('id, contacts_remaining')
    .eq('org_id', orgId)
    .gt('contacts_remaining', 0)
    .order('purchased_at', { ascending: true });
  for (const p of (packs ?? []) as Array<{ id: string; contacts_remaining: number }>) {
    if (remaining <= 0) break;
    const draw = Math.min(p.contacts_remaining, remaining);
    await admin.from('org_contact_packs').update({ contacts_remaining: p.contacts_remaining - draw }).eq('id', p.id);
    remaining -= draw;
  }
}
