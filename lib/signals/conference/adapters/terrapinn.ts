/**
 * Terrapinn adapter — PARTIAL (server-rendered sponsor + exhibitor logo wall).
 *
 * Terrapinn runs many life-science congresses (World Vaccine Congress, Festival
 * of Biologics, …) on terrapinn.com. The public page:
 *
 *   https://www.terrapinn.com/conference/<event>/sponsors-and-exhibitors.stm
 *
 * SERVER-RENDERS a logo wall: each sponsor/exhibitor is a `col-sm-3 Panel` card
 * grouped under an `<h3>` tier heading (Diamond/Platinum/Gold/Silver/Bronze
 * Sponsor, Exhibitor). The company name lives in the logo's `title`/`alt`
 * attribute as `"<Name> at <Event> <Year>"`; some cards wrap the logo in an
 * `<a href>` to the company website. We read the name from the `title`/`alt`
 * attribute (the most reliable signal in the static HTML).
 *
 * ⚠️ PARTIAL — this is the server-rendered subset (the named sponsors plus the
 * exhibitors that already have logos uploaded), NOT the full exhibitor floor.
 * The complete A–Z exhibitor list on these pages is hydrated client-side (the
 * page wires `ajax` refresh handlers), so a bare fetch sees only the logo wall.
 * In practice that subset is still substantial:
 *
 * Verified live (2026-06-24, no auth):
 *   World Vaccine Congress Washington → 50 cards
 *     (IQVIA Laboratories, Cytiva, Sanofi, WuXi Vaccines, Parexel, ICON, …)
 *   Festival of Biologics USA → ~31 cards
 *     (Fujifilm Biotechnologies, Lonza, Minaris Advanced Therapies, SCIEX, …)
 *
 * To get the full floor: capture the hydrated exhibitor-list XHR from a real
 * browser session, or render headless (Apify/Playwright). Until then this
 * adapter returns the logo-wall subset honestly.
 */
import type { ConferenceAdapter, ConferenceForFetch, ExhibitorRecord } from './types';
import { conferenceFetch } from '../fetch';

/** Build the public sponsors-and-exhibitors URL from an event slug or full URL. */
export function terrapinnExhibitorsUrl(slugOrUrl: string): string {
  if (/^https?:\/\//i.test(slugOrUrl)) return slugOrUrl;
  return `https://www.terrapinn.com/conference/${slugOrUrl}/sponsors-and-exhibitors.stm`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strip the `" at <Event> <Year>"` provenance suffix Terrapinn appends to every
 * logo title/alt. Company names can themselves contain " at ", so we only strip
 * the LAST such suffix and require it to look like an event tail (ends with a
 * 4-digit year, which every Terrapinn title carries).
 */
function stripEventSuffix(title: string): string {
  // Prefer a year-anchored cut: "<Name> at <…> 2027" → "<Name>".
  const yearCut = title.match(/^(.*?) at [^]*\b(19|20)\d{2}\b\s*$/);
  if (yearCut && yearCut[1].trim()) return yearCut[1].trim();
  // Fallback: cut at the last " at ".
  const idx = title.lastIndexOf(' at ');
  if (idx > 0) return title.slice(0, idx).trim();
  return title.trim();
}

/**
 * Parse the server-rendered logo wall into exhibitor records. Names come from
 * the `title` attribute of each `<img … title="NAME at EVENT YEAR">` (falling
 * back to `alt`). Exported for the test stub so the regex is unit-checkable
 * without a network call.
 */
export function parseTerrapinnExhibitors(html: string, sourceUrl: string): ExhibitorRecord[] {
  const out: ExhibitorRecord[] = [];
  const seen = new Set<string>();

  // Each logo card: <img ... title="NAME at EVENT YEAR" alt="..."> — the title
  // (or alt) carries the company name with an " at <event>" suffix.
  const imgRe = /<img\b[^>]*\b(?:title|alt)="([^"]*?\sat\s[^"]*)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const raw = decodeEntities(m[1]);
    const name = stripEventSuffix(raw);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, sourceUrl });
  }

  return out;
}

export const terrapinnAdapter: ConferenceAdapter = {
  platform: 'terrapinn',
  async fetchExhibitors(conf: ConferenceForFetch): Promise<ExhibitorRecord[]> {
    const url = terrapinnExhibitorsUrl(conf.exhibitorSourceUrl);
    const res = await conferenceFetch(url);
    if (!res.ok) throw new Error(`terrapinn sponsors-and-exhibitors ${res.status} for ${url}`);
    // NOTE: returns the server-rendered sponsor + logo-wall subset only (see
    // file header) — not the full client-hydrated exhibitor floor.
    return parseTerrapinnExhibitors(await res.text(), url);
  },
};
