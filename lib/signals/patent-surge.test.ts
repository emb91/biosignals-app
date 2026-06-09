/**
 * Tests for the patent-surge collector. Pure functions, run via node --test:
 *   npm run test:patent-surge
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEntities,
  patentPublicationNumber,
  collectRecentPatentsByCompany,
  type PatentEventInput,
} from './patent-surge';

function ev(over: Partial<PatentEventInput> & { sourceEventType: string }): PatentEventInput {
  return {
    companyId: 'c1',
    sourceUrl: null,
    sourceTitle: null,
    sourceSummary: null,
    metadata: {},
    eventAt: null,
    observedAt: '2026-05-20T00:00:00Z',
    ...over,
  };
}

test('decodeEntities handles numeric + named entities from PatentsView titles', () => {
  assert.equal(decodeEntities("Nucleosides with 3&#39;-hydroxy blocking groups"), "Nucleosides with 3'-hydroxy blocking groups");
  assert.equal(decodeEntities('Foo &amp; Bar'), 'Foo & Bar');
  assert.equal(decodeEntities('A &lt;b&gt; c'), 'A <b> c');
  assert.equal(decodeEntities('messy   spacing  '), 'messy spacing');
});

test('patentPublicationNumber extracts from /patent/ URL, falls back to metadata', () => {
  assert.equal(patentPublicationNumber('https://patents.google.com/patent/EP4724203A1'), 'EP4724203A1');
  assert.equal(patentPublicationNumber('https://patents.google.com/patent/US2026098256A1?oq=x'), 'US2026098256A1');
  assert.equal(patentPublicationNumber('https://patents.google.com/?assignee=Illumina'), null); // surge search url
  assert.equal(patentPublicationNumber(null, { patent_id: 'EP-4724203-A1' }), 'EP4724203A1');
  assert.equal(patentPublicationNumber(null, {}), null);
});

test('dedupes the same publication across overlapping signal keys; newest filing first', () => {
  const rows: PatentEventInput[] = [
    // EP4724203A1 appears under BOTH published and filed (the real overlap)
    ev({ sourceEventType: 'patent_application_published', sourceUrl: 'https://patents.google.com/patent/EP4724203A1',
         metadata: { patent_title: 'Method for polishing a substrate' }, eventAt: '2026-04-15' }),
    ev({ sourceEventType: 'patent_filed_or_granted', sourceUrl: 'https://patents.google.com/patent/EP4724203A1',
         metadata: { patent_title: 'Method for polishing a substrate' }, eventAt: '2026-04-15' }),
    // a distinct, older one
    ev({ sourceEventType: 'patent_filed_or_granted', sourceUrl: 'https://patents.google.com/patent/EP4720334A1',
         metadata: { patent_title: 'Methods for preserving methylation status during clustering' }, eventAt: '2026-04-08' }),
    // the aggregate surge itself must be ignored
    ev({ sourceEventType: 'assignee_portfolio_acceleration', sourceUrl: 'https://patents.google.com/?assignee=Illumina',
         metadata: { recent_patents_90d: 34 }, eventAt: '2026-05-20' }),
  ];
  const byCompany = collectRecentPatentsByCompany(rows);
  const patents = byCompany.get('c1')!;
  assert.equal(patents.length, 2, 'EP4724203A1 deduped, surge excluded');
  assert.equal(patents[0].key, 'EP4724203A1'); // newest filing (2026-04-15) first
  assert.equal(patents[0].title, 'Method for polishing a substrate');
  assert.equal(patents[0].url, 'https://patents.google.com/patent/EP4724203A1');
  assert.equal(patents[1].key, 'EP4720334A1');
});

test('falls back to summary for title; HTML-decodes; skips rows with no link or title', () => {
  const rows: PatentEventInput[] = [
    ev({ sourceEventType: 'patent_granted', sourceUrl: 'https://patents.google.com/patent/EP3902814B1',
         sourceSummary: "Granted patent detected for Illumina: Nucleosides with 3&#39;-hydroxy blocking groups.", eventAt: '2026-04-08' }),
    ev({ sourceEventType: 'patent_filed_or_granted', sourceUrl: null, metadata: {}, sourceSummary: null }), // unusable → skipped
  ];
  const patents = collectRecentPatentsByCompany(rows).get('c1')!;
  assert.equal(patents.length, 1);
  assert.equal(patents[0].title, "Nucleosides with 3'-hydroxy blocking groups");
});

test('groups by company and ignores non-patent rows', () => {
  const rows: PatentEventInput[] = [
    ev({ companyId: 'a', sourceEventType: 'patent_granted', sourceUrl: 'https://patents.google.com/patent/US1A', metadata: { patent_title: 'A' }, eventAt: '2026-04-01' }),
    ev({ companyId: 'b', sourceEventType: 'patent_granted', sourceUrl: 'https://patents.google.com/patent/US2B', metadata: { patent_title: 'B' }, eventAt: '2026-04-02' }),
    ev({ companyId: 'a', sourceEventType: 'funding_round', sourceUrl: 'https://x', metadata: {}, eventAt: '2026-04-03' }),
  ];
  const by = collectRecentPatentsByCompany(rows);
  assert.equal(by.get('a')!.length, 1);
  assert.equal(by.get('b')!.length, 1);
});
