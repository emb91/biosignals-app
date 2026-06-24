/**
 * Per-ICP deal performance + whole-book rollup — the "bottom-up" half of Coverage.
 *
 * Maps each synced HubSpot deal to an ICP and aggregates real outcomes per ICP:
 * active deal count, open pipeline $, won/lost counts, win rate, avg ACV (won),
 * avg sales-cycle length (with sample size), a blended **throughput** rank
 * (win-rate-weighted won revenue per day), and a MEASURED contact→deal
 * conversion rate (distinct held contacts that produced a deal ÷ held contacts).
 *
 * It also reports what the per-ICP view CANNOT see, so the page can be honest:
 *  - unattributed deals (no resolvable deal → company/contact → ICP path)
 *  - period actuals (closed-won $ and count in the current + prior quarter,
 *    open pipeline now) computed over ALL deals, attributed or not
 *
 * Deal → ICP resolution (two paths, A preferred):
 *   A. crm_deal_company_links.arcova_company_id → org company matched_icp_id
 *   B. crm_deal_contact_links.arcova_contact_id → contacts.company_id → matched_icp_id
 *
 * Cycle length uses crm_deal_stage_history (first-stage entered_at → closedwon
 * entered_at); falls back to created_date → close_date when history is absent
 * (deals that closed before stage-history capture began). Pure aggregation over
 * data we already store — no external calls.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { priorQuarter, quarterDateRange, quarterOf } from './period';
import { listActiveCompanyStateForUser } from '../org-company-state';

/** Below this many held contacts we don't trust a measured contact→deal rate. */
export const MIN_CONTACTS_FOR_MEASURED_CONVERSION = 5;

/**
 * Cycle length (days) assumed when an ICP has closed-won evidence but no deal
 * yielded a usable cycle AND no other ICP has a measured cycle to borrow.
 * 90 days is roughly one quarter, a conservative B2B default.
 */
export const DEFAULT_ASSUMED_CYCLE_DAYS = 90;

export type IcpPerformance = {
  active_deal_count: number;
  pipeline_usd: number;
  won_count: number;
  lost_count: number;
  win_rate: number | null; // won / (won + lost)
  won_usd: number;
  avg_acv: number | null; // mean amount of won deals
  avg_cycle_days: number | null; // mean (first-stage → closedwon)
  /** Closed-won deals contributing to avg_cycle_days ("based on N deals"). */
  cycle_sample: number;
  /** How many cycle samples came from stage history (vs created→close fallback). */
  cycle_from_history: number;
  /**
   * True when throughput was computed with an ASSUMED cycle (median of other
   * ICPs' measured cycles, else DEFAULT_ASSUMED_CYCLE_DAYS) because no deal in
   * this ICP had usable dates. Typical for imported historical deals whose
   * created_date is the import date. UI can disclose "cycle assumed".
   */
  cycle_assumed: boolean;
  throughput: number | null; // win-rate-weighted won revenue per day
  confidence: 'high' | 'medium' | 'low'; // by closed-deal sample size
  /** Held contacts mapped to this ICP (conversion denominator). */
  contacts_total: number;
  /** Distinct held contacts linked to at least one deal (conversion numerator). */
  contacts_with_deals: number;
  /** Measured contact→deal rate; null below the sample floor (caller falls back). */
  contact_to_deal: number | null;
  /** Movement: closed-won within the requested period. */
  won_count_in_period: number;
  won_usd_in_period: number;
};

export type CoverageActuals = {
  period: string;
  priorPeriod: string;
  /** Closed-won inside the requested period (ALL deals, attributed or not). */
  wonUsd: number;
  wonCount: number;
  priorWonUsd: number;
  priorWonCount: number;
  /** Open (non-closed) pipeline right now, across all deals. */
  openPipelineUsd: number;
  openDealCount: number;
};

