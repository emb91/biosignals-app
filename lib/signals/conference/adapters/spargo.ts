/**
 * SPARGO / a2zinc adapter — CRACKED.
 *
 * SPARGO events run on the a2zinc.net event platform and power ASCO and ASH.
 * The Public/Exhibitors.aspx page SERVER-RENDERS the full exhibitor list inline
 * as an HTML table — no XHR, no JSON, no auth. See
 * docs/conference-ingestion-deep.md §2.
 *
 *   https://events.jspargo.com/<event>/Public/Exhibitors.aspx   (ASCO: asco25)
 *
 * Each exhibitor row:
 *   <td class="companyName"><a class="exhibitorName" href="openURL.aspx?...">AbbVie</a></td>
 *   <td class="boothLabel"><a class="boothLabel aa-mapIt" ... boothid="...">33166</a></td>
 *
 * Verified live (2026-06-24, no auth): ASCO asco25 → 557 exhibitors
 *   (AbbVie, Abbott Molecular, Adaptive Biotechnologies Corporation, Advarra, …).
 * ASH uses the same platform — swap the events.jspargo.com slug.
 */
import type { ConferenceAdapter, ConferenceForFetch, ExhibitorRecord } from './types';

const UA = 'Arcova GTM conference-monitor (contact: emma@arcova.bio)';

/** Build the public Exhibitors.aspx URL from a slug or accept a full URL. */
export function spargoExhibitorsUrl(slugOrUrl: string): string {
  if (/^https?:\/\//i.test(slugOrUrl)) return slugOrUrl;
  return `https://events.jspargo.com/${slugOrUrl}/Public/Exhibitors.aspx`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Parse the exhibitor names (and best-effort booth) from the Exhibitors.aspx
 * HTML. Names come from `<a class="exhibitorName" ...>NAME</a>`. Exported for
 * the test stub so the regex is unit-checkable without a network call.
 */
export function parseSpargoExhibitors(html: string, sourceUrl: string): ExhibitorRecord[] {
  const out: ExhibitorRecord[] = [];
  const nameRe = /<a[^>]*class="exhibitorName"[^>]*>([^<]+)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(html)) !== null) {
    const name = decodeEntities(m[1]);
    if (name) out.push({ name, sourceUrl });
  }
  return out;
}

export const spargoAdapter: ConferenceAdapter = {
  platform: 'spargo',
  async fetchExhibitors(conf: ConferenceForFetch): Promise<ExhibitorRecord[]> {
    const url = spargoExhibitorsUrl(conf.exhibitorSourceUrl);
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`spargo Exhibitors.aspx ${res.status} for ${url}`);
    return parseSpargoExhibitors(await res.text(), url);
  },
};
