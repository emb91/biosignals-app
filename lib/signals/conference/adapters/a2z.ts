/**
 * a2z / Personify "EventMap" adapter — CRACKED.
 *
 * a2z (Personify) is the same event platform family that powers SPARGO shows,
 * but a large set of societies host their own a2zinc instances and surface the
 * exhibitor list through the floor-plan view: `Public/EventMap.aspx?shMode=E`.
 * This view SERVER-RENDERS the full exhibitor table inline as HTML — no XHR, no
 * JSON endpoint, no auth. (The plain `Exhibitors.aspx` on these instances is a
 * JS shell with no data; `EventMap.aspx?shMode=E` is the one that carries it.)
 *
 *   https://s19.a2zinc.net/clients/sfn/sfn26/Public/EventMap.aspx?shMode=E   (SfN)
 *   https://s36.a2zinc.net/clients/AFCo/ada2026/Public/eventmap.aspx?shMode=E (ADA)
 *   https://www.expo.acc.org/ACC26/Public/EventMap.aspx?shMode=E             (ACC)
 *
 * Each exhibitor row renders as:
 *   <td class="companyName"><a class="exhibitorName" href="eBooth.aspx?...">Bruker Nano Inc.</a></td>
 *   <td class="boothLabel aa-mapIt"><a class="boothLabel" ... data-boothlabels="1917" ...>1917</a></td>
 *
 * Depth is name + booth (enough to MATCH). Per-exhibitor websites live on the
 * individual eBooth pages, not the list, so `website`/`category` are not
 * populated here.
 *
 * a2z 403s a bare/non-browser User-Agent, so this adapter goes through
 * `conferenceFetch` (browser UA + Accept header by default).
 *
 * Verified live (2026-06-24, no auth):
 *   SfN  sfn26    → 429 exhibitors (Bruker Nano Inc., Carl Zeiss, Abcam, …)
 *   ADA  ada2026  → 198 exhibitors (Abbott, Dexcom, Eli Lilly, …)
 *   ACC  ACC26    → 380 exhibitors (Abbott, Abcentra LLC, AstraZeneca, …)
 *   USCAP uscap2026 → ~190 (3DHISTECH, AbbVie, …)
 */
import type { ConferenceAdapter, ConferenceForFetch, ExhibitorRecord } from './types';
import { conferenceFetch } from '../fetch';

/**
 * Accept a full EventMap URL, or normalise a plain Exhibitors.aspx URL on the
 * same instance to the EventMap view that actually carries data. If callers
 * already pass `EventMap.aspx?shMode=E` it is returned untouched.
 */
export function a2zEventMapUrl(sourceUrl: string): string {
  // Already an EventMap URL — leave it alone (preserve existing query string).
  if (/eventmap\.aspx/i.test(sourceUrl)) return sourceUrl;
  // A plain Exhibitors.aspx on the same instance → rewrite to the data view.
  if (/exhibitors\.aspx/i.test(sourceUrl)) {
    const base = sourceUrl.replace(/exhibitors\.aspx.*$/i, 'EventMap.aspx');
    return `${base}?shMode=E`;
  }
  return sourceUrl;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse exhibitor name + booth from the EventMap.aspx HTML. Names come from
 * `<a class="exhibitorName" ...>NAME</a>`; the booth is the text of the first
 * `<a class="boothLabel" ...>BOOTH</a>` that follows the name in the same row.
 *
 * Exported and pure so the parse is unit-checkable from a fixture without a
 * network call. Dedupes on name+booth (some exhibitors list multiple booths).
 */
export function parseA2zExhibitors(html: string, sourceUrl: string): ExhibitorRecord[] {
  const nameRe = /<a[^>]*class="exhibitorName"[^>]*>([^<]+)<\/a>/gi;
  const boothRe = /<a[^>]*class="boothLabel"[^>]*>([^<]+)<\/a>/gi;

  // Collect booth-anchor positions so each name can grab the next booth after it.
  const booths: Array<{ pos: number; booth: string }> = [];
  let bm: RegExpExecArray | null;
  while ((bm = boothRe.exec(html)) !== null) {
    booths.push({ pos: bm.index, booth: decodeEntities(bm[1]) });
  }

  const out: ExhibitorRecord[] = [];
  const seen = new Set<string>();
  let nm: RegExpExecArray | null;
  let boothCursor = 0;
  while ((nm = nameRe.exec(html)) !== null) {
    const name = decodeEntities(nm[1]);
    if (!name) continue;
    const namePos = nm.index;
    // Advance the cursor to the first booth anchor that starts after this name.
    while (boothCursor < booths.length && booths[boothCursor].pos < namePos) boothCursor++;
    const booth = boothCursor < booths.length ? booths[boothCursor].booth : undefined;

    const key = `${name.toLowerCase()}|${booth ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(booth ? { name, booth, sourceUrl } : { name, sourceUrl });
  }
  return out;
}

export const a2zAdapter: ConferenceAdapter = {
  platform: 'a2z',
  async fetchExhibitors(conf: ConferenceForFetch): Promise<ExhibitorRecord[]> {
    const url = a2zEventMapUrl(conf.exhibitorSourceUrl);
    const res = await conferenceFetch(url);
    if (!res.ok) throw new Error(`a2z EventMap.aspx ${res.status} for ${url}`);
    return parseA2zExhibitors(await res.text(), url);
  },
};