export type CoverageRollup = {
  byIcp: Map<string, IcpPerformance>;
  totalDeals: number;
  attributedDeals: number;
  /** Deals with no resolvable ICP — invisible to the per-ICP view. */
  unattributed: { dealCount: number; openUsd: number; wonUsd: number };
  actuals: CoverageActuals;
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
/** Closed-won predicate shared with /api/coverage/target so attainment numbers agree. */
export function isWon(stage?: string | null): boolean {
  return normStage(stage) === 'closedwon';
}
function isLost(stage?: string | null): boolean {
  return normStage(stage) === 'closedlost';
}
function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const t0 = new Date(a).getTime();
  const t1 = new Date(b).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  const days = (t1 - t0) / 86_400_000;
  // Deals entered directly as closed-won often carry a close_date a few seconds
  // BEFORE created_date. Treat anything within a day as a same-day (0d) cycle;
  // only reject genuinely inverted ranges.
  if (days < -1) return null;
  return Math.max(0, days);
}
function mean(values: number[]): number | null {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

/**
 * Fallback cycle for ICPs with closed-won evidence but no usable cycle data
 * (e.g. historical imports where created_date is the sync date and close_date
 * is months earlier, so created→close is rejected and stage history is absent
 * or a single jump to closedwon). Median of the user's measured per-ICP avg
 * cycles when any exist, else DEFAULT_ASSUMED_CYCLE_DAYS. Pure; exported for
 * unit tests.
 */
export function assumedCycleDays(measuredCycles: number[]): number {
  const vals = measuredCycles.filter((v) => Number.isFinite(v) && v >= 0).sort((x, y) => x - y);
  if (vals.length === 0) return DEFAULT_ASSUMED_CYCLE_DAYS;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 === 1 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

/**
 * Throughput = win_rate × won_usd ÷ max(cycle, 1), the allocation ranking
 * weight. When the ICP has closed-won evidence (win rate known, won_usd > 0)
 * but NO measured cycle, fall back to fallbackCycleDays and flag the result as
 * assumed, so historical imports with unusable dates still rank by
 * win_rate × won_usd instead of dropping to zero allocation weight.
 * Pure; exported for unit tests.
 */
export function computeThroughput(params: {
  winRate: number | null;
  wonUsd: number;
  avgCycleDays: number | null;
  fallbackCycleDays: number;
}): { throughput: number | null; cycleAssumed: boolean } {
  const { winRate, wonUsd, avgCycleDays, fallbackCycleDays } = params;
  if (winRate == null) return { throughput: null, cycleAssumed: false };
  if (avgCycleDays != null) {
    // Cycles are floored at 1 day so same-day closes don't divide by zero.
    return { throughput: (winRate * wonUsd) / Math.max(avgCycleDays, 1), cycleAssumed: false };
  }
  if (wonUsd > 0) {
    return { throughput: (winRate * wonUsd) / Math.max(fallbackCycleDays, 1), cycleAssumed: true };
  }
  // No won revenue and no cycle: nothing rankable (e.g. lost-only ICPs).
  return { throughput: null, cycleAssumed: false };
}
function inRange(iso: string | null, range: { startIso: string; endIso: string } | null): boolean {
  if (!iso || !range) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  const asIso = new Date(t).toISOString();
  return asIso >= range.startIso && asIso < range.endIso;
}

function emptyRollup(period: string): CoverageRollup {
  return {
    byIcp: new Map(),
    totalDeals: 0,
    attributedDeals: 0,
    unattributed: { dealCount: 0, openUsd: 0, wonUsd: 0 },
    actuals: {
      period,
      priorPeriod: priorQuarter(period),
      wonUsd: 0,
      wonCount: 0,
      priorWonUsd: 0,
      priorWonCount: 0,
      openPipelineUsd: 0,
      openDealCount: 0,
    },
  };
}

/**
 * Compute the full coverage rollup for a user: per-ICP performance keyed by
 * icp_id (ICPs with no mapped deals won't appear — caller defaults to null),
 * plus unattributed-deal accounting and period actuals.
 */
export async function computeCoverageRollup(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  period: string = quarterOf(),
): Promise<CoverageRollup> {
  const rollup = emptyRollup(period);
  const curRange = quarterDateRange(period);
  const priorRange = quarterDateRange(priorQuarter(period));

  const { data: dealRows } = await supabase
    .from('crm_deals')
    .select('hubspot_deal_id, deal_stage, amount, close_date, created_date')
    .eq('user_id', userId);
  const deals = (dealRows ?? []) as DealRow[];
  if (deals.length === 0) return rollup;
  rollup.totalDeals = deals.length;

  // Deal → ICP resolution inputs + contact universe for measured conversion.
  const [companyLinksRes, contactLinksRes, userCompaniesRes, contactsRes] = await Promise.all([
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
    listActiveCompanyStateForUser(supabase as any, userId, 'company_id, matched_icp_id'),
    supabase
      .from('contacts')
      .select('id, company_id')
      .eq('user_id', userId)
      .not('company_id', 'is', null),
  ]);

  const companyToIcp = new Map<string, string>();
  for (const r of (userCompaniesRes ?? []) as Array<{ company_id: string; matched_icp_id: string | null }>) {
    if (!r.matched_icp_id) continue;
    companyToIcp.set(r.company_id, r.matched_icp_id);
  }

  const contactToIcp = new Map<string, string>();
  const contactsTotalByIcp = new Map<string, number>();
  for (const r of (contactsRes.data ?? []) as Array<{ id: string; company_id: string }>) {
    const icp = companyToIcp.get(r.company_id);
    if (!icp) continue;
    contactToIcp.set(r.id, icp);
    contactsTotalByIcp.set(icp, (contactsTotalByIcp.get(icp) ?? 0) + 1);
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
  for (const r of contactLinks) {
    if (dealToIcp.has(r.hubspot_deal_id)) continue;
    const icp = contactToIcp.get(r.arcova_contact_id);
    if (icp) dealToIcp.set(r.hubspot_deal_id, icp);
  }

  // Measured contact→deal numerator: distinct held contacts with ≥1 deal link.
  const dealLinkedContactsByIcp = new Map<string, Set<string>>();
  for (const r of contactLinks) {
    const icp = contactToIcp.get(r.arcova_contact_id);
    if (!icp) continue;
    let set = dealLinkedContactsByIcp.get(icp);
    if (!set) {
      set = new Set();
      dealLinkedContactsByIcp.set(icp, set);
    }
    set.add(r.arcova_contact_id);
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
    cyclesFromHistory: number;
    wonInPeriod: number;
    wonUsdInPeriod: number;
  };
  const agg = new Map<string, Agg>();
  const get = (icp: string): Agg => {
    let a = agg.get(icp);
    if (!a) {
      a = {
        active: 0,
        pipeline: 0,
        won: 0,
        lost: 0,
        wonUsd: 0,
        acv: [],
        cycles: [],
        cyclesFromHistory: 0,
        wonInPeriod: 0,
        wonUsdInPeriod: 0,
      };
      agg.set(icp, a);
    }
    return a;
  };

  for (const deal of deals) {
    const amount = typeof deal.amount === 'number' && Number.isFinite(deal.amount) ? deal.amount : 0;
    const won = isWon(deal.deal_stage);
    const lost = isLost(deal.deal_stage);

    // Whole-book actuals (attributed or not).
    if (won) {
      if (inRange(deal.close_date, curRange)) {
        rollup.actuals.wonUsd += amount;
        rollup.actuals.wonCount += 1;
      } else if (inRange(deal.close_date, priorRange)) {
        rollup.actuals.priorWonUsd += amount;
        rollup.actuals.priorWonCount += 1;
      }
    } else if (!lost) {
      rollup.actuals.openPipelineUsd += amount;
      rollup.actuals.openDealCount += 1;
    }

    const icp = dealToIcp.get(deal.hubspot_deal_id);
    if (!icp) {
      rollup.unattributed.dealCount += 1;
      if (won) rollup.unattributed.wonUsd += amount;
      else if (!lost) rollup.unattributed.openUsd += amount;
      continue;
    }
    rollup.attributedDeals += 1;

    const a = get(icp);
    if (won) {
      a.won += 1;
      a.wonUsd += amount;
      if (amount > 0) a.acv.push(amount);
      if (inRange(deal.close_date, curRange)) {
        a.wonInPeriod += 1;
        a.wonUsdInPeriod += amount;
      }
      // cycle: stage-history first→won, else created→close
      const historyCycle = daysBetween(
        firstStageAt.get(deal.hubspot_deal_id) ?? null,
        wonStageAt.get(deal.hubspot_deal_id) ?? null,
      );
      const cycle = historyCycle ?? daysBetween(deal.created_date, deal.close_date);
      if (cycle != null && cycle >= 0) {
        a.cycles.push(cycle);
        if (historyCycle != null) a.cyclesFromHistory += 1;
      }
    } else if (lost) {
      a.lost += 1;
    } else {
      a.active += 1;
      a.pipeline += amount;
    }
  }

  // Fallback cycle for ICPs whose won deals all lack usable dates (historical
  // imports): borrow the median measured cycle from the user's other ICPs.
  const measuredIcpCycles: number[] = [];
  for (const a of agg.values()) {
    const m = mean(a.cycles);
    if (m != null) measuredIcpCycles.push(m);
  }
  const fallbackCycleDays = assumedCycleDays(measuredIcpCycles);

  for (const [icp, a] of agg) {
    const closed = a.won + a.lost;
    const win_rate = closed > 0 ? a.won / closed : null;
    const avg_acv = mean(a.acv);
    const avg_cycle_days = mean(a.cycles);
    // Throughput: win-rate-weighted won revenue per day. Captures conversion,
    // deal size×volume (won_usd), and velocity in one rank-able number.
    const { throughput, cycleAssumed: cycle_assumed } = computeThroughput({
      winRate: win_rate,
      wonUsd: a.wonUsd,
      avgCycleDays: avg_cycle_days,
      fallbackCycleDays,
    });
    const confidence: IcpPerformance['confidence'] = closed >= 10 ? 'high' : closed >= 4 ? 'medium' : 'low';

    const contacts_total = contactsTotalByIcp.get(icp) ?? 0;
    const contacts_with_deals = dealLinkedContactsByIcp.get(icp)?.size ?? 0;
    const contact_to_deal =
      contacts_total >= MIN_CONTACTS_FOR_MEASURED_CONVERSION && contacts_with_deals > 0
        ? contacts_with_deals / contacts_total
        : null;

    rollup.byIcp.set(icp, {
      active_deal_count: a.active,
      pipeline_usd: a.pipeline,
      won_count: a.won,
      lost_count: a.lost,
      win_rate,
      won_usd: a.wonUsd,
      avg_acv,
      avg_cycle_days,
      cycle_sample: a.cycles.length,
      cycle_from_history: a.cyclesFromHistory,
      cycle_assumed,
      throughput,
      confidence,
      contacts_total,
      contacts_with_deals,
      contact_to_deal,
      won_count_in_period: a.wonInPeriod,
      won_usd_in_period: a.wonUsdInPeriod,
    });
  }

  return rollup;
}
