/**
 * Tests for the Coverage allocation engine. Pure functions, run via node --test:
 *   npm run test:coverage-allocation
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateTarget, type IcpAllocationInput, type CoverageDefaults } from './allocation';
import { quarterOf, priorQuarter, quarterLabel, quarterDateRange, isValidPeriod } from './period';

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
