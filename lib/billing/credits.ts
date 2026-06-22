import { createAdminClient } from '@/lib/supabase-admin';
import {
  ACTION_CREDITS,
  FREE_TIER,
  PLANS,
  type BillingInterval,
  type BillingPlanKey,
  type CreditAction,
  type PlanKey,
} from '@/lib/billing/config';
import { isOrgBillingExempt } from '@/lib/billing/exemptions';

export type CreditBucketSource =
  | 'free_monthly'
  | 'paid_monthly'
  | 'annual'
  | 'purchased'
  | 'adjustment';

export type CreditErrorCode =
  | 'insufficient_credits'
  | 'usage_cap_reached'
  | 'active_lead_cap_reached'
  | 'payment_access_paused';

export type CreditReservation =
  | { ok: true; transactionId: string | null; reserved: number; idempotent: boolean }
  | {
      ok: false;
      code: CreditErrorCode;
      message: string;
      action: string;
      requiredCredits?: number;
      availableCredits?: number;
    };

export type UsageResult =
  | { ok: true; used: number; limit: number; resetsAt: string; idempotent: boolean }
  | {
      ok: false;
      code: 'usage_cap_reached';
      message: string;
      action: string;
      usage: { used: number; limit: number; resetsAt: string };
    };

export type CreditBalanceBySource = {
  included: { granted: number; available: number };
  purchased: { granted: number; available: number };
  adjustment: { granted: number; available: number };
  total: { granted: number; available: number };
};

