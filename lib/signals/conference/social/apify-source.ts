/**
 * Phase 3 — Social-intent: Apify source STUB.
 *
 * This documents the chosen Apify actors + their input/output shape and maps
 * them onto SocialPostRecord. It is intentionally a stub: the fetch + cost
 * metering are TODO and wired only when this signal is productionized. NEW file;
 * no shared files (lib/apify.ts, lib/provider-usage.ts) are edited here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CHOSEN ACTORS (evaluated 2026-06-24 via Apify MCP search-actors)
 *
 * LinkedIn (primary — richest author data, same vendor we already use):
 *   actor id   : harvestapi/linkedin-post-search   (buIWk2uOUzTmcLsuB)
 *   why        : (1) Same `harvestapi` vendor as our existing profile/company
 *                actors in lib/apify.ts — proven, no-cookies, ~3,900 monthly
 *                users, 99.7% success. (2) `searchQueries` takes the same string
 *                you'd type in the LinkedIn search bar, so a conference hashtag
 *                ('#ASCO26') is a direct query. (3) Posts come back WITH the
 *                author block (name, headline, profile URL, current company) —
 *                exactly the resolution input we need, no second profile call.
 *                (4) `postedLimit`/`postedLimitDate` let us scope to the active
 *                pre-event window cheaply (we don't re-scan history every run).
 *   input      : { searchQueries: string[]; maxPosts?: number;
 *                  postedLimit?: 'any'|'1h'|'24h'|'week'|'month'|'3months'|…;
 *                  sortBy?: 'relevance'|'date';
 *                  profileScraperMode?: 'short'|'main' (short is enough) }
 *   pricing    : $0.002 per post (FREE/BRONZE), down to $0.0015 (GOLD+).
 *                $0.001 per 0-result query. Optional profile enrich +$0.002.
 *
 * X / Twitter (secondary — broader public reach, weaker employer data):
 *   actor id   : khadinakbar/x-tweet-scraper   (rmq9TEULqx95AyQTX)
 *   why        : native `hashtags: string[]` + `mentioning` inputs (no advanced
 *                query string needed), returns tweet text + author info + media,
 *                no login required by default, 98.6% success. Cheaper sibling
 *                seemuapps/x-tweet-scraper (eGmQvYzZpTLaeouyj) at $0.001/tweet is
 *                a fine cost-down swap if author depth is sufficient.
 *   input      : { hashtags?: string[]; searchQuery?: string; mentioning?: string;
 *                  maxTweetsPerQuery?: number; startDate?: string; endDate?: string;
 *                  sort?: string; lang?: string; onlyVerified?: boolean }
 *   pricing    : $0.003 per tweet.
 *   caveat     : X structures employer poorly — `company` is usually only
 *                inferable from the bio text, so X posts resolve to a person more
 *                reliably than to a company. Treat as lower-confidence.
 *
 * ToS / RATE-LIMIT REALITY (honest):
 *   - LinkedIn aggressively rate-limits and prohibits scraping in its User
 *     Agreement. The no-cookies actor shifts that exposure onto Apify's infra,
 *     but it does NOT make it ToS-clean — runs can degrade/empty without notice,
 *     and this is a per-conference ToS gate exactly like the exhibitor sources
 *     (see docs/conference-sources.md "ToS is a per-show field"). Do not treat a
 *     green run as a durable contract.
 *   - X is comparatively tolerant of public search but still rate-limits; the
 *     login-free path is the most fragile part of any X actor.
 *   - Both are PUBLIC self-declarations (the author chose to post "I'll be at
 *     #ASCO26"), which is the most defensible category of social signal — but
 *     reachable ≠ permitted to resell as a signal. Review before productionizing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type {
  ConferenceForSocialScrape,
  SocialPostRecord,
  SocialPostSource,
} from './types';

/**
 * Actor identifiers. When productionizing, fold these into lib/apify.ts
 * APIFY_ACTORS (with publishedUnit/unitPriceUsd) rather than re-declaring the
 * runner — reuse runApifyActor so cost lands in apify_run_usage automatically.
 */
