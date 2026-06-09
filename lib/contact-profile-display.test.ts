/**
 * Tests for parseContactLocation — splitting a contact's location into
 * City / State / Country for the side-panel sub-headers.
 *
 * Pure-function tests, run via `node --test`:
 *   npm run test:contact-location
 *
 * Locks in the real garbled cases (the `location` string is clean; the
 * separate city/country columns are unreliable dash-joined dupes).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseContactLocation } from './contact-profile-display';

test('US-style "City, State, Country" location parses into all three', () => {
  // Aisling: location is the clean source; city="San Diego", country="USA" ignored.
  assert.deepEqual(
    parseContactLocation('San Diego, California, United States', 'San Diego', 'USA'),
    { city: 'San Diego', state: 'California', country: 'United States' },
  );
});

test('"City, Country" location parses with no state', () => {
  // Althea: location clean; the city/country columns are junk and must be ignored.
  assert.deepEqual(
    parseContactLocation(
      'Dubai, United Arab Emirates',
      'Dubai - Dubai - United Arab Emirates',
      'Dubai - Dubai - United Arab Emirates',
    ),
    { city: 'Dubai', state: null, country: 'United Arab Emirates' },
  );
});

test('single-part location → city only', () => {
  assert.deepEqual(parseContactLocation('Remote', null, null), {
    city: 'Remote',
    state: null,
    country: null,
  });
});

test('repeated tokens in location are de-duped', () => {
  assert.deepEqual(parseContactLocation('Dubai, Dubai, United Arab Emirates', null, null), {
    city: 'Dubai',
    state: null,
    country: 'United Arab Emirates',
  });
});

test('falls back to cleaned city/country fields when location is empty', () => {
  // Junky dash-joined fields: city = first token, country = last token.
  assert.deepEqual(
    parseContactLocation('', 'Dubai - Dubai - United Arab Emirates', 'Dubai - Dubai - United Arab Emirates'),
    { city: 'Dubai', state: null, country: 'United Arab Emirates' },
  );
});

test('all-empty → all null', () => {
  assert.deepEqual(parseContactLocation(null, null, null), {
    city: null,
    state: null,
    country: null,
  });
});
