import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/org-context';
import { createAdminClient } from '@/lib/supabase-admin';
import { getOrgEntitlements } from '@/lib/billing/entitlements';
import { isBillingConfigured } from '@/lib/billing/stripe';
import {
  ACTION_CREDITS,
  CREDIT_PACK_SIZE,
  PLANS,
  creditPackPriceId,
  planAnnualPriceId,
  planPriceId,
} from '@/lib/billing/config';
import { creditBalanceBySource } from '@/lib/billing/credits';

export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const entitlements = await getOrgEntitlements(ctx.orgId);
  const now = new Date().toISOString();
  const monthStart = new Date(Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    1,
  )).toISOString();
  const dayStart = new Date(Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  )).toISOString();
  const rollingStart = new Date(Date.now() - 86_400_000).toISOString();

  const [
    membersResult,
    creditBalanceResult,
    bucketsResult,
    monitoredContactsResult,
    waitlistedContactsResult,
    monthlyUsageResult,
    dailyUsageResult,
    rollingUsageResult,
  ] = await Promise.all([
    admin.from('org_members').select('user_id').eq('org_id', ctx.orgId),
    creditBalanceBySource(ctx.orgId).catch(() => null),
    admin.from('org_credit_buckets')
      .select('id, source, credits_granted, credits_remaining, valid_from, expires_at')
      .eq('org_id', ctx.orgId).gt('expires_at', now).order('expires_at'),
    admin.from('org_monitored_contacts').select('id', { count: 'exact', head: true })
      .eq('org_id', ctx.orgId).eq('status', 'active'),
    admin.from('org_monitored_contacts').select('id', { count: 'exact', head: true })
      .eq('org_id', ctx.orgId).eq('status', 'waitlisted'),
    admin.from('org_usage_events').select('action_type, quantity')
      .eq('org_id', ctx.orgId).gte('occurred_at', monthStart),
    admin.from('org_usage_events').select('action_type, quantity')
      .eq('org_id', ctx.orgId).gte('occurred_at', dayStart),
    admin.from('org_usage_events').select('action_type, quantity')
      .eq('org_id', ctx.orgId).gte('occurred_at', rollingStart),
  ]);

  const monthly = usageMap(monthlyUsageResult.data);
  const daily = usageMap(dailyUsageResult.data);
  const rolling = usageMap(rollingUsageResult.data);
  const userIds = (membersResult.data ?? []).map((row) => row.user_id as string);
  const storedContactsResult = userIds.length
    ? await admin.from('user_contacts').select('id', { count: 'exact', head: true })
      .in('user_id', userIds).is('archived_at', null)
    : { count: 0 };
  const selectedPlan = entitlements.planKey === 'free' ? null : PLANS[entitlements.planKey];
  const packAvailable = selectedPlan ? Boolean(creditPackPriceId(selectedPlan.key)) : false;
  const available =
    isBillingConfigured() &&
    Object.values(PLANS).every((plan) => Boolean(planPriceId(plan)));
  const creditBalance = entitlements.complimentary
    ? complimentaryCreditBalance(entitlements.creditsGranted, monthly, daily, rolling)
    : creditBalanceResult ?? {
      included: { granted: entitlements.creditsGranted, available: entitlements.creditsAvailable },
      purchased: { granted: 0, available: 0 },
      adjustment: { granted: 0, available: 0 },
      total: { granted: entitlements.creditsGranted, available: entitlements.creditsAvailable },
    };

  return NextResponse.json({
    available,
    role: ctx.role,
    unlimited: entitlements.unlimited,
    complimentary: entitlements.complimentary,
    plan: {
      key: entitlements.planKey,
      name: entitlements.planName,
      status: entitlements.status,
      billingInterval: entitlements.billingInterval,
      renewsAt: entitlements.currentPeriodEnd,
      cancelAtPeriodEnd: entitlements.cancelAtPeriodEnd,
      paymentAccessPaused: entitlements.paymentAccessPaused,
    },
    seats: {
      used: membersResult.data?.length ?? 1,
      included: entitlements.seatLimit,
    },
    credits: {
      available: creditBalance.total.available,
      granted: creditBalance.total.granted,
      includedAvailable: creditBalance.included.available,
      includedGranted: creditBalance.included.granted,
      purchasedAvailable: creditBalance.purchased.available,
      purchasedGranted: creditBalance.purchased.granted,
      adjustmentAvailable: creditBalance.adjustment.available,
      adjustmentGranted: creditBalance.adjustment.granted,
      buckets: bucketsResult.data ?? [],
    },
    capacity: {
      storedContacts: storedContactsResult.count ?? 0,
      storedContactsCap: entitlements.caps.activeMonitoredContacts,
      activeMonitoredContacts: monitoredContactsResult.count ?? 0,
      activeMonitoredContactsCap: entitlements.caps.activeMonitoredContacts,
      monitoringCadenceDays: entitlements.caps.monitoringCadenceDays,
    },
    triage: {
      used: monthly.import_triage ?? 0,
      limit: entitlements.caps.importedRecordsTriagedMonthly,
    },
    importedEnrichments: {
      used: monthly.imported_enrichment ?? 0,
      included: entitlements.caps.importedEnrichmentsIncludedMonthly,
      hardCap: entitlements.caps.importedEnrichmentsHardCapMonthly,
    },
    activeLeads: {
      used: monitoredContactsResult.count ?? 0,
      cap: entitlements.caps.activeMonitoredContacts,
      waitlisted: waitlistedContactsResult.count ?? 0,
      cadenceDays: entitlements.caps.monitoringCadenceDays,
    },
    netNewLeads: {
      used: monthly.net_new_enriched_lead ?? 0,
      limit: entitlements.caps.netNewEnrichedLeadsMonthly,
    },
    sequences: {
      used: rolling.outreach_sequence ?? 0,
      limit: entitlements.caps.sequencesRolling24Hours,
    },
    phoneReveals: {
      used: daily.phone_reveal ?? 0,
      limit: entitlements.caps.phoneRevealsDaily,
    },
    emailFinder: {
      used: daily.email_finder ?? 0,
      limit: entitlements.caps.emailFinderRequestsDaily,
    },
    catalog: {
      plans: Object.values(PLANS).map((plan) => ({
        key: plan.key,
        name: plan.name,
        monthlyUsd: plan.monthlyUsd,
        annualUsd: plan.annualUsd,
        monthlyCredits: plan.monthlyCredits,
        annualCredits: plan.annualCredits,
        activeLeadsCap: plan.caps.activeMonitoredContacts,
        monitoringCadenceDays: plan.caps.monitoringCadenceDays,
        available: Boolean(planPriceId(plan)),
        annualAvailable: Boolean(planAnnualPriceId(plan)),
      })),
      pack: selectedPlan ? {
        credits: CREDIT_PACK_SIZE,
        usd: selectedPlan.creditPackUsdPer1k,
        available: packAvailable,
      } : null,
    },
  });
}

function usageMap(rows: Array<{ action_type: string; quantity: number }> | null): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows ?? []) {
    result[row.action_type] = (result[row.action_type] ?? 0) + Number(row.quantity ?? 0);
  }
  return result;
}

function complimentaryCreditBalance(
  granted: number,
  monthly: Record<string, number>,
  daily: Record<string, number>,
  rolling: Record<string, number>,
) {
  const used =
    (monthly.imported_enrichment ?? 0) * ACTION_CREDITS.imported_contact_company_enrichment +
    (monthly.net_new_enriched_lead ?? 0) * ACTION_CREDITS.net_new_enriched_lead +
    (daily.email_finder ?? 0) * ACTION_CREDITS.email_finder +
    (daily.phone_reveal ?? 0) * ACTION_CREDITS.phone_reveal +
    (rolling.outreach_sequence ?? 0) * ACTION_CREDITS.outreach_sequence;
  const available = Math.max(0, granted - used);
  return {
    included: { granted, available },
    purchased: { granted: 0, available: 0 },
    adjustment: { granted: 0, available: 0 },
    total: { granted, available },
  };
}
