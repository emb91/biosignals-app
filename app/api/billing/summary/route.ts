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
import { canBuyCreditPacksWithStripe } from '@/lib/billing/checkout-eligibility';
import { isBillingPortalConfigured } from '@/lib/billing/portal-config';

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
  const usageStart = entitlements.currentPeriodStart ?? monthStart;
  const allowanceMultiplier = entitlements.billingInterval === 'annual' ? 12 : 1;

  const [
    membersResult,
    creditBalanceResult,
    bucketsResult,
    monitoredContactsResult,
    waitlistedContactsResult,
    activeIcpsResult,
    periodUsageResult,
    orgBillingResult,
    subscriptionResult,
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
    admin.from('icps').select('id', { count: 'exact', head: true })
      .eq('org_id', ctx.orgId),
    admin.from('org_usage_events').select('action_type, quantity')
      .eq('org_id', ctx.orgId).gte('occurred_at', usageStart),
    admin.from('organizations').select('stripe_customer_id').eq('id', ctx.orgId)
      .maybeSingle<{ stripe_customer_id: string | null }>(),
    admin.from('org_subscriptions')
      .select('stripe_subscription_id, status, plan_key')
      .eq('org_id', ctx.orgId)
      .maybeSingle<{ stripe_subscription_id: string | null; status: string | null; plan_key: string | null }>(),
  ]);

  const monthly = usageMap(periodUsageResult.data);
  const userIds = (membersResult.data ?? []).map((row) => row.user_id as string);
  const storedContactsResult = userIds.length
    ? await admin.from('user_contacts').select('id', { count: 'exact', head: true })
      .in('user_id', userIds).is('archived_at', null)
    : { count: 0 };
  const selectedPlan = entitlements.planKey === 'free' ? null : PLANS[entitlements.planKey];
  const stripeAccount = {
    stripeCustomerId: orgBillingResult.data?.stripe_customer_id,
    stripeSubscriptionId: subscriptionResult.data?.stripe_subscription_id,
    subscriptionStatus: subscriptionResult.data?.status,
    planKey: subscriptionResult.data?.plan_key,
  };
  const stripeBackedPaid = canBuyCreditPacksWithStripe(stripeAccount);
  const packConfigured = selectedPlan ? Boolean(creditPackPriceId(selectedPlan.key)) : false;
  const packAvailable = Boolean(selectedPlan && packConfigured && stripeBackedPaid);
  const available =
    isBillingConfigured() &&
    Object.values(PLANS).every((plan) => Boolean(planPriceId(plan)));
  const creditBalance = entitlements.complimentary
    ? complimentaryCreditBalance(entitlements.creditsGranted, monthly)
    : creditBalanceResult ?? {
      included: { granted: entitlements.creditsGranted, available: entitlements.creditsAvailable },
      purchased: { granted: 0, available: 0 },
      adjustment: { granted: 0, available: 0 },
      total: { granted: entitlements.creditsGranted, available: entitlements.creditsAvailable },
    };
  const annualPace = annualPaceSummary({
    planKey: entitlements.planKey,
    billingInterval: entitlements.billingInterval,
    includedGranted: creditBalance.included.granted,
    includedAvailable: creditBalance.included.available,
  });

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
    billing: {
      stripeBacked: stripeBackedPaid,
      canOpenPortal: Boolean(
        isBillingConfigured() &&
          isBillingPortalConfigured() &&
          orgBillingResult.data?.stripe_customer_id &&
          !entitlements.unlimited,
      ),
      creditPackConfigured: packConfigured,
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
    annualPace,
    capacity: {
      storedContacts: storedContactsResult.count ?? 0,
      storedContactsCap: entitlements.caps.activeMonitoredContacts,
      activeMonitoredContacts: monitoredContactsResult.count ?? 0,
      activeMonitoredContactsCap: entitlements.caps.activeMonitoredContacts,
      monitoringCadenceDays: entitlements.caps.monitoringCadenceDays,
    },
    activeIcps: {
      used: activeIcpsResult.count ?? 0,
      limit: entitlements.caps.activeIcps,
    },
    triage: {
      used: monthly.import_triage ?? 0,
      limit: entitlements.caps.importedRecordsTriagedMonthly,
    },
    importedEnrichments: {
      used: monthly.imported_enrichment ?? 0,
      included: entitlements.caps.importedEnrichmentsIncludedMonthly * allowanceMultiplier,
      hardCap: entitlements.caps.importedEnrichmentsHardCapMonthly * allowanceMultiplier,
    },
    activeLeads: {
      used: monitoredContactsResult.count ?? 0,
      cap: entitlements.caps.activeMonitoredContacts,
      waitlisted: waitlistedContactsResult.count ?? 0,
      cadenceDays: entitlements.caps.monitoringCadenceDays,
    },
    netNewLeads: {
      used: monthly.net_new_enriched_lead ?? 0,
      limit: entitlements.caps.netNewEnrichedLeadsMonthly * allowanceMultiplier,
    },
    sequences: {
      used: monthly.outreach_sequence ?? 0,
      limit: entitlements.caps.outreachSequencesIncludedMonthly * allowanceMultiplier,
      emailSteps: (monthly.outreach_sequence ?? 0) * 4,
      linkedinAdds: monthly.outreach_sequence ?? 0,
      linkedinMessages: (monthly.outreach_sequence ?? 0) * 2,
    },
    phoneReveals: {
      used: monthly.phone_reveal ?? 0,
      limit: entitlements.caps.phoneRevealsIncludedMonthly * allowanceMultiplier,
    },
    emailFinder: {
      used: monthly.email_finder ?? 0,
      limit: entitlements.caps.emailFinderRequestsIncludedMonthly * allowanceMultiplier,
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
        activeIcpCap: plan.caps.activeIcps,
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

function annualPaceSummary(params: {
  planKey: string;
  billingInterval: string;
  includedGranted: number;
  includedAvailable: number;
}) {
  if (params.billingInterval !== 'annual' || !(params.planKey === 'starter' || params.planKey === 'growth')) {
    return null;
  }
  const plan = PLANS[params.planKey];
  const usedCredits = Math.max(0, params.includedGranted - params.includedAvailable);
  const monthsEquivalent = plan.monthlyCredits > 0
    ? Math.round((usedCredits / plan.monthlyCredits) * 10) / 10
    : 0;
  const level =
    monthsEquivalent >= 3 ? 'strong'
      : monthsEquivalent >= 1 ? 'heads_up'
        : 'normal';
  return {
    monthlyCredits: plan.monthlyCredits,
    annualCredits: plan.annualCredits,
    usedCredits,
    monthsEquivalent,
    level,
    message: `You've used ${usedCredits.toLocaleString()} of ${plan.annualCredits.toLocaleString()} annual credits. That's about ${monthsEquivalent.toLocaleString()} months of ${plan.name} usage. Your credits are available until renewal, but active ICP capacity and active lead capacity still apply.`,
  };
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
) {
  const used =
    (monthly.imported_enrichment ?? 0) * ACTION_CREDITS.imported_contact_company_enrichment +
    (monthly.net_new_enriched_lead ?? 0) * ACTION_CREDITS.net_new_enriched_lead +
    (monthly.email_finder ?? 0) * ACTION_CREDITS.email_finder +
    (monthly.phone_reveal ?? 0) * ACTION_CREDITS.phone_reveal +
    (monthly.outreach_sequence ?? 0) * ACTION_CREDITS.outreach_sequence;
  const available = Math.max(0, granted - used);
  return {
    included: { granted, available },
    purchased: { granted: 0, available: 0 },
    adjustment: { granted: 0, available: 0 },
    total: { granted, available },
  };
}
