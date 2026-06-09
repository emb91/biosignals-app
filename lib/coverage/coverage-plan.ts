/**
 * Glue between the Coverage page's ICP cards + the pure allocation engine.
 *
 * Builds allocation inputs from the cards the page already holds (throughput /
 * win-rate / ACV from CRM performance, held contacts from sourced data) plus
 * optional supply ceilings, derives blended fallback funnel rates, and runs
 * allocateTarget(). Kept out of the page component so it stays testable.
 */
import {
  allocateTarget,
  type IcpAllocationInput,
  type CoverageDefaults,
  type AllocationResult,
  type CoverageTargetType,
} from './allocation';

/** Industry-ish fallbacks used only where an ICP has no CRM signal of its own. */
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
  } | null;
};

export type CoveragePlan = {
  result: AllocationResult;
  defaults: CoverageDefaults;
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

  // A revenue target needs SOME ACV to convert money → deals → contacts.
  const canPlan = target.type === 'deals' || acvs.length > 0;

  const defaults: CoverageDefaults = {
    winRate: blendedWinRate,
    contactToDeal: DEFAULT_CONTACT_TO_DEAL,
    avgAcv: blendedAcv > 0 ? blendedAcv : 1, // only consulted for revenue; canPlan guards real use
  };

  const icps: IcpAllocationInput[] = cards.map((c) => ({
    icpId: c.icp_id,
    label: c.label,
    throughput: c.performance?.throughput ?? null,
    winRate: c.performance?.win_rate ?? null,
    contactToDeal: null, // per-ICP conversion not yet measured — uses default
    avgAcv: c.performance?.avg_acv ?? null,
    heldContacts: c.contact_count,
    sourceableCeiling: ceilings ? ceilings.get(c.icp_id) ?? null : null,
  }));

  return { result: allocateTarget({ target, icps, defaults }), defaults, canPlan };
}
