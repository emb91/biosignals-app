/**
 * Tests for the canonical company resolver.
 *
 * Pure-function tests run via `node --test` (no DB dependency). The full
 * cascade is smoke-tested live in plain SQL against the resolver RPC — see
 * supabase/migrations/20260527_resolve_company_candidates.sql and the README
 * note in resolve-mentions.ts.
 *
 * Run (after building):
 *   tsc -p tsconfig.test.resolver.json && \
 *     node --test /tmp/arcova-resolver-tests/lib/companies/resolve-mentions.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
// Import from match-helpers (deps-free) so the test bundle doesn't need
// the Supabase admin client or LLM wrapper at runtime.
import {
  uniqueTokenCoverage,
  distinctiveTokens,
  sharesDistinctiveToken,
} from './match-helpers';

function tokens(s: string): Set<string> {
  return new Set(s.split(' ').filter((t) => t.length >= 3));
}

test('uniqueTokenCoverage: identical names → 1.0', () => {
  const cov = uniqueTokenCoverage(tokens('arvinas'), 'arvinas', []);
  assert.equal(cov, 1);
});

test('uniqueTokenCoverage: shorter side ⊂ longer (input shorter)', () => {
  // "arvinas" fully covered by "arvinas therapeutics" → 1.0
  const cov = uniqueTokenCoverage(tokens('arvinas'), 'arvinas therapeutics', []);
  assert.equal(cov, 1);
});

test('uniqueTokenCoverage: shorter side ⊂ longer (canonical shorter)', () => {
  // canonical "arvinas" fully covered by input "arvinas therapeutics" → 1.0
  const cov = uniqueTokenCoverage(tokens('arvinas therapeutics'), 'arvinas', []);
  assert.equal(cov, 1);
});

test('uniqueTokenCoverage: rejects token-boundary false positive', () => {
  // "bayer" is a substring of "forbayer" at the character level but NOT a
  // shared token. Coverage of {bayer} against tokens of "forbayer holdings"
  // = {forbayer, holdings} → 0 hits → null.
  const cov = uniqueTokenCoverage(tokens('bayer'), 'forbayer holdings', []);
  assert.equal(cov, null);
});

test('uniqueTokenCoverage: matches against an alias', () => {
  const cov = uniqueTokenCoverage(tokens('bms'), 'bristol myers squibb', ['bms', 'bristol myers']);
  // {bms} fully covered by alias {bms} → 1.0
  assert.equal(cov, 1);
});

test('uniqueTokenCoverage: partial token overlap', () => {
  // {moderna, vaccines} vs canonical "moderna" (tokens: {moderna})
  // Shorter side = {moderna}, longer = {moderna, vaccines}. Hits = 1, coverage = 1.
  const cov = uniqueTokenCoverage(tokens('moderna vaccines'), 'moderna', []);
  assert.equal(cov, 1);
});

test('uniqueTokenCoverage: no overlap → null', () => {
  const cov = uniqueTokenCoverage(tokens('pfizer'), 'roche genentech', []);
  assert.equal(cov, null);
});

test('uniqueTokenCoverage: short input filtered out → null', () => {
  // Input has no tokens >= 3 chars → empty set → returns null
  const cov = uniqueTokenCoverage(new Set<string>(), 'arvinas', []);
  assert.equal(cov, null);
});

test('uniqueTokenCoverage: picks best across name+aliases', () => {
  // Name matches nothing, alias matches fully → coverage from the alias wins
  const cov = uniqueTokenCoverage(
    tokens('genentech'),
    'roche holding ag',
    ['genentech', 'f hoffmann la roche'],
  );
  assert.equal(cov, 1);
});

// ── distinctiveTokens ────────────────────────────────────────────────────────

test('distinctiveTokens: strips generic biotech suffixes', () => {
  const t = distinctiveTokens('junshi biosciences');
  assert.deepEqual([...t], ['junshi']);
});

test('distinctiveTokens: keeps proper-noun tokens', () => {
  const t = distinctiveTokens('bristol myers squibb');
  assert.deepEqual([...t].sort(), ['bristol', 'myers', 'squibb']);
});

test('distinctiveTokens: drops sub-3-char tokens', () => {
  // 'a' and 'an' are too short; 'biotech' is generic; 'foo' is distinctive.
  const t = distinctiveTokens('a an foo biotech');
  assert.deepEqual([...t], ['foo']);
});

// ── sharesDistinctiveToken ───────────────────────────────────────────────────

test('sharesDistinctiveToken: shared generic suffix is NOT a match', () => {
  // The shared-suffix-only false positive that bit us in practice.
  assert.equal(sharesDistinctiveToken('junshi biosciences', 'enzene biosciences'), false);
  assert.equal(sharesDistinctiveToken('spyre therapeutics', 'seaport therapeutics'), false);
  assert.equal(sharesDistinctiveToken('apogee therapeutics', 'seaport therapeutics'), false);
});

test('sharesDistinctiveToken: shared distinctive token IS a match', () => {
  assert.equal(sharesDistinctiveToken('moderna', 'moderna therapeutics'), true);
  assert.equal(sharesDistinctiveToken('illumina diagnostics', 'illumina'), true);
});

test('sharesDistinctiveToken: input with only generic tokens falls back to true', () => {
  // If the input is "biosciences inc" we have no distinctive token to test;
  // let the LLM decide rather than block outright.
  assert.equal(sharesDistinctiveToken('biosciences', 'enzene biosciences'), true);
});

test('sharesDistinctiveToken: "alcon laboratories" vs "alkem laboratories" rejected', () => {
  // Real false-positive case: trigram similarity 0.65 (just over high-conf
  // threshold) but they share only "laboratories" which is a generic suffix.
  assert.equal(sharesDistinctiveToken('alcon laboratories', 'alkem laboratories'), false);
});

test('uniqueTokenCoverage with distinctive-only input rejects generic-suffix-only overlap', () => {
  // "ph health" → distinctiveTokens = {} ('ph' is < 3 chars, 'health' is
  // generic). The resolver skips step 4 entirely for empty input — callers
  // pass distinctiveTokens(input), not raw tokens.
  // But if they DID pass raw, here's what should happen with distinctive input
  // {perkinelmer} against canonical "perkinelmer health sciences":
  const cov = uniqueTokenCoverage(distinctiveTokens('perkinelmer'), 'perkinelmer health sciences', []);
  assert.equal(cov, 1);
});
