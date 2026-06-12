import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { isAdminEmail } from '@/lib/admin-access';
import {
  APIFY_PROFILE_SCRAPE_USD,
  APIFY_COMPANY_SCRAPE_USD,
  APOLLO_CREDITS,
  APOLLO_PLAN,
  ZEROBOUNCE_CREDITS,
  ZEROBOUNCE_PLAN,
  fetchZeroBounceCreditsBalance,
} from '@/lib/provider-usage';

type UsageByUserRow = {
  user_id: string | null;
  apify_profile_scrapes: number;
  apify_company_scrapes: number;
  apollo_person_enrichments: number;
  apollo_org_enrichments: number;
  phone_reveal_requests: number;
  phone_reveals_received: number;
  zerobounce_email_validations: number;
  zerobounce_email_finder_successes: number;
};

type ProviderEventRow = {
  id: string;
  user_id: string | null;
  provider: string;
  event_type: string;
  quantity: number;
  unit_cost_usd: number | null;
  cost_usd: number | null;
  credit_units: number | null;
  created_at: string;
};

type AcquisitionUsageEventRow = {
  event_type: string;
  quantity: number;
  internal_credit_units: number | null;
  created_at: string;
};

const RECENT_LIMIT = 200;
const APOLLO_ACQUISITION_EVENT_TYPES = [
  'apollo_company_search_result',
  'apollo_company_enrichment',
  'apollo_people_search_result',
  'apollo_person_enrichment',
] as const;

