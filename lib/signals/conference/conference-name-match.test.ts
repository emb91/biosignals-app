/**
 * Conference exhibitor name-matching regression stub.
 *
 * The conference monitor resolves exhibitor names → canonical companies through
 * the SAME resolver primitives every other monitor uses
 * (normalizeCompanyForMatching + the distinctive-token evidence check in
 * match-helpers). This test pins the load-bearing matching guarantees directly
 * against those primitives, plus the adapter parsers, so a regression there
 * surfaces here.
 *
 * Run: npx tsc -p tsconfig.test.conference-name-match.json && \
 *      node /tmp/arcova-conference-name-match-tests/lib/signals/conference/conference-name-match.test.js
 * (mirrors the sec-form-d-screener test wiring; see tsconfig.test.*.json).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCompanyForMatching } from '../company-name-variants';
import { verifyNormalizedCompanyEvidence } from '../../companies/match-helpers';
import { parseSpargoExhibitors } from './adapters/spargo';
import { parseSmallWorldLabsExhibitors } from './adapters/smallworldlabs';
import { decodeMysGlyphs, splitMysRow } from './adapters/mapyourshow';

/** Verify an exhibitor name against a canonical company name + aliases. */
function matches(exhibitorName: string, canonicalName: string, aliases: string[] = []): boolean {
  return verifyNormalizedCompanyEvidence(
    normalizeCompanyForMatching(exhibitorName),
    normalizeCompanyForMatching(canonicalName),
    aliases.map(normalizeCompanyForMatching),
  ).verified;
}

// ── exact-name match ─────────────────────────────────────────────────────────
test('exact name match (with entity suffix variance)', () => {
  assert.equal(matches('Adaptive Biotechnologies Corporation', 'Adaptive Biotechnologies'), true);
  assert.equal(matches('AGC Biologics', 'AGC Biologics'), true);
});

// ── alias match ──────────────────────────────────────────────────────────────
test('alias match resolves to canonical company', () => {
  assert.equal(matches('Genentech, Inc.', 'Roche', ['Genentech, Inc.', 'F. Hoffmann-La Roche AG']), true);
});

// ── generic-name rejection ───────────────────────────────────────────────────
test('generic name does NOT match (no distinctive tokens)', () => {
  // "Bio Therapeutics" is all generic biotech tokens — must not match an
  // unrelated company even though it shares generic words.
  assert.equal(matches('Bio Therapeutics', 'Acme Bio Therapeutics'), false);
  // And a generic name must not be admitted against a different real company.
  assert.equal(matches('Bio Therapeutics', 'Adaptive Biotechnologies'), false);
});

// ── dup-variant normalization ────────────────────────────────────────────────
test('AbbVie / Abbvie / AbbVie Brasil normalize + match the canonical', () => {
  const canon = 'AbbVie';
  assert.equal(matches('AbbVie', canon), true);
  assert.equal(matches('Abbvie', canon), true);
  // "AbbVie Brasil" carries an extra distinctive token; the resolver's
  // distinctive-token coverage rule treats the shorter (canonical) token set as
  // the must-cover side, so the subsidiary-style variant still resolves.
  assert.equal(matches('AbbVie Brasil', canon), true);
  // Sanity: the three variants normalize to the same canonical token for "abbvie".
  assert.equal(normalizeCompanyForMatching('AbbVie'), normalizeCompanyForMatching('Abbvie'));
});

// ── adapter parsers ──────────────────────────────────────────────────────────
test('spargo parser extracts names from exhibitorName anchors + decodes entities', () => {
  const html = `
    <td class="companyName"><a class="exhibitorName" href="openURL.aspx?x=1">AbbVie</a></td>
    <td class="companyName"><a class="exhibitorName" href="openURL.aspx?x=2">Bristol &amp; Myers</a></td>
  `;
  const rows = parseSpargoExhibitors(html, 'https://events.jspargo.com/asco25/Public/Exhibitors.aspx');
  assert.deepEqual(rows.map((r) => r.name), ['AbbVie', 'Bristol & Myers']);
});

test('smallworldlabs parser extracts company anchors + absolute profile url', () => {
  const html = `
    <a class="generic-option-link" href="/co/agc-biologics" data-option-url="/co/agc-biologics">AGC Biologics</a>
    <a class="generic-option-link" href="/co/acrobiosystems" data-option-url="/co/acrobiosystems">ACROBiosystems</a>
  `;
  const rows = parseSmallWorldLabsExhibitors(html, 'https://asgct2026.smallworldlabs.com');
  assert.deepEqual(rows.map((r) => r.name), ['AGC Biologics', 'ACROBiosystems']);
  assert.equal(rows[0].sourceUrl, 'https://asgct2026.smallworldlabs.com/co/agc-biologics');
});

// ── Map Your Show font offset + row split ────────────────────────────────────
test('mapyourshow +29 glyph offset decodes stored codes back to readable text', () => {
  // "BIO" stored as codes minus 29: B(66)->37, I(73)->44, O(79)->50
  assert.equal(decodeMysGlyphs([37, 44, 50]), 'BIO');
});

test('mapyourshow row split separates name from trailing booth', () => {
  assert.deepEqual(splitMysRow('Acme Therapeutics    1430'), { name: 'Acme Therapeutics', booth: '1430' });
  assert.deepEqual(splitMysRow('Lonely Company'), { name: 'Lonely Company' });
});