export function creditEnforcementEnabled(action?: string): boolean {
  if (process.env.ARCOVA_CREDIT_ENFORCEMENT === 'true') return true;
  if (!action) return false;
  const enabledActions = (process.env.ARCOVA_CREDIT_ENFORCEMENT_ACTIONS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return enabledActions.includes(action);
}

export async function ensureCurrentCreditGrant(params: {
  orgId: string;
  planKey: BillingPlanKey;
  interval: BillingInterval;
  periodStart?: string | null;
  periodEnd?: string | null;
  reference?: string | null;
}): Promise<void> {
  const now = new Date();
  const calendar = utcMonthWindow(now);
  const start = params.periodStart ?? calendar.start;
  const end = params.periodEnd ?? calendar.end;
  const plan = params.planKey === 'free' ? null : PLANS[params.planKey];
  const source: CreditBucketSource = params.planKey === 'free'
    ? 'free_monthly'
    : params.interval === 'annual' ? 'annual' : 'paid_monthly';
  const credits = params.planKey === 'free'
    ? FREE_TIER.monthlyCredits
    : params.interval === 'annual' ? plan!.annualCredits : plan!.monthlyCredits;
  const reference = params.reference
    ?? `${source}:${params.orgId}:${start.slice(0, 10)}`;

  const admin = createAdminClient();
  const { count: existingActive } = await admin.from('org_credit_buckets')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', params.orgId)
    .eq('source', source)
    .lte('valid_from', new Date().toISOString())
    .gt('expires_at', new Date().toISOString());
  if ((existingActive ?? 0) > 0) return;
  const { error } = await admin.rpc('grant_org_credit_bucket', {
    p_org_id: params.orgId,
    p_source: source,
    p_credits: credits,
    p_valid_from: start,
    p_expires_at: end,
    p_external_reference: reference,
    p_metadata: { planKey: params.planKey, interval: params.interval },
  });
  if (error && !isMissingRpc(error)) {
    throw new Error(`credit grant failed: ${error.message}`);
  }
}

export async function reserveCredits(params: {
  orgId: string;
  userId?: string | null;
  action: CreditAction | string;
  idempotencyKey: string;
  credits?: number;
  quantity?: number;
  entityType?: string | null;
  entityId?: string | null;
  purchasedOnly?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<CreditReservation> {
  const unitCredits = params.credits
    ?? ACTION_CREDITS[params.action as CreditAction]
    ?? 0;
  const credits = roundCredits(unitCredits * (params.quantity ?? 1));
  if (credits === 0) {
    return { ok: true, transactionId: null, reserved: 0, idempotent: false };
  }

  // Complimentary Arcova-owned workspaces retain provider/usage telemetry but
  // never reserve or settle customer credits.
  if (await isOrgBillingExempt(params.orgId)) {
    return { ok: true, transactionId: null, reserved: credits, idempotent: false };
  }

  const admin = createAdminClient();
  const { data: subscription } = await admin.from('org_subscriptions')
    .select('status, grace_until')
    .eq('org_id', params.orgId)
    .maybeSingle<{ status: string; grace_until: string | null }>();
  if (
    subscription?.status === 'past_due' &&
    subscription.grace_until &&
    new Date(subscription.grace_until).getTime() < Date.now() &&
    creditEnforcementEnabled(params.action)
  ) {
    return {
      ok: false,
      code: 'payment_access_paused',
      message: 'Paid actions are paused while the billing issue is resolved.',
      action: 'Update billing in Settings.',
    };
  }
  const { data, error } = await admin.rpc('reserve_org_credits', {
    p_org_id: params.orgId,
    p_user_id: params.userId ?? null,
    p_action_type: params.action,
    p_credits: credits,
    p_idempotency_key: params.idempotencyKey,
    p_entity_type: params.entityType ?? null,
    p_entity_id: params.entityId ?? null,
    p_allowed_sources: params.purchasedOnly
      ? ['purchased', 'adjustment']
      : ['free_monthly', 'paid_monthly', 'annual', 'purchased', 'adjustment'],
    p_metadata: params.metadata ?? {},
  });

  if (error) {
    if (isMissingRpc(error) && !creditEnforcementEnabled(params.action)) {
      return { ok: true, transactionId: null, reserved: credits, idempotent: false };
    }
    throw new Error(`credit reservation failed: ${error.message}`);
  }
  const result = data as {
    ok: boolean;
    transactionId?: string;
    reserved?: number;
    idempotent?: boolean;
    requiredCredits?: number;
    availableCredits?: number;
  };
  if (!result.ok) {
    if (!creditEnforcementEnabled(params.action)) {
      return { ok: true, transactionId: null, reserved: credits, idempotent: false };
    }
    return {
      ok: false,
      code: 'insufficient_credits',
      message: 'You do not have enough credits for this action.',
      action: 'Buy credits or upgrade your plan to continue.',
      requiredCredits: Number(result.requiredCredits ?? credits),
      availableCredits: Number(result.availableCredits ?? 0),
    };
  }
  return {
    ok: true,
    transactionId: result.transactionId ?? null,
    reserved: Number(result.reserved ?? credits),
    idempotent: Boolean(result.idempotent),
  };
}

export async function settleCredits(transactionId: string | null, credits?: number): Promise<void> {
  if (!transactionId) return;
  const admin = createAdminClient();
  let settled = credits;
  if (settled == null) {
    const { data } = await admin
      .from('org_credit_transactions')
      .select('credits_reserved')
      .eq('id', transactionId)
      .maybeSingle<{ credits_reserved: number }>();
    settled = Number(data?.credits_reserved ?? 0);
  }
  const { error } = await admin.rpc('settle_org_credits', {
    p_transaction_id: transactionId,
    p_credits: roundCredits(settled),
  });
  if (error && !isMissingRpc(error)) throw new Error(`credit settlement failed: ${error.message}`);
}

export async function refundCredits(transactionId: string | null): Promise<void> {
  if (!transactionId) return;
  const admin = createAdminClient();
  const { error } = await admin.rpc('refund_org_credits', {
    p_transaction_id: transactionId,
  });
  if (error && !isMissingRpc(error)) throw new Error(`credit refund failed: ${error.message}`);
}

export async function checkAndIncrementUsage(params: {
  orgId: string;
  userId?: string | null;
  action: string;
  quantity?: number;
  operationKey: string;
  limit: number;
  window: 'utc_day' | 'utc_month' | 'rolling_24h';
  metadata?: Record<string, unknown>;
}): Promise<UsageResult> {
  const period = usageWindow(params.window);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('check_and_increment_usage', {
    p_org_id: params.orgId,
    p_user_id: params.userId ?? null,
    p_action_type: params.action,
    p_quantity: params.quantity ?? 1,
    p_operation_key: params.operationKey,
    p_window_start: period.start,
    p_window_end: period.end,
    p_limit: params.limit,
    p_metadata: params.metadata ?? {},
  });
  if (error) {
    if (isMissingRpc(error) && !creditEnforcementEnabled(params.action)) {
      return { ok: true, used: 0, limit: params.limit, resetsAt: period.end, idempotent: false };
    }
    throw new Error(`usage check failed: ${error.message}`);
  }
  const result = data as {
    ok: boolean;
    used: number;
    limit: number;
    resetsAt?: string;
    idempotent?: boolean;
  };
  if (!result.ok && creditEnforcementEnabled(params.action)) {
    return {
      ok: false,
      code: 'usage_cap_reached',
      message: 'This workspace has reached its usage limit for this action.',
      action: 'Wait for the limit to reset or upgrade your plan.',
      usage: {
        used: Number(result.used ?? 0),
        limit: Number(result.limit ?? params.limit),
        resetsAt: result.resetsAt ?? period.end,
      },
    };
  }
  return {
    ok: true,
    used: Number(result.used ?? 0),
    limit: Number(result.limit ?? params.limit),
    resetsAt: result.resetsAt ?? period.end,
    idempotent: Boolean(result.idempotent),
  };
}

export async function recordMeteredUsage(params: {
  orgId: string;
  userId?: string | null;
  action: string;
  quantity?: number;
  operationKey: string;
  window: 'utc_day' | 'utc_month' | 'rolling_24h';
  metadata?: Record<string, unknown>;
}): Promise<UsageResult> {
  return checkAndIncrementUsage({
    ...params,
    limit: Number.MAX_SAFE_INTEGER,
  });
}

/** Finalize a provisional usage-cap event after provider work completes. */
export async function settleUsage(params: {
  orgId: string;
  action: string;
  operationKey: string;
  quantity: number;
}): Promise<void> {
  const admin = createAdminClient();
  if (params.quantity <= 0) {
    await admin.from('org_usage_events').delete()
      .eq('org_id', params.orgId)
      .eq('action_type', params.action)
      .eq('operation_key', params.operationKey);
    return;
  }
  await admin.from('org_usage_events').update({ quantity: params.quantity })
    .eq('org_id', params.orgId)
    .eq('action_type', params.action)
    .eq('operation_key', params.operationKey);
}

export async function availableCreditBalance(orgId: string): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('org_credit_buckets')
    .select('credits_remaining')
    .eq('org_id', orgId)
    .lte('valid_from', new Date().toISOString())
    .gt('expires_at', new Date().toISOString());
  if (error) {
    if (error.code === '42P01') return 0;
    throw error;
  }
  return (data ?? []).reduce((sum, row) => sum + Number(row.credits_remaining ?? 0), 0);
}

export async function creditBalanceBySource(orgId: string): Promise<CreditBalanceBySource> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('org_credit_buckets')
    .select('source, credits_granted, credits_remaining')
    .eq('org_id', orgId)
    .lte('valid_from', new Date().toISOString())
    .gt('expires_at', new Date().toISOString());
  if (error) {
    if (isMissingRpc(error)) {
      return emptyCreditBalance();
    }
    throw error;
  }

  const balance = emptyCreditBalance();
  for (const row of data ?? []) {
    const granted = Number(row.credits_granted ?? 0);
    const available = Number(row.credits_remaining ?? 0);
    const source = String(row.source ?? '');
    const bucket = source === 'purchased'
      ? balance.purchased
      : source === 'adjustment'
        ? balance.adjustment
        : balance.included;
    bucket.granted += granted;
    bucket.available += available;
    balance.total.granted += granted;
    balance.total.available += available;
  }
  return balance;
}

export function utcMonthWindow(at = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

function usageWindow(kind: 'utc_day' | 'utc_month' | 'rolling_24h'): { start: string; end: string } {
  const now = new Date();
  if (kind === 'rolling_24h') {
    return {
      start: new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
      end: now.toISOString(),
    };
  }
  if (kind === 'utc_month') return utcMonthWindow(now);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function roundCredits(value: number): number {
  return Math.round(value * 100) / 100;
}

function emptyCreditBalance(): CreditBalanceBySource {
  return {
    included: { granted: 0, available: 0 },
    purchased: { granted: 0, available: 0 },
    adjustment: { granted: 0, available: 0 },
    total: { granted: 0, available: 0 },
  };
}

function isMissingRpc(error: { code?: string }): boolean {
  return error.code === '42883' || error.code === 'PGRST202' || error.code === '42P01';
}

export function planCreditPackPrice(planKey: PlanKey): number {
  return PLANS[planKey].creditPackUsdPer1k;
}
