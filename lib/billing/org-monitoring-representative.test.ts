import test from 'node:test';
import assert from 'node:assert/strict';
import { pickOrgMonitoringRepresentative } from './org-monitoring-representative';

test('picks one stable monitoring representative for an org', () => {
  const representative = pickOrgMonitoringRepresentative([
    {
      userId: 'user_member_early',
      role: 'member',
      joinedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      userId: 'user_admin_late',
      role: 'admin',
      joinedAt: '2026-02-01T00:00:00.000Z',
      createdAt: '2026-02-01T00:00:00.000Z',
    },
    {
      userId: 'user_owner',
      role: 'owner',
      joinedAt: '2026-03-01T00:00:00.000Z',
      createdAt: '2026-03-01T00:00:00.000Z',
    },
  ]);

  assert.equal(representative?.userId, 'user_owner');
});

test('uses join/create time and user id for deterministic tie breaks', () => {
  const representative = pickOrgMonitoringRepresentative([
    {
      userId: 'user_b',
      role: 'member',
      joinedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-02T00:00:00.000Z',
    },
    {
      userId: 'user_a',
      role: 'member',
      joinedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ]);

  assert.equal(representative?.userId, 'user_a');
});

test('returns null when an org has no usable members', () => {
  assert.equal(pickOrgMonitoringRepresentative([]), null);
  assert.equal(
    pickOrgMonitoringRepresentative([
      { userId: '', role: 'owner', joinedAt: null, createdAt: null },
    ]),
    null,
  );
});