export const SOCIAL_APIFY_ACTORS = {
  linkedin: {
    id: 'harvestapi/linkedin-post-search',
    actorId: 'buIWk2uOUzTmcLsuB',
    publishedUnit: 'post',
    unitPriceUsd: 0.002, // FREE tier; 0.0015 on GOLD+
  },
  x: {
    id: 'khadinakbar/x-tweet-scraper',
    actorId: 'rmq9TEULqx95AyQTX',
    publishedUnit: 'tweet',
    unitPriceUsd: 0.003,
  },
} as const;

/** A reasonable per-conference cap so one show can't run up unbounded spend. */
export const DEFAULT_MAX_POSTS_PER_CONFERENCE = 200;

/**
 * Build the LinkedIn actor input for one conference. One query per social tag so
 * `matchedTags` can be attributed back precisely. `postedLimit` keeps the scrape
 * inside the active window (cost guardrail — see the doc's cadence section).
 */
export function buildLinkedInInput(
  conf: ConferenceForSocialScrape,
  opts?: { maxPosts?: number; postedLimit?: string },
): Record<string, unknown> {
  return {
    searchQueries: conf.socialTags,
    maxPosts: opts?.maxPosts ?? DEFAULT_MAX_POSTS_PER_CONFERENCE,
    postedLimit: opts?.postedLimit ?? 'month',
    sortBy: 'date',
    profileScraperMode: 'short', // name + headline + company is enough to resolve
  };
}

/** Build the X actor input for one conference (native hashtags[] field). */
export function buildXInput(
  conf: ConferenceForSocialScrape,
  opts?: { maxTweets?: number },
): Record<string, unknown> {
  // The X actor wants bare hashtag tokens (no leading '#'); LinkedIn wants the
  // literal search string. Strip '#' here only.
  const hashtags = conf.socialTags.map((t) => t.replace(/^#/, ''));
  return {
    hashtags,
    maxTweetsPerQuery: opts?.maxTweets ?? DEFAULT_MAX_POSTS_PER_CONFERENCE,
    sort: 'Latest',
  };
}

/**
 * LinkedIn social-post source. STUB.
 *
 * TODO(productionize):
 *   1. Register the actor in lib/apify.ts APIFY_ACTORS and call runApifyActor
 *      so spend lands in apify_run_usage (do NOT hand-roll a fetch here — that
 *      would bypass cost tracking; see lib/provider-usage.ts).
 *   2. Map each returned post item → SocialPostRecord:
 *        postId      ← item.id / item.urn / item.postUrl
 *        postUrl     ← item.url / item.postUrl
 *        text        ← item.text / item.content
 *        postedAt    ← item.postedAt / item.date
 *        author.name        ← item.author.name / item.authorName
 *        author.profileUrl  ← item.author.linkedinUrl / item.author.profileUrl
 *        author.headline    ← item.author.headline / item.author.position
 *        author.company     ← item.author.companyName / item.author.currentCompany
 *        author.companyUrl  ← item.author.companyUrl / company URN
 *        matchedTags ← the socialTags whose query produced this item
 *   3. Drop items with no author.name AND no author.profileUrl (unresolvable).
 */
export const linkedInSocialSource: SocialPostSource = {
  network: 'linkedin',
  async fetchPosts(_conf: ConferenceForSocialScrape): Promise<SocialPostRecord[]> {
    throw new Error(
      'linkedInSocialSource.fetchPosts is a stub — wire harvestapi/linkedin-post-search ' +
        'via runApifyActor (lib/apify.ts) and map items to SocialPostRecord. See file header.',
    );
  },
};

/**
 * X / Twitter social-post source. STUB. Same productionize TODO as LinkedIn,
 * mapping the tweet payload (id, url, text, createdAt, author.{userName,name,
 * description}) onto SocialPostRecord; X `company` is usually unset.
 */
export const xSocialSource: SocialPostSource = {
  network: 'x',
  async fetchPosts(_conf: ConferenceForSocialScrape): Promise<SocialPostRecord[]> {
    throw new Error(
      'xSocialSource.fetchPosts is a stub — wire khadinakbar/x-tweet-scraper via ' +
        'runApifyActor (lib/apify.ts) and map tweets to SocialPostRecord. See file header.',
    );
  },
};
