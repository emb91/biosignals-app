/**
 * Small World Labs adapter — PARTIAL.
 *
 * Powers ASGCT (asgct2026.smallworldlabs.com). The /exhibitors page
 * server-renders the first page of the exhibitor directory table — each row is
 * a `<td>` with a favorite-star control and the company anchor:
 *   <a class="generic-option-link" href="/co/agc-biologics" ...>AGC Biologics</a>
 * The anchor text is the display name; /co/<slug> is the profile URL.
 *
 * Verified live (2026-06-24, no auth): 40 companies server-rendered this way
 *   (3PBIOVIAN, AAVnerGene, ABEC, Abnova Corporation, ACGT, ACROBiosystems,
 *    AGC Biologics, Akadeum Life Sciences …) — the first directory page, NOT an
 *    A–Z filter nav (each anchor sits in a real exhibitor row).
 *
 * ⚠️ PARTIAL: ASGCT has ~320 exhibitors. The remaining ~280 load via the
 * member-directory widget AJAX (page references /swl/js/ajax.js +
 * js_ajax_refresh.js). Re-checked live 2026-06-24: the static HTML exposes NO
 * pagination params, widget id, or total count — the directory is a stateful
 * widget that pages via XHR tied to the rendered session, so it is NOT
 * reproducible with a bare fetch. To finish: capture the widget directory XHR
 * from a real browser session, or use a headless render (Apify/Playwright) for
 * the full list. See docs/conference-ingestion-deep.md §3.
 */
import type { ConferenceAdapter, ConferenceForFetch, ExhibitorRecord } from './types';

const UA = 'Arcova GTM conference-monitor (contact: emma@arcova.bio)';

/** Accept a full /exhibitors URL or a bare subdomain ("asgct2026"). */
export function smallWorldLabsExhibitorsUrl(subdomainOrUrl: string): string {
  if (/^https?:\/\//i.test(subdomainOrUrl)) return subdomainOrUrl;
  return `https://${subdomainOrUrl}.smallworldlabs.com/exhibitors`;
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
}

/**
 * Parse the server-rendered company anchors. Returns the subset of exhibitors
 * present in the static HTML (see PARTIAL note above). Exported for the test
 * stub. `origin` is used to absolutize the /co/<slug> profile URL.
 */
export function parseSmallWorldLabsExhibitors(html: string, origin: string): ExhibitorRecord[] {
  const out: ExhibitorRecord[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]*class="generic-option-link"[^>]*href="\/co\/([a-z0-9-]+)"[^>]*>([^<]+)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1];
    const name = decodeEntities(m[2]);
    if (!name || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ name, sourceUrl: `${origin}/co/${slug}` });
  }
  return out;
}

export const smallWorldLabsAdapter: ConferenceAdapter = {
  platform: 'smallworldlabs',
  async fetchExhibitors(conf: ConferenceForFetch): Promise<ExhibitorRecord[]> {
    const url = smallWorldLabsExhibitorsUrl(conf.exhibitorSourceUrl);
    const origin = new URL(url).origin;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`smallworldlabs /exhibitors ${res.status} for ${url}`);
    // NOTE: returns only the server-rendered subset until the widget-AJAX
    // full-list endpoint is captured (see file header).
    return parseSmallWorldLabsExhibitors(await res.text(), origin);
  },
};
