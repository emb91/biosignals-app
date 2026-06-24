/**
 * abstractsonline / OASIS itinerary planner adapter.
 *
 * CTI Meeting Technology's "Program Planner" (the `pp8` SPA at
 * abstractsonline.com/pp8/#!/{eventId}) powers AACR / ASCO / AHA / many large
 * society programs. It was previously logged as "not cracked" because the data
 * API is 401-gated behind a per-request `Backpack` token. That conclusion was
 * WRONG: the token is mintable over plain HTTP with a PUBLIC service credential
 * baked into the SPA, and every data endpoint then works server-side with no
 * browser. Verified live end-to-end against AACR 2025 (eventId 20273) on
 * 2026-06-24 — see docs/CONFERENCE_PHASE2_PRESENTERS.md §"abstractsonline (OASIS)".
 *
 * ── The cracked recipe (all plain HTTPS, no headless, no cookies) ────────────
 *
 *   base = https://www.abstractsonline.com/oe3
 *
 *   1. Mint a token (the SPA ships a fixed anonymous service login):
 *        POST {base}/Backpack/create
 *        headers: { Content-Type: application/json, Accept: application/json, Caller: PP8 }
 *        body:    { "Username": "backpack", "Password": "89j34jks98cnjks989p;nfs44" }
 *        → 201 { ID: <token>, Expiration }   // token valid ~to end of UTC day
 *      (the SPA's app/config.js + util.getBackpackId() — credential is in clear
 *       text in the bundle; this is not our secret, it is theirs and public.)
 *
 *   2. Every subsequent call carries `Backpack: <token>` (+ Caller: PP8).
 *
 *   3. Search is ASYNC — create, poll, page:
 *        POST {base}/Program/{eventId}/Search/New/{Presentation|Session|Person}
 *             body { "Phrase": "<query>" }            → { SearchId, Status:"Not Started" }
 *        GET  {base}/Program/{eventId}/Search/{SearchId}      → poll until Status:"Complete" (gives Count)
 *        GET  {base}/Program/{eventId}/Search/{SearchId}/Results?page=N&pagesize=M
 *             → { Page, PageSize, Results:[{ Id, Body(title), Head(datetime), Type }], Search:{ Count } }
 *      NOTE: empty Phrase returns 0 — the list browse is FILTER-driven, not
 *      phrase-driven. Get the facet tree at {base}/Program/{eventId}/Search/{SearchId}/Filters
 *      and apply day/session-type filters to enumerate everything; OR (leaner,
 *      and on-model for us) run a `Person` search per tracked-contact surname and
 *      confirm via the AuthorBlock — match, don't crawl.
 *
 *   4. Per-record detail carries the speakers + affiliations:
 *        GET {base}/Program/{eventId}/Presentation/{Id}
 *          → { PresenterDisplayName, AuthorBlock(HTML names+institutions),
 *              DisclosureBlock, PresentationNumber, Abstract, ... }
 *        GET {base}/Program/{eventId}/Session/{Id}/presentations
 *        GET {base}/Program/{eventId}/Participant/{Id}/presentations
 *      `AuthorBlock` is the gold: every author with a superscript-numbered
 *      institution (incl. company affiliations). Parsed by parseAuthorBlock below.
 *
 * ── Build status ──
 *   fetchAppearances is a CLEAN SKIP (returns []) for now — the live orchestration
 *   (mint → search/filter → page → detail → map authors) is deferred until the
 *   next OASIS shows are in-window (AACR/ASCO 2026 are past; 2027 planners are not
 *   published yet). The PURE pieces are implemented and tested now so the build is
 *   a thin wrapper when the time comes: the public credential, the route builder
 *   (abstractsOnlineApiRoutes), and the AuthorBlock parser (parseAuthorBlock).
 *
 * NEW file — touches no working adapter.
 */
import type {
  AppearanceRecord,
  ConferenceForAppearanceFetch,
  PresenterSourceAdapter,
} from './types';

/** Recipe is verified end-to-end; the live network build is intentionally deferred. */
export const ABSTRACTSONLINE_RECIPE_VERIFIED = true as const;
/** fetchAppearances is still a clean skip (no live orchestration yet). */
export const ABSTRACTSONLINE_LIVE = false as const;

/** OASIS data-API origin. */
export const OASIS_DOMAIN = 'https://www.abstractsonline.com/oe3';

/**
 * Public anonymous service login the pp8 SPA ships in its bundle to mint a
 * Backpack token. This is CTI's own public credential (clear-text in their
 * JavaScript), not an Arcova secret. POST it to {OASIS_DOMAIN}/Backpack/create.
 */
export const OASIS_PUBLIC_BACKPACK_LOGIN = {
  Username: 'backpack',
  Password: '89j34jks98cnjks989p;nfs44',
} as const;

/**
 * Build the OASIS data-API routes for an eventId. Pure (no network) so the
 * deferred live build — and the test — can use the exact routes. `eventId` is the
 * numeric id in the planner hash (abstractsonline.com/pp8/#!/{eventId}).
 */
