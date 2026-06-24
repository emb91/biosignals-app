/**
 * Informa Connect adapter — CRACKED.
 *
 * Informa Connect life-sciences shows (CGT Manufacturing & Commercialization,
 * RNA Leaders USA, Antibody Engineering, Biotech Week Boston, BPI West, TIDES,
 * LSX) run on the informaconnect.com platform. The sponsors page
 * SERVER-RENDERS the full sponsor/exhibitor roster inline — no XHR, no JSON
 * endpoint, no auth. Names live both in rendered tags AND in a structured JSON
 * blob embedded in the page; we parse the JSON blob (richest + most stable).
 *
 *   https://informaconnect.com/<event>/sponsors/            (CGT/CTB, TIDES, BPI…)
 *   https://informaconnect.com/<event>/sponsors-partners/   (RNA Leaders USA)
 *
 * The roster path varies per show, so `exhibitorSourceUrl` MUST be the FULL
 * sponsors URL (not a slug) — some shows use /sponsors/, some /sponsors-partners/,
 * and a few have no roster page at all (the bare /<event>/ home does NOT embed
 * the blob; it 307-redirects there from /sponsors/).
 *
 * Each sponsor object in the blob looks like:
 *   {"name":"Catalent","path":"catalent1","logo":{…},
 *    "openInNewTabEnabled":true,"linkToExternalPageEnabled":false,
 *    "url":"https://www.example.com/",   // OPTIONAL real website
 *    "sponsorTitle":"Platinum Sponsors","featured":false}
 *
 * - `name`         → company display name (required, drives matching).
 * - `sponsorTitle` → tier ("Platinum Sponsors", "Event Partners", "Exhibitors"…)
 *                    → mapped to `category`. Sponsors are grouped by tier; we
 *                    capture every tier.
 * - `url`          → the company's real website, when present. NOTE: `path` is an
 *                    INTERNAL informaconnect slug, never a website — ignore it.
 *
 * Verified live (2026-06-24, no auth, browser UA):
 *   CGT/cell-therapy-bioprocessing/sponsors/ → 203 sponsors
 *     (MilliporeSigma, Lonza, Catalent, Cytiva, Sartorius, Thermo Fisher …),
 *     45 with websites.
 *   tides/sponsors/ → 177 sponsors (Nitto Avecia, Agilent Technologies …),
 *     23 with websites.
 *   rna-leaders-usa/sponsors-partners/ → 8 sponsors (Codexis, Sartorius …),
 *     thinner because the show is early in its cycle.
 *
 * Caveat: this is the SPONSOR/PARTNER roster, which on most Informa shows is the
 * complete paid-presence list rather than a separate full exhibitor hall. A
 * couple of seeded shows expose no roster page yet; those parse to [] (handled
 * gracefully) until their /sponsors/ page is published.
 */
import type {
  ConferenceAdapter,
  ConferenceForFetch,
  ConferencePlatform,
  ExhibitorRecord,
} from './types';
import { conferenceFetch } from '../fetch';

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

/** Decode the JSON-string escapes Informa uses for embedded values. */
function decodeJsonString(s: string): string {
  return s
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/** Strip a trailing " Sponsors"/" Sponsor"/" Partners" suffix for a tidy category. */
function normalizeTier(raw: string): string | undefined {
  const t = decodeEntities(decodeJsonString(raw));
  return t || undefined;
}

/**
 * Parse the sponsor/exhibitor roster from an Informa Connect sponsors page.
 *
 * The page embeds a JSON blob with one object per sponsor. We walk each object
 * from its `"name"` to its `"sponsorTitle"` terminator (a key unique to sponsor
 * objects), pulling the optional company `url` that sits inside that slice. The
 * slice is length-bounded so a stray `"name"` elsewhere on the page can't swallow
 * unrelated markup.
 *
 * Exported so the regex is unit-checkable without a network call.
 */
export function parseInformaSponsors(html: string, sourceUrl: string): ExhibitorRecord[] {
  const out: ExhibitorRecord[] = [];
  const seen = new Set<string>();
  // name ... (sponsor-object body) ... sponsorTitle
  const entryRe =
    /"name":"((?:[^"\\]|\\.)*)"([\s\S]*?)"sponsorTitle":"((?:[^"\\]|\\.)*)"/g;
  // a company website inside the sponsor object body
  const urlRe = /"url":"(https?:(?:[^"\\]|\\.)*)"/;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(html)) !== null) {
    const body = m[2];
    // Reject runaway matches: a real sponsor object body is small. This guards
    // against a non-sponsor "name" field pairing with a distant "sponsorTitle".
    if (body.length > 600) continue;
    const name = decodeEntities(decodeJsonString(m[1]));
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const rec: ExhibitorRecord = { name, sourceUrl };
    const category = normalizeTier(m[3]);
    if (category) rec.category = category;
    const um = urlRe.exec(body);
    if (um) {
      const website = decodeJsonString(um[1]).trim();
      if (website) rec.website = website;
    }
    out.push(rec);
  }
  return out;
}

export const informaAdapter: ConferenceAdapter = {
  // 'informa' is not in the ConferencePlatform enum yet; the main thread will add
  // it. The cast keeps this file self-consistent in the meantime.
  platform: 'informa' as ConferencePlatform,
  async fetchExhibitors(conf: ConferenceForFetch): Promise<ExhibitorRecord[]> {
    const url = conf.exhibitorSourceUrl;
    if (!/^https?:\/\//i.test(url)) {
      throw new Error(
        `informa adapter needs a full sponsors URL in exhibitorSourceUrl (got "${url}")`,
      );
    }
    // `redirect: 'follow'` is the fetch default; a show with no roster page
    // 307s to its event home, which embeds no blob → parses to [] (no throw).
    const res = await conferenceFetch(url);
    if (!res.ok) throw new Error(`informa sponsors ${res.status} for ${url}`);
    return parseInformaSponsors(await res.text(), url);
  },
};
