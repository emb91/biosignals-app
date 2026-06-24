/**
 * Small World Labs adapter — handles BOTH server-rendered directory templates.
 *
 * Powers ASGCT, SOT/ToxExpo, … on `{event}.smallworldlabs.com/exhibitors`. The
 * directory has two layouts in the wild (verified live 2026-06-24, no auth):
 *
 *   • LIST template (e.g. ASGCT) — the company anchor links to the /co/ profile:
 *       <a class="generic-option-link" href="/co/agc-biologics">AGC Biologics</a>
 *
 *   • CARD template (e.g. SOT/ToxExpo) — the name is the card heading's `title`
 *     attribute; the card's own `generic-option-link` points to an a2z booth-map
 *     URL, NOT a /co/ profile, so the old list-only regex returned ZERO here:
 *       <h5 class="generic-option font-weight-bold …" title="28bio">28bio</h5>
 *
 * We parse both and dedupe by name. (ToxExpo 2026 → 45 companies via the card
 * path, which the previous list-only parser missed entirely.)
 *
 * ⚠️ Large events paginate. When the directory exceeds one page it adds a "More"
 * button wired to jQuery `jsPaginator` against the member-directory AJAX —
 * `ajaxParams = { module:'organizations_organization_list', method:'paginationHandler',
 * site_page_id:'<id>', template:'generic…' }`. The exact AJAX endpoint hasn't
 * been pinned down (it needs a live multi-page event to capture — ASGCT 2026 is
 * now archived/empty). Single-page events (the common case) are fully covered by
 * the server-rendered parse below; for a big multi-page show this returns page 1
 * until the paginationHandler endpoint is captured and wired.
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
 * Parse the server-rendered exhibitor directory (both templates). Exported for
 * the test. `origin` absolutizes the /co/<slug> profile URL (list template) and
 * the directory URL (card template, which has no per-company /co/ link).
 */
export function parseSmallWorldLabsExhibitors(html: string, origin: string): ExhibitorRecord[] {
  const out: ExhibitorRecord[] = [];
  const seen = new Set<string>();
  const push = (rawName: string, sourceUrl: string) => {
    const name = decodeEntities(rawName);
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, sourceUrl });
  };

  // LIST template: anchor → /co/<slug> profile.
  const reList = /<a[^>]*class="[^"]*generic-option-link[^"]*"[^>]*href="\/co\/([a-z0-9-]+)"[^>]*>([^<]+)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = reList.exec(html)) !== null) {
    push(m[2], `${origin}/co/${m[1]}`);
  }

  // CARD template: name in the heading's title attr; attribute to the directory.
  const directoryUrl = `${origin}/exhibitors`;
  const reCard = /<h5\b[^>]*\bclass="[^"]*\bgeneric-option\b[^"]*"[^>]*\btitle="([^"]+)"/gi;
  while ((m = reCard.exec(html)) !== null) {
    push(m[1], directoryUrl);
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
