/**
 * CadmiumCD / eventScribe presenter adapter — STUB.
 *
 * eventScribe is the agenda half of CadmiumCD (same vendor as Conference
 * Harvester, which Phase 1 cracked for exhibitors). The full schedule is
 * SERVER-RENDERED — no headless browser required.
 *
 * Cracked endpoint (curl-verified, no auth, 2026-06-24 — see
 * docs/CONFERENCE_PHASE2_PRESENTERS.md §1):
 *
 *   GET {agendaSourceUrl}/agenda.asp?pfp=FullSchedule&all=1
 *     → HTTP 200, full HTML schedule (211 KB for ASCPT 2026)
 *     → 145 distinct named presenters, each rendered inline as:
 *
 *       Chair: <a class="loadbyurl popup-link"
 *          data-url="/ajaxcalls/presenterInfo.asp?HPRID=830451">Sandra A.G Visser, PhD</a>
 *          &ndash; Quantivis LLC, ASCPT President
 *
 *   Per-presenter detail (bio + session list, gate it — one request each):
 *   GET {agendaSourceUrl}/ajaxcalls/presenterInfo.asp?HPRID={id}
 *
 * NOTE: the eventScribe subdomain slug is PER-EVENT and must be discovered, not
 * guessed (ascpt2026 works; sitc2025/aacr2025 use different slugs). The caller
 * passes the discovered event root as `agendaSourceUrl`.
 *
 * THIS IS A STUB. The fetch + HTML parse are intentionally not implemented — this
 * file exists to pin the interface and the cracked endpoint. Do NOT wire it into
 * a registry or monitor yet.
 */
import type {
  AppearanceRecord,
  ConferenceForAppearanceFetch,
  PresenterSourceAdapter,
} from './types';

/** Honest browser UA + Accept (same default the Phase 1 fetcher uses). */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const eventScribeAdapter: PresenterSourceAdapter = {
  platform: 'eventscribe',

  async fetchAppearances(conf: ConferenceForAppearanceFetch): Promise<AppearanceRecord[]> {
    // TODO(phase-2): implement the real fetch + parse.
    //
    //   1. const base = conf.agendaSourceUrl.replace(/\/$/, '');
    //   2. const url = `${base}/agenda.asp?pfp=FullSchedule&all=1`;
    //   3. fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' } })
    //   4. Parse each presenter anchor:
    //        /presenterInfo\.asp\?HPRID=(\d+)">([^<]+)<\/a>\s*&ndash;\s*([^<]+)/g
    //      → group 2 = speakerName (+ credential), group 3 = affiliationRaw
    //        (split trailing role off the affiliation, e.g. "Quantivis LLC, ASCPT President").
    //   5. Determine appearanceType from the label preceding the anchor
    //        ("Chair:" → 'chair', "Moderator:" → 'moderator', "Speaker:"/"Presenter:" → 'speaker').
    //   6. Associate the session title from the enclosing session block.
    //   7. HTML-entity-decode names (&amp; → &, &ndash; → –).
    //   8. (optional, gated) enrich each via /ajaxcalls/presenterInfo.asp?HPRID=<id>.
    //
    // Returns AppearanceRecord[] — name + affiliation + sessionTitle + appearanceType.
    // emails are NOT present in eventScribe agendas (leave publishedEmail undefined).
    void conf;
    void BROWSER_UA;
    throw new Error('eventScribeAdapter.fetchAppearances not implemented (Phase 2 stub)');
  },
};
