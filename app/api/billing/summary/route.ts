import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/org-context';
import { createAdminClient } from '@/lib/supabase-admin';
import { getOrgEntitlements } from '@/lib/billing/entitlements';
import { isBillingConfigured } from '@/lib/billing/stripe';
import {
  CREDIT_PACK_SIZE,
  PLANS,
  creditPackPriceId,
  planAnnualPriceId,
  planPriceId,
} from '@/lib/billing/config';

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
    memberCountResult,
    bucketsResult,
    monitoredContactsResult,
    waitlistedContactsResult,
    monthlyUsageResult,
    dailyUsageResult,
    rollingUsageResult,
  ] = await Promise.all([
    admin.from('org_members').select('user_id', { count: 'exact', head: true }).eq('org_id', ctx.orgId),
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
  const selectedPlan = entitlements.planKey === 'free' ? null : PLANS[entitlements.planKey];
  const packAvailable = selectedPlan ? Boolean(creditPackPriceId(selectedPlan.key)) : false;
  const available =
    isBillingConfigured() &&
    Object.values(PLANS).every((plan) => Boolean(planPriceId(plan)));

  return NextResponse.json({
    available,
    role: ctx.role,
    unlimited: entitlements.unlimited,
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
      used: memberCountResult.count ?? 1,
      included: entitlements.seatLimit,
    },
    credits: {
      available: entitlements.creditsAvailable,
      granted: entitlements.creditsGranted,
      buckets: bucketsResult.data ?? [],
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
