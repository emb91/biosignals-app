/**
 * Cadence-rule regression: pins the date math and gate predicates that drive
 * the signal delta crons' weekly heartbeat (growth weekly / starter+free
 * monthly on the month's first weekday occurrence).
 *
 * Run: npx tsc -p tsconfig.test.monitor-cadence.json && \
 *      node --test /tmp/arcova-monitor-cadence-tests/lib/signals/monitor-cadence-rules.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WEEKLY_CADENCE_DAYS,
  isFirstWeekdayOccurrenceOfMonth,
  dueForCadence,
  lookbackDaysForCadence,
} from './monitor-cadence-rules';

// Cadence values from the billing catalog.
const GROWTH = 7;
const MONTHLY = 30;

/** UTC midnight for a given Y-M-D. */
function utc(year: number, month1: number, day: number): number {
  return Date.UTC(year, month1 - 1, day, 0, 0, 0);
}

test('isFirstWeekdayOccurrenceOfMonth: true only for day-of-month 1..7 (UTC)', () => {
  for (let day = 1; day <= 7; day += 1) {
    assert.equal(isFirstWeekdayOccurrenceOfMonth(utc(2026, 6, day)), true, `day ${day}`);
  }
  for (const day of [8, 14, 21, 28, 30]) {
    assert.equal(isFirstWeekdayOccurrenceOfMonth(utc(2026, 6, day)), false, `day ${day}`);
  }
});

test('isFirstWeekdayOccurrenceOfMonth: handles month boundaries', () => {
  // The first Monday of July 2026 is the 6th; the last Monday of June is the 29th.
  assert.equal(isFirstWeekdayOccurrenceOfMonth(utc(2026, 7, 6)), true);
  assert.equal(isFirstWeekdayOccurrenceOfMonth(utc(2026, 6, 29)), false);
  // First day of a month is always a first-occurrence regardless of weekday.
  assert.equal(isFirstWeekdayOccurrenceOfMonth(utc(2026, 1, 1)), true);
});

test('dueForCadence: weekly tiers are due on every tick', () => {
  assert.equal(dueForCadence(GROWTH, utc(2026, 6, 1)), true);
  assert.equal(dueForCadence(GROWTH, utc(2026, 6, 22)), true); // mid-month still due
  assert.equal(dueForCadence(WEEKLY_CADENCE_DAYS, utc(2026, 6, 30)), true);
});

test('dueForCadence: monthly tiers are due only on the first weekday occurrence', () => {
  assert.equal(dueForCadence(MONTHLY, utc(2026, 6, 3)), true); // within first 7 days
  assert.equal(dueForCadence(MONTHLY, utc(2026, 6, 7)), true); // boundary
  assert.equal(dueForCadence(MONTHLY, utc(2026, 6, 8)), false); // just past
  assert.equal(dueForCadence(MONTHLY, utc(2026, 6, 22)), false);
});

test('lookbackDaysForCadence: weekly window covers a week, monthly covers ~35-day spacing', () => {
  assert.equal(lookbackDaysForCadence(GROWTH), 10);
  assert.equal(lookbackDaysForCadence(MONTHLY), 37);
  // Monthly lookback must exceed the worst-case first-weekday spacing (35 days).
  assert.ok(lookbackDaysForCadence(MONTHLY) > 35);
});
