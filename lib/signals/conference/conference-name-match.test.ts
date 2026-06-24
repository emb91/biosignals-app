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
import { parseA2zExhibitors, a2zEventMapUrl } from './adapters/a2z';
import { parseSmallWorldLabsExhibitors } from './adapters/smallworldlabs';
import {
  calibrateMysOffset,
  decodeMysGlyphs,
  rowsFromPositionedText,
  splitMysRow,
} from './adapters/mapyourshow';

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

test('smallworldlabs parser also reads the card template (SOT/ToxExpo)', () => {
  // Card layout: name in the heading's title attr; the card's generic-option-link
  // points to an a2z booth map (not /co/), so the list-only regex saw nothing.
  const html = `
    <div class="card" data-item-id="128">
      <div class="card-header bg-light">
        <h5 data-generic-layout="heading" class="generic-option font-weight-bold truncate-1-line" title="28bio">28bio</h5>
      </div>
      <a class="generic-option-link font-weight-bold" href="https://s36.a2zinc.net/clients/AIM-SOT/toxexpo2026/Public/eventmap.aspx?EventId=16">28bio</a>
    </div>
    <div class="card" data-item-id="200">
      <h5 class="generic-option font-weight-bold" title="Cytek Biosciences">Cytek Biosciences</h5>
    </div>
  `;
  const rows = parseSmallWorldLabsExhibitors(html, 'https://toxexpo2026.smallworldlabs.com');
  assert.deepEqual(rows.map((r) => r.name), ['28bio', 'Cytek Biosciences']);
  assert.equal(rows[0].sourceUrl, 'https://toxexpo2026.smallworldlabs.com/exhibitors');
});

test('a2z EventMap parser pairs exhibitorName with the row booth + decodes entities', () => {
  // Mirrors the real EventMap.aspx markup: a companyName cell with an
  // exhibitorName anchor, followed by a boothLabel anchor in the same row.
  const html = `
    <tr data-boothid="111140">
      <td class="companyName"><a class="exhibitorName" href="eBooth.aspx?BoothID=111140">Bruker Nano Inc.</a></td>
      <td class="boothLabel aa-mapIt"><a class="boothLabel" href="#" data-boothlabels="1917">1917</a></td>
    </tr>
    <tr data-boothid="110001">
      <td class="companyName"><a class="exhibitorName" href="eBooth.aspx?BoothID=110001">Bristol &amp; Myers</a></td>
      <td class="boothLabel aa-mapIt"><a class="boothLabel" href="#" data-boothlabels="BS 44">BS 44</a></td>
    </tr>
  `;
  const src = 'https://s19.a2zinc.net/clients/sfn/sfn26/Public/EventMap.aspx?shMode=E';
  const rows = parseA2zExhibitors(html, src);
  assert.deepEqual(rows, [
    { name: 'Bruker Nano Inc.', booth: '1917', sourceUrl: src },
    { name: 'Bristol & Myers', booth: 'BS 44', sourceUrl: src },
  ]);
});

test('a2z parser dedupes on name+booth (multi-booth exhibitors kept distinct)', () => {
  const html = `
    <td class="companyName"><a class="exhibitorName" href="#">Abbott Diabetes Care</a></td>
    <td class="boothLabel"><a class="boothLabel" href="#">1418</a></td>
    <td class="companyName"><a class="exhibitorName" href="#">Abbott Diabetes Care</a></td>
    <td class="boothLabel"><a class="boothLabel" href="#">BS 19</a></td>
    <td class="companyName"><a class="exhibitorName" href="#">Abbott Diabetes Care</a></td>
    <td class="boothLabel"><a class="boothLabel" href="#">1418</a></td>
  `;
  const rows = parseA2zExhibitors(html, 'x');
  // Two distinct booths survive; the exact-duplicate (1418) is collapsed.
  assert.deepEqual(rows.map((r) => r.booth), ['1418', 'BS 19']);
});

test('a2z url normaliser rewrites Exhibitors.aspx to the EventMap data view', () => {
  assert.equal(
    a2zEventMapUrl('https://s19.a2zinc.net/clients/sfn/sfn26/Public/Exhibitors.aspx'),
    'https://s19.a2zinc.net/clients/sfn/sfn26/Public/EventMap.aspx?shMode=E',
  );
  // An existing EventMap URL is passed through untouched (query preserved).
  const em = 'https://www.expo.acc.org/ACC26/Public/EventMap.aspx?shMode=E';
  assert.equal(a2zEventMapUrl(em), em);
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

// ── Map Your Show offset calibration (ToUnicode-less fallback path) ───────────
test('mapyourshow offset calibration learns the shift from a header anchor', () => {
  // ToUnicode worked: codes already spell "Booth", so the learned offset is 0.
  assert.equal(calibrateMysOffset([66, 111, 111, 116, 104], 'Booth'), 0);
  // Shifted subset font: "Name" stored as codes-29 -> calibrate back to +29.
  const shifted = 'Name'.split('').map((c) => c.charCodeAt(0) - 29);
  assert.equal(calibrateMysOffset(shifted, 'Name'), 29);
  // Once learned, decodeMysGlyphs applies it to recover the text.
  assert.equal(decodeMysGlyphs(shifted, 29), 'Name');
  // No single constant maps the codes onto the expected text -> null (bail).
  assert.equal(calibrateMysOffset([66, 99, 111, 116, 104], 'Booth'), null);
  // Length mismatch / empty -> null.
  assert.equal(calibrateMysOffset([66, 111], 'Booth'), null);
  assert.equal(calibrateMysOffset([], ''), null);
});

// ── Map Your Show two-column row reconstruction ──────────────────────────────
test('mapyourshow rebuilds name/booth rows from positioned text', () => {
  // One page laid out like the real export: names at x≈47, booths at x≈451,
  // rows ~22pt apart (y descending). Includes the header row, a normal row,
  // a wrapped multi-line name, and a genuinely booth-less exhibitor.
  const src = 'https://bio2026.mapyourshow.com/8_0/exhibitor/exhibitor-list.cfm?export=pdf';
  const page = [
    { str: '2026 BIO International Convention', x: 42, y: 730 },
    { str: 'Name', x: 47, y: 654 },
    { str: 'Booth', x: 451, y: 654 },
    // normal row
    { str: 'AbbVie', x: 47, y: 631 },
    { str: '2103', x: 451, y: 631 },
    // wrapped name: two name fragments straddling the booth's vertical center
    { str: 'Investment and Finance Office of the Presidency of the Republic of', x: 47, y: 479 },
    { str: 'Türkiye', x: 47, y: 464 },
    { str: '4951', x: 451, y: 472 },
    // booth-less exhibitor (no booth fragment near its y)
    { str: 'Amgen', x: 47, y: 420 },
  ];
  const rows = rowsFromPositionedText([page], src);
  assert.deepEqual(rows, [
    { name: 'AbbVie', booth: '2103', sourceUrl: src },
    {
      name: 'Investment and Finance Office of the Presidency of the Republic of Türkiye',
      booth: '4951',
      sourceUrl: src,
    },
    { name: 'Amgen', sourceUrl: src },
  ]);
});
