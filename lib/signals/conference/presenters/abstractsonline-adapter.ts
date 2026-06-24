/**
 * abstractsonline / OASIS itinerary planner adapter — NOT CRACKED (stub).
 *
 * CTI Meeting Technology's "Program Planner" (the `pp8` SPA at
 * abstractsonline.com/pp8/#!/{eventId}) powers AACR / ASCO / AHA / many large
 * society programs. Unlike eventScribe and Informa (server-rendered, parseable
 * with one HTTP request), this one is a Backbone/RequireJS single-page app whose
 * data sits behind a WCF/OASIS REST service that is HARD-GATED on a per-request
 * `Backpack` token — and that token cannot be minted over plain HTTP.
 *
 * ── What the SPA actually does (reverse-engineered from js/main.js +
 *    js/main-built.js + js/app/config.js, 2026-06-24, AACR 2025 eventId 20273) ──
 *
 *   const domain = 'https://www.abstractsonline.com/oe3';  // app/config.js
 *   const meetingID = <eventId from the #!/<id> hash>;     // e.g. 20273
 *
 *   1. Anonymous backpack (the per-session client key), at app bootstrap:
 *        POST  {domain}/Backpack/new/planner8/secret
 *        → { ID, Expiration }   // stored in the `backpack` cookie
 *   2. EVERY data call carries that token in a `Backpack` header, e.g. the
 *      catalog search:
 *        POST  {domain}/Program/{meetingID}/Search/New/{type}
 *        headers: { Backpack, Accept: application/json, Caller: PP8 }
 *        body:    { "Phrase": "<query>" }
 *      and the per-record reads: GET {domain}/Program/{meetingID}/Person,
 *      /Session, /Presentation, … (sessions + speakers + affiliations live here).
 *
 * ── Why it is NOT reachable over HTTP (the precise blocker, all verified live) ──
 *
 *   • Every data endpoint is auth-gated. With no header:
 *       POST {domain}/Program/20273/Search/New/all  → 401
 *       GET  {domain}/Program/20273/{Person|Session|Presentation|Authors|...} → 401
 *       body: {"Message":"A valid Backpack key needs to be included in the
 *              header of your request."}
 *     So nothing is readable without a backpack token.
 *
 *   • The anonymous-backpack route the SPA uses does NOT exist on the public
 *     service. POST/GET/PUT to {domain}/Backpack/new/planner8/secret all return
 *     the WCF "Endpoint not found" page (HTTP 404) — from bare curl AND from a
 *     real headless browser (Apify rag-web-browser GET). The public Backpack
 *     service's full operation table (…/OE3/Backpack/help) confirms it: the only
 *     creation route is `POST /Backpack/create` (CreateNew), which requires an
 *     `OasisCredential` body and returns 400 "Credentials are missing or
 *     invalid." `Backpack/{ID}` is a strictly 1-segment route — any 3-segment
 *     `new/.../...` path is unrouted. There is no anonymous, no-auth way in.
 *
 *   • Rendering the SPA does not help short of executing it long enough to let it
 *     mint its own backpack and then reading `window.app.user.getBackpack()` /
 *     re-issuing the data fetches from inside the page origin. That requires a
 *     code-injecting headless browser (Puppeteer/Playwright with a custom
 *     pageFunction) — apify/puppeteer-scraper, apify/web-scraper — none of which
 *     were runnable in this environment (all require interactive account-level
 *     permission approval). rag-web-browser only returns page text/markdown and
 *     does not run long enough for the SPA to populate data ("One fine body"
 *     placeholder only), so it cannot extract the program either.
 *
 * ── What it would take to crack ──
 *   A headless browser that (a) loads {pp8}/#!/{eventId}, (b) waits for the SPA
 *   to bootstrap and provision its anonymous backpack, then (c) from the page
 *   origin reads the backpack and replays {domain}/Program/{meetingID}/Search/New
 *   + the per-record GETs — OR a CTI-issued credential / signed token if the
 *   society grants one. Until then this platform is browser-only and this adapter
 *   stays a stub. (The journal abstract-supplement / society-archive path is the
 *   fallback for AACR/ASCO speakers — see docs/CONFERENCE_PHASE2_PRESENTERS.md.)
 *
 * See docs/CONFERENCE_PHASE2_PRESENTERS.md §"abstractsonline (OASIS) — not
 * cracked" for the full finding. NEW file — touches no working adapter.
 */
import type {
  AppearanceRecord,
  ConferenceForAppearanceFetch,
  PresenterSourceAdapter,
} from './types';

/** Marker so callers/tests can detect the not-yet-cracked state without parsing the message. */
export const ABSTRACTSONLINE_NOT_CRACKED = true as const;

/**
 * Build the OASIS data-API base for an eventId. Exported (pure, no network) so a
 * future headless cracker can reuse the exact routes once a backpack is in hand.
 * `eventId` is the numeric id in the planner hash (abstractsonline.com/pp8/#!/{eventId}).
 */
export function abstractsOnlineApiRoutes(eventId: string | number): {
  domain: string;
  backpackCreate: string;
  search: (type: string) => string;
} {
  const domain = 'https://www.abstractsonline.com/oe3';
  return {
    domain,
    // The SPA's anonymous-backpack route (browser-only; 404s to bare HTTP).
    backpackCreate: `${domain}/Backpack/new/planner8/secret`,
    search: (type: string) => `${domain}/Program/${eventId}/Search/New/${type}`,
  };
}

/**
 * Pure parse helper — placeholder. When the backpack-gated `Search/New` /
 * `Program/{id}/...` JSON is finally obtainable (headless), map each session's
 * speakers → AppearanceRecord[] here. Kept exported to mirror the working
 * adapters' (parse + fetch) shape and to give the test something to assert on.
 */
export function parseAbstractsOnlineProgram(
  _json: unknown,
  _sourceUrl: string,
): AppearanceRecord[] {
  return [];
}

export const abstractsOnlineAdapter: PresenterSourceAdapter = {
  platform: 'abstractsonline',
  /**
   * CLEAN SKIP until cracked. The OASIS data API is browser-only (every
   * /Program/{eventId}/* endpoint is Backpack-gated and the anonymous-backpack
   * route 404s to plain HTTP — see the file header for the full finding). Rather
   * than throw (which the per-conference try/catch in syncPresentersDelta would
   * record as a failure on every run), we return no appearances so the platform
   * stays wired and dormant without spamming the sync-run failure log. Swap the
   * body for the real headless fetch (mint backpack from page origin → replay
   * Search/New + per-record GETs → parseAbstractsOnlineProgram) once available.
   */
  async fetchAppearances(_conf: ConferenceForAppearanceFetch): Promise<AppearanceRecord[]> {
    return [];
  },
};
