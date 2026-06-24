import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conferencePhase, isConferenceSignalAlive } from './conference-phase';

const start = '2026-06-10';
const end = '2026-06-12';

test('before start -> upcoming', () => {
  assert.equal(conferencePhase(start, end, new Date('2026-05-01')), 'upcoming');
});

test('during event -> live', () => {
  assert.equal(conferencePhase(start, end, new Date('2026-06-11T09:00:00Z')), 'live');
});

test('within 21d after end -> recent', () => {
  assert.equal(conferencePhase(start, end, new Date('2026-06-25')), 'recent');
});

test('past 21d after end -> expired', () => {
  assert.equal(conferencePhase(start, end, new Date('2026-07-10')), 'expired');
});

test('expired conference is not alive (suppressed)', () => {
  assert.equal(isConferenceSignalAlive(start, end, new Date('2026-07-10')), false);
  assert.equal(isConferenceSignalAlive(start, end, new Date('2026-06-25')), true);
});

test('single-day event (no end) reads as live on the day', () => {
  assert.equal(conferencePhase('2026-06-10', null, new Date('2026-06-10T15:00:00Z')), 'live');
});

test('unknown dates -> upcoming (never wrongly expired)', () => {
  assert.equal(conferencePhase(null, null, new Date('2026-07-10')), 'upcoming');
});
