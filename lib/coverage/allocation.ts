/**
 * Coverage allocation engine — the prescriptive layer.
 *
 * Takes ONE overall quarterly target and splits it across ICPs by **throughput**
 * (the best-converting/fastest ICPs get more of the number), back-calculates the
 * funnel to "buy N contacts" per ICP, and respects each ICP's **addressable-supply
 * ceiling** — reallocating overflow to ICPs that still have headroom (capped
 * proportional / water-fill allocation). Reports any final shortfall the current
 * ICP set + supply can't reach.
 *
 * Pure + deterministic (ceilings/rates are inputs, not fetched here) so it's
 * unit-tested via node --test — see lib/coverage/allocation.test.ts.
 */

export type CoverageTargetType = 'revenue' | 'deals';

export type IcpAllocationInput = {
  icpId: string;
  label: string;
  /** Ranking weight — win-rate-weighted throughput. <=0/null → no performance signal. */
  throughput: number | null;
  /** Per-ICP funnel rates (fall back to `defaults` when null / low-confidence). */
  winRate: number | null;
  contactToDeal: number | null;
  avgAcv: number | null;
  /** Contacts already held for this ICP (count toward the funnel). */
  heldContacts: number;
  /** Net-new sourceable contacts (provider supply minus held, deduped). null = unknown (treated as unlimited). */
  sourceableCeiling: number | null;
};

export type CoverageDefaults = {
  winRate: number; // e.g. 0.2
  contactToDeal: number; // e.g. 0.1
  avgAcv: number; // for revenue targets, $/deal
};

export type IcpAllocation = {
  icpId: string;
  label: string;
  shareOfTarget: number; // 0..1
  subTarget: number; // target units (revenue $ or deal count) allocated
  requiredDeals: number;
  requiredContacts: number;
  toBuy: number; // contacts to source (>= 0)
  sourceable: number; // min(toBuy, ceiling)
  capped: boolean; // ceiling limited this ICP
};

export type AllocationResult = {
  allocations: IcpAllocation[];
  totalToBuy: number;
  /** Target units we could NOT allocate (all eligible ICPs hit their supply ceiling). */
  shortfall: number;
  notes: string[];
};

const clampPos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** Effective per-ICP funnel rates, falling back to global defaults. */
function rates(icp: IcpAllocationInput, d: CoverageDefaults) {
  const winRate = icp.winRate != null && icp.winRate > 0 ? icp.winRate : d.winRate;
  const contactToDeal = icp.contactToDeal != null && icp.contactToDeal > 0 ? icp.contactToDeal : d.contactToDeal;
  const avgAcv = icp.avgAcv != null && icp.avgAcv > 0 ? icp.avgAcv : d.avgAcv;
  return { winRate, contactToDeal, avgAcv };
}

/** target units → deals (revenue ÷ ACV, or identity for a deals target). */
function targetToDeals(units: number, type: CoverageTargetType, avgAcv: number): number {
  return type === 'revenue' ? units / avgAcv : units;
}
/** deals → contacts needed (÷ win rate ÷ contact→deal). */
function dealsToContacts(deals: number, winRate: number, contactToDeal: number): number {
  return deals / winRate / contactToDeal;
}
/** Max target units an ICP can support given held + ceiling contacts. */
function capacity(icp: IcpAllocationInput, d: CoverageDefaults, type: CoverageTargetType): number {
  if (icp.sourceableCeiling == null) return Infinity;
  const { winRate, contactToDeal, avgAcv } = rates(icp, d);
  const maxContacts = clampPos(icp.heldContacts) + clampPos(icp.sourceableCeiling);
  const maxDeals = maxContacts * contactToDeal * winRate;
  return type === 'revenue' ? maxDeals * avgAcv : maxDeals;
}

/**
 * Capped proportional (water-fill) allocation of `targetValue` across ICPs by
 * `throughput` weight, never exceeding any ICP's supply capacity.
 */