export function abstractsOnlineApiRoutes(eventId: string | number): {
  domain: string;
  backpackCreate: string;
  meeting: string;
  searchNew: (dataset: 'Presentation' | 'Session' | 'Person') => string;
  searchStatus: (searchId: string | number) => string;
  searchFilters: (searchId: string | number) => string;
  searchResults: (searchId: string | number, page: number, pageSize: number) => string;
  presentation: (id: string | number) => string;
  sessionPresentations: (id: string | number) => string;
  participantPresentations: (id: string | number) => string;
} {
  const domain = OASIS_DOMAIN;
  const program = `${domain}/Program/${eventId}`;
  return {
    domain,
    backpackCreate: `${domain}/Backpack/create`,
    meeting: `${domain}/program/meeting/${eventId}`,
    searchNew: (dataset) => `${program}/Search/New/${dataset}`,
    searchStatus: (searchId) => `${program}/Search/${searchId}`,
    searchFilters: (searchId) => `${program}/Search/${searchId}/Filters`,
    searchResults: (searchId, page, pageSize) =>
      `${program}/Search/${searchId}/Results?page=${page}&pagesize=${pageSize}`,
    presentation: (id) => `${program}/Presentation/${id}`,
    sessionPresentations: (id) => `${program}/Session/${id}/presentations`,
    participantPresentations: (id) => `${program}/Participant/${id}/presentations`,
  };
}

/** One author parsed out of an OASIS `AuthorBlock`. */
export type AuthorBlockEntry = {
  /** Author display name, tags + superscripts stripped. */
  name: string;
  /** Institution(s) for this author's superscript number(s), joined with "; ". */
  affiliationRaw: string;
  /** The superscript institution indexes this author carried. */
  affiliationNums: number[];
  /** True if the source bolded this author (the presenting / first author). */
  isBold: boolean;
};

const stripTags = (s: string): string =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Parse an OASIS `AuthorBlock` (from a Presentation detail) into authors with
 * their affiliations. The block is two segments separated by a `<br>`:
 *   "<b>First Author</b><sup>1</sup>, Second<sup>2,3</sup>, …<br><br/>
 *    <sup>1</sup>Inst One, City, ST,<sup>2</sup>Inst Two, Country,…"
 * The first segment lists authors each tagged with superscript institution
 * indexes; the second maps each index → institution text. We join them so each
 * author carries its real affiliation string (the company-matching key).
 *
 * Pure + synchronous — the hardest parse detail, locked in against real AACR 2025
 * data (see presenters.test.ts). The live fetch maps these → AppearanceRecord[].
 */
export function parseAuthorBlock(authorBlock: string): AuthorBlockEntry[] {
  if (!authorBlock) return [];
  // Split authors / institutions at the first <br> boundary.
  const brMatch = authorBlock.search(/<br\s*\/?>/i);
  const authorsPart = brMatch >= 0 ? authorBlock.slice(0, brMatch) : authorBlock;
  const instPart = brMatch >= 0 ? authorBlock.slice(brMatch) : '';

  // Institution index → text. Each entry is "<sup>N</sup>Text" until the next sup.
  const institutions = new Map<number, string>();
  const instRe = /<sup>\s*(\d+)\s*<\/sup>([\s\S]*?)(?=<sup>\s*\d+\s*<\/sup>|$)/g;
  let im: RegExpExecArray | null;
  while ((im = instRe.exec(instPart)) !== null) {
    const num = Number(im[1]);
    const text = stripTags(im[2]).replace(/[,;\s]+$/, '').trim();
    if (text) institutions.set(num, text);
  }

  // Authors: "<name><sup>n[,n…]</sup>", comma-separated. [^,] keeps names from
  // spanning the comma separators between authors.
  const authors: AuthorBlockEntry[] = [];
  const authRe = /([^,]*?)<sup>\s*([\d,\s]+?)\s*<\/sup>/g;
  let am: RegExpExecArray | null;
  while ((am = authRe.exec(authorsPart)) !== null) {
    const rawName = am[1];
    const isBold = /<b>/i.test(rawName);
    const name = stripTags(rawName);
    if (!name) continue;
    const nums = am[2]
      .split(/[,\s]+/)
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0);
    const affiliationRaw = nums
      .map((n) => institutions.get(n))
      .filter((v): v is string => Boolean(v))
      .join('; ');
    authors.push({ name, affiliationRaw, affiliationNums: nums, isBold });
  }
  return authors;
}

export const abstractsOnlineAdapter: PresenterSourceAdapter = {
  platform: 'abstractsonline',
  /**
   * CLEAN SKIP. The recipe above is verified, but the live orchestration is
   * deferred until OASIS shows are next in-window (no AACR/ASCO 2027 planner is
   * published yet). Returning no appearances keeps the platform wired and dormant
   * without spamming the sync-run failure log. When built, this becomes:
   *   mint token → (filter-browse OR per-tracked-surname Person search) → page
   *   Results → GET Presentation/{Id} → parseAuthorBlock → AppearanceRecord[].
   */
  async fetchAppearances(_conf: ConferenceForAppearanceFetch): Promise<AppearanceRecord[]> {
    return [];
  },
};
