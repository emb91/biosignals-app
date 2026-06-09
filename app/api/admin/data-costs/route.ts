import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { isAdminEmail } from '@/lib/admin-access';
import {
  APIFY_PROFILE_SCRAPE_USD,
  APIFY_COMPANY_SCRAPE_USD,
  APOLLO_CREDITS,
  APOLLO_PLAN,
} from '@/lib/provider-usage';

type UsageByUserRow = {
  user_id: string | null;
  apify_profile_scrapes: number;
  apify_company_scrapes: number;
  apollo_person_enrichments: number;
  apollo_org_enrichments: number;
  phone_reveal_requests: number;
  phone_reveals_received: number;
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

const RECENT_LIMIT = 200;

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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

    const [usageRes, recentRes, firstEventRes, usersRes] = await Promise.all([
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
    ]);

    if (usageRes.error) throw usageRes.error;

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
        };
      })
      .sort((a, b) => b.apifyCostUsd - a.apifyCostUsd || b.apolloCredits - a.apolloCredits);

    const totals = byUser.reduce(
      (acc, u) => {
        acc.apify.profileScrapes += u.apifyProfileScrapes;
        acc.apify.companyScrapes += u.apifyCompanyScrapes;
        acc.apify.costUsd += u.apifyCostUsd;
        acc.apollo.personEnrichments += u.apolloPersonEnrichments;
        acc.apollo.orgEnrichments += u.apolloOrgEnrichments;
        acc.apollo.phoneReveals += u.phoneReveals;
        acc.apollo.credits += u.apolloCredits;
        return acc;
      },
      {
        apify: { profileScrapes: 0, companyScrapes: 0, costUsd: 0 },
        apollo: { personEnrichments: 0, orgEnrichments: 0, phoneReveals: 0, credits: 0 },
      },
    );
    totals.apify.costUsd = Math.round(totals.apify.costUsd * 1_000_000) / 1_000_000;
    totals.apollo.credits = Math.round(totals.apollo.credits * 100) / 100;

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
      },
      apolloPlan: { name: APOLLO_PLAN.name, monthlyUsd: APOLLO_PLAN.monthlyUsd },
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
