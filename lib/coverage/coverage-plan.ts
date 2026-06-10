/**
 * Glue between the Coverage page's ICP cards + the pure allocation engine.
 *
 * Builds allocation inputs from the cards the page already holds (throughput /
 * win-rate / ACV / measured contact→deal from CRM performance, held contacts
 * from sourced data) plus optional supply ceilings, derives blended fallback
 * funnel rates, and runs allocateTarget(). Every fallback rate carries a
 * measured/assumed provenance flag so the UI can label the plan honestly.
 * Kept out of the page component so it stays testable.
 */
import {
  allocateTarget,
  type IcpAllocationInput,
  type CoverageDefaults,
  type AllocationResult,
  type CoverageTargetType,
} from './allocation';

/** Industry-ish fallbacks used only where nothing has been measured. */
export const DEFAULT_CONTACT_TO_DEAL = 0.1; // 10% of engaged contacts become a deal
export const DEFAULT_WIN_RATE = 0.2; // 20% of deals close won

export type CoveragePlanCard = {
  icp_id: string;
  label: string;
  contact_count: number;
  performance: {
    throughput: number | null;
    win_rate: number | null;
    avg_acv: number | null;
    /** Measured contact→deal rate for this ICP (null below the sample floor). */
    contact_to_deal?: number | null;
    /** Conversion sample, for blending: numerator / denominator. */
    contacts_with_deals?: number;
    contacts_total?: number;
  } | null;
};

/** Where each blended fallback rate came from — drives honest UI labels. */
export type CoveragePlanSources = {
  winRate: 'measured' | 'assumed';
  contactToDeal: 'measured' | 'assumed';
  avgAcv: 'measured' | 'assumed';
  /** Pooled conversion sample behind a measured contactToDeal. */
  conversionSample: { withDeals: number; total: number } | null;
};

export type CoveragePlan = {
  result: AllocationResult;
  defaults: CoverageDefaults;
  sources: CoveragePlanSources;
  /** false → revenue target but no ACV anywhere, so revenue→deals can't be back-calc'd honestly. */
  canPlan: boolean;
};

export function buildCoveragePlan(params: {
  cards: CoveragePlanCard[];
  target: { type: CoverageTargetType; value: number };
  /** icpId → net-new sourceable contacts (from a supply check). Absent = unlimited. */
  ceilings?: Map<string, number | null>;
}): CoveragePlan {
  const { cards, target, ceilings } = params;

  const winRates = cards
    .map((c) => c.performance?.win_rate)
    .filter((v): v is number => v != null && v > 0);
  const acvs = cards
    .map((c) => c.performance?.avg_acv)
    .filter((v): v is number => v != null && v > 0);

  const blendedWinRate = winRates.length
    ? winRates.reduce((s, v) => s + v, 0) / winRates.length
    : DEFAULT_WIN_RATE;
  const blendedAcv = acvs.length ? acvs.reduce((s, v) => s + v, 0) / acvs.length : 0;

  // Blended contact→deal: pool the measured samples (numerators ÷ denominators)
  // across ICPs rather than averaging rates, so big ICPs weigh more.
  let convWithDeals = 0;
  let convTotal = 0;
  for (const c of cards) {
    const p = c.performance;
    if (p?.contact_to_deal != null && p.contacts_total != null && p.contacts_with_deals != null) {
      convWithDeals += p.contacts_with_deals;
      convTotal += p.contacts_total;
    }
  }
  const blendedContactToDeal = convTotal > 0 && convWithDeals > 0 ? convWithDeals / convTotal : null;

  // A revenue target needs SOME ACV to convert money → deals → contacts.
  const canPlan = target.type === 'deals' || acvs.length > 0;

  const defaults: CoverageDefaults = {
    winRate: blendedWinRate,
    contactToDeal: blendedContactToDeal ?? DEFAULT_CONTACT_TO_DEAL,
    avgAcv: blendedAcv > 0 ? blendedAcv : 1, // only consulted for revenue; canPlan guards real use
  };

  const sources: CoveragePlanSources = {
    winRate: winRates.length > 0 ? 'measured' : 'assumed',
    contactToDeal: blendedContactToDeal != null ? 'measured' : 'assumed',
    avgAcv: acvs.length > 0 ? 'measured' : 'assumed',
    conversionSample: blendedContactToDeal != null ? { withDeals: convWithDeals, total: convTotal } : null,
  };

  const icps: IcpAllocationInput[] = cards.map((c) => ({
    icpId: c.icp_id,
    label: c.label,
    throughput: c.performance?.throughput ?? null,
    winRate: c.performance?.win_rate ?? null,
    contactToDeal: c.performance?.contact_to_deal ?? null,
    avgAcv: c.performance?.avg_acv ?? null,
    heldContacts: c.contact_count,
    sourceableCeiling: ceilings ? ceilings.get(c.icp_id) ?? null : null,
  }));

  return { result: allocateTarget({ target, icps, defaults }), defaults, sources, canPlan };
}
