/**
 * Per-plan cadence gates for the signal delta crons.
 *
 * Each delta cron fires once a week on its own assigned weekday (see
 * vercel.json — funding Mon, grants Tue, ... publications Sun). Two gates ride
 * that weekly heartbeat:
 *
 *   1. Attribution gate (product tier) — a customer's monitor only writes to
 *      THEIR feed at their plan cadence, regardless of how fresh the shared
 *      mirror is. This is the upgrade incentive: a starter/free customer never
 *      sees signals more often than monthly even if a growth customer tracking
 *      the same company forced a weekly scrape.
 *        - growth  → every weekly tick   (the cron's schedule IS the cadence)
 *        - starter → first weekly tick of the month
 *        - free    → first weekly tick of the month
 *
 *   2. Acquisition gate (cost) — a SHARED scrape (the paid mirrors: patents via
 *      BigQuery, press releases via Haiku) only runs at the fastest cadence any
 *      active customer demands. If no growth customer is active, the scrape
 *      drops to monthly. Free-API mirrors aren't gated (cost ≈ $0).
 *
 * Because each cron runs on a single weekday, "first occurrence of that weekday
 * this month" is simply day-of-month ≤ 7 — no need to know which weekday it is.
 * All date math is UTC to match Vercel's cron scheduler.
 *
 * Cadence numbers come straight from the billing catalog's canonical
 * monitoringCadenceDays (lib/billing/config.ts): growth 7, starter 30, free 30.
 */
import type { createAdminClient } from '@/lib/supabase-admin';
import { orgIdForUser } from '@/lib/org-context';
import { FREE_TIER, PLANS, isPlanKey } from '@/lib/billing/config';
import {
  WEEKLY_CADENCE_DAYS,
  dueForCadence,
  lookbackDaysForCadence,
} from '@/lib/signals/monitor-cadence-rules';

export {
  WEEKLY_CADENCE_DAYS,
  isFirstWeekdayOccurrenceOfMonth,
  dueForCadence,
  lookbackDaysForCadence,
} from '@/lib/signals/monitor-cadence-rules';

type Admin = ReturnType<typeof createAdminClient>;

const LIVE_SUB_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * Resolve a user's monitoring cadence (days) from their org's plan tier.
 * Lightweight and side-effect free (membership + subscription reads only).
 * Mirrors getOrgEntitlements' tier logic: billing-exempt orgs get growth
 * freshness, a live subscription maps to its plan, everything else is free.
 */
export async function resolveMonitorCadenceDays(admin: Admin, userId: string): Promise<number> {
  const orgId = await orgIdForUser(admin, userId);
  if (!orgId) return FREE_TIER.caps.monitoringCadenceDays;

  const { data: org } = await admin
    .from('organizations')
    .select('billing_exempt')
    .eq('id', orgId)
    .maybeSingle<{ billing_exempt: boolean }>();
  if (org?.billing_exempt) return PLANS.growth.caps.monitoringCadenceDays;

  const { data: sub } = await admin
    .from('org_subscriptions')
    .select('status, plan_key')
    .eq('org_id', orgId)
    .maybeSingle<{ status: string; plan_key: string }>();

  if (sub && LIVE_SUB_STATUSES.has(sub.status) && isPlanKey(sub.plan_key)) {
    return PLANS[sub.plan_key].caps.monitoringCadenceDays;
  }
  return FREE_TIER.caps.monitoringCadenceDays;
}

/** Timestamp of a user's most recent successful run for a given signal runner. */
export async function lastSuccessfulRunAt(
  admin: Admin,
  userId: string,
  runner: string,
): Promise<Date | null> {
  const { data } = await admin
    .from('signals_run_history')
    .select('created_at')
    .eq('user_id', userId)
    .eq('runner', runner)
    .eq('status', 'success')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string }>();
  return data?.created_at ? new Date(data.created_at) : null;
}

export type AttributionDecision = {
  due: boolean;
  cadenceDays: number;
  lookbackDays: number;
};

/**
 * Attribution gate: should this user's monitor run on this weekly tick?
 *
 * Growth runs every tick. Monthly tiers run on the month's first occurrence of
 * the cron's weekday — OR, as a one-time bootstrap, if they have never had a
 * successful run for this runner, so a fresh signup doesn't wait up to a month
 * for its first signals.
 */
export async function attributionDueForUser(
  admin: Admin,
  params: { userId: string; runner: string; now?: number },
): Promise<AttributionDecision> {
  const now = params.now ?? Date.now();
  const cadenceDays = await resolveMonitorCadenceDays(admin, params.userId);
  const lookbackDays = lookbackDaysForCadence(cadenceDays);

  if (dueForCadence(cadenceDays, now)) {
    return { due: true, cadenceDays, lookbackDays };
  }
  // Monthly tier on a non-first tick — only due if it has never run (bootstrap).
  const last = await lastSuccessfulRunAt(admin, params.userId, params.runner);
  return { due: last === null, cadenceDays, lookbackDays };
}

export async function monitorDueForUser(
  admin: Admin,
  params: { userId: string; runner: string; now?: number },
): Promise<AttributionDecision> {
  return attributionDueForUser(admin, params);
}

/**
 * Acquisition gate input: the fastest cadence (smallest day count) demanded by
 * the set of active customers. 7 if any active customer is growth-tier or
 * billing-exempt, otherwise 30. Pass the cron's already-loaded active user ids
 * so we don't re-scan the customer base.
 */
export async function fastestActiveAcquisitionCadence(
  admin: Admin,
  activeUserIds: string[],
): Promise<number> {
  let fastest = FREE_TIER.caps.monitoringCadenceDays;
  for (const userId of activeUserIds) {
    const cadence = await resolveMonitorCadenceDays(admin, userId);
    if (cadence <= WEEKLY_CADENCE_DAYS) return WEEKLY_CADENCE_DAYS; // can't get faster
    if (cadence < fastest) fastest = cadence;
  }
  return fastest;
}
