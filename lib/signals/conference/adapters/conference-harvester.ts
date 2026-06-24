/**
 * Conference Harvester / CadmiumCD adapter — CRACKED.
 *
 * Powers SITC (EventKey=NAKXYFLC) and SLAS (EventKey=ANXMFLVZ); cracking it
 * unlocks both. See docs/conference-ingestion-deep.md §1 for the full writeup.
 *
 * The floorplan v2 page drives the exhibitor list via a POST to
 *   https://www.conferenceharvester.com/floorplan/v2/ajaxcalls/CreateCompanyList.asp
 * which requires EventID + EventClientID (numeric, per-event) in addition to
 * the EventKey. A bare call returns an "Oops" 500. EventID/EventClientID live
 * in the floorplan index page's inline JS, so we scrape them once then POST.
 *
 * Verified live (2026-06-24, no auth):
 *   SITC NAKXYFLC → EventID=25702 EventClientID=272 → 144 exhibitors (10x Genomics, AstraZeneca, BD)
 *   SLAS ANXMFLVZ → EventID=24981 EventClientID=134 → 435 exhibitors (Abcam, 10x Genomics)
 *
 * Optional enrichment (not done here): GET ExhibitorInfoPopup.asp?BoothID=&EventKey=
 * returns website/LinkedIn/Twitter per booth — gate it (one request/booth).
 */
import type { ConferenceAdapter, ConferenceForFetch, ExhibitorRecord } from './types';

const HOST = 'https://www.conferenceharvester.com';
const INDEX_URL = `${HOST}/floorplan/v2/index.asp`;
const COMPANY_LIST_URL = `${HOST}/floorplan/v2/ajaxcalls/CreateCompanyList.asp`;

const UA = 'Arcova GTM conference-monitor (contact: emma@arcova.bio)';

type HarvesterCompany = {
  exhibitorName?: string | null;
  boothNumber?: string | null;
  exhibitorKey?: string | null;
  boothURL?: string | null;
};
type HarvesterBucket = { bucketHeading?: string; companyList?: HarvesterCompany[] };
type HarvesterResponse = { companyListHeading?: HarvesterBucket[] };

/**
 * Scrape EventID + EventClientID from the floorplan index page's inline JS.
 * Returns null for a value it can't find so the caller can fall back to
 * `platformParams` (where a known pair can be pre-seeded).
 */
export async function fetchHarvesterEventIds(
  eventKey: string,
): Promise<{ eventId: string | null; eventClientId: string | null }> {
  const res = await fetch(`${INDEX_URL}?EventKey=${encodeURIComponent(eventKey)}`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`conference-harvester index ${res.status} for ${eventKey}`);
  const html = await res.text();
  // Inline JS: `data: { EventID : 25702, EventClientID : 272, EventKey: '...' }`
  const eventId = html.match(/EventID\s*:\s*(\d+)/)?.[1] ?? null;
  const eventClientId = html.match(/EventClientID\s*:\s*(\d+)/)?.[1] ?? null;
  return { eventId, eventClientId };
}

function flatten(resp: HarvesterResponse, sourceUrl: string): ExhibitorRecord[] {
  const out: ExhibitorRecord[] = [];
  for (const bucket of resp.companyListHeading ?? []) {
    for (const c of bucket.companyList ?? []) {
      const name = c.exhibitorName?.trim();
      if (!name) continue;
      out.push({
        name,
        booth: c.boothNumber?.trim() || undefined,
        sourceUrl,
      });
    }
  }
  return out;
}

export const conferenceHarvesterAdapter: ConferenceAdapter = {
  platform: 'conference_harvester',
  async fetchExhibitors(conf: ConferenceForFetch): Promise<ExhibitorRecord[]> {
    // exhibitorSourceUrl carries the EventKey (or a full index URL we parse).
    const eventKey =
      conf.exhibitorSourceUrl.match(/EventKey=([A-Z0-9]+)/i)?.[1] ?? conf.exhibitorSourceUrl;

    // Prefer pre-seeded ids; otherwise scrape them from the index page.
    let eventId = conf.platformParams?.eventId != null ? String(conf.platformParams.eventId) : null;
    let eventClientId =
      conf.platformParams?.eventClientId != null ? String(conf.platformParams.eventClientId) : null;
    if (!eventId || !eventClientId) {
      const scraped = await fetchHarvesterEventIds(eventKey);
      eventId = eventId ?? scraped.eventId;
      eventClientId = eventClientId ?? scraped.eventClientId;
    }
    if (!eventId || !eventClientId) {
      throw new Error(`conference-harvester: missing EventID/EventClientID for ${eventKey}`);
    }

    const body = new URLSearchParams({
      EventID: eventId,
      EventClientID: eventClientId,
      EventKey: eventKey,
      ShowLogos: 'Yes',
      LogoLocation: '1',
      ShowCompanyWithNegativeBalance: '1',
      OpenBoothPopupLink: 'ajaxcalls/OpenBoothPopup.asp?',
      RentedBoothPopupLink: 'ajaxcalls/ExhibitorInfoPopup.asp?',
      BlockLogosBeforeLogoTaskCompletion: 'false',
    });

    const indexUrl = `${INDEX_URL}?EventKey=${encodeURIComponent(eventKey)}`;
    const res = await fetch(COMPANY_LIST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: indexUrl,
        'User-Agent': UA,
      },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`conference-harvester CreateCompanyList ${res.status} for ${eventKey}`);
    // Response is JSON served as text/html.
    const parsed = JSON.parse(await res.text()) as HarvesterResponse;
    return flatten(parsed, indexUrl);
  },
};
