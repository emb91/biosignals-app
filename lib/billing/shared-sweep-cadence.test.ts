import test from 'node:test';
import assert from 'node:assert/strict';
import { pickSharedNextSweepAt } from './shared-sweep-cadence';

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 5, 24, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

test('falls back to the cadence-derived timestamp when there are no subscribers', () => {
  const fallback = iso(NOW + 7 * DAY_MS);
  assert.equal(pickSharedNextSweepAt([], fallback), fallback);
  assert.equal(pickSharedNextSweepAt([null, undefined], fallback), fallback);
});

test('picks the earliest subscriber due date, not the fastest cadence horizon', () => {
  // Weekly subscriber was just advanced 7 days out; the monthly subscriber is
  // still due in 2 days. The shared target must follow the monthly subscriber
  // so it is not delayed to the weekly horizon.
  const weeklyNext = iso(NOW + 7 * DAY_MS);
  const monthlyNext = iso(NOW + 2 * DAY_MS);
  const fallback = weeklyNext; // now + fastest cadence (the buggy value)
  assert.equal(pickSharedNextSweepAt([weeklyNext, monthlyNext], fallback), monthlyNext);
});

test('ignores null subscriber rows while still finding the earliest', () => {
  const a = iso(NOW + 30 * DAY_MS);
  const b = iso(NOW + 5 * DAY_MS);
  const fallback = iso(NOW + 7 * DAY_MS);
  assert.equal(pickSharedNextSweepAt([a, null, b, undefined], fallback), b);
});

test('single subscriber returns its own next sweep (matches the old behavior)', () => {
  const only = iso(NOW + 7 * DAY_MS);
  const fallback = only;
  assert.equal(pickSharedNextSweepAt([only], fallback), only);
});

test('does not assume lexical ordering matches chronological ordering', () => {
  // Differing offsets that would sort wrong as plain strings.
  const earlierZulu = '2026-06-30T00:00:00.000Z';
  const laterPlusOffset = '2026-06-30T06:00:00.000+05:00'; // = 01:00Z, later instant
  const fallback = iso(NOW + 365 * DAY_MS);
  assert.equal(pickSharedNextSweepAt([laterPlusOffset, earlierZulu], fallback), earlierZulu);
});