export function allocateTarget(input: {
  target: { type: CoverageTargetType; value: number };
  icps: IcpAllocationInput[];
  defaults: CoverageDefaults;
}): AllocationResult {
  const { target, icps, defaults } = input;
  const notes: string[] = [];
  const type = target.type;

  if (!icps.length || !(target.value > 0)) {
    return { allocations: [], totalToBuy: 0, shortfall: clampPos(target.value), notes };
  }

  // Weights: throughput where we have it; equal split when no ICP has a signal.
  const anyThroughput = icps.some((i) => (i.throughput ?? 0) > 0);
  if (!anyThroughput) {
    notes.push('No closed-deal history yet — splitting the target evenly across ICPs until performance data accrues.');
  }
  const weightOf = (i: IcpAllocationInput) => (anyThroughput ? clampPos(i.throughput ?? 0) : 1);

  const cap = new Map(icps.map((i) => [i.icpId, capacity(i, defaults, type)]));
  const alloc = new Map(icps.map((i) => [i.icpId, 0]));
  const cappedSet = new Set<string>(); // ICPs the supply ceiling held back during fill
  let remaining = target.value;
  const active = new Set(icps.filter((i) => weightOf(i) > 0).map((i) => i.icpId));

  // Water-fill: distribute remaining by weight among non-capped ICPs; lock any
  // that hit capacity and continue with the rest. Bounded iterations.
  for (let iter = 0; iter < icps.length + 2 && remaining > 1e-6 && active.size > 0; iter++) {
    const totalWeight = icps.filter((i) => active.has(i.icpId)).reduce((s, i) => s + weightOf(i), 0);
    if (totalWeight <= 0) break;
    let distributed = 0;
    for (const i of icps) {
      if (!active.has(i.icpId)) continue;
      const want = (weightOf(i) / totalWeight) * remaining;
      const room = (cap.get(i.icpId) ?? Infinity) - (alloc.get(i.icpId) ?? 0);
      const give = Math.min(want, room);
      alloc.set(i.icpId, (alloc.get(i.icpId) ?? 0) + give);
      distributed += give;
      if (Number.isFinite(cap.get(i.icpId) ?? Infinity) && room - give <= 1e-6) {
        active.delete(i.icpId); // hit capacity → lock
        if (want > room + 1e-6) cappedSet.add(i.icpId); // wanted more than supply allows
      }
    }
    remaining -= distributed;
    if (distributed <= 1e-6) break; // no one has room
  }

  // Float residue from repeated proportional splits is not a real shortfall:
  // ignore anything below one part-per-million of the target (min 1e-6).
  const epsilon = Math.max(1e-6, target.value * 1e-6);
  const shortfall = remaining > epsilon ? remaining : 0;
  if (shortfall > 0) {
    notes.push('Target exceeds the addressable supply across your ICPs — broaden an ICP, raise the timeline, or accept a lower number.');
  }

  const allocations: IcpAllocation[] = icps.map((i) => {
    const { winRate, contactToDeal, avgAcv } = rates(i, defaults);
    const subTarget = alloc.get(i.icpId) ?? 0;
    const requiredDeals = targetToDeals(subTarget, type, avgAcv);
    const requiredContacts = dealsToContacts(requiredDeals, winRate, contactToDeal);
    const toBuy = Math.max(0, Math.ceil(requiredContacts - clampPos(i.heldContacts)));
    const sourceable = i.sourceableCeiling == null ? toBuy : Math.min(toBuy, clampPos(i.sourceableCeiling));
    return {
      icpId: i.icpId,
      label: i.label,
      shareOfTarget: target.value > 0 ? subTarget / target.value : 0,
      subTarget,
      requiredDeals,
      requiredContacts,
      toBuy,
      sourceable,
      capped: cappedSet.has(i.icpId),
    };
  });

  const totalToBuy = allocations.reduce((s, a) => s + a.sourceable, 0);
  return { allocations, totalToBuy, shortfall, notes };
}
