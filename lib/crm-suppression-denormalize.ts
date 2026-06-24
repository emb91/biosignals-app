import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveContactHubSpotStates,
  HUBSPOT_STATE_PRIORITY,
  type HubSpotLeadState,
} from '@/lib/hubspot-lead-state';
import { isCrmSuppressed } from '@/lib/lead-action';
import { updateCompanyStateForUser } from '@/lib/org-company-state';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = SupabaseClient<any>;

/**
 * Denormalize each contact's CRM suppression state onto `contacts.crm_is_suppressed`
 * and the company-aggregated state onto `org_companies.crm_is_suppressed`.
 *
 * WHY: the contacts list (/api/contacts query-builder) and accounts list
 * (list_user_accounts RPC) paginate in SQL ordered by priority_score. CRM
 * suppression (closed-won/lost → priority drops) is otherwise applied only at
 * READ time on the current page, so across page boundaries a closed deal with
 * high intrinsic priority could sort onto page 1 yet display low, burying active
 * accounts. This boolean lets SQL sink suppressed rows to the bottom globally.
 *
 * State resolution reuses `resolveContactHubSpotStates`, so it never drifts from
 * the read-time logic. The `crm_is_suppressed` flag is time-dependent only at
 * cooldown EXPIRY (won 1yr / lost 6mo) — call this on every HubSpot sync and the
 * daily cron so the flag stays within <24h of accurate (sort slot only; the
 * displayed value is always computed live). Idempotent.
 *
 * See the CRM suppression policy memory.
 */
export async function denormalizeCrmSuppressionState(
  admin: AdminClient,
  userId: string,
): Promise<{ contactsUpdated: number; companiesUpdated: number }> {
  const { data: contactRows, error } = await admin
    .from('contacts')
    .select('id, email, company_id')
    .eq('user_id', userId)
    .is('archived_at', null);
  if (error || !contactRows?.length) return { contactsUpdated: 0, companiesUpdated: 0 };

  const stubs = contactRows as Array<{ id: string; email: string | null; company_id: string | null }>;
  const states = await resolveContactHubSpotStates(
    admin,
    userId,
    stubs.map((c) => ({ id: c.id, email: c.email })),
  );

  // Per-contact suppression flag (every contact gets a value — contacts with no
  // resolved deal clear to false, healing stale flags).
  const contactSuppressed = new Map<string, boolean>();
  // Per-company: keep the highest-priority lead state (+ its close date) so the
  // company aggregate matches the accounts view's "strongest state wins" rule.
  const companyAgg = new Map<string, { state: HubSpotLeadState; closedAt: string | null; priority: number }>();

  for (const c of stubs) {
    const resolved = states.get(c.id) ?? null;
    const state = resolved?.state ?? null;
    const closedAt = resolved?.modifiedAt ?? null;
    const suppressed = isCrmSuppressed(state, closedAt);
    contactSuppressed.set(c.id, suppressed);

    if (c.company_id && state) {
      const priority = HUBSPOT_STATE_PRIORITY[state] ?? 0;
      const existing = companyAgg.get(c.company_id);
      if (!existing || priority > existing.priority) {
        companyAgg.set(c.company_id, { state, closedAt, priority });
      }
    }
  }

  // Bulk-write contacts: one UPDATE per boolean value (2 round-trips max).
  let contactsUpdated = 0;
  for (const flag of [true, false]) {
    const ids = stubs.map((c) => c.id).filter((id) => contactSuppressed.get(id) === flag);
    if (!ids.length) continue;
    const { error: upErr } = await admin
      .from('contacts')
      .update({ crm_is_suppressed: flag })
      .eq('user_id', userId)
      .in('id', ids);
    if (!upErr) contactsUpdated += ids.length;
  }

  // Bulk-write org_companies: companies with an aggregated suppressed state vs.
  // everything else (cleared to false). Scope to this user's org companies only.
  const suppressedCompanyIds = [...companyAgg.entries()]
    .filter(([, v]) => isCrmSuppressed(v.state, v.closedAt))
    .map(([companyId]) => companyId);

  // Reset every currently-flagged company for this user to false (heals expired
  // cooldowns + companies that dropped their closed deal), then flag the current
  // suppressed set true. Two clean writes — no fragile NOT-IN string building.
  await updateCompanyStateForUser(admin, userId, { crm_is_suppressed: false });

  let companiesUpdated = 0;
  if (suppressedCompanyIds.length) {
    await updateCompanyStateForUser(admin, userId, { crm_is_suppressed: true }, suppressedCompanyIds);
    companiesUpdated += suppressedCompanyIds.length;
  }

  return { contactsUpdated, companiesUpdated };
}
