/**
 * Phase 3 — Social-intent: Apify source (LinkedIn only).
 *
 * Scope (Emma, binding — see docs/CONFERENCE_PHASE3_SOCIAL.md "Scope refinements"):
 *   - LinkedIn ONLY. X/Twitter is dropped (paid, weak employer resolution).
 *   - Cost = POSTS, not runs: a per-conference post cap + `postedLimit` window are
 *     the only cost levers (batching runs together saves nothing — priced per post).
 *   - WINDOWED to conference dates: the CALLER (sync-social-delta.ts) only invokes
 *     this for in-window conferences. This module just scrapes + maps.
 *
 * CHOSEN ACTOR (evaluated 2026-06-24 via Apify MCP search-actors):
 *   harvestapi/linkedin-post-search  (run id buIWk2uOUzTmcLsuB)
 *     - Same `harvestapi` vendor as our existing profile/company actors — proven,
 *       no-cookies, ~3,900 monthly users, 99.7% success.
 *     - `searchQueries` takes a literal LinkedIn search-bar string, so a conference
 *       hashtag ('#ASCO26') is a direct query.
 *     - Posts come back WITH the author block (name, headline, profile URL, current
 *       company) — exactly the resolution input, no second profile call.
 *     - `postedLimit` scopes the scrape to recent posts cheaply.
 *   Priced $0.002/post (FREE/BRONZE) → $0.0015 (GOLD+); $0.001 per 0-result query.
 *
 * Cost tracking: fetchPosts routes through runApifyActor (lib/apify.ts), so spend
 * lands in apify_run_usage automatically. We never hand-roll a fetch here.
 *
 * ToS reality (honest): LinkedIn prohibits scraping and aggressively rate-limits.
 * The no-cookies actor shifts exposure onto Apify infra but is NOT ToS-clean — gate
 * on the same per-conference tos_status the exhibitor pipeline uses. Posts targeted
 * are PUBLIC self-declarations (the most defensible category) — reachable ≠ resell.
 *
 * NEW file. Edits lib/apify.ts only via its additive `linkedin-post-search` entry.
 * Pure parse/filter/confidence logic lives in ./post-parsing (no Supabase chain, so
 * it is unit-testable in isolation); this module adds only the runApifyActor call.
 */

import { runApifyActor } from '@/lib/apify';
import type { ConferenceForSocialScrape, SocialPostRecord, SocialPostSource } from './types';
import { buildLinkedInInput, mapPost, type RawLinkedInPost } from './post-parsing';

// Re-export the pure helpers so existing import sites can keep using apify-source.
export {
  buildLinkedInInput,
  mapAuthor,
  mapPost,
  scoreAttendanceAssertion,
  authorResolutionStrength,
  postConfidence,
  DEFAULT_MAX_POSTS_PER_CONFERENCE,
  DEFAULT_POSTED_LIMIT,
  SOCIAL_CONFIDENCE_GATE,
} from './post-parsing';

/**
 * LinkedIn social-post source. Calls harvestapi/linkedin-post-search via
 * runApifyActor (cost → apify_run_usage), maps results to SocialPostRecord, and
 * drops items with no resolvable author. The CALLER must only invoke this for
 * in-window conferences (window/cost gate lives in sync-social-delta.ts).
 */
export const linkedInSocialSource: SocialPostSource = {
  network: 'linkedin',
  async fetchPosts(conf: ConferenceForSocialScrape): Promise<SocialPostRecord[]> {
    if (!conf.socialTags || conf.socialTags.length === 0) return [];
    const input = buildLinkedInInput(conf);
    const items = await runApifyActor<RawLinkedInPost>({
      actor: 'linkedin-post-search',
      input,
      actionType: 'conference_social_post_search',
      // Cost is per RESULTING post; inputCount tracks the query fan-out for logging.
      inputCount: conf.socialTags.length,
      metadata: { conference_id: conf.conferenceId, conference_name: conf.name },
    });

    const records: SocialPostRecord[] = [];
    for (const raw of items) {
      const rec = mapPost(raw, conf);
      if (rec) records.push(rec);
    }
    return records;
  },
};
