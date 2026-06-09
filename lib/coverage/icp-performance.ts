/**
 * Per-ICP deal performance — the "bottom-up" half of the Coverage page.
 *
 * Maps each synced HubSpot deal to an ICP and aggregates real outcomes per ICP:
 * active deal count, open pipeline £, won/lost counts, win rate, avg ACV (won),
 * avg sales-cycle length, and a blended **throughput** rank (win-rate-weighted
 * won revenue per day) that surfaces the genuinely best-performing ICP rather
 * than the one with the biggest single deal.
 *
 * Deal → ICP resolution (two paths, A preferred):
 *   A. crm_deal_company_links.arcova_company_id → user_companies.matched_icp_id
 *   B. crm_deal_contact_links.arcova_contact_id → contacts.company_id → matched_icp_id
 *
 * Cycle length uses crm_deal_stage_history (first-stage entered_at → closedwon
 * entered_at); falls back to created_date → close_date when history is absent
 * (deals that closed before stage-history capture began). Pure aggregation over
 * data we already store — no external calls.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type IcpPerformance = {
  active_deal_count: number;
  pipeline_usd: number;
  won_count: number;
  lost_count: number;
  win_rate: number | null; // won / (won + lost)
  won_usd: number;
  avg_acv: number | null; // mean amount of won deals
  avg_cycle_days: number | null; // mean (first-stage → closedwon)
  throughput: number | null; // win-rate-weighted won revenue per day
  confidence: 'high' | 'medium' | 'low'; // by closed-deal sample size
};

type DealRow = {
  hubspot_deal_id: string;
  deal_stage: string | null;
  amount: number | null;
  close_date: string | null;
  created_date: string | null;
};

function normStage(value?: string | null): string {
  return (value ?? '').trim().toLowerCase();
}
function isWon(stage?: string | null): boolean {
  return normStage(stage) === 'closedwon';
}
function isLost(stage?: string | null): boolean {
  return normStage(stage) === 'closedlost';
}
function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const t0 = new Date(a).getTime();
  const t1 = new Date(b).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return null;
  return (t1 - t0) / 86_400_000;
}
function mean(values: number[]): number | null {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

function emptyPerformance(): IcpPerformance {
  return {
    active_deal_count: 0,
    pipeline_usd: 0,
    won_count: 0,
    lost_count: 0,
    win_rate: null,
    won_usd: 0,
    avg_acv: null,
    avg_cycle_days: null,
    throughput: null,
    confidence: 'low',
  };
}

/**
 * Compute per-ICP deal performance for a user. Returns a Map keyed by icp_id;
 * ICPs with no mapped deals simply won't appear (caller defaults to null/empty).
 */
