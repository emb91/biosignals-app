import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getOrgContext } from '@/lib/org-context';
import { getOrgEntitlements } from '@/lib/billing/entitlements';
import { ACTION_CREDITS, FREE_TIER, PLANS, isPlanKey, type UsageCaps } from '@/lib/billing/config';
import {
  findPendingTriageRowForOrg,
  listPendingTriageRowsForOrg,
  updatePendingTriageRowForOrg,
  type PendingTriagePatch,
  type RawTriageRow,
  type TriageGroup,
} from '@/lib/triage-pending-rows';

type TriageSummary = {
  total: number;
  high: number;
  medium: number;
  low: number;
  untriaged: number;
  scheduledHighFit: number;
  monthlyThroughput: number;
};

const TRIAGE_ORDER: Record<TriageGroup | 'untriaged', number> = {
  high: 0,
  medium: 1,
  low: 2,
  untriaged: 3,
};

// Fallback only — actual monthly enrichment throughput comes from the org's
// shared lead-enrichment credit pool, not a fixed guess.
const MONTHLY_HIGH_FIT_THROUGHPUT = 300;

function isTriageGroup(value: unknown): value is TriageGroup {
  return value === 'high' || value === 'medium' || value === 'low';
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function effectiveTriage(row: Pick<RawTriageRow, 'triage_group' | 'triage_override_group'>): TriageGroup | null {
  return row.triage_override_group ?? row.triage_group ?? null;
}

function apparentFitScore(row: RawTriageRow): number {
  const raw = row.raw_data ?? {};
  const title = [
    row.raw_data?.job_title,
    row.raw_data?.title,
    row.raw_data?.seniority,
    row.raw_data?.department,
  ].map(asString).filter(Boolean).join(' ').toLowerCase();
  const company = [
    row.company_name,
    raw.company_domain,
    raw.company_industry,
    raw.company_sub_industry,
  ].map(asString).filter(Boolean).join(' ').toLowerCase();

  let score = 0;
  if (/\b(chief|cxo|vp|vice president|head|director|founder|co-?founder|owner|president)\b/.test(title)) score += 40;
  if (/\b(cmc|manufactur|clinical|regulatory|quality|r&d|research|development|business development|procurement)\b/.test(title)) score += 35;
  if (/\b(bio|pharma|therapeutics|life science|clinical|cro|cdmo|biotech|medical)\b/.test(company)) score += 20;
  if (row.email) score += 3;
  if (row.linkedin_url) score += 2;
  return score;
}

function addMonths(date: Date, months: number): Date {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function expectedEnrichmentDate(highFitIndex: number | null, monthlyThroughput: number): string | null {
  if (highFitIndex == null) return null;
  const perMonth = monthlyThroughput > 0 ? monthlyThroughput : MONTHLY_HIGH_FIT_THROUGHPUT;
  const monthOffset = Math.floor(highFitIndex / perMonth) + 1;
  return addMonths(new Date(), monthOffset).toISOString();
}

export async function GET() {
  const context = await getOrgContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const admin = createAdminClient();
    const monthlyThroughput = await resolveMonthlyThroughput(admin, context.orgId);
    const { data, error } = await listPendingTriageRowsForOrg(admin, context.orgId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const sorted = ((data ?? []) as RawTriageRow[])
      .map((row) => ({
        ...row,
        effective_triage_group: effectiveTriage(row),
        apparent_fit_score: apparentFitScore(row),
      }))
      .sort((a, b) => {
        const aGroup = a.effective_triage_group ?? 'untriaged';
        const bGroup = b.effective_triage_group ?? 'untriaged';
        const groupDiff = TRIAGE_ORDER[aGroup] - TRIAGE_ORDER[bGroup];
        if (groupDiff !== 0) return groupDiff;
        const pinnedDiff = Number(Boolean(b.pinned_at)) - Number(Boolean(a.pinned_at));
        if (pinnedDiff !== 0) return pinnedDiff;
        const fitDiff = b.apparent_fit_score - a.apparent_fit_score;
        if (fitDiff !== 0) return fitDiff;
        const aTime = a.triage_scored_at || a.uploaded_at || '';
        const bTime = b.triage_scored_at || b.uploaded_at || '';
        return bTime.localeCompare(aTime);
      });

    let highFitIndex = 0;
    const rows = sorted.map((row) => {
      const isHigh = row.effective_triage_group === 'high';
      const queueIndex = isHigh ? highFitIndex++ : null;
      const raw = row.raw_data ?? {};
      const fallbackName = [asString(raw.first_name), asString(raw.last_name)].filter(Boolean).join(' ');
      const name = row.full_name ?? asString(raw.full_name) ?? fallbackName;
      return {
        id: row.id,
        name: name || 'Unnamed contact',
        company: row.company_name ?? asString(raw.company_name),
        title: asString(raw.job_title) ?? asString(raw.title),
        email: row.email ?? asString(raw.email),
        linkedin_url: row.linkedin_url ?? asString(raw.linkedin_url),
        company_domain: asString(raw.company_domain),
        company_linkedin_url: asString(raw.company_linkedin_url),
        location: asString(raw.location),
        status: row.status,
        triage_group: row.triage_group,
        triage_override_group: row.triage_override_group ?? null,
        effective_triage_group: row.effective_triage_group,
        triage_version: row.triage_version,
        triage_scored_at: row.triage_scored_at,
        triage_overridden_by: row.triage_overridden_by ?? null,
        triage_overridden_at: row.triage_overridden_at ?? null,
        pinned_at: row.pinned_at ?? null,
        expected_enrichment_date: expectedEnrichmentDate(queueIndex, monthlyThroughput),
        queue_position: queueIndex == null ? null : queueIndex + 1,
        apparent_fit_score: row.apparent_fit_score,
        raw_data: raw,
      };
    });

    const summary = rows.reduce<TriageSummary>(
      (acc, row) => {
        acc.total += 1;
        const group = row.effective_triage_group ?? 'untriaged';
        acc[group] += 1;
        if (row.expected_enrichment_date) acc.scheduledHighFit += 1;
        return acc;
      },
      { total: 0, high: 0, medium: 0, low: 0, untriaged: 0, scheduledHighFit: 0, monthlyThroughput },
    );

    return NextResponse.json({ data: rows, summary });
  } catch (error) {
    console.error('[triage GET] failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function resolveMonthlyThroughput(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<number> {
  const entitlements = await getOrgEntitlements(orgId).catch(() => null);
  if (entitlements) return contactCompanyEquivalentThroughput(entitlements.caps);

  const { data: subscription } = await admin
    .from('org_subscriptions')
    .select('status, plan_key')
    .eq('org_id', orgId)
    .maybeSingle<{ status: string | null; plan_key: string | null }>();
  const planKey = subscription?.plan_key;
  const live =
    subscription &&
    ['active', 'trialing', 'past_due'].includes(subscription.status ?? '') &&
    isPlanKey(planKey);
  if (live && isPlanKey(planKey)) return contactCompanyEquivalentThroughput(PLANS[planKey].caps);
  return contactCompanyEquivalentThroughput(FREE_TIER.caps);
}

function contactCompanyEquivalentThroughput(caps: UsageCaps): number {
  return Math.floor(
    caps.leadEnrichmentCreditsIncludedMonthly / ACTION_CREDITS.imported_contact_company_enrichment,
  );
}

export async function PATCH(request: Request) {
  const context = await getOrgContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { id?: unknown; triageGroup?: unknown; pinNextBatch?: unknown };
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  try {
    const admin = createAdminClient();
    const { data: row, error: lookupError } = await findPendingTriageRowForOrg(admin, context.orgId, id);

    if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });
    if (!row) return NextResponse.json({ error: 'Triage row not found' }, { status: 404 });

    const patch: PendingTriagePatch = {};
    if ('triageGroup' in body) {
      if (body.triageGroup !== null && !isTriageGroup(body.triageGroup)) {
        return NextResponse.json({ error: 'triageGroup must be high, medium, low, or null' }, { status: 400 });
      }
      patch.triage_override_group = body.triageGroup;
      patch.triage_overridden_by = context.user.id;
      patch.triage_overridden_at = new Date().toISOString();
    }
    if (body.pinNextBatch === true) {
      patch.pinned_at = new Date().toISOString();
      patch.pinned_by = context.user.id;
      if (!('triage_override_group' in patch)) patch.triage_override_group = 'high';
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No supported update provided' }, { status: 400 });
    }

    const { error } = await updatePendingTriageRowForOrg(admin, context.orgId, id, patch);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[triage PATCH] failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
