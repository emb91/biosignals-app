/**
 * Tests for the company merge + identifier safety primitives.
 *
 * Pure-function tests (no DB / LLM deps), run via `node --test`:
 *   npm run test:company-merge
 *
 * These lock in the two production bug classes these helpers prevent:
 *   - destructive identity clobber (Moderna → "Moderna Housewares")
 *   - overly-permissive external lookups (name fuzzy-matching the wrong entity)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { stickyIdentity, pickStrongestIdentifier, STICKY_COMPANY_IDENTITY_FIELDS } from './company-merge';

test('stickyIdentity: existing value wins over fresh (the Moderna clobber fix)', () => {
  // Enriching biotech Moderna; a fuzzy match returned "Moderna Housewares".
  assert.equal(stickyIdentity('Moderna', 'Moderna Housewares'), 'Moderna');
  assert.equal(stickyIdentity('moderna.com', 'modernahousewares.com'), 'moderna.com');
});

test('stickyIdentity: falls through to fresh when existing is empty (new row)', () => {
  assert.equal(stickyIdentity(null, 'Moderna Therapeutics'), 'Moderna Therapeutics');
  assert.equal(stickyIdentity(undefined, 'Moderna Therapeutics'), 'Moderna Therapeutics');
  assert.equal(stickyIdentity('', 'Moderna Therapeutics'), 'Moderna Therapeutics');
  assert.equal(stickyIdentity('   ', 'Moderna Therapeutics'), 'Moderna Therapeutics');
});

test('stickyIdentity: tries each fresh value in order, returns null when nothing present', () => {
  assert.equal(stickyIdentity(null, null, '', 'third'), 'third');
  assert.equal(stickyIdentity(null, null, ''), null);
  assert.equal(stickyIdentity(undefined), null);
});

test('stickyIdentity: works for non-string identity values', () => {
  assert.equal(stickyIdentity<number>(42, 99), 42);
  assert.equal(stickyIdentity<number>(null, 99), 99);
});

test('pickStrongestIdentifier: priority is linkedin > domain > name', () => {
  assert.deepEqual(
    pickStrongestIdentifier({ linkedinUrl: 'https://linkedin.com/company/modernatx', domain: 'modernatx.com', name: 'Moderna' }),
    { kind: 'linkedin_url', value: 'https://linkedin.com/company/modernatx' },
  );
  assert.deepEqual(
    pickStrongestIdentifier({ domain: 'modernatx.com', name: 'Moderna' }),
    { kind: 'domain', value: 'modernatx.com' },
  );
  assert.deepEqual(
    pickStrongestIdentifier({ name: 'Moderna' }),
    { kind: 'name', value: 'Moderna' },
  );
});

test('pickStrongestIdentifier: normalizes the domain (strips protocol/www/path)', () => {
  assert.deepEqual(
    pickStrongestIdentifier({ domain: 'https://www.ModernaTX.com/about' }),
    { kind: 'domain', value: 'modernatx.com' },
  );
});

test('pickStrongestIdentifier: returns null when nothing usable', () => {
  assert.equal(pickStrongestIdentifier({}), null);
  assert.equal(pickStrongestIdentifier({ domain: '  ', name: '' }), null);
});

test('STICKY_COMPANY_IDENTITY_FIELDS lists the identity columns', () => {
  assert.deepEqual([...STICKY_COMPANY_IDENTITY_FIELDS], ['company_name', 'domain', 'linkedin_url']);
});
