import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_SWEEP_SOURCES,
  CONTACT_SWEEP_SOURCES,
  type AccountSweepSource,
  type ContactSweepSource,
} from './monitoring-sources';
import {
  dueForRollingCadence,
  lookbackDaysForCadence,
} from '../signals/monitor-cadence-rules';

type Subscriber = {
  orgId: string;
  userId: string;
  cadenceDays: number;
  lastSuccessfulAt: number | null;
  status: 'active' | 'paused' | 'cancelled';
};

type DryRunPlan = {
  source: AccountSweepSource | ContactSweepSource;
  entityId: string;
  status: 'active' | 'no_subscribers';
  effectiveCadenceDays: number;
  activeSubscriberCount: number;
  fastestOrgId: string | null;
  lookbackDays: number;
  dueOrgIds: string[];
  gatedOrgIds: string[];
  providerSyncWouldRun: boolean;
  targetWouldAdvance: boolean;
};

function planSharedSweepDryRun(params: {
  source: AccountSweepSource | ContactSweepSource;
  entityId: string;
  subscribers: Subscriber[];
  now: number;
}): DryRunPlan {
  const active = params.subscribers.filter((subscriber) => subscriber.status === 'active');
  if (!active.length) {
    return {
      source: params.source,
      entityId: params.entityId,
      status: 'no_subscribers',
      effectiveCadenceDays: 30,
      activeSubscriberCount: 0,
      fastestOrgId: null,
      lookbackDays: lookbackDaysForCadence(30),
      dueOrgIds: [],
      gatedOrgIds: [],
      providerSyncWouldRun: false,
      targetWouldAdvance: false,
    };
  }

  const fastest = active.reduce((winner, subscriber) => (
    subscriber.cadenceDays < winner.cadenceDays ? subscriber : winner
  ), active[0]);
  const dueOrgIds: string[] = [];
  const gatedOrgIds: string[] = [];
  for (const subscriber of active) {
    if (dueForRollingCadence(subscriber.cadenceDays, subscriber.lastSuccessfulAt, params.now)) {
      dueOrgIds.push(subscriber.orgId);
    } else {
      gatedOrgIds.push(subscriber.orgId);
    }
  }

  return {
    source: params.source,
    entityId: params.entityId,
    status: 'active',
    effectiveCadenceDays: fastest.cadenceDays,
    activeSubscriberCount: active.length,
    fastestOrgId: fastest.orgId,
    lookbackDays: lookbackDaysForCadence(fastest.cadenceDays),
    dueOrgIds,
    gatedOrgIds,
    providerSyncWouldRun: dueOrgIds.length > 0,
    targetWouldAdvance: dueOrgIds.length > 0,
  };
}

const NOW = Date.UTC(2026, 5, 24, 12, 0, 0);
const DAY_MS = 86_400_000;

test('dry run source catalog covers account and contact cadence lanes', () => {
  assert.deepEqual([...ACCOUNT_SWEEP_SOURCES], [
    'hiring',
    'publications',
    'patents',
    'press_releases',
    'funding',
    'grants',
    'fda_regulatory',
    'clinical_trials',
    'conferences',
  ]);
  assert.deepEqual([...CONTACT_SWEEP_SOURCES], [
    'job_change',
    'publications',
    'conference_presenters',
    'conference_social',
  ]);
});

test('dry run: overlapping weekly and monthly subscribers scrape once and gate monthly attribution', () => {
  const plan = planSharedSweepDryRun({
    source: 'hiring',
    entityId: 'company_genentech',
    now: NOW,
    subscribers: [
      {
        orgId: 'org_growth_weekly',
        userId: 'user_growth',
        cadenceDays: 7,
        lastSuccessfulAt: NOW - 8 * DAY_MS,
        status: 'active',
      },
      {
        orgId: 'org_starter_monthly',
        userId: 'user_starter',
        cadenceDays: 30,
        lastSuccessfulAt: NOW - 23 * DAY_MS,
        status: 'active',
      },
    ],
  });

  assert.equal(plan.status, 'active');
  assert.equal(plan.effectiveCadenceDays, 7);
  assert.equal(plan.activeSubscriberCount, 2);
  assert.equal(plan.fastestOrgId, 'org_growth_weekly');
  assert.equal(plan.lookbackDays, 10);
  assert.deepEqual(plan.dueOrgIds, ['org_growth_weekly']);
  assert.deepEqual(plan.gatedOrgIds, ['org_starter_monthly']);
  assert.equal(plan.providerSyncWouldRun, true);
  assert.equal(plan.targetWouldAdvance, true);
});

