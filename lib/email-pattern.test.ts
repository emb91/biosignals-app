import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyEmailPattern,
  deriveDominantPattern,
  isFreeMailDomain,
  normalizeNamePart,
  synthesizeEmailFromPattern,
} from './email-pattern';
import { getContactEmailDeliverabilityDisplayMeta, shouldRunAutomatedEmailVerification } from './contact-emails';

test('normalizeNamePart strips case, diacritics, hyphens and spaces', () => {
  assert.equal(normalizeNamePart('Jeff'), 'jeff');
  assert.equal(normalizeNamePart('  Núñez '), 'nunez');
  assert.equal(normalizeNamePart("O'Brien"), 'obrien');
  assert.equal(normalizeNamePart('Smith-Jones'), 'smithjones');
  assert.equal(normalizeNamePart('van der Berg'), 'vanderberg');
  assert.equal(normalizeNamePart(null), '');
});

test('classifyEmailPattern: jgraff matches {f}{last}', () => {
  const matches = classifyEmailPattern('jgraff@gardanthealth.com', 'Jeff', 'Graff');
  assert.ok(matches.includes('{f}{last}'));
  assert.ok(!matches.includes('{first}.{last}'));
});

test('classifyEmailPattern: first.last and friends', () => {
  assert.ok(classifyEmailPattern('jeff.graff@x.com', 'Jeff', 'Graff').includes('{first}.{last}'));
  assert.ok(classifyEmailPattern('jeffgraff@x.com', 'Jeff', 'Graff').includes('{first}{last}'));
  assert.ok(classifyEmailPattern('jeff@x.com', 'Jeff', 'Graff').includes('{first}'));
  assert.ok(classifyEmailPattern('graffj@x.com', 'Jeff', 'Graff').includes('{last}{f}'));
});

test('classifyEmailPattern: no name → no matches; unrelated local → no matches', () => {
  assert.deepEqual(classifyEmailPattern('jgraff@x.com', null, null), []);
  assert.deepEqual(classifyEmailPattern('info@x.com', 'Jeff', 'Graff'), []);
});

test('deriveDominantPattern: a single verified sample is enough', () => {
  const derived = deriveDominantPattern([
    { email: 'jgraff@gardanthealth.com', firstName: 'Jeff', lastName: 'Graff' },
  ]);
  assert.ok(derived);
  assert.equal(derived.pattern, '{f}{last}');
  assert.equal(derived.sampleCount, 1);
  assert.equal(derived.totalSamples, 1);
});

test('deriveDominantPattern: 1-vs-1 conflict yields null; 2-vs-1 picks the majority', () => {
  const conflicted = deriveDominantPattern([
    { email: 'jgraff@x.com', firstName: 'Jeff', lastName: 'Graff' },
    { email: 'mary.poppins@x.com', firstName: 'Mary', lastName: 'Poppins' },
  ]);
  assert.equal(conflicted, null);

  const majority = deriveDominantPattern([
    { email: 'jgraff@x.com', firstName: 'Jeff', lastName: 'Graff' },
    { email: 'mpoppins@x.com', firstName: 'Mary', lastName: 'Poppins' },
    { email: 'kate.bell@x.com', firstName: 'Kate', lastName: 'Bell' },
  ]);
  assert.ok(majority);
  assert.equal(majority.pattern, '{f}{last}');
  assert.equal(majority.sampleCount, 2);
  assert.equal(majority.totalSamples, 3);
});

test('deriveDominantPattern: duplicate addresses count once; junk rows are ignored', () => {
  const derived = deriveDominantPattern([
    { email: 'jgraff@x.com', firstName: 'Jeff', lastName: 'Graff' },
    { email: 'JGraff@x.com', firstName: 'Jeff', lastName: 'Graff' },
    { email: 'not-an-email', firstName: 'A', lastName: 'B' },
    { email: 'info@x.com', firstName: 'Front', lastName: 'Desk' },
  ]);
  assert.ok(derived);
  assert.equal(derived.totalSamples, 1);
});

test('synthesizeEmailFromPattern: the Rachel Nagy scenario', () => {
  // Jeff Graff = jgraff@ → Rachel Nagy = rnagy@
  const derived = deriveDominantPattern([
    { email: 'jgraff@gardanthealth.com', firstName: 'Jeff', lastName: 'Graff' },
  ]);
  assert.ok(derived);
  const guess = synthesizeEmailFromPattern(derived.pattern, 'Rachel', 'Nagy', 'gardanthealth.com');
  assert.equal(guess, 'rnagy@gardanthealth.com');
});

test('synthesizeEmailFromPattern: refuses free-mail domains and missing name parts', () => {
  assert.equal(synthesizeEmailFromPattern('{f}{last}', 'Rachel', 'Nagy', 'gmail.com'), null);
  assert.equal(synthesizeEmailFromPattern('{f}{last}', 'Rachel', null, 'x.com'), null);
  assert.equal(synthesizeEmailFromPattern('{first}', null, 'Nagy', 'x.com'), null);
  assert.equal(synthesizeEmailFromPattern('{f}{last}', 'Rachel', 'Nagy', null), null);
});

test('synthesizeEmailFromPattern: normalizes messy input names and domains', () => {
  assert.equal(
    synthesizeEmailFromPattern('{first}.{last}', 'José', "O'Neil-Smith", 'https://www.X.com/about'),
    'jose.oneilsmith@x.com',
  );
});

test('isFreeMailDomain', () => {
  assert.equal(isFreeMailDomain('gmail.com'), true);
  assert.equal(isFreeMailDomain('WWW.Outlook.com'), true);
  assert.equal(isFreeMailDomain('gardanthealth.com'), false);
  assert.equal(isFreeMailDomain(null), false);
});

test('pattern_guessed integrates with deliverability machinery', () => {
  const meta = getContactEmailDeliverabilityDisplayMeta('pattern_guessed');
  assert.equal(meta.icon, 'warning');
  assert.match(meta.label.toLowerCase(), /guess/);

  // Guessed addresses stay eligible for ZeroBounce verification…
  assert.equal(shouldRunAutomatedEmailVerification('pattern_guessed', 'pattern'), true);
  // …but a user override still wins.
  assert.equal(shouldRunAutomatedEmailVerification('pattern_guessed', 'user'), false);
});
