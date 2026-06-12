import { createAdminClient } from '@/lib/supabase-admin';
import { FREE_TIER, PLANS, isPlanKey, type PlanKey } from '@/lib/billing/config';

/**
 * Resolves what an org is entitled to right now: plan, seats, and contact
 * allowance. This is the single read path for billing state — enforcement
 * (Phase 4) and the Settings billing UI both consume it.
 *
 * Free tier = no org_subscriptions row (or a non-live one): 1 seat and a
 * LIFETIME contact allowance. Paid plans meter contacts per billing period
 * (org_billable_contact_events since current_period_start), then draw down
 * prepaid packs.
 */

export type SubscriptionStatus =
  | 'free'
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled';

export type OrgEntitlements = {
  planKey: PlanKey | 'free';
  planName: string;
  status: SubscriptionStatus;
  seatLimit: number;
  includedContacts: number;
  /** True when the contact allowance is lifetime (free tier), not monthly. */
  lifetimeAllowance: boolean;
  contactsUsedThisPeriod: number;
  packBalance: number;
  /** Included allowance left + pack balance. */
  contactAllowanceRemaining: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Past-due orgs keep full access until this passes (then soft-lock). */
  graceUntil: string | null;
};

type SubscriptionRow = {
  status: string;
  plan_key: string;
  included_seats: number;
  included_monthly_contacts: number;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  grace_until: string | null;
};

const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export async function getOrgEntitlements(orgId: string): Promise<OrgEntitlements> {
  const admin = createAdminClient();

  const { data: sub } = await admin
    .from('org_subscriptions')
    .select(
      'status, plan_key, included_seats, included_monthly_contacts, current_period_start, current_period_end, cancel_at_period_end, grace_until',
    )
    .eq('org_id', orgId)
    .maybeSingle<SubscriptionRow>();

  const live = sub && LIVE_STATUSES.has(sub.status);

  // Pack balance counts for free and paid orgs alike (a pack purchase is
  // valid without a subscription).
  const { data: packs } = await admin
    .from('org_contact_packs')
    .select('contacts_remaining')
    .eq('org_id', orgId)
    .gt('contacts_remaining', 0);
  const packBalance = (packs ?? []).reduce((sum, p) => sum + (p.contacts_remaining ?? 0), 0);

  if (!live) {
    const used = await countBillableContacts(orgId, null);
    const remaining = Math.max(0, FREE_TIER.lifetimeContacts - used) + packBalance;
    return {
      planKey: 'free',
      planName: 'Free',
      status: 'free',
      seatLimit: FREE_TIER.seatLimit,
      includedContacts: FREE_TIER.lifetimeContacts,
      lifetimeAllowance: true,
      contactsUsedThisPeriod: used,
      packBalance,
      contactAllowanceRemaining: remaining,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      graceUntil: null,
    };
  }

  const plan = isPlanKey(sub.plan_key) ? PLANS[sub.plan_key] : null;
  const includedContacts = sub.included_monthly_contacts || plan?.includedMonthlyContacts || 0;
  const used = await countBillableContacts(orgId, sub.current_period_start);
  const remaining = Math.max(0, includedContacts - used) + packBalance;

  return {
    planKey: plan?.key ?? 'free',
    planName: plan?.name ?? sub.plan_key,
    status: sub.status as SubscriptionStatus,
    seatLimit: sub.included_seats || plan?.includedSeats || FREE_TIER.seatLimit,
    includedContacts,
    lifetimeAllowance: false,
    contactsUsedThisPeriod: used,
    packBalance,
    contactAllowanceRemaining: remaining,
    currentPeriodStart: sub.current_period_start,
    currentPeriodEnd: sub.current_period_end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    graceUntil: sub.grace_until,
  };
}

async function countBillableContacts(orgId: string, since: string | null): Promise<number> {
  const admin = createAdminClient();
  let query = admin
    .from('org_billable_contact_events')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId);
  if (since) query = query.gte('created_at', since);
  const { count } = await query;
  return count ?? 0;
}
