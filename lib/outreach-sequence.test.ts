import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasCompleteBestPracticeCadence,
  sanitizeOutreachMessages,
  withLinkedInInvite,
  type OutreachSequenceMessage,
} from './outreach-sequence';

const generatedCopy: OutreachSequenceMessage[] = [
  { day_offset: 1, subject: 'First email', body: 'Email one', channel: 'email' },
  { day_offset: 4, subject: 'Second email', body: 'Email two', channel: 'email' },
  { day_offset: 8, subject: '', body: 'Thanks for connecting.', channel: 'linkedin' },
  { day_offset: 11, subject: 'Third email', body: 'Email three', channel: 'email' },
  { day_offset: 14, subject: '', body: 'One last LinkedIn note.', channel: 'linkedin' },
  { day_offset: 21, subject: 'Leaving it here', body: 'Email four', channel: 'email' },
];

test('subject-less LinkedIn messages survive staging sanitization', () => {
  const messages = sanitizeOutreachMessages(generatedCopy);
  assert.deepEqual(messages.map((message) => message.day_offset), [1, 4, 8, 11, 14, 21]);
  assert.equal(messages.find((message) => message.day_offset === 8)?.channel, 'linkedin');
  assert.equal(messages.find((message) => message.day_offset === 14)?.channel, 'linkedin');
});

test('the connection request is inserted in canonical order', () => {
  const messages = withLinkedInInvite(generatedCopy);
  assert.deepEqual(messages.map((message) => message.day_offset), [1, 4, 7, 8, 11, 14, 21]);
  assert.deepEqual(messages[2], {
    day_offset: 7,
    subject: '',
    body: '',
    channel: 'linkedin',
  });
  assert.equal(hasCompleteBestPracticeCadence(messages), true);
});

test('stage sanitization produces the complete best-practice cadence', () => {
  const messages = sanitizeOutreachMessages(generatedCopy, { injectLinkedInInvite: true });
  assert.equal(messages.length, 7);
  assert.equal(hasCompleteBestPracticeCadence(messages), true);
});

test('email steps still require both a subject and body', () => {
  const messages = sanitizeOutreachMessages([
    { day_offset: 1, subject: '', body: 'Missing subject', channel: 'email' },
    { day_offset: 4, subject: 'Missing body', body: '', channel: 'email' },
  ]);
  assert.deepEqual(messages, []);
});
