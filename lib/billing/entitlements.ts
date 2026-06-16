import { createAdminClient } from '@/lib/supabase-admin';
import { FREE_TIER, PLANS, isPlanKey, type PlanKey } from '@/lib/billing/config';

/**
 * Resolves what an org is entitled to right now: plan, seats, and all quota
 * dimensions. Single read path for billing state — enforcement gates and the
 * Settings UI both consume it.
 *
 * Free tier = no org_subscriptions row (or a non-live one).
 * Paid plans meter enrichments per billing period (org_billable_contact_events
 * since current_period_start), then draw down prepaid packs.
 * All per-seat quotas scale linearly: org total = seats × per-seat constant.
 */

export type SubscriptionStatus =
  | 'free'
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled';

export const UNLIMITED = 1_000_000_000;

export type OrgEntitlements = {
  planKey: PlanKey | 'free';
  planName: string;
  status: SubscriptionStatus;
  unlimited: boolean;
  seatLimit: number;

  // Enrichment quota
  includedContacts: number;
  lifetimeAllowance: boolean;
  contactsUsedThisPeriod: number;
  packBalance: number;
  contactAllowanceRemaining: number;

  // Active-leads pipeline cap (enriched, non-archived contacts)
  activeLeadsCap: number;

  // Exports per day
  exportsPerDay: number;

  // Net-new leads (data page purchases)
  netNewLeadsIncluded: number;
  netNewLeadsUsedThisPeriod: number;
  netNewLeadsRemaining: number;

  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
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

  const { data: org } = await admin
    .from('organizations')
    .select('billing_exempt')
    .eq('id', orgId)
    .maybeSingle<{ billing_exempt: boolean }>();
  if (org?.billing_exempt) {
    return {
      planKey: 'free',
      planName: 'Free',
      status: 'free',
      unlimited: true,
      seatLimit: UNLIMITED,
      includedContacts: UNLIMITED,
      lifetimeAllowance: true,
      contactsUsedThisPeriod: 0,
      packBalance: 0,
      contactAllowanceRemaining: UNLIMITED,
      activeLeadsCap: UNLIMITED,
      exportsPerDay: UNLIMITED,
      netNewLeadsIncluded: UNLIMITED,
      netNewLeadsUsedThisPeriod: 0,
      netNewLeadsRemaining: UNLIMITED,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      graceUntil: null,
    };
  }

  const { data: sub } = await admin
    .from('org_subscriptions')
    .select(
      'status, plan_key, included_seats, included_monthly_contacts, current_period_start, current_period_end, cancel_at_period_end, grace_until',
    )
    .eq('org_id', orgId)
    .maybeSingle<SubscriptionRow>();

  const live = sub && LIVE_STATUSES.has(sub.status);

  const { data: packs } = await admin
    .from('org_contact_packs')
    .select('contacts_remaining')
    .eq('org_id', orgId)
    .gt('contacts_remaining', 0);
  const packBalance = (packs ?? []).reduce((sum, p) => sum + (p.contacts_remaining ?? 0), 0);

  if (!live) {
    const used = await countBillableContacts(orgId, null, 'enrichment');
    const remaining = Math.max(0, FREE_TIER.lifetimeEnrichments - used) + packBalance;
    const leadsUsed = await countBillableContacts(orgId, null, 'acquisition');
    return {
      planKey: 'free',
      planName: 'Free',
      status: 'free',
      unlimited: false,
      seatLimit: FREE_TIER.seatLimit,
      includedContacts: FREE_TIER.lifetimeEnrichments,
      lifetimeAllowance: true,
      contactsUsedThisPeriod: used,
      packBalance,
      contactAllowanceRemaining: remaining,
      activeLeadsCap: FREE_TIER.activeLeadsCap,
      exportsPerDay: FREE_TIER.exportsPerDay,
      netNewLeadsIncluded: FREE_TIER.lifetimeLeads,
      netNewLeadsUsedThisPeriod: leadsUsed,
      netNewLeadsRemaining: Math.max(0, FREE_TIER.lifetimeLeads - leadsUsed),
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      graceUntil: null,
    };
  }

  const plan = isPlanKey(sub.plan_key) ? PLANS[sub.plan_key] : null;
  const seats = sub.included_seats || 1;

  // included_monthly_contacts is written by the webhook as seats × enrichmentsPerSeat.
  // Fall back to computing from plan config if the row predates this model.
  const includedContacts =
    sub.included_monthly_contacts ||
    (plan ? plan.enrichmentsPerSeat * seats : 0);

  const used = await countBillableContacts(orgId, sub.current_period_start, 'enrichment');
  const remaining = Math.max(0, includedContacts - used) + packBalance;

  const leadsUsed = await countBillableContacts(orgId, sub.current_period_start, 'acquisition');
  const netNewLeadsIncluded = plan ? plan.netNewLeadsPerSeat * seats : 0;

  return {
    planKey: plan?.key ?? 'free',
    planName: plan?.name ?? sub.plan_key,
    status: sub.status as SubscriptionStatus,
    unlimited: false,
    seatLimit: seats,
    includedContacts,
    lifetimeAllowance: false,
    contactsUsedThisPeriod: used,
    packBalance,
    contactAllowanceRemaining: remaining,
    activeLeadsCap: plan ? plan.activeLeadsCapPerSeat * seats : FREE_TIER.activeLeadsCap,
    exportsPerDay: plan ? plan.exportsPerDayPerSeat * seats : FREE_TIER.exportsPerDay,
    netNewLeadsIncluded,
    netNewLeadsUsedThisPeriod: leadsUsed,
    netNewLeadsRemaining: Math.max(0, netNewLeadsIncluded - leadsUsed),
    currentPeriodStart: sub.current_period_start,
    currentPeriodEnd: sub.current_period_end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    graceUntil: sub.grace_until,
  };
}

async function countBillableContacts(
  orgId: string,
  since: string | null,
  source: 'enrichment' | 'acquisition' | null = null,
): Promise<number> {
  const admin = createAdminClient();
  let query = admin
    .from('org_billable_contact_events')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId);
  if (since) query = query.gte('created_at', since);
  if (source) query = query.eq('source', source);
  const { count } = await query;
  return count ?? 0;
}
