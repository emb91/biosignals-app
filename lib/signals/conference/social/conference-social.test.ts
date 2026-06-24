/**
 * Phase 3 social-intent — unit tests (FIXTURES ONLY; no live Apify run).
 *
 * Covers the trust-boundary logic of the pipeline against sample post JSON:
 *   1. Attendance-assertion filter — positive cues assert, negative/spectator cues
 *      hard-drop, reshares drop.
 *   2. Confidence scoring + gating — assertion strength × author-resolution
 *      strength, and the SOCIAL_CONFIDENCE_GATE band.
 *   3. Raw → SocialPostRecord mapping — author block + matched-tag attribution +
 *      unresolvable-author drop.
 *   4. Author → person resolution — "last f" token build + employer cross-check
 *      (the disambiguation guard) + profile-URL key.
 *   5. Dedupe — one (conference, person) per show: highest-confidence post wins.
 *   6. Scrape-window gate — in-window vs too-far-out vs expired.
 *
 * The Apify actor is never invoked — these are pure functions over fixtures, so the
 * test costs nothing and stays inside ToS.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreAttendanceAssertion,
  authorResolutionStrength,
  postConfidence,
  mapPost,
  mapAuthor,
  buildLinkedInInput,
  SOCIAL_CONFIDENCE_GATE,
  DEFAULT_MAX_POSTS_PER_CONFERENCE,
  type RawLinkedInPost,
} from './post-parsing';
import { authorNameToken } from './author-token';
import { employerMatches, normalizeLinkedinKey } from './social-resolution';
import { inSocialScrapeWindow, SOCIAL_PRE_EVENT_LEAD_DAYS } from './scrape-window';
import type { ConferenceForSocialScrape, SocialPostRecord } from './types';

const CONF: ConferenceForSocialScrape = {
  conferenceId: 'conf-asco-2026',
  name: 'ASCO 2026',
  socialTags: ['#ASCO26', '#ASCO2026'],
  startDate: '2026-06-01',
  endDate: '2026-06-05',
};

// ── 1. Attendance-assertion filter ──────────────────────────────────────────────

test('positive cue: "presenting" asserts attendance with high strength', () => {
  const a = scoreAttendanceAssertion("I'm presenting our Phase 2 data at #ASCO26 next week!");
  assert.equal(a.asserts, true);
  assert.equal(a.cue, 'presenting');
  assert.ok(a.confidence >= 0.9);
});

test('positive cue: "come by our booth" asserts attendance', () => {
  const a = scoreAttendanceAssertion('Come by our booth 1203 to chat about biomarkers #ASCO26');
  assert.equal(a.asserts, true);
  assert.ok(a.confidence >= 0.85);
});

test('positive cue: "see you at" asserts but at lower strength', () => {
  const a = scoreAttendanceAssertion('See you at #ASCO26!');
  assert.equal(a.asserts, true);
  assert.equal(a.cue, 'see_you_at');
  assert.ok(a.confidence < 0.85 && a.confidence >= 0.6);
});

test('negative cue: "wish I was at" hard-drops despite the hashtag', () => {
  const a = scoreAttendanceAssertion('Wish I was at #ASCO26 this year — following along online.');
  assert.equal(a.asserts, false);
  assert.equal(a.confidence, 0);
  assert.match(a.cue ?? '', /^negative:/);
});

test('negative cue: "couldn\'t make it" hard-drops', () => {
  const a = scoreAttendanceAssertion("Couldn't make it to #ASCO26 but excited to read the abstracts");
  assert.equal(a.asserts, false);
});

test('negative cue: news/observer voice ("recap of") drops', () => {
  const a = scoreAttendanceAssertion('A recap of the key #ASCO26 readouts you may have missed.');
  assert.equal(a.asserts, false);
});

test('reshare prefix drops', () => {
  const a = scoreAttendanceAssertion('RT @someone: presenting at #ASCO26');
  assert.equal(a.asserts, false);
  assert.equal(a.cue, 'reshare');
});

test('bare hashtag mention with no cue does not assert', () => {
  const a = scoreAttendanceAssertion('Big week for oncology. #ASCO26');
  assert.equal(a.asserts, false);
});

test('empty text does not assert', () => {
  assert.equal(scoreAttendanceAssertion('').asserts, false);
  assert.equal(scoreAttendanceAssertion(null).asserts, false);
});

// ── 2. Confidence scoring + gating ──────────────────────────────────────────────

test('author resolution strength: profile URL > name+company > name only', () => {
  assert.equal(authorResolutionStrength({ name: 'Jane Doe', profileUrl: 'https://linkedin.com/in/janedoe' }), 1);
  assert.equal(authorResolutionStrength({ name: 'Jane Doe', company: 'Acme Bio' }), 0.75);
  assert.equal(authorResolutionStrength({ name: 'Jane Doe' }), 0.55);
  assert.equal(authorResolutionStrength({ name: '' }), 0);
});

test('combined confidence gates: strong assertion + profile URL passes the gate', () => {
  const rec: SocialPostRecord = {
    network: 'linkedin',
    postId: 'p1',
    postUrl: 'https://linkedin.com/posts/p1',
    text: "I'm presenting at #ASCO26",
    author: { name: 'Jane Doe', profileUrl: 'https://linkedin.com/in/janedoe', company: 'Acme Bio' },
    matchedTags: ['#ASCO26'],
  };
  const { confidence } = postConfidence(rec);
  assert.ok(confidence >= SOCIAL_CONFIDENCE_GATE);
});

test('combined confidence gates: weak assertion + name-only falls below the gate', () => {
  const rec: SocialPostRecord = {
    network: 'linkedin',
    postId: 'p2',
    postUrl: '',
    text: 'Excited for #ASCO26', // 0.5 strength
    author: { name: 'Jane Doe' }, // 0.55 strength → 0.275 combined
    matchedTags: ['#ASCO26'],
  };
  const { confidence } = postConfidence(rec);
  assert.ok(confidence < SOCIAL_CONFIDENCE_GATE);
});

test('non-asserting post scores zero confidence', () => {
  const rec: SocialPostRecord = {
    network: 'linkedin',
    postId: 'p3',
    postUrl: '',
    text: 'Wish I was at #ASCO26',
    author: { name: 'Jane Doe', profileUrl: 'https://linkedin.com/in/janedoe' },
    matchedTags: ['#ASCO26'],
  };
  assert.equal(postConfidence(rec).confidence, 0);
});

// ── 3. Raw → SocialPostRecord mapping ───────────────────────────────────────────

test('mapPost maps author block + attributes matched tags + post id', () => {
  const raw: RawLinkedInPost = {
    id: 'urn:li:activity:123',
    url: 'https://www.linkedin.com/posts/janedoe_asco26-activity-123',
    text: "I'll be at #ASCO26 — find me at booth 1203! #ASCO2026",
    postedAt: '2026-05-20T10:00:00Z',
    author: {
      name: 'Jane Doe',
      linkedinUrl: 'https://www.linkedin.com/in/janedoe',
      headline: 'VP Clinical Development',
      companyName: 'Acme Bio',
    },
  };
  const rec = mapPost(raw, CONF);
  assert.ok(rec);
  assert.equal(rec!.postId, 'urn:li:activity:123');
  assert.equal(rec!.author.name, 'Jane Doe');
  assert.equal(rec!.author.profileUrl, 'https://www.linkedin.com/in/janedoe');
  assert.equal(rec!.author.company, 'Acme Bio');
  assert.deepEqual([...rec!.matchedTags].sort(), ['#ASCO2026', '#ASCO26']);
});

test('mapPost falls back to all conference tags when none appear literally in text', () => {
  const raw: RawLinkedInPost = {
    id: 'p4',
    url: 'https://linkedin.com/posts/p4',
    text: 'Presenting our data at the big oncology meeting (tag in the image)',
    author: { name: 'Sam Lee', linkedinUrl: 'https://linkedin.com/in/samlee' },
  };
  const rec = mapPost(raw, CONF);
  assert.deepEqual(rec!.matchedTags, CONF.socialTags);
});

test('mapAuthor returns null when neither name nor profile URL is present', () => {
  assert.equal(mapAuthor({ text: 'hi' }), null);
});

test('mapPost drops an item with an unresolvable author', () => {
  assert.equal(mapPost({ id: 'p5', text: 'presenting at #ASCO26' }, CONF), null);
});

test('buildLinkedInInput caps posts and one query per tag', () => {
  const input = buildLinkedInInput(CONF);
  assert.deepEqual(input.searchQueries, CONF.socialTags);
  assert.equal(input.maxPosts, DEFAULT_MAX_POSTS_PER_CONFERENCE);
  assert.equal(input.postedLimit, 'month');
});

// ── 4. Author → person resolution ───────────────────────────────────────────────

test('authorNameToken builds lowercase "last f" from "First Last"', () => {
  assert.equal(authorNameToken('Jane Doe'), 'doe j');
});

test('authorNameToken handles "Last, First" and strips credentials/honorifics', () => {
  assert.equal(authorNameToken('Doe, Jane'), 'doe j');
  assert.equal(authorNameToken('Dr. Jane A. Doe, PhD'), 'doe j');
});

test('authorNameToken returns null for single-token names', () => {
  assert.equal(authorNameToken('Madonna'), null);
  assert.equal(authorNameToken(''), null);
});

test('employerMatches: contact company name appears as a whole word in the stated employer', () => {
  assert.equal(employerMatches('Acme Bio', [], 'Acme Bio, Inc.'), 'Acme Bio, Inc.');
  assert.ok(employerMatches('Acme', [], 'Acme Therapeutics'));
});

test('employerMatches: a different employer is rejected (token disambiguation guard)', () => {
  assert.equal(employerMatches('Acme Bio', [], 'Globex Pharmaceuticals'), null);
});

test('employerMatches: short aliases (<4 chars) are not trusted', () => {
  // "BMS" would substring-match too aggressively; rejected unless the full name hits.
  assert.equal(employerMatches('Bristol Myers Squibb', ['BMS'], 'BMScience Labs'), null);
});

test('employerMatches: qualifying alias matches as a whole word', () => {
  assert.ok(employerMatches('Bristol Myers Squibb', ['Bristol-Myers'], 'Bristol Myers oncology team'));
});

test('normalizeLinkedinKey strips scheme/host noise and keeps /in/ profiles only', () => {
  assert.equal(
    normalizeLinkedinKey('https://www.linkedin.com/in/janedoe/'),
    'linkedin.com/in/janedoe',
  );
  // Company page (not /in/) is not a person key.
  assert.equal(normalizeLinkedinKey('https://www.linkedin.com/company/acme'), '');
  assert.equal(normalizeLinkedinKey(null), '');
});

// ── 5. Dedupe: one (conference, person) per show — highest-confidence wins ───────

test('dedupe by author token keeps the highest-confidence asserting post', () => {
  // Two posts from the same author at the same show: a weak one and a strong one.
  const posts: SocialPostRecord[] = [
    {
      network: 'linkedin',
      postId: 'a',
      postUrl: 'https://linkedin.com/posts/a',
      text: 'Excited for #ASCO26', // weak (0.5)
      author: { name: 'Jane Doe', profileUrl: 'https://linkedin.com/in/janedoe', company: 'Acme Bio' },
      matchedTags: ['#ASCO26'],
    },
    {
      network: 'linkedin',
      postId: 'b',
      postUrl: 'https://linkedin.com/posts/b',
      text: "I'm presenting at #ASCO26", // strong (0.95)
      author: { name: 'Jane Doe', profileUrl: 'https://linkedin.com/in/janedoe', company: 'Acme Bio' },
      matchedTags: ['#ASCO26'],
    },
  ];

  // Mirror the sync's dedupe: one entry per author token, highest confidence wins.
  const byToken = new Map<string, { postId: string; confidence: number }>();
  for (const post of posts) {
    const { assertion, confidence } = postConfidence(post);
    if (!assertion.asserts) continue;
    const token = authorNameToken(post.author.name)!;
    const prior = byToken.get(token);
    if (!prior || confidence > prior.confidence) {
      byToken.set(token, { postId: post.postId, confidence });
    }
  }

  assert.equal(byToken.size, 1);
  assert.equal(byToken.get('doe j')!.postId, 'b'); // the strong post is the evidence
});

// ── 6. Scrape-window gate ───────────────────────────────────────────────────────

test('window gate: in-window during pre-event lead', () => {
  const now = new Date('2026-05-25'); // 7 days before start
  const { inWindow, phase } = inSocialScrapeWindow('2026-06-01', '2026-06-05', now);
  assert.equal(inWindow, true);
  assert.equal(phase, 'upcoming');
});

test('window gate: too far out (before the lead) is not scraped', () => {
  const now = new Date('2026-01-01'); // ~5 months out, beyond the 6-week lead
  const { inWindow } = inSocialScrapeWindow('2026-06-01', '2026-06-05', now);
  assert.equal(inWindow, false);
});

test('window gate: live and recent are in-window; expired is not', () => {
  assert.equal(inSocialScrapeWindow('2026-06-01', '2026-06-05', new Date('2026-06-03')).inWindow, true);
  assert.equal(inSocialScrapeWindow('2026-06-01', '2026-06-05', new Date('2026-06-10')).inWindow, true);
  assert.equal(inSocialScrapeWindow('2026-06-01', '2026-06-05', new Date('2026-07-15')).inWindow, false);
});

test('window gate: lead constant is ~6 weeks', () => {
  assert.equal(SOCIAL_PRE_EVENT_LEAD_DAYS, 42);
});
