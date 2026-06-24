/**
 * Pure parse / filter / confidence logic for Phase 3 social-intent posts.
 *
 * Split out of apify-source.ts so it carries NO runtime dependency on lib/apify
 * (and therefore no Supabase chain) and can be unit-tested in isolation against
 * fixtures. apify-source.ts imports these and adds only the runApifyActor call.
 *
 * The attendance-assertion filter is the precision gate: a hashtag match is NOT an
 * attendance assertion. We require a first-person attendance cue and HARD-DROP on
 * spectator / past-tense / news-voice cues. Confidence = assertion strength ×
 * author-resolution strength; the monitor gates emission at SOCIAL_CONFIDENCE_GATE.
 */
import type {
  AttendanceAssertion,
  ConferenceForSocialScrape,
  SocialPostAuthor,
  SocialPostRecord,
} from './types';

/** A reasonable per-conference cap so one viral hashtag can't run up unbounded spend. */
export const DEFAULT_MAX_POSTS_PER_CONFERENCE = 200;

/** Default `postedLimit` window — scope each run to recent posts (net-new only). */
export const DEFAULT_POSTED_LIMIT = 'month';

/** Gate emission at this combined confidence (assertion × author resolution). */
export const SOCIAL_CONFIDENCE_GATE = 0.6;

// ── Attendance-assertion filter (cheap, no LLM) ─────────────────────────────────

type Cue = { label: string; pattern: RegExp; strength: number };

