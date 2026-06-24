/**
 * Job-change re-check cadence, by plan tier.
 *
 * Each good-fit contact should get its LinkedIn profile re-scraped no more
 * often than this interval. Higher tiers get fresher detection; lower tiers
 * reveal job-change data on the same plan cadence as the other signal monitors.
 *
 * Agreed starting points (Emma owns the final numbers, tunable via env without
 * a deploy):
 *   - growth  → weekly  (every 7 days)
 *   - starter → monthly (every 30 days)
 *   - free    → monthly (every 30 days)
 *
 * Env overrides: JOB_CHANGE_CYCLE_DAYS_GROWTH / _STARTER / _FREE.
 */

import { createAdminClient } from '@/lib/supabase-admin';
import { orgIdForUser } from '@/lib/org-context';
import { isPlanKey, type PlanKey } from '@/lib/billing/config';

export type CadencePlan = PlanKey | 'free';

const DEFAULT_CYCLE_DAYS: Record<CadencePlan, number> = {
  growth: 7,
  starter: 30,
  free: 30,
};

const LIVE_SUB_STATUSES = new Set(['active', 'trialing', 'past_due']);

function envDays(key: string, fallback: number): number {
  const raw = process.env[key];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

/** Re-check interval (days) for a plan tier, honoring env overrides. */
export function cadenceDaysForPlan(plan: CadencePlan): number {
  switch (plan) {
    case 'growth':
      return envDays('JOB_CHANGE_CYCLE_DAYS_GROWTH', DEFAULT_CYCLE_DAYS.growth);
    case 'starter':
      return envDays('JOB_CHANGE_CYCLE_DAYS_STARTER', DEFAULT_CYCLE_DAYS.starter);
    default:
      return envDays('JOB_CHANGE_CYCLE_DAYS_FREE', DEFAULT_CYCLE_DAYS.free);
  }
}

/**
 * Resolve a user's plan tier and its re-check cadence. Lightweight on purpose
 * (reads org membership + subscription status only) so admin/manual runs can
 * reuse the same tier rules as the scheduled sweep dispatcher.
 *
 * Mirrors getOrgEntitlements' tier logic: billing-exempt orgs (internal/owner)
 * get top-tier freshness; a live subscription maps to its plan; everything else
 * is treated as free.
 */
export async function resolveCadenceDaysForUser(
  userId: string,
): Promise<{ planKey: CadencePlan; cycleDays: number }> {
  const admin = createAdminClient();
  const orgId = await orgIdForUser(admin, userId);
  if (!orgId) {
    return { planKey: 'free', cycleDays: cadenceDaysForPlan('free') };
  }

  const { data: org } = await admin
    .from('organizations')
    .select('billing_exempt')
    .eq('id', orgId)
    .maybeSingle<{ billing_exempt: boolean }>();
  if (org?.billing_exempt) {
    return { planKey: 'growth', cycleDays: cadenceDaysForPlan('growth') };
  }

  const { data: sub } = await admin
    .from('org_subscriptions')
    .select('status, plan_key')
    .eq('org_id', orgId)
    .maybeSingle<{ status: string; plan_key: string }>();

  const planKey: CadencePlan =
    sub && LIVE_SUB_STATUSES.has(sub.status) && isPlanKey(sub.plan_key)
      ? sub.plan_key
      : 'free';

  return { planKey, cycleDays: cadenceDaysForPlan(planKey) };
}
