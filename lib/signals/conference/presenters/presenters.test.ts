/**
 * Phase 2 presenters pipeline — unit tests (no network).
 *
 * Covers:
 *   1. eventScribe parse (against a fixture slice of the live ASCPT 2026 program):
 *      names, affiliations, roles, nearest-preceding session-title attribution,
 *      credential/pronoun stripping, the affiliation-without-dash case, and the
 *      404 shell → [] behavior.
 *   2. Person/company resolution edge cases: the "Last F" token, generic-name
 *      rejection, two-factor admission (token + affiliation must match company),
 *      and a token-collision-with-wrong-company rejection.
 *   3. Monitor dedupe admission (presenterContactAdmission fail-closed).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseEventScribeAgenda,
  splitNameAndCredential,
  cleanAffiliation,
  roleLabelToAppearanceType,
  decodeHtmlEntities,
} from './eventscribe-adapter';
import {
  EVENTSCRIBE_ASCPT2026_FIXTURE,
  EVENTSCRIBE_404_SHELL,
} from './eventscribe-fixture';
import {
  speakerNameToken,
  normalizedSpeakerToken,
  affiliationMatchesCompany,
  resolvePresenterPeople,
  containsWholeWord,
  presenterContactAdmission,
  type PersonTokenCandidate,
} from './presenter-resolution';

const SRC = 'https://ascpt2026.eventscribe.net/agenda.asp?pfp=FullSchedule&all=1';

// ── 1. eventScribe parse ─────────────────────────────────────────────────────

test('parse: extracts the named presenters from the fixture', () => {
  const recs = parseEventScribeAgenda(EVENTSCRIBE_ASCPT2026_FIXTURE, SRC);
  const names = recs.map((r) => r.speakerName);
  assert.ok(names.includes('Sandra A.G Visser'), 'Visser present');
  assert.ok(names.includes('Brian W. Corrigan'), 'Corrigan present');
  assert.ok(names.includes('Sarah Kim'), 'Kim present');
  assert.ok(names.includes('Dan M. Roden'), 'Roden present');
  assert.ok(names.includes('Gwenn S. Smith'), 'Smith present');
  assert.equal(recs.length, 6, 'six distinct appearances in the fixture');
});

test('parse: affiliations are captured and the trailing role title is dropped', () => {
  const recs = parseEventScribeAgenda(EVENTSCRIBE_ASCPT2026_FIXTURE, SRC);
  const visser = recs.find((r) => r.speakerName === 'Sandra A.G Visser');
  assert.ok(visser);
  // "Quantivis LLC, ASCPT President" → "Quantivis LLC"
  assert.equal(visser?.affiliationRaw, 'Quantivis LLC');
  assert.equal(recs.find((r) => r.speakerName === 'Sarah Kim')?.affiliationRaw, 'University of Florida');
  assert.equal(recs.find((r) => r.speakerName === 'Brian W. Corrigan')?.affiliationRaw, 'Metrum RG');
});

test('parse: a presenter with no affiliation (no dash) has undefined affiliation', () => {
  const recs = parseEventScribeAgenda(EVENTSCRIBE_ASCPT2026_FIXTURE, SRC);
  const reynolds = recs.find((r) => r.speakerName === 'Kellie S. Reynolds');
  assert.ok(reynolds, 'Reynolds present even without affiliation');
  assert.equal(reynolds?.affiliationRaw, undefined);
});

test('parse: session title is the nearest PRECEDING list-row-primary (not the block head)', () => {
  const recs = parseEventScribeAgenda(EVENTSCRIBE_ASCPT2026_FIXTURE, SRC);
  // The "Speaker Ready Room" span precedes these anchors, but the correct
  // session is "Opening Session …" — nearest-preceding attribution.
  const visser = recs.find((r) => r.speakerName === 'Sandra A.G Visser');
  assert.equal(visser?.sessionTitle, 'Opening Session (brought to you by Pfizer)');
  // The poster moderator belongs to a different, later session.
  const smith = recs.find((r) => r.speakerName === 'Gwenn S. Smith');
  assert.equal(smith?.sessionTitle, 'Moderated Poster Session: Pharmacometrics');
  // Nobody should be attributed to "Speaker Ready Room" (it has no presenters).
  assert.ok(!recs.some((r) => r.sessionTitle === 'Speaker Ready Room'));
});

test('parse: appearance types map from the role label', () => {
  const recs = parseEventScribeAgenda(EVENTSCRIBE_ASCPT2026_FIXTURE, SRC);
  assert.equal(recs.find((r) => r.speakerName === 'Sandra A.G Visser')?.appearanceType, 'chair');
  assert.equal(recs.find((r) => r.speakerName === 'Gwenn S. Smith')?.appearanceType, 'moderator');
  // "Award Recipient" is an unknown label → falls back to 'presenter'.
  assert.equal(recs.find((r) => r.speakerName === 'Dan M. Roden')?.appearanceType, 'presenter');
});

test('parse: abstract_url points at the per-presenter detail; no email captured', () => {
  const recs = parseEventScribeAgenda(EVENTSCRIBE_ASCPT2026_FIXTURE, SRC);
  const visser = recs.find((r) => r.speakerName === 'Sandra A.G Visser');
  assert.match(visser?.abstractUrl ?? '', /presenterInfo\.asp\?HPRID=830451$/);
  assert.equal((visser as { publishedEmail?: string }).publishedEmail, undefined);
});

test('parse: the 404 shell yields no records', () => {
  assert.deepEqual(parseEventScribeAgenda(EVENTSCRIBE_404_SHELL, SRC), []);
});

test('splitNameAndCredential: strips credential + pronouns into speakerTitle', () => {
  const a = splitNameAndCredential('Sandra A.G Visser, PhD (she/her/hers)');
  assert.equal(a.speakerName, 'Sandra A.G Visser');
  assert.match(a.speakerTitle ?? '', /PhD/);
  assert.match(a.speakerTitle ?? '', /she\/her\/hers/);

  const b = splitNameAndCredential('Kellie S. Reynolds, PharmD');
  assert.equal(b.speakerName, 'Kellie S. Reynolds');
  assert.equal(b.speakerTitle, 'PharmD');
});

test('cleanAffiliation: decodes, drops dash, keeps first comma segment', () => {
  assert.equal(cleanAffiliation(' &ndash; Quantivis LLC, ASCPT President'), 'Quantivis LLC');
  assert.equal(cleanAffiliation(''), undefined);
});

test('roleLabelToAppearanceType: known labels map, unknown falls back to presenter', () => {
  assert.equal(roleLabelToAppearanceType('Chair'), 'chair');
  assert.equal(roleLabelToAppearanceType('Moderator'), 'moderator');
  assert.equal(roleLabelToAppearanceType('State of the Art Speaker'), 'speaker');
  assert.equal(roleLabelToAppearanceType('Award Lecturer'), 'speaker');
  assert.equal(roleLabelToAppearanceType('Award Recipient'), 'presenter');
});

test('decodeHtmlEntities: handles ndash / amp / numeric', () => {
  assert.equal(decodeHtmlEntities('A &amp; B &ndash; C &#39;D&#39;'), "A & B – C 'D'");
});

// ── 2. Person / company resolution ───────────────────────────────────────────

test('speakerNameToken: "First Last" → "Last F"', () => {
  assert.equal(speakerNameToken('Sarah Kim'), 'Kim S');
  assert.equal(speakerNameToken('Sandra A.G Visser'), 'Visser S');
});

test('speakerNameToken: strips a surviving credential / pronoun tail', () => {
  assert.equal(speakerNameToken('Dan M. Roden, MD'), 'Roden D');
  assert.equal(speakerNameToken('Gwenn S. Smith, PhD (she/her/hers)'), 'Smith G');
});

test('speakerNameToken: single-word / empty names yield null', () => {
  assert.equal(speakerNameToken('Madonna'), null);
  assert.equal(speakerNameToken(''), null);
});

test('normalizedSpeakerToken: lowercases the token', () => {
  assert.equal(normalizedSpeakerToken('Sarah Kim'), 'kim s');
});

test('containsWholeWord: word-boundary, not substring', () => {
  assert.equal(containsWholeWord('university of florida', 'florida'), true);
  assert.equal(containsWholeWord('forbayer institute', 'bayer'), false);
});

test('affiliationMatchesCompany: matches a distinctive company name', () => {
  assert.equal(affiliationMatchesCompany('Metrum Research Group', ['Metrum RG'], 'Metrum RG'), true);
  assert.equal(
    affiliationMatchesCompany('University of Florida', [], 'University of Florida'),
    true,
  );
});

test('affiliationMatchesCompany: generic-only company name is rejected', () => {
  // No distinctive token → never match (the publications-monitor guard).
  assert.equal(affiliationMatchesCompany('Bio Therapeutics', [], 'Acme Bio Therapeutics'), false);
});

test('affiliationMatchesCompany: no overlap → false', () => {
  assert.equal(affiliationMatchesCompany('Quantivis LLC', [], 'University of Florida'), false);
});

test('resolvePresenterPeople: admits on token + affiliation match', () => {
  const index = new Map<string, PersonTokenCandidate[]>([
    ['kim s', [{ personId: 'p-kim', companyId: 'c-uf', companyName: 'University of Florida', companyAliases: [] }]],
  ]);
  const out = resolvePresenterPeople('Sarah Kim', 'University of Florida', index);
  assert.equal(out.length, 1);
  assert.equal(out[0].personId, 'p-kim');
  assert.equal(out[0].companyId, 'c-uf');
});

test('resolvePresenterPeople: token collision with WRONG company is rejected', () => {
  // Two "Kim S" people at different companies; the appearance affiliation only
  // matches one. The other must NOT be admitted (the false-positive guard).
  const index = new Map<string, PersonTokenCandidate[]>([
    [
      'kim s',
      [
        { personId: 'p-uf', companyId: 'c-uf', companyName: 'University of Florida', companyAliases: [] },
        { personId: 'p-pfizer', companyId: 'c-pf', companyName: 'Pfizer', companyAliases: [] },
      ],
    ],
  ]);
  const out = resolvePresenterPeople('Sarah Kim', 'University of Florida', index);
  assert.equal(out.length, 1);
  assert.equal(out[0].personId, 'p-uf');
});

test('resolvePresenterPeople: a "Last F" token with no affiliation match is rejected', () => {
  const index = new Map<string, PersonTokenCandidate[]>([
    ['kim s', [{ personId: 'p-kim', companyId: 'c-uf', companyName: 'University of Florida', companyAliases: [] }]],
  ]);
  // Bare name, no affiliation → cannot verify → no admission.
  assert.deepEqual(resolvePresenterPeople('Sarah Kim', null, index), []);
  // Wrong affiliation → no admission either.
  assert.deepEqual(resolvePresenterPeople('Sarah Kim', 'Some Other Place', index), []);
});

// ── 3. Monitor admission / dedupe guard ──────────────────────────────────────

test('presenterContactAdmission: admits a verified speaker match', () => {
  const matches = [
    {
      source_field: 'speaker_name',
      person_id: 'p-1',
      company_id: 'c-1',
      verified: true,
      verification_reason: 'token + affiliation cross-check',
    },
  ];
  const a = presenterContactAdmission({
    personId: 'p-1',
    matches,
    acceptedSourceFields: ['speaker_name', 'affiliation'],
  });
  assert.equal(a.admitted, true);
  assert.equal(a.matchType, 'verified_presenter');
  assert.equal(a.companyId, 'c-1');
});

test('presenterContactAdmission: fails closed for an unverified match', () => {
  const matches = [{ source_field: 'speaker_name', person_id: 'p-1', verified: false }];
  const a = presenterContactAdmission({ personId: 'p-1', matches, acceptedSourceFields: ['speaker_name'] });
  assert.equal(a.admitted, false);
  assert.equal(a.matchType, 'verified_presenter_rejected');
});

test('presenterContactAdmission: fails closed when no match for the person', () => {
  const matches = [{ source_field: 'speaker_name', person_id: 'p-other', verified: true }];
  const a = presenterContactAdmission({ personId: 'p-1', matches, acceptedSourceFields: ['speaker_name'] });
  assert.equal(a.admitted, false);
});

test('presenterContactAdmission: rejects a verified match on a non-accepted source field', () => {
  const matches = [{ source_field: 'bio_text', person_id: 'p-1', verified: true }];
  const a = presenterContactAdmission({ personId: 'p-1', matches, acceptedSourceFields: ['speaker_name'] });
  assert.equal(a.admitted, false);
});

// ── Informa /speakers/ adapter ──────────────────────────────────────────────
import { parseInformaSpeakers } from './informa-agenda-adapter';

const INFORMA_SPEAKERS_FIXTURE =
  '{"selectedField":"NAME","speakers":[' +
  '{"@class":"informa.event.view.speaker.EsSpeakerView","forename":"Todd","surname":"McDevitt","jobTitle":"Vice President, Cell Therapy","company":"Genentech","path":"todd-mcdevitt","logo":{"url":"x.jpg"}},' +
  '{"@class":"informa.event.view.speaker.EsSpeakerView","forename":"Arvind","surname":"Natarajan","jobTitle":"SVP, Technical Development","company":"Iovance Biotherapeutics","path":"arvind-natarajan"},' +
  // duplicate of the first — must dedupe on name+company
  '{"@class":"informa.event.view.speaker.EsSpeakerView","forename":"Todd","surname":"McDevitt","jobTitle":"Vice President, Cell Therapy","company":"Genentech","path":"todd-mcdevitt-2"},' +
  // unicode-escaped affiliation must decode
  '{"@class":"informa.event.view.speaker.EsSpeakerView","forename":"Jos\\u00e9","surname":"Garc\\u00eda","jobTitle":"CSO","company":"BioNova S\\u00e0rl","path":"jose"}' +
  ']}';

test('parseInformaSpeakers: extracts name + affiliation + title, dedupes, decodes unicode', () => {
  const rows = parseInformaSpeakers(INFORMA_SPEAKERS_FIXTURE, 'https://informaconnect.com/x/speakers/');
  assert.equal(rows.length, 3); // 4 objects, 1 is a dup
  const todd = rows.find((r) => r.speakerName === 'Todd McDevitt');
  assert.ok(todd);
  assert.equal(todd.affiliationRaw, 'Genentech');
  assert.equal(todd.speakerTitle, 'Vice President, Cell Therapy');
  assert.equal(todd.appearanceType, 'speaker');
  assert.equal(rows.find((r) => r.affiliationRaw === 'BioNova Sàrl')?.speakerName, 'José García');
});

test('parseInformaSpeakers: empty / non-speaker html yields no rows', () => {
  assert.equal(parseInformaSpeakers('<html>no speakers here</html>', 'u').length, 0);
});