test('dry run: monthly-only subscriber runs monthly with monthly lookback', () => {
  const plan = planSharedSweepDryRun({
    source: 'press_releases',
    entityId: 'company_genentech',
    now: NOW,
    subscribers: [
      {
        orgId: 'org_starter_monthly',
        userId: 'user_starter',
        cadenceDays: 30,
        lastSuccessfulAt: NOW - 31 * DAY_MS,
        status: 'active',
      },
    ],
  });

  assert.equal(plan.effectiveCadenceDays, 30);
  assert.equal(plan.lookbackDays, 37);
  assert.deepEqual(plan.dueOrgIds, ['org_starter_monthly']);
  assert.deepEqual(plan.gatedOrgIds, []);
  assert.equal(plan.providerSyncWouldRun, true);
});

test('dry run: stale shared target does not trigger provider sync when no subscriber is due', () => {
  const plan = planSharedSweepDryRun({
    source: 'patents',
    entityId: 'company_genentech',
    now: NOW,
    subscribers: [
      {
        orgId: 'org_growth_weekly',
        userId: 'user_growth',
        cadenceDays: 7,
        lastSuccessfulAt: NOW - 3 * DAY_MS,
        status: 'active',
      },
      {
        orgId: 'org_starter_monthly',
        userId: 'user_starter',
        cadenceDays: 30,
        lastSuccessfulAt: NOW - 23 * DAY_MS,
        status: 'active',
      },
    ],
  });

  assert.deepEqual(plan.dueOrgIds, []);
  assert.deepEqual(plan.gatedOrgIds, ['org_growth_weekly', 'org_starter_monthly']);
  assert.equal(plan.providerSyncWouldRun, false);
  assert.equal(plan.targetWouldAdvance, false);
});

test('dry run: cancelled weekly subscriber downgrades shared cadence to monthly', () => {
  const plan = planSharedSweepDryRun({
    source: 'funding',
    entityId: 'company_genentech',
    now: NOW,
    subscribers: [
      {
        orgId: 'org_growth_weekly',
        userId: 'user_growth',
        cadenceDays: 7,
        lastSuccessfulAt: NOW - 8 * DAY_MS,
        status: 'cancelled',
      },
      {
        orgId: 'org_starter_monthly',
        userId: 'user_starter',
        cadenceDays: 30,
        lastSuccessfulAt: NOW - 31 * DAY_MS,
        status: 'active',
      },
    ],
  });

  assert.equal(plan.effectiveCadenceDays, 30);
  assert.equal(plan.activeSubscriberCount, 1);
  assert.equal(plan.fastestOrgId, 'org_starter_monthly');
  assert.deepEqual(plan.dueOrgIds, ['org_starter_monthly']);
});

test('dry run: contact source overlap uses the same subscriber gate', () => {
  const plan = planSharedSweepDryRun({
    source: 'job_change',
    entityId: 'person_contact_at_genentech',
    now: NOW,
    subscribers: [
      {
        orgId: 'org_growth_weekly',
        userId: 'user_growth',
        cadenceDays: 7,
        lastSuccessfulAt: NOW - 8 * DAY_MS,
        status: 'active',
      },
      {
        orgId: 'org_starter_monthly',
        userId: 'user_starter',
        cadenceDays: 30,
        lastSuccessfulAt: NOW - 23 * DAY_MS,
        status: 'active',
      },
    ],
  });

  assert.equal(plan.effectiveCadenceDays, 7);
  assert.deepEqual(plan.dueOrgIds, ['org_growth_weekly']);
  assert.deepEqual(plan.gatedOrgIds, ['org_starter_monthly']);
});

test('dry run: no active subscribers leaves target inert', () => {
  const plan = planSharedSweepDryRun({
    source: 'conference_social',
    entityId: 'person_contact_at_genentech',
    now: NOW,
    subscribers: [
      {
        orgId: 'org_growth_weekly',
        userId: 'user_growth',
        cadenceDays: 7,
        lastSuccessfulAt: NOW - 8 * DAY_MS,
        status: 'paused',
      },
    ],
  });

  assert.equal(plan.status, 'no_subscribers');
  assert.equal(plan.activeSubscriberCount, 0);
  assert.deepEqual(plan.dueOrgIds, []);
  assert.equal(plan.providerSyncWouldRun, false);
});
