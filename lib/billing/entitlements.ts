import { createAdminClient } from '@/lib/supabase-admin';
import {
  FREE_TIER,
  PLANS,
  isPlanKey,
  type BillingInterval,
  type PlanKey,
  type UsageCaps,
} from '@/lib/billing/config';
import { availableCreditBalance, ensureCurrentCreditGrant } from '@/lib/billing/credits';

export type SubscriptionStatus = 'free' | 'active' | 'trialing' | 'past_due' | 'canceled';
export const UNLIMITED = 1_000_000_000;

export type OrgEntitlements = {
  planKey: PlanKey | 'free';
  planName: string;
  status: SubscriptionStatus;
  billingInterval: BillingInterval;
  unlimited: boolean;
  complimentary: boolean;
  seatLimit: number;
  creditsGranted: number;
  creditsAvailable: number;
  caps: UsageCaps;
  paymentAccessPaused: boolean;

  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  graceUntil: string | null;
};

type SubscriptionRow = {
  status: string;
  plan_key: string;
  billing_interval?: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  grace_until: string | null;
  stripe_subscription_id?: string | null;
};

const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export async function getOrgEntitlements(orgId: string): Promise<OrgEntitlements> {
  const admin = createAdminClient();
  const [{ data: org }, { data: sub }] = await Promise.all([
    admin.from('organizations').select('billing_exempt').eq('id', orgId)
      .maybeSingle<{ billing_exempt: boolean }>(),
    admin.from('org_subscriptions')
      .select(
        'status, plan_key, billing_interval, current_period_start, current_period_end, cancel_at_period_end, grace_until, stripe_subscription_id',
      )
      .eq('org_id', orgId)
      .maybeSingle<SubscriptionRow>(),
  ]);

  if (org?.billing_exempt) return complimentaryEntitlements();

  const live = Boolean(sub && LIVE_STATUSES.has(sub.status) && isPlanKey(sub.plan_key));
  const planKey: PlanKey | 'free' = live && isPlanKey(sub!.plan_key) ? sub!.plan_key : 'free';
  const plan = planKey === 'free' ? null : PLANS[planKey];
  const interval: BillingInterval = sub?.billing_interval === 'annual' ? 'annual' : 'monthly';

  await ensureCurrentCreditGrant({
    orgId,
    planKey,
    interval,
    periodStart: live ? sub?.current_period_start : null,
    periodEnd: live ? sub?.current_period_end : null,
    reference: live && sub?.stripe_subscription_id && sub.current_period_start
      ? `subscription:${sub.stripe_subscription_id}:${sub.current_period_start}`
      : null,
  }).catch((error) => {
    // Deploys may run app code briefly before the migration. Reads must remain available.
    console.warn('[billing] current credit grant unavailable:', error);
  });

  const creditsAvailable = await availableCreditBalance(orgId).catch(() => 0);
  const caps = plan?.caps ?? FREE_TIER.caps;
  const status = live ? (sub!.status as SubscriptionStatus) : 'free';
  const paymentAccessPaused =
    status === 'past_due' &&
    Boolean(sub?.grace_until) &&
    new Date(sub!.grace_until!).getTime() < Date.now();
  const creditsGranted = plan
    ? interval === 'annual' ? plan.annualCredits : plan.monthlyCredits
    : FREE_TIER.monthlyCredits;

  return {
    planKey,
    planName: plan?.name ?? FREE_TIER.name,
    status,
    billingInterval: interval,
    unlimited: false,
    complimentary: false,
    seatLimit: plan?.workspaceUsers ?? FREE_TIER.seatLimit,
    creditsGranted,
    creditsAvailable,
    caps,
    paymentAccessPaused,
    currentPeriodStart: live ? sub?.current_period_start ?? null : null,
    currentPeriodEnd: live ? sub?.current_period_end ?? null : null,
    cancelAtPeriodEnd: Boolean(live && sub?.cancel_at_period_end),
    graceUntil: live ? sub?.grace_until ?? null : null,
  };
}

function complimentaryEntitlements(): OrgEntitlements {
  const plan = PLANS.growth;
  const caps: UsageCaps = plan.caps;
  return {
    planKey: 'free',
    planName: 'Arcova credits',
    status: 'free',
    billingInterval: 'monthly',
    unlimited: false,
    complimentary: true,
    seatLimit: UNLIMITED,
    creditsGranted: plan.monthlyCredits,
    creditsAvailable: plan.monthlyCredits,
    caps,
    paymentAccessPaused: false,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    graceUntil: null,
  };
}
