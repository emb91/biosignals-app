import test from 'node:test';
import assert from 'node:assert/strict';
import { CIK_REFRESH_DAYS, isCikResolutionStale } from './cik-staleness';

const NOW = Date.UTC(2026, 5, 24, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

test('never-checked companies are stale', () => {
  assert.equal(isCikResolutionStale(null, NOW), true);
  assert.equal(isCikResolutionStale(undefined, NOW), true);
  assert.equal(isCikResolutionStale('', NOW), true);
});

test('unparseable timestamps are treated as stale', () => {
  assert.equal(isCikResolutionStale('not-a-date', NOW), true);
});

test('recently checked companies are fresh (incl. confirmed-no-match)', () => {
  // A null cik with a recent cik_checked_at is the "confirmed absent" terminal
  // state — it must read as fresh so we don't re-resolve it every run.
  assert.equal(isCikResolutionStale(new Date(NOW - 1 * DAY_MS).toISOString(), NOW), false);
  assert.equal(isCikResolutionStale(new Date(NOW - (CIK_REFRESH_DAYS - 1) * DAY_MS).toISOString(), NOW), false);
});

test('checks older than the refresh window are stale', () => {
  assert.equal(isCikResolutionStale(new Date(NOW - (CIK_REFRESH_DAYS + 1) * DAY_MS).toISOString(), NOW), true);
});

test('exactly at the refresh window is stale (>= boundary)', () => {
  assert.equal(isCikResolutionStale(new Date(NOW - CIK_REFRESH_DAYS * DAY_MS).toISOString(), NOW), true);
});

test('respects a custom refreshDays override', () => {
  const sevenDaysAgo = new Date(NOW - 7 * DAY_MS).toISOString();
  assert.equal(isCikResolutionStale(sevenDaysAgo, NOW, 30), false);
  assert.equal(isCikResolutionStale(sevenDaysAgo, NOW, 5), true);
});
