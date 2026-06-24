/**
 * Conference registry-refresh helper regression stub.
 *
 * The registry-refresh monitor (refresh-registry.ts) keeps the `conferences`
 * table pointed at each recurring show's LIVE edition. Its load-bearing logic is
 * the pure, network-free helpers in registry-refresh-helpers.ts: bumping the year
 * token in a platform source-key/URL, deciding a platform's resolution strategy,
 * the liveness gate, and the stable-URL date parser. This test pins those so a
 * regression there surfaces here, the same way conference-name-match.test.ts pins
 * the adapter parsers.
 *
 * Run (mirrors the conference test wiring; see tsconfig.test.*.json):
 *   npm run test:conference-registry-refresh
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bumpYearToken,
  extractEditionDates,
  looksLikeLiveEdition,
  mapYourShowProbeUrl,
  nextEditionSourceKey,
  refreshStrategyForPlatform,
  smallWorldLabsProbeUrl,
} from './registry-refresh-helpers';

// ── year-token bumping ───────────────────────────────────────────────────────
test('bumpYearToken bumps a 2-digit mapyourshow show code, preserving width', () => {
  assert.equal(bumpYearToken('ashg26'), 'ashg27');
  assert.equal(bumpYearToken('medtech26'), 'medtech27');
  assert.equal(bumpYearToken('ispeam26'), 'ispeam27');
  // Decade rollover stays 2-digit.
  assert.equal(bumpYearToken('foo29'), 'foo30');
});

test('bumpYearToken bumps a 4-digit show code/slug, preserving width', () => {
  assert.equal(bumpYearToken('idweek2026'), 'idweek2027');
  assert.equal(bumpYearToken('asgct2026'), 'asgct2027');
  assert.equal(bumpYearToken('ahasessions2026'), 'ahasessions2027');
});

test('bumpYearToken prefers the 4-digit token (does not cut the trailing 2 digits)', () => {
  // "idweek2026" must become "idweek2027", not "idweek2027" via a bad "26"->"27"
  // cut that would leave "idweek2027" — assert the whole 4-digit token moved.
  assert.equal(bumpYearToken('idweek2026'), 'idweek2027');
});

test('bumpYearToken returns null when there is no year token', () => {
  assert.equal(bumpYearToken('bioprocessing'), null);
  assert.equal(bumpYearToken(''), null);
});

// ── per-platform strategy ────────────────────────────────────────────────────
test('refreshStrategyForPlatform classifies each platform', () => {
  assert.equal(refreshStrategyForPlatform('mapyourshow'), 'templated');
  assert.equal(refreshStrategyForPlatform('smallworldlabs'), 'templated');
  assert.equal(refreshStrategyForPlatform('terrapinn'), 'stable');
  assert.equal(refreshStrategyForPlatform('informa'), 'stable');
  // Opaque-eventId + uncracked platforms are manual (left for human seeding).
  assert.equal(refreshStrategyForPlatform('abstractsonline'), 'manual');
  assert.equal(refreshStrategyForPlatform('a2z'), 'manual');
  assert.equal(refreshStrategyForPlatform('spargo'), 'manual');
  assert.equal(refreshStrategyForPlatform('conference_harvester'), 'manual');
});

// ── next-edition source-key derivation ───────────────────────────────────────
test('nextEditionSourceKey bumps a mapyourshow show code', () => {
  assert.equal(nextEditionSourceKey('mapyourshow', 'ashg26'), 'ashg27');
  assert.equal(nextEditionSourceKey('mapyourshow', 'idweek2026'), 'idweek2027');
});

test('nextEditionSourceKey bumps a smallworldlabs bare subdomain', () => {
  assert.equal(nextEditionSourceKey('smallworldlabs', 'asgct2026'), 'asgct2027');
});

test('nextEditionSourceKey bumps the year only in a smallworldlabs full-URL host', () => {
  assert.equal(
    nextEditionSourceKey('smallworldlabs', 'https://asgct2026.smallworldlabs.com/exhibitors'),
    'https://asgct2027.smallworldlabs.com/exhibitors',
  );
});

test('nextEditionSourceKey returns null for stable / manual platforms', () => {
  assert.equal(nextEditionSourceKey('terrapinn', 'whatever'), null);
  assert.equal(nextEditionSourceKey('informa', 'whatever'), null);
  assert.equal(nextEditionSourceKey('abstractsonline', 'whatever'), null);
});

// ── probe URLs ───────────────────────────────────────────────────────────────
test('probe URLs follow the platform conventions', () => {
  assert.equal(mapYourShowProbeUrl('ashg27'), 'https://ashg27.mapyourshow.com/');
  assert.equal(
    smallWorldLabsProbeUrl('asgct2027'),
    'https://asgct2027.smallworldlabs.com/exhibitors',
  );
  // A full URL is passed through untouched.
  assert.equal(
    smallWorldLabsProbeUrl('https://asgct2027.smallworldlabs.com/exhibitors'),
    'https://asgct2027.smallworldlabs.com/exhibitors',
  );
});

// ── liveness gate ────────────────────────────────────────────────────────────
test('looksLikeLiveEdition accepts a real page and rejects shells/placeholders', () => {
  const realPage = '<html>' + 'x'.repeat(2000) + '</html>';
  assert.equal(looksLikeLiveEdition(200, realPage), true);
  // Non-2xx/3xx-ok → not live.
  assert.equal(looksLikeLiveEdition(404, realPage), false);
  assert.equal(looksLikeLiveEdition(500, realPage), false);
  // Tiny body (redirect stub / empty shell) → not live.
  assert.equal(looksLikeLiveEdition(200, '<html></html>'), false);
  // Explicit not-found / coming-soon text → not live even if large.
  assert.equal(looksLikeLiveEdition(200, 'Coming soon ' + 'x'.repeat(2000)), false);
  assert.equal(looksLikeLiveEdition(200, 'Page not found ' + 'x'.repeat(2000)), false);
});

// ── stable-URL date extraction ───────────────────────────────────────────────
test('extractEditionDates reads a "13 - 14 April 2027" day range (terrapinn)', () => {
  assert.deepEqual(extractEditionDates('Join us 13 - 14 April 2027 in Boston'), {
    startDate: '2027-04-13',
    endDate: '2027-04-14',
  });
  assert.deepEqual(extractEditionDates('8-11 March 2027'), {
    startDate: '2027-03-08',
    endDate: '2027-03-11',
  });
});

test('extractEditionDates reads an "April 13-14, 2027" month-first range (informa)', () => {
  assert.deepEqual(extractEditionDates('Conference dates: April 13-14, 2027'), {
    startDate: '2027-04-13',
    endDate: '2027-04-14',
  });
  assert.deepEqual(extractEditionDates('September 23 - 25, 2026'), {
    startDate: '2026-09-23',
    endDate: '2026-09-25',
  });
});

test('extractEditionDates prefers machine-readable <time datetime> tags', () => {
  const html = '<time datetime="2027-03-08T09:00">8 Mar</time> to <time datetime="2027-03-11">11 Mar</time>';
  assert.deepEqual(extractEditionDates(html), {
    startDate: '2027-03-08',
    endDate: '2027-03-11',
  });
});

test('extractEditionDates reads a single-day event', () => {
  assert.deepEqual(extractEditionDates('A one-day summit on 23 September 2026.'), {
    startDate: '2026-09-23',
    endDate: '2026-09-23',
  });
  assert.deepEqual(extractEditionDates('Held September 24, 2026 only'), {
    startDate: '2026-09-24',
    endDate: '2026-09-24',
  });
});

test('extractEditionDates returns nulls when no confident date is present', () => {
  assert.deepEqual(extractEditionDates('<html>no dates here</html>'), {
    startDate: null,
    endDate: null,
  });
});
