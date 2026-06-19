/**
 * Tests for the routine-sweep fit gate. Pure functions, run via node --test:
 *   npm run test:sweep-fit-gate
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SWEEP_FIT_THRESHOLD,
  isCompanySweepEligible,
  isContactSweepEligible,
} from './sweep-fit-gate';

test('default threshold is 0.70 (a displayed fit of 70)', () => {
  assert.equal(SWEEP_FIT_THRESHOLD, 0.7);
});

test('company gate: at or above the bar passes, below fails', () => {
  assert.equal(isCompanySweepEligible(0.7), true);
  assert.equal(isCompanySweepEligible(0.95), true);
  assert.equal(isCompanySweepEligible(0.69), false);
  assert.equal(isCompanySweepEligible(0), false);
});

test('company gate: unscored (null/undefined) is excluded', () => {
  assert.equal(isCompanySweepEligible(null), false);
  assert.equal(isCompanySweepEligible(undefined), false);
});

test('contact gate requires BOTH contact and company to clear the bar', () => {
  // both good → swept
  assert.equal(isContactSweepEligible(0.8, 0.8), true);
  // great contact, weak company → skip
  assert.equal(isContactSweepEligible(0.95, 0.5), false);
  // weak contact, great company → skip
  assert.equal(isContactSweepEligible(0.4, 0.95), false);
  // both at the bar → swept
  assert.equal(isContactSweepEligible(0.7, 0.7), true);
});

test('contact gate: missing either score is excluded', () => {
  assert.equal(isContactSweepEligible(null, 0.9), false);
  assert.equal(isContactSweepEligible(0.9, null), false);
  assert.equal(isContactSweepEligible(null, null), false);
});
