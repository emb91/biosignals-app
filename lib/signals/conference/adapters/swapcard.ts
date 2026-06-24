/**
 * Swapcard adapter — CRACKED.
 *
 * Swapcard powers many life-science events (Phacilitate Advanced Therapies Week,
 * etc.) on app.swapcard.com. The public exhibitor view is a Next.js page whose
 * SSR payload (`__NEXT_DATA__`) carries the first page of exhibitors inline, and
 * — more usefully — the page's data comes from a PUBLIC, UNAUTHENTICATED GraphQL
 * endpoint that paginates the FULL list. We page that endpoint directly, so we
 * get every exhibitor, not just the SSR first page.
 *
 *   Public page:  https://<sub>.app.swapcard.com/event/<slug>/exhibitors/<viewId>
 *   GraphQL:      https://api.swapcard.com/graphql   (no auth, no API key)
 *
 * The `<viewId>` is the base64-ish last path segment of the public URL
 * (e.g. `RXZlbnRWaWV3XzU1OTU0Nw==`). That is the only parameter the GraphQL
 * query needs. The operation mirrors the one the app's own bundle ships:
 *
 *   query($viewId: ID!, $endCursor: String) {
 *     view: Core_eventExhibitorListView(viewId: $viewId) {
 *       exhibitors(cursor: { first: 50, after: $endCursor }) {
 *         totalCount
 *         pageInfo { hasNextPage endCursor }
 *         nodes { name websiteUrl }
 *       }
 *     }
 *   }
 *
 * Verified live (2026-06-24, no auth): Advanced Therapies Week
 *   viewId RXZlbnRWaWV3XzU1OTU0Nw== → 97/97 exhibitors paged in full
 *   (Charles River, Cytiva, Lonza, Sartorius, Fujifilm Diosynth, Viralgen,
 *    Wacker Biotech, …). `websiteUrl` present on many nodes (e.g. criver.com).
 */
import type { ConferenceAdapter, ConferenceForFetch, ExhibitorRecord } from './types';

const UA = 'Arcova GTM conference-monitor (contact: emma@arcova.bio)';
const GRAPHQL_URL = 'https://api.swapcard.com/graphql';
const PAGE_SIZE = 50;
/** Safety bound so a pathological/looping cursor can't run forever. */
const MAX_PAGES = 100;

const EXHIBITORS_QUERY = `query EventExhibitorsConnection($viewId: ID!, $endCursor: String) {
  view: Core_eventExhibitorListView(viewId: $viewId) {
    id
    exhibitors(cursor: { first: ${PAGE_SIZE}, after: $endCursor }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { name websiteUrl }
    }
  }
}`;

/**
 * Pull the Swapcard view id from a public exhibitor URL, or accept a bare id.
 * Public URL shape: `https://<sub>.app.swapcard.com/event/<slug>/exhibitors/<viewId>`
 * The view id is the last non-empty path segment.
 */
export function swapcardViewId(sourceUrl: string): string {
  if (!/^https?:\/\//i.test(sourceUrl)) return sourceUrl.trim();
  let path: string;
  try {
    path = new URL(sourceUrl).pathname;
  } catch {
    return sourceUrl.trim();
  }
  const segs = path.split('/').filter(Boolean);
  const last = segs[segs.length - 1];
  return (last || sourceUrl).trim();
}

type ExhibitorNode = { name?: string | null; websiteUrl?: string | null };
type ExhibitorsPage = {
  data?: {
    view?: {
      exhibitors?: {
        totalCount?: number;
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        nodes?: ExhibitorNode[];
      } | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

/**
 * Normalise one GraphQL exhibitors page into `ExhibitorRecord[]`. Exported so a
 * captured JSON fixture can be unit-checked without a network call. `sourceUrl`
 * is the public exhibitor page URL (provenance).
 */
export function parseSwapcardExhibitorsPage(page: ExhibitorsPage, sourceUrl: string): ExhibitorRecord[] {
  const nodes = page?.data?.view?.exhibitors?.nodes ?? [];
  const out: ExhibitorRecord[] = [];
  for (const n of nodes) {
    const name = (n?.name ?? '').trim();
    if (!name) continue;
    const rec: ExhibitorRecord = { name, sourceUrl };
    const site = (n?.websiteUrl ?? '').trim();
    if (site) rec.website = site;
    out.push(rec);
  }
  return out;
}

async function fetchExhibitorsPage(viewId: string, endCursor: string | null): Promise<ExhibitorsPage> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      // Swapcard's public GraphQL accepts unauthenticated reads for published
      // event views; the Origin header mirrors a normal browser call.
      Origin: 'https://app.swapcard.com',
    },
    body: JSON.stringify({
      query: EXHIBITORS_QUERY,
      variables: { viewId, endCursor },
    }),
  });
  if (!res.ok) throw new Error(`swapcard graphql ${res.status} for view ${viewId}`);
  const json = (await res.json()) as ExhibitorsPage;
  if (json.errors?.length) {
    throw new Error(`swapcard graphql errors: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  return json;
}

export const swapcardAdapter: ConferenceAdapter = {
  platform: 'swapcard',
  async fetchExhibitors(conf: ConferenceForFetch): Promise<ExhibitorRecord[]> {
    const viewId = swapcardViewId(conf.exhibitorSourceUrl);
    if (!viewId) throw new Error('swapcard: could not resolve viewId from exhibitorSourceUrl');

    const out: ExhibitorRecord[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;

    for (let pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
      const page: ExhibitorsPage = await fetchExhibitorsPage(viewId, cursor);
      for (const rec of parseSwapcardExhibitorsPage(page, conf.exhibitorSourceUrl)) {
        const key = rec.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(rec);
      }
      const info = page?.data?.view?.exhibitors?.pageInfo;
      if (!info?.hasNextPage || !info.endCursor) break;
      cursor = info.endCursor;
    }

    return out;
  },
};