function num(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function currentCalendarMonthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function currentBillingPeriodStart(now: Date, anchorDay: number, anchorUtcHour: number): string {
  const safeAnchor = Math.min(28, Math.max(1, Math.floor(anchorDay || 1)));
  const safeHour = Math.min(23, Math.max(0, Math.floor(anchorUtcHour || 0)));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), safeAnchor, safeHour));
  if (now.getTime() < start.getTime()) {
    start.setUTCMonth(start.getUTCMonth() - 1);
  }
  return start.toISOString();
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isAdminEmail(user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const admin = createAdminClient();

    const now = new Date();
    const periodStart = currentBillingPeriodStart(
      now,
      APOLLO_PLAN.billingCycleAnchorDay,
      APOLLO_PLAN.billingCycleAnchorUtcHour,
    );
    const baselineRecordedAt = APOLLO_PLAN.baselineRecordedAt;
    const baselineApplies =
      baselineRecordedAt != null &&
      new Date(baselineRecordedAt).getTime() >= new Date(periodStart).getTime() &&
      new Date(baselineRecordedAt).getTime() <= now.getTime();
    const meteredSince = baselineApplies ? baselineRecordedAt : periodStart;
    const zeroBouncePeriodStart = currentCalendarMonthStart(now);

    const [usageRes, recentRes, firstEventRes, usersRes, monthlyApolloRes, monthlyAcquisitionApolloRes, monthlyZeroBounceRes, liveZeroBounceCredits] =
      await Promise.all([
        admin.from('data_provider_usage_by_user').select('*'),
        admin
          .from('provider_usage_events')
          .select('id, user_id, provider, event_type, quantity, unit_cost_usd, cost_usd, credit_units, created_at')
          .order('created_at', { ascending: false })
          .limit(RECENT_LIMIT),
        admin
          .from('provider_usage_events')
          .select('created_at')
          .order('created_at', { ascending: true })
          .limit(1),
        admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
        admin
          .from('provider_usage_events')
          .select('credit_units')
          .eq('provider', 'apollo')
          .gte('created_at', meteredSince),
        admin
          .from('data_acquisition_usage_events')
          .select('event_type, quantity, internal_credit_units, created_at')
          .in('event_type', [...APOLLO_ACQUISITION_EVENT_TYPES])
          .gte('created_at', meteredSince),
        admin
          .from('provider_usage_events')
          .select('event_type, quantity, credit_units')
          .eq('provider', 'zerobounce')
          .gte('created_at', zeroBouncePeriodStart),
        fetchZeroBounceCreditsBalance(),
      ]);

    if (usageRes.error) throw usageRes.error;
    if (recentRes.error) throw recentRes.error;
    if (firstEventRes.error) throw firstEventRes.error;
    if (monthlyApolloRes.error) throw monthlyApolloRes.error;
    if (monthlyAcquisitionApolloRes.error) throw monthlyAcquisitionApolloRes.error;
    if (monthlyZeroBounceRes.error) throw monthlyZeroBounceRes.error;

    const zeroBounceRows = (monthlyZeroBounceRes.data ?? []) as Array<{
      event_type: string;
      quantity: number;
      credit_units: number | null;
    }>;
    const trackedZeroBounceCredits = zeroBounceRows.reduce((sum, row) => sum + num(row.credit_units), 0);
    const trackedZeroBounceValidations = zeroBounceRows.reduce((sum, row) => {
      if (row.event_type === 'zerobounce_email_validate') return sum + num(row.quantity);
      return sum;
    }, 0);
    const trackedZeroBounceFinderSuccesses = zeroBounceRows.reduce((sum, row) => {
      if (row.event_type === 'zerobounce_email_finder') return sum + num(row.quantity);
      return sum;
    }, 0);

    const directApolloCredits = (monthlyApolloRes.data ?? []).reduce(
      (sum, row) => sum + num(row.credit_units),
      0,
    );
    const acquisitionRows = (monthlyAcquisitionApolloRes.data ?? []) as AcquisitionUsageEventRow[];
    const acquisitionApolloCredits = acquisitionRows.reduce(
      (sum, row) => sum + num(row.internal_credit_units),
      0,
    );
    const acquisitionSearchCredits = acquisitionRows.reduce((sum, row) => {
      if (row.event_type === 'apollo_company_search_result' || row.event_type === 'apollo_people_search_result') {
        return sum + num(row.internal_credit_units);
      }
      return sum;
    }, 0);
    const acquisitionEnrichmentCredits = acquisitionApolloCredits - acquisitionSearchCredits;
    const baselineCredits = baselineApplies ? APOLLO_PLAN.currentPeriodBaselineCredits : 0;
    const currentPeriodApolloCredits = baselineCredits + directApolloCredits + acquisitionApolloCredits;

    const emailById = new Map<string, string>();
    for (const u of usersRes.data?.users ?? []) {
      if (u.id && u.email) emailById.set(u.id, u.email);
    }

    const usageRows = (usageRes.data ?? []) as UsageByUserRow[];

    const byUser = usageRows
      .map((row) => {
        const apifyProfileScrapes = num(row.apify_profile_scrapes);
        const apifyCompanyScrapes = num(row.apify_company_scrapes);
        const apolloPersonEnrichments = num(row.apollo_person_enrichments);
        const apolloOrgEnrichments = num(row.apollo_org_enrichments);
        const phoneReveals = num(row.phone_reveals_received);

        const apifyCostUsd =
          apifyProfileScrapes * APIFY_PROFILE_SCRAPE_USD + apifyCompanyScrapes * APIFY_COMPANY_SCRAPE_USD;
        const apolloCredits =
          apolloPersonEnrichments * APOLLO_CREDITS.person_enrichment +
          apolloOrgEnrichments * APOLLO_CREDITS.company_enrichment +
          phoneReveals * APOLLO_CREDITS.phone_reveal;
        const zerobounceValidations = num(row.zerobounce_email_validations);
        const zerobounceFinderSuccesses = num(row.zerobounce_email_finder_successes);
        const zerobounceCredits =
          zerobounceValidations * ZEROBOUNCE_CREDITS.email_validate +
          zerobounceFinderSuccesses * ZEROBOUNCE_CREDITS.email_finder;

        return {
          userId: row.user_id,
          email: (row.user_id && emailById.get(row.user_id)) || 'unknown',
          apifyProfileScrapes,
          apifyCompanyScrapes,
          apifyCostUsd: Math.round(apifyCostUsd * 1_000_000) / 1_000_000,
          apolloPersonEnrichments,
          apolloOrgEnrichments,
          phoneReveals,
          apolloCredits: Math.round(apolloCredits * 100) / 100,
          zerobounceValidations,
          zerobounceFinderSuccesses,
          zerobounceCredits: Math.round(zerobounceCredits * 100) / 100,
        };
      })
      .sort((a, b) => b.apifyCostUsd - a.apifyCostUsd || b.apolloCredits - a.apolloCredits || b.zerobounceCredits - a.zerobounceCredits);

    const totals = byUser.reduce(
      (acc, u) => {
        acc.apify.profileScrapes += u.apifyProfileScrapes;
        acc.apify.companyScrapes += u.apifyCompanyScrapes;
        acc.apify.costUsd += u.apifyCostUsd;
        acc.apollo.personEnrichments += u.apolloPersonEnrichments;
        acc.apollo.orgEnrichments += u.apolloOrgEnrichments;
        acc.apollo.phoneReveals += u.phoneReveals;
        acc.apollo.credits += u.apolloCredits;
        acc.zerobounce.validations += u.zerobounceValidations;
        acc.zerobounce.finderSuccesses += u.zerobounceFinderSuccesses;
        acc.zerobounce.credits += u.zerobounceCredits;
        return acc;
      },
      {
        apify: { profileScrapes: 0, companyScrapes: 0, costUsd: 0 },
        apollo: { personEnrichments: 0, orgEnrichments: 0, phoneReveals: 0, credits: 0 },
        zerobounce: { validations: 0, finderSuccesses: 0, credits: 0 },
      },
    );
    totals.apify.costUsd = Math.round(totals.apify.costUsd * 1_000_000) / 1_000_000;
    totals.apollo.credits = Math.round(totals.apollo.credits * 100) / 100;
    totals.zerobounce.credits = Math.round(totals.zerobounce.credits * 100) / 100;

    const recentRows = (recentRes.data ?? []) as ProviderEventRow[];
    const recent = recentRows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      userEmail: (row.user_id && emailById.get(row.user_id)) || 'unknown',
      provider: row.provider,
      eventType: row.event_type,
      quantity: num(row.quantity),
      costUsd: row.cost_usd,
      creditUnits: row.credit_units,
    }));

    const meteringSince = firstEventRes.data?.[0]?.created_at ?? null;

    return NextResponse.json({
      ok: true,
      pricing: {
        apifyProfileUsd: APIFY_PROFILE_SCRAPE_USD,
        apifyCompanyUsd: APIFY_COMPANY_SCRAPE_USD,
        apolloCredits: {
          person: APOLLO_CREDITS.person_enrichment,
          company: APOLLO_CREDITS.company_enrichment,
          phoneReveal: APOLLO_CREDITS.phone_reveal,
        },
        zerobounceCredits: {
          validate: ZEROBOUNCE_CREDITS.email_validate,
          finder: ZEROBOUNCE_CREDITS.email_finder,
        },
      },
      apolloPlan: {
        name: APOLLO_PLAN.name,
        monthlyUsd: APOLLO_PLAN.monthlyUsd,
        monthlyCredits: APOLLO_PLAN.monthlyCredits,
        currentPeriodCredits: Math.round(currentPeriodApolloCredits * 100) / 100,
        currentMonthCredits: Math.round(currentPeriodApolloCredits * 100) / 100,
        directCredits: Math.round(directApolloCredits * 100) / 100,
        acquisitionCredits: Math.round(acquisitionApolloCredits * 100) / 100,
        acquisitionSearchCredits: Math.round(acquisitionSearchCredits * 100) / 100,
        acquisitionEnrichmentCredits: Math.round(acquisitionEnrichmentCredits * 100) / 100,
        baselineCredits: Math.round(baselineCredits * 100) / 100,
        baselineRecordedAt: baselineApplies ? baselineRecordedAt : null,
        periodStart,
        monthStart: periodStart,
        billingCycleAnchorDay: APOLLO_PLAN.billingCycleAnchorDay,
        billingCycleAnchorUtcHour: APOLLO_PLAN.billingCycleAnchorUtcHour,
      },
      zerobouncePlan: {
        name: ZEROBOUNCE_PLAN.name,
        liveCreditsBalance: liveZeroBounceCredits,
        trackedPeriodCredits: Math.round(trackedZeroBounceCredits * 100) / 100,
        trackedValidations: trackedZeroBounceValidations,
        trackedFinderSuccesses: trackedZeroBounceFinderSuccesses,
        periodStart: zeroBouncePeriodStart,
      },
      totals: { ...totals, users: byUser.length },
      byUser,
      recent,
      meteringSince,
    });
  } catch (error) {
    console.error('[admin/data-costs] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
