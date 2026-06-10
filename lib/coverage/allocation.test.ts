/**
 * Tests for the Coverage allocation engine. Pure functions, run via node --test:
 *   npm run test:coverage-allocation
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateTarget, type IcpAllocationInput, type CoverageDefaults } from './allocation';
import { quarterOf, priorQuarter, quarterLabel, quarterDateRange, quarterProgress, isValidPeriod } from './period';
import { buildCoveragePlan, DEFAULT_WIN_RATE, DEFAULT_CONTACT_TO_DEAL } from './coverage-plan';
import { computeCoverageVerdict, type CoverageVerdictInput } from './verdict';
import { assumedCycleDays, computeThroughput, DEFAULT_ASSUMED_CYCLE_DAYS } from './icp-performance';

const D: CoverageDefaults = { winRate: 0.5, contactToDeal: 0.5, avgAcv: 10_000 };
const approx = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;

function icp(over: Partial<IcpAllocationInput> & { icpId: string }): IcpAllocationInput {
  return {
    label: over.icpId,
    throughput: null,
    winRate: null,
    contactToDeal: null,
    avgAcv: null,
    heldContacts: 0,
    sourceableCeiling: null,
    ...over,
  };
}

test('splits a deals target by throughput weight; back-calcs contacts (rates 0.5/0.5)', () => {
  const r = allocateTarget({
    target: { type: 'deals', value: 4 },
    defaults: D,
    icps: [icp({ icpId: 'A', throughput: 3 }), icp({ icpId: 'B', throughput: 1 })],
  });
  const a = r.allocations.find((x) => x.icpId === 'A')!;
  const b = r.allocations.find((x) => x.icpId === 'B')!;
  assert.ok(approx(a.subTarget, 3) && approx(b.subTarget, 1), 'A=3, B=1 deals');
  assert.equal(a.toBuy, 12); // 3 deals ÷0.5 ÷0.5 = 12 contacts
  assert.equal(b.toBuy, 4);
  assert.equal(r.totalToBuy, 16);
  assert.equal(r.shortfall, 0);
});

test('revenue target → deals → contacts, minus held', () => {
  const r = allocateTarget({
    target: { type: 'revenue', value: 100_000 },
    defaults: D,
    icps: [icp({ icpId: 'A', throughput: 1, heldContacts: 5 })],
  });
  const a = r.allocations[0];
  // 100k ÷ 10k = 10 deals; 10 ÷0.5 ÷0.5 = 40 contacts; − 5 held = 35
  assert.equal(a.requiredDeals, 10);
  assert.equal(a.toBuy, 35);
});

test('supply ceiling caps an ICP and reallocates overflow to the other', () => {
  const r = allocateTarget({
    target: { type: 'deals', value: 10 },
    defaults: D,
    icps: [
      icp({ icpId: 'A', throughput: 10, sourceableCeiling: 8 }), // cap = 8×0.5×0.5 = 2 deals
      icp({ icpId: 'B', throughput: 1 }), // uncapped
    ],
  });
  const a = r.allocations.find((x) => x.icpId === 'A')!;
  const b = r.allocations.find((x) => x.icpId === 'B')!;
  assert.ok(approx(a.subTarget, 2), 'A capped at 2 deals');
  assert.ok(a.capped, 'A flagged capped');
  assert.ok(approx(b.subTarget, 8), 'B absorbs the overflow → 8 deals');
  assert.equal(r.shortfall, 0);
  assert.equal(a.sourceable, 8); // bought up to its ceiling
});

test('reports shortfall when target exceeds total addressable supply', () => {
  const r = allocateTarget({
    target: { type: 'deals', value: 10 },
    defaults: D,
    icps: [
      icp({ icpId: 'A', throughput: 1, sourceableCeiling: 2 }), // cap 0.5 deals
      icp({ icpId: 'B', throughput: 1, sourceableCeiling: 2 }), // cap 0.5 deals
    ],
  });
  assert.ok(approx(r.shortfall, 9), `~9 deals unreachable, got ${r.shortfall}`);
  assert.equal(r.totalToBuy, 4); // 2 + 2 contacts
});

test('no throughput anywhere → even split + a note', () => {
  const r = allocateTarget({
    target: { type: 'deals', value: 4 },
    defaults: D,
    icps: [icp({ icpId: 'A' }), icp({ icpId: 'B' })],
  });
  assert.ok(approx(r.allocations[0].subTarget, 2) && approx(r.allocations[1].subTarget, 2));
  assert.ok(r.notes.some((n) => /even/i.test(n)));
});

test('edge cases: empty ICPs and zero target', () => {
  assert.equal(allocateTarget({ target: { type: 'deals', value: 5 }, defaults: D, icps: [] }).shortfall, 5);
  const zero = allocateTarget({ target: { type: 'deals', value: 0 }, defaults: D, icps: [icp({ icpId: 'A', throughput: 1 })] });
  assert.equal(zero.shortfall, 0);
  assert.equal(zero.allocations.length, 0);
});

test('period helpers: quarter math, labels, UTC ranges', () => {
  assert.equal(quarterOf(new Date('2026-06-10T00:00:00Z')), '2026-Q2');
  assert.equal(quarterOf(new Date('2026-01-01T00:00:00Z')), '2026-Q1');
  assert.equal(quarterOf(new Date('2026-12-31T23:59:59Z')), '2026-Q4');
  assert.equal(priorQuarter('2026-Q1'), '2025-Q4'); // wraps the year
  assert.equal(priorQuarter('2026-Q3'), '2026-Q2');
  assert.equal(quarterLabel('2026-Q2'), 'Q2 2026');
  assert.ok(isValidPeriod('2026-Q4') && !isValidPeriod('2026-Q5') && !isValidPeriod('nope'));
  const range = quarterDateRange('2026-Q2')!;
  assert.equal(range.startIso, '2026-04-01T00:00:00.000Z');
  assert.equal(range.endIso, '2026-07-01T00:00:00.000Z'); // exclusive
  assert.equal(quarterDateRange('bad'), null);
});

test('quarterProgress: elapsed fraction + days left, clamped', () => {
  // Mid-quarter: May 16 is ~half of Q2 (Apr 1 – Jul 1).
  const mid = quarterProgress('2026-Q2', new Date('2026-05-16T12:00:00Z'))!;
  assert.ok(mid.elapsedFraction > 0.45 && mid.elapsedFraction < 0.55, `~0.5, got ${mid.elapsedFraction}`);
  assert.ok(mid.daysLeft > 40 && mid.daysLeft < 50);
  // Before the quarter starts → 0; after it ends → 1 / 0 days.
  assert.equal(quarterProgress('2026-Q2', new Date('2026-01-01T00:00:00Z'))!.elapsedFraction, 0);
  const done = quarterProgress('2026-Q2', new Date('2026-09-01T00:00:00Z'))!;
  assert.equal(done.elapsedFraction, 1);
  assert.equal(done.daysLeft, 0);
  assert.equal(quarterProgress('nope'), null);
});

test('buildCoveragePlan: measured contact→deal pools samples; assumed otherwise', () => {
  const measured = buildCoveragePlan({
    cards: [
      {
        icp_id: 'A',
        label: 'A',
        contact_count: 15,
        performance: {
          throughput: 2,
          win_rate: 0.5,
          avg_acv: 10_000,
          contact_to_deal: 4 / 15,
          contacts_with_deals: 4,
          contacts_total: 15,
        },
      },
      {
        icp_id: 'B',
        label: 'B',
        contact_count: 5,
        performance: {
          throughput: 1,
          win_rate: 0.5,
          avg_acv: 10_000,
          contact_to_deal: 1 / 5,
          contacts_with_deals: 1,
          contacts_total: 5,
        },
      },
    ],
    target: { type: 'deals', value: 10 },
  });
  // Pooled: (4 + 1) / (15 + 5) = 0.25, not mean(4/15, 1/5).
  assert.ok(Math.abs(measured.defaults.contactToDeal - 0.25) < 1e-9);
  assert.equal(measured.sources.contactToDeal, 'measured');
  assert.deepEqual(measured.sources.conversionSample, { withDeals: 5, total: 20 });

  const assumed = buildCoveragePlan({
    cards: [{ icp_id: 'A', label: 'A', contact_count: 3, performance: { throughput: 1, win_rate: 0.5, avg_acv: 10_000 } }],
    target: { type: 'deals', value: 10 },
  });
  assert.equal(assumed.defaults.contactToDeal, DEFAULT_CONTACT_TO_DEAL);
  assert.equal(assumed.sources.contactToDeal, 'assumed');
  assert.equal(assumed.sources.winRate, 'measured');
});

// ── Cycle fallback (historical imports) ──────────────────────────────────────

test('assumedCycleDays: median of measured cycles; documented default when none', () => {
  assert.equal(assumedCycleDays([30, 90, 60]), 60); // odd count → middle value
  assert.equal(assumedCycleDays([30, 90]), 60); // even count → mean of middle two
  assert.equal(assumedCycleDays([45]), 45);
  assert.equal(assumedCycleDays([]), DEFAULT_ASSUMED_CYCLE_DAYS);
  assert.equal(assumedCycleDays([NaN, -5]), DEFAULT_ASSUMED_CYCLE_DAYS); // junk filtered out
});

test('computeThroughput: measured cycle wins; no fallback flag', () => {
  const r = computeThroughput({ winRate: 0.5, wonUsd: 90_000, avgCycleDays: 45, fallbackCycleDays: 90 });
  assert.equal(r.throughput, (0.5 * 90_000) / 45); // 1000/day
  assert.equal(r.cycleAssumed, false);
  // Same-day closes floor at 1 day rather than dividing by zero.
  const sameDay = computeThroughput({ winRate: 1, wonUsd: 10_000, avgCycleDays: 0, fallbackCycleDays: 90 });
  assert.equal(sameDay.throughput, 10_000);
});

test('computeThroughput: won evidence + no usable cycle → median-cycle fallback (historical import)', () => {
  // Imported historical deals: created_date = sync date, close_date months
  // earlier → cycle rejected → avg_cycle_days null. Other ICPs measured
  // [30, 60, 90] days → median 60 borrowed.
  const fallback = assumedCycleDays([30, 60, 90]);
  const r = computeThroughput({ winRate: 0.5, wonUsd: 120_000, avgCycleDays: null, fallbackCycleDays: fallback });
  assert.equal(r.throughput, (0.5 * 120_000) / 60); // ranks by win_rate × won_usd, not zero
  assert.equal(r.cycleAssumed, true);
});

test('computeThroughput: default-cycle fallback when NO ICP has a measured cycle', () => {
  const fallback = assumedCycleDays([]);
  assert.equal(fallback, DEFAULT_ASSUMED_CYCLE_DAYS);
  const r = computeThroughput({ winRate: 0.4, wonUsd: 90_000, avgCycleDays: null, fallbackCycleDays: fallback });
  assert.equal(r.throughput, (0.4 * 90_000) / DEFAULT_ASSUMED_CYCLE_DAYS);
  assert.equal(r.cycleAssumed, true);
});

test('computeThroughput: stays null without won evidence (no fake signal)', () => {
  // No closed deals at all.
  assert.deepEqual(
    computeThroughput({ winRate: null, wonUsd: 0, avgCycleDays: null, fallbackCycleDays: 90 }),
    { throughput: null, cycleAssumed: false },
  );
  // Lost-only ICP: win rate 0, nothing won → nothing rankable, not "assumed".
  assert.deepEqual(
    computeThroughput({ winRate: 0, wonUsd: 0, avgCycleDays: null, fallbackCycleDays: 90 }),
    { throughput: null, cycleAssumed: false },
  );
});

// ── Verdict ──────────────────────────────────────────────────────────────────

function verdictInput(over: Partial<CoverageVerdictInput> = {}): CoverageVerdictInput {
  return {
    icpCount: 3,
    gapIcpLabels: [],
    hasCrm: true,
    target: { type: 'revenue', value: 1_000_000 },
    actuals: { wonUsd: 500_000, wonCount: 2, openPipelineUsd: 100_000 },
    elapsedFraction: 0.5,
    weeksLeft: 6,
    shortfall: 0,
    topPriority: { icpId: 'a', label: 'ICP A', toBuy: 120 },
    periodLabel: 'Q2 2026',
    ...over,
  };
}

test('verdict: resolution order no-icps → no-target → blocked → behind → on-track', () => {
  assert.equal(computeCoverageVerdict(verdictInput({ icpCount: 0 })).status, 'no-icps');
  assert.equal(computeCoverageVerdict(verdictInput({ target: null })).status, 'no-target');
  assert.equal(computeCoverageVerdict(verdictInput({ shortfall: 250_000 })).status, 'blocked');
  assert.equal(
    computeCoverageVerdict(verdictInput({ actuals: { wonUsd: 100_000, wonCount: 1, openPipelineUsd: 0 } })).status,
    'behind', // 10% attained at 50% pace
  );
  assert.equal(computeCoverageVerdict(verdictInput()).status, 'on-track'); // 50% at 50%
});

test('verdict: pace grace, target hit, deals basis', () => {
  // 42% attained at 50% elapsed is within the 10pt grace → on-track.
  const grace = computeCoverageVerdict(
    verdictInput({ actuals: { wonUsd: 420_000, wonCount: 2, openPipelineUsd: 0 } }),
  );
  assert.equal(grace.status, 'on-track');

  const hit = computeCoverageVerdict(
    verdictInput({ actuals: { wonUsd: 1_200_000, wonCount: 3, openPipelineUsd: 0 } }),
  );
  assert.equal(hit.status, 'on-track');
  assert.ok(hit.attainment! >= 1);
  assert.match(hit.headline, /Target hit/);

  // Deals target paces on counts, not dollars.
  const deals = computeCoverageVerdict(
    verdictInput({
      target: { type: 'deals', value: 10 },
      actuals: { wonUsd: 0, wonCount: 1, openPipelineUsd: 0 },
    }),
  );
  assert.equal(deals.status, 'behind');
  assert.ok(Math.abs(deals.attainment! - 0.1) < 1e-9);
});

test('verdict: plan-only without CRM; behind recommends the top plan row', () => {
  const planOnly = computeCoverageVerdict(verdictInput({ hasCrm: false, actuals: null }));
  assert.equal(planOnly.status, 'plan-only');
  assert.equal(planOnly.action?.kind, 'source');

  const behind = computeCoverageVerdict(
    verdictInput({ actuals: { wonUsd: 0, wonCount: 0, openPipelineUsd: 0 } }),
  );
  assert.equal(behind.status, 'behind');
  assert.equal(behind.action?.kind, 'source');
  assert.equal(behind.action?.icpId, 'a');
  assert.equal(behind.action?.count, 120);

  const noTarget = computeCoverageVerdict(verdictInput({ target: null, gapIcpLabels: ['ICP B'] }));
  assert.equal(noTarget.action?.kind, 'set-target');
  assert.match(noTarget.detail ?? '', /coverage gap/);
});

test('buildCoveragePlan: blends rates, guards revenue without ACV', () => {
  const cards = [
    { icp_id: 'A', label: 'A', contact_count: 0, performance: { throughput: 2, win_rate: 0.4, avg_acv: 20_000 } },
    { icp_id: 'B', label: 'B', contact_count: 0, performance: { throughput: 1, win_rate: 0.2, avg_acv: null } },
  ];
  const revenue = buildCoveragePlan({ cards, target: { type: 'revenue', value: 100_000 } });
  assert.ok(revenue.canPlan, 'revenue plannable when some ACV exists');
  assert.ok(Math.abs(revenue.defaults.winRate - 0.3) < 1e-9, 'blended win rate = mean(0.4,0.2)=0.3');
  assert.ok(revenue.result.allocations.length === 2);

  // No ACV anywhere → a revenue target cannot be planned honestly.
  const noAcv = buildCoveragePlan({
    cards: [{ icp_id: 'A', label: 'A', contact_count: 0, performance: { throughput: 1, win_rate: null, avg_acv: null } }],
    target: { type: 'revenue', value: 100_000 },
  });
  assert.equal(noAcv.canPlan, false);
  assert.equal(noAcv.defaults.winRate, DEFAULT_WIN_RATE); // no win rate → falls back to default

  // A deals target is always plannable (no ACV needed).
  const deals = buildCoveragePlan({
    cards: [{ icp_id: 'A', label: 'A', contact_count: 0, performance: null }],
    target: { type: 'deals', value: 10 },
  });
  assert.ok(deals.canPlan);
});