export async function computeIcpPerformanceByIcp(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
): Promise<Map<string, IcpPerformance>> {
  const result = new Map<string, IcpPerformance>();

  const { data: dealRows } = await supabase
    .from('crm_deals')
    .select('hubspot_deal_id, deal_stage, amount, close_date, created_date')
    .eq('user_id', userId);
  const deals = (dealRows ?? []) as DealRow[];
  if (deals.length === 0) return result;

  // Deal → ICP resolution inputs.
  const [companyLinksRes, contactLinksRes, userCompaniesRes] = await Promise.all([
    supabase
      .from('crm_deal_company_links')
      .select('hubspot_deal_id, arcova_company_id')
      .eq('user_id', userId)
      .not('arcova_company_id', 'is', null),
    supabase
      .from('crm_deal_contact_links')
      .select('hubspot_deal_id, arcova_contact_id')
      .eq('user_id', userId)
      .not('arcova_contact_id', 'is', null),
    supabase
      .from('user_companies')
      .select('company_id, matched_icp_id')
      .eq('user_id', userId)
      .not('matched_icp_id', 'is', null),
  ]);

  const companyToIcp = new Map<string, string>();
  for (const r of (userCompaniesRes.data ?? []) as Array<{ company_id: string; matched_icp_id: string }>) {
    companyToIcp.set(r.company_id, r.matched_icp_id);
  }

  // Path A: deal → company → icp
  const dealToIcp = new Map<string, string>();
  for (const r of (companyLinksRes.data ?? []) as Array<{ hubspot_deal_id: string; arcova_company_id: string }>) {
    if (dealToIcp.has(r.hubspot_deal_id)) continue;
    const icp = companyToIcp.get(r.arcova_company_id);
    if (icp) dealToIcp.set(r.hubspot_deal_id, icp);
  }

  // Path B (fallback): deal → contact → contact.company → icp, only for deals A missed.
  const contactLinks = (contactLinksRes.data ?? []) as Array<{ hubspot_deal_id: string; arcova_contact_id: string }>;
  const unresolvedContactIds = [
    ...new Set(
      contactLinks
        .filter((r) => !dealToIcp.has(r.hubspot_deal_id))
        .map((r) => r.arcova_contact_id),
    ),
  ];
  if (unresolvedContactIds.length > 0) {
    const { data: contactRows } = await supabase
      .from('contacts')
      .select('id, company_id')
      .eq('user_id', userId)
      .in('id', unresolvedContactIds);
    const contactToCompany = new Map<string, string>();
    for (const r of (contactRows ?? []) as Array<{ id: string; company_id: string | null }>) {
      if (r.company_id) contactToCompany.set(r.id, r.company_id);
    }
    for (const r of contactLinks) {
      if (dealToIcp.has(r.hubspot_deal_id)) continue;
      const companyId = contactToCompany.get(r.arcova_contact_id);
      const icp = companyId ? companyToIcp.get(companyId) : undefined;
      if (icp) dealToIcp.set(r.hubspot_deal_id, icp);
    }
  }

  // Stage history for cycle length: per deal, first entered_at + closedwon entered_at.
  const mappedDealIds = deals.map((d) => d.hubspot_deal_id).filter((id) => dealToIcp.has(id));
  const firstStageAt = new Map<string, string>();
  const wonStageAt = new Map<string, string>();
  if (mappedDealIds.length > 0) {
    const { data: stageRows } = await supabase
      .from('crm_deal_stage_history')
      .select('hubspot_deal_id, stage, entered_at')
      .eq('user_id', userId)
      .in('hubspot_deal_id', mappedDealIds);
    for (const r of (stageRows ?? []) as Array<{ hubspot_deal_id: string; stage: string; entered_at: string }>) {
      const cur = firstStageAt.get(r.hubspot_deal_id);
      if (!cur || r.entered_at < cur) firstStageAt.set(r.hubspot_deal_id, r.entered_at);
      if (isWon(r.stage)) wonStageAt.set(r.hubspot_deal_id, r.entered_at);
    }
  }

  // Aggregate.
  type Agg = {
    active: number;
    pipeline: number;
    won: number;
    lost: number;
    wonUsd: number;
    acv: number[];
    cycles: number[];
  };
  const agg = new Map<string, Agg>();
  const get = (icp: string): Agg => {
    let a = agg.get(icp);
    if (!a) {
      a = { active: 0, pipeline: 0, won: 0, lost: 0, wonUsd: 0, acv: [], cycles: [] };
      agg.set(icp, a);
    }
    return a;
  };

  for (const deal of deals) {
    const icp = dealToIcp.get(deal.hubspot_deal_id);
    if (!icp) continue;
    const a = get(icp);
    const amount = typeof deal.amount === 'number' && Number.isFinite(deal.amount) ? deal.amount : 0;
    if (isWon(deal.deal_stage)) {
      a.won += 1;
      a.wonUsd += amount;
      if (amount > 0) a.acv.push(amount);
      // cycle: stage-history first→won, else created→close
      const cycle =
        daysBetween(firstStageAt.get(deal.hubspot_deal_id) ?? null, wonStageAt.get(deal.hubspot_deal_id) ?? null) ??
        daysBetween(deal.created_date, deal.close_date);
      if (cycle != null && cycle >= 0) a.cycles.push(cycle);
    } else if (isLost(deal.deal_stage)) {
      a.lost += 1;
    } else {
      a.active += 1;
      a.pipeline += amount;
    }
  }

  for (const [icp, a] of agg) {
    const closed = a.won + a.lost;
    const win_rate = closed > 0 ? a.won / closed : null;
    const avg_acv = mean(a.acv);
    const avg_cycle_days = mean(a.cycles);
    // Throughput: win-rate-weighted won revenue per day. Captures conversion,
    // deal size×volume (won_usd), and velocity in one rank-able number.
    const throughput =
      win_rate != null && avg_cycle_days != null && avg_cycle_days > 0
        ? (win_rate * a.wonUsd) / avg_cycle_days
        : null;
    const confidence: IcpPerformance['confidence'] = closed >= 10 ? 'high' : closed >= 4 ? 'medium' : 'low';
    result.set(icp, {
      active_deal_count: a.active,
      pipeline_usd: a.pipeline,
      won_count: a.won,
      lost_count: a.lost,
      win_rate,
      won_usd: a.wonUsd,
      avg_acv,
      avg_cycle_days,
      throughput,
      confidence,
    });
  }

  return result;
}

export { emptyPerformance };
