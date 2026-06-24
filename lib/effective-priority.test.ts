import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authoritativeAccountReadiness,
  CRM_SUPPRESSED_READINESS,
  computeIntrinsicPriority,
  effectiveReadiness,
  isCrmSuppressed,
  isEligibleForPriorityNudge,
  resolveEffectivePriority,
} from './effective-priority';

test('active entities preserve their intrinsic priority', () => {
  const result = resolveEffectivePriority({
    intrinsicPriority: 0.89,
    companyFit: 1,
    contactFit: 1,
    intrinsicReadiness: 0.78,
    crmState: 'active',
  });

  assert.equal(result.isSuppressed, false);
  assert.equal(result.intrinsicPriority, 0.89);
  assert.equal(result.effectivePriority, 0.89);
  assert.equal(result.effectiveReadiness, 0.78);
});

test('closed-lost contact keeps intrinsic 100 but resolves to effective 51', () => {
  const result = resolveEffectivePriority({
    intrinsicPriority: 1,
    companyFit: 1,
    contactFit: 1,
    intrinsicReadiness: 1,
    crmState: 'dormant',
    crmClosedAt: '2026-06-01T00:00:00.000Z',
    asOfMs: Date.parse('2026-06-22T00:00:00.000Z'),
  });

  assert.equal(result.isSuppressed, true);
  assert.equal(result.intrinsicPriority, 1);
  assert.equal(result.effectiveReadiness, CRM_SUPPRESSED_READINESS);
  assert.equal(result.effectivePriority, 0.505);
});

test('suppression expiry restores intrinsic priority', () => {
  const result = resolveEffectivePriority({
    intrinsicPriority: 0.91,
    companyFit: 1,
    contactFit: 1,
    intrinsicReadiness: 0.82,
    crmState: 'dormant',
    crmClosedAt: '2025-01-01T00:00:00.000Z',
    asOfMs: Date.parse('2026-06-22T00:00:00.000Z'),
  });

  assert.equal(result.isSuppressed, false);
  assert.equal(result.effectivePriority, 0.91);
});

test('denormalized suppression state takes precedence for SQL-backed consumers', () => {
  const result = resolveEffectivePriority({
    intrinsicPriority: 0.9,
    companyFit: 0.8,
    intrinsicReadiness: 1,
    crmState: 'active',
    crmIsSuppressed: true,
  });

  assert.equal(result.isSuppressed, true);
  assert.equal(result.effectivePriority, 0.404);
});

test('contact effective readiness still combines account and personal signals', () => {
  assert.equal(effectiveReadiness(0.8, 0.4), 0.8400000000000001);
  assert.equal(effectiveReadiness(null, 0.6), 0.6);
});

test('account snapshot readiness wins over stale company-state mirror', () => {
  const staleMirrorReadiness = 0.52;
  const snapshotReadiness = 1;
  const readiness = authoritativeAccountReadiness(snapshotReadiness, staleMirrorReadiness);

  assert.equal(readiness, 1);
  assert.equal(
    computeIntrinsicPriority({
      companyFit: 0.9,
      contactFit: 1,
      readiness,
    }),
    0.9,
  );
  assert.equal(
    computeIntrinsicPriority({
      companyFit: 0.9,
      contactFit: 1,
      readiness: staleMirrorReadiness,
    }),
    0.684,
  );
});

test('priority-change nudges fail closed on suppressed or unknown eligibility', () => {
  assert.equal(isEligibleForPriorityNudge(false), true);
  assert.equal(isEligibleForPriorityNudge(true), false);
  assert.equal(isEligibleForPriorityNudge(null), false);
  assert.equal(isEligibleForPriorityNudge(undefined), false);
});

test('CRM cooldown policy remains won 365 days and lost 180 days', () => {
  const close = '2026-01-01T00:00:00.000Z';
  assert.equal(isCrmSuppressed('dormant', close, Date.parse('2026-06-01T00:00:00.000Z')), true);
  assert.equal(isCrmSuppressed('dormant', close, Date.parse('2026-08-01T00:00:00.000Z')), false);
  assert.equal(isCrmSuppressed('customer', close, Date.parse('2026-08-01T00:00:00.000Z')), true);
});
