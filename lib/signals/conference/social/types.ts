/**
 * Phase 3 — Social-intent (CONTACT-level) types for the conference signal.
 *
 * Companion to the company-level exhibitor signal (`exhibiting_at_conference`).
 * Where the exhibitor signal answers "which COMPANY has a booth", this layer
 * answers "which PERSON is self-declaring attendance" on social — e.g.
 * "presenting at #ASCO26", "come see us at booth 1203, #SITC25".
 *
 * Pipeline shape (see docs/CONFERENCE_PHASE3_SOCIAL.md):
 *   Apify hashtag/keyword search  →  SocialPostRecord[]
 *     → attendance assertion filter + confidence scoring
 *     → resolve SocialPostAuthor to a canonical person (people) + company
 *     → emit CONTACT-level `attending_conference` with the conference-date phase
 *
 * NEW file. No shared files edited. Mirrors the field-depth-optional convention
 * of adapters/types.ts: networks differ in what author detail they expose, so
 * everything past name/profileUrl is optional.
 */

/** Which social network a post came from. Drives the adapter + ToS posture. */
export type SocialNetwork = 'linkedin' | 'x';

/**
 * The author of a social post, as extracted from the scraped payload. This is
 * the resolution input — name + profileUrl are the strong identifiers; headline
 * and company help disambiguate when name alone is ambiguous.
 *
 * Field depth varies by network and by whether profile enrichment was enabled:
 *   - LinkedIn (harvestapi/linkedin-post-search, profileScraperMode 'short'):
 *     name + profileUrl + headline + current company are typically present.
 *   - X (khadinakbar/x-tweet-scraper): handle + displayName + bio; company is
 *     rarely structured (often only inferable from the bio text).
 */
export type SocialPostAuthor = {
  /** Display name as printed on the profile. Required — drives person matching. */
  name: string;
  /**
   * Canonical profile URL (LinkedIn /in/… or x.com/<handle>). The strongest
   * identifier we have for resolving to a canonical person — prefer it over name.
   */
  profileUrl?: string;
  /** X/Twitter @handle (without the @), when the network is 'x'. */
  handle?: string;
  /** Profile headline / job title line, if the payload carries it. */
  headline?: string;
  /** Current employer name, if the payload carries structured company data. */
  company?: string;
  /** Company profile/page URL, if present (LinkedIn company URN/URL). */
  companyUrl?: string;
};

/**
 * One social post as returned by an adapter, already normalized across networks.
 * The raw provider payload differs (LinkedIn post vs tweet); the adapter maps it
 * onto this shape so the resolver + emitter stay network-agnostic.
 */
export type SocialPostRecord = {
  /** Which network this came from. */
  network: SocialNetwork;
  /** Stable per-post id from the provider (post URN / tweet id). For dedupe. */
  postId: string;
  /** Permalink to the post, for provenance + the signal's evidence_url. */
  postUrl: string;
  /** Full post body text. The attendance assertion is detected from this. */
  text: string;
  /** ISO timestamp the post was published, if known. */
  postedAt?: string | null;
  /** The author block (resolution input). */
  author: SocialPostAuthor;
  /**
   * Which conference hashtag(s)/term(s) this post matched on. Lets us attribute
   * the post to a specific `conferences` row even when the query batched several.
   * Each entry is a tag exactly as searched (e.g. '#ASCO26').
   */
  matchedTags: string[];
};

/**
 * The conference context an adapter is asked to scrape for. Carries the tag set
 * to search and the id to attribute matches back to. `social_tags` is expected
 * to live on the `conferences` row (a `text[]` column — see the doc).
 */
export type ConferenceForSocialScrape = {
  /** Stable conference id (uuid in the `conferences` table). */
  conferenceId: string;
  /** Human name, for logging. */
  name: string;
  /**
   * The hashtags / initials to search, e.g. ['#ASCO26', '#ASCO2026', 'ASCO 2026'].
   * Sourced from `conferences.social_tags text[]`.
   */
  socialTags: string[];
  /** Conference start/end — used by the caller to gate scraping to the window. */
  startDate?: string | null;
  endDate?: string | null;
};

/**
 * The outcome of scoring a post for whether it actually asserts attendance.
 * Pure-text heuristic (no LLM in the cheap path); an optional LLM screener can
 * upgrade ambiguous medium-confidence posts (mirrors sec-form-d-screener).
 */
export type AttendanceAssertion = {
  /** Whether the post asserts the author will attend / is attending / presenting. */
  asserts: boolean;
  /** 0..1 confidence. Gate emission at a threshold (suggest >= 0.6). */
  confidence: number;
  /** Which assertion cue fired ('presenting' | 'booth' | 'see you at' | …). */
  cue?: string;
};

/** A single adapter that scrapes one network for posts matching a tag set. */
export interface SocialPostSource {
  /** The network this source covers. */
  readonly network: SocialNetwork;
  /** Fetch posts matching the conference's social tags. */
  fetchPosts(conf: ConferenceForSocialScrape): Promise<SocialPostRecord[]>;
}