/** Strong first-person attendance assertions. */
const POSITIVE_CUES: Cue[] = [
  { label: 'presenting', pattern: /\b(i'?m|i am|we'?re|we are)\s+presenting\b/i, strength: 0.95 },
  { label: 'speaking', pattern: /\b(i'?m|i am|we'?re|we are)\s+speaking\b/i, strength: 0.92 },
  { label: 'our_booth', pattern: /\bour booth\b/i, strength: 0.9 },
  { label: 'come_by_booth', pattern: /\b(come|stop|swing)\s+by\s+(our\s+)?booth\b/i, strength: 0.9 },
  { label: 'visit_us_booth', pattern: /\b(visit|find|see)\s+us\s+(at\s+)?(our\s+)?booth\b/i, strength: 0.9 },
  { label: 'ill_be_at', pattern: /\bi'?(ll| will)\s+be\s+at\b/i, strength: 0.88 },
  { label: 'well_be_at', pattern: /\bwe'?(ll| will)\s+be\s+at\b/i, strength: 0.85 },
  { label: 'find_me_at', pattern: /\bfind me at\b/i, strength: 0.85 },
  { label: 'join_us_at', pattern: /\bjoin us (at|in)\b/i, strength: 0.8 },
  { label: 'see_you_at', pattern: /\bsee you (at|in)\b/i, strength: 0.78 },
  { label: 'attending', pattern: /\b(i'?m|i am|we'?re|we are)\s+attending\b/i, strength: 0.8 },
  { label: 'heading_to', pattern: /\b(i'?m|i am|we'?re|we are)?\s*heading (to|over to)\b/i, strength: 0.72 },
  { label: 'on_my_way', pattern: /\bon my way to\b/i, strength: 0.72 },
  { label: 'looking_forward', pattern: /\blooking forward to\b/i, strength: 0.55 },
  { label: 'excited_for', pattern: /\b(excited|thrilled|can'?t wait)\b/i, strength: 0.5 },
];

/**
 * Negative cues — spectator / past-tense / observer voice. Any of these HARD-DROPS
 * the post: the author is NOT asserting their own attendance.
 */
const NEGATIVE_CUES: Cue[] = [
  { label: 'couldnt_make_it', pattern: /\bcouldn'?t make it\b/i, strength: 1 },
  { label: 'cant_make_it', pattern: /\bcan'?t make it\b/i, strength: 1 },
  { label: 'wish_i_was', pattern: /\bwish (i|we) (was|were|could)\b/i, strength: 1 },
  { label: 'not_attending', pattern: /\b(not|won'?t be|will not be)\s+(attending|going|there)\b/i, strength: 1 },
  { label: 'watch_livestream', pattern: /\b(watch|tune in|stream)\b.*\blivestream\b/i, strength: 1 },
  { label: 'recap_of', pattern: /\brecap of\b/i, strength: 1 },
  { label: 'last_year_at', pattern: /\blast year (at|@)\b/i, strength: 1 },
  { label: 'read_about', pattern: /\bread (about|more)\b/i, strength: 1 },
  { label: 'highlights_from', pattern: /\bhighlights from\b/i, strength: 1 },
];

/** Leading "RT @" / "reposted" markers — pure reshares are not first-person assertions. */
const RESHARE_PATTERN = /^\s*(rt\s+@|reposted\b|sharing\b)/i;

/**
 * Score a post for whether it ASSERTS first-person attendance (pure-text heuristic).
 * Returns the strongest positive cue's strength, or asserts:false if a negative cue
 * fires or no positive cue is present.
 */
export function scoreAttendanceAssertion(text: string | null | undefined): AttendanceAssertion {
  const body = (text ?? '').trim();
  if (!body) return { asserts: false, confidence: 0 };

  if (RESHARE_PATTERN.test(body)) return { asserts: false, confidence: 0, cue: 'reshare' };

  for (const neg of NEGATIVE_CUES) {
    if (neg.pattern.test(body)) {
      return { asserts: false, confidence: 0, cue: `negative:${neg.label}` };
    }
  }

  let best: Cue | null = null;
  for (const pos of POSITIVE_CUES) {
    if (pos.pattern.test(body) && (!best || pos.strength > best.strength)) best = pos;
  }
  if (!best) return { asserts: false, confidence: 0 };
  return { asserts: true, confidence: best.strength, cue: best.label };
}

/**
 * Author-resolution strength multiplier. A profile URL (/in/…) is the strongest
 * identifier; name + structured company is medium; name alone is weak.
 */
export function authorResolutionStrength(author: SocialPostAuthor): number {
  if (author.profileUrl && author.profileUrl.includes('/in/')) return 1;
  if (author.company && author.name) return 0.75;
  if (author.name) return 0.55;
  return 0;
}

/** Combined confidence for a post: assertion strength × author-resolution strength. */
export function postConfidence(record: SocialPostRecord): {
  assertion: AttendanceAssertion;
  authorStrength: number;
  confidence: number;
} {
  const assertion = scoreAttendanceAssertion(record.text);
  const authorStrength = authorResolutionStrength(record.author);
  const confidence = assertion.asserts ? assertion.confidence * authorStrength : 0;
  return { assertion, authorStrength, confidence };
}

// ── Raw → SocialPostRecord mapping ──────────────────────────────────────────────

/** The shape the harvestapi post-search actor returns (defensive — fields vary). */
export type RawLinkedInPost = Record<string, unknown>;

function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  return undefined;
}

function pick(obj: RawLinkedInPost, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = str(obj[k]);
    if (v) return v;
  }
  return undefined;
}

/** Map the (defensively-typed) author sub-object onto SocialPostAuthor. */
export function mapAuthor(raw: RawLinkedInPost): SocialPostAuthor | null {
  const authorObj = (raw.author && typeof raw.author === 'object' ? raw.author : raw) as RawLinkedInPost;
  const name =
    pick(authorObj, ['name', 'fullName', 'authorName']) ?? pick(raw, ['authorName', 'authorFullName']);
  const profileUrl =
    pick(authorObj, ['linkedinUrl', 'profileUrl', 'url', 'publicProfileUrl']) ??
    pick(raw, ['authorUrl', 'authorProfileUrl']);
  if (!name && !profileUrl) return null; // unresolvable — drop
  return {
    name: name ?? '',
    profileUrl,
    headline: pick(authorObj, ['headline', 'position', 'occupation', 'subtitle']),
    company: pick(authorObj, ['companyName', 'currentCompany', 'company']),
    companyUrl: pick(authorObj, ['companyUrl', 'companyLinkedinUrl']),
  };
}

/**
 * Map one raw actor item to a SocialPostRecord, attributing matchedTags by which of
 * the conference's tags appear in the post text. Returns null for items with no
 * resolvable author or no post id.
 */
export function mapPost(
  raw: RawLinkedInPost,
  conf: ConferenceForSocialScrape,
): SocialPostRecord | null {
  const author = mapAuthor(raw);
  if (!author) return null;

  const postUrl = pick(raw, ['url', 'postUrl', 'link', 'permalink']);
  const postId = pick(raw, ['id', 'urn', 'postId', 'activityId']) ?? postUrl;
  if (!postId) return null;

  const text = pick(raw, ['text', 'content', 'commentary', 'body']) ?? '';
  const postedAt = pick(raw, ['postedAt', 'date', 'publishedAt', 'createdAt']) ?? null;

  const haystack = `${text} ${postUrl ?? ''}`.toLowerCase();
  const matchedTags = conf.socialTags.filter((t) => {
    const needle = t.toLowerCase().trim();
    return needle.length > 0 && haystack.includes(needle);
  });

  return {
    network: 'linkedin',
    postId,
    postUrl: postUrl ?? '',
    text,
    postedAt,
    author,
    matchedTags: matchedTags.length ? matchedTags : conf.socialTags,
  };
}

/**
 * Build the LinkedIn actor input for one conference. One `searchQueries` entry per
 * social tag so matchedTags can be attributed; `maxPosts` is the per-conference
 * cost cap; `postedLimit` keeps the scrape inside the active window.
 */
export function buildLinkedInInput(
  conf: ConferenceForSocialScrape,
  opts?: { maxPosts?: number; postedLimit?: string },
): Record<string, unknown> {
  return {
    searchQueries: conf.socialTags,
    maxPosts: opts?.maxPosts ?? DEFAULT_MAX_POSTS_PER_CONFERENCE,
    postedLimit: opts?.postedLimit ?? DEFAULT_POSTED_LIMIT,
    sortBy: 'date',
    profileScraperMode: 'short',
  };
}
