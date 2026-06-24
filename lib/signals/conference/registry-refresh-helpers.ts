/**
 * Pure helpers for the conference registry-refresh monitor.
 *
 * The registry rows go stale because they're only ever seeded manually: when next
 * year's edition of a recurring show publishes, the existing row still points at
 * last year's URL/eventId/dates, so the exhibitor + presenter pollers keep
 * pulling a dead edition. These helpers carry the load-bearing, network-free
 * logic the refresh sync needs:
 *
 *   • bump the calendar year embedded in a platform source-key or URL
 *     (mapyourshow show codes `{code}{yy|yyyy}`, smallworldlabs `{slug}{year}`
 *     subdomains),
 *   • extract the current edition's dates from a stable-URL page's HTML
 *     (terrapinn, informa), and
 *   • decide, given a row's platform, what KIND of resolution it supports.
 *
 * Kept pure (no fetch, no Supabase) so they're unit-testable without a network
 * call — mirrors how the adapters expose their parsers (parseTerrapinnExhibitors,
 * splitMysRow, parseAuthorBlock) for the conference test stub.
 */
import type { ConferencePlatform } from './adapters/types';

/**
 * How an edition can be resolved for a given platform.
 *
 *   templated — the live edition lives at a year-templated URL/key we can derive
 *               and probe (mapyourshow show code, smallworldlabs subdomain).
 *   stable    — the URL is year-stable; re-fetch the same page and read the
 *               current edition's dates off it (terrapinn, informa).
 *   manual    — no reliable programmatic edition signal (e.g. abstractsonline
 *               eventId is an opaque per-edition number, not derivable); these
 *               are left unchanged and surfaced for manual re-seeding.
 */
export type RefreshStrategy = 'templated' | 'stable' | 'manual';

export function refreshStrategyForPlatform(platform: ConferencePlatform | string): RefreshStrategy {
  switch (platform) {
    case 'mapyourshow':
    case 'smallworldlabs':
      return 'templated';
    case 'terrapinn':
    case 'informa':
      return 'stable';
    default:
      // a2z, spargo, conference_harvester, swapcard, abstractsonline, and any
      // future platform default to manual until a derivation is proven for them.
      return 'manual';
  }
}

/**
 * Bump a 4-digit (2020-2099) or 2-digit ('20-'99) year token embedded in a
 * source string by `by` years, returning the new string, or null if no year
 * token is present.
 *
 * Handles the two real registry conventions:
 *   • mapyourshow show codes:  "ashg26" → "ashg27", "idweek2026" → "idweek2027",
 *     "medtech26" → "medtech27", "ispeam26" → "ispeam27".
 *   • smallworldlabs subdomains/slugs: "asgct2026" → "asgct2027".
 *
 * We bump the LAST year token in the string (the edition year is always the
 * trailing token in these codes) and preserve its digit width, so a 2-digit
 * code stays 2-digit and a 4-digit code stays 4-digit.
 */
export function bumpYearToken(source: string, by = 1): string | null {
  if (!source) return null;
  // Find the last 4-digit (20xx) or 2-digit (2x-9x) year token. The 4-digit
  // alternative is tried first so "idweek2026" cuts "2026", not "26".
  const re = /(20\d{2})(?!\d)|(?<![0-9])([2-9]\d)(?![0-9])/g;
  let last: { index: number; text: string } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const text = m[1] ?? m[2];
    last = { index: m.index, text };
  }
  if (!last) return null;
  const isFourDigit = last.text.length === 4;
  const current = isFourDigit ? Number(last.text) : 2000 + Number(last.text);
  const next = current + by;
  const replacement = isFourDigit ? String(next) : String(next).slice(-2);
  return source.slice(0, last.index) + replacement + source.slice(last.index + last.text.length);
}

/**
 * Derive the next-edition candidate source-key for a templated platform, or null
 * if the platform isn't templated or the key carries no year token.
 *
 *   mapyourshow      — `exhibitor_source_url` is the bare show code ("ashg26").
 *   smallworldlabs   — `exhibitor_source_url` is the subdomain or a full
 *                      `{slug}{year}.smallworldlabs.com/...` URL.
 *
 * For smallworldlabs we bump the year inside the subdomain label specifically
 * (so a full URL's year-bearing host is updated while the rest of the URL is
 * preserved); for mapyourshow we bump the year in the show code directly.
 */
export function nextEditionSourceKey(
  platform: ConferencePlatform | string,
  currentSourceKey: string | null | undefined,
  by = 1,
): string | null {
  if (!currentSourceKey) return null;
  if (platform === 'mapyourshow') {
    return bumpYearToken(currentSourceKey, by);
  }
  if (platform === 'smallworldlabs') {
    // A full URL: bump the year in the host's first label only.
    if (/^https?:\/\//i.test(currentSourceKey)) {
      try {
        const url = new URL(currentSourceKey);
        const [first, ...rest] = url.hostname.split('.');
        const bumped = bumpYearToken(first, by);
        if (!bumped) return null;
        url.hostname = [bumped, ...rest].join('.');
        return url.toString();
      } catch {
        return null;
      }
    }
    // A bare subdomain ("asgct2026").
    return bumpYearToken(currentSourceKey, by);
  }
  return null;
}

/**
 * The mapyourshow liveness-probe URL for a show code. The home page is enough to
 * tell whether the edition exists (a published show renders a real home page; an
 * unpublished one 404s or redirects away).
 */
export function mapYourShowProbeUrl(showCode: string): string {
  return `https://${showCode}.mapyourshow.com/`;
}

/**
 * The smallworldlabs liveness-probe URL for a subdomain or full URL. Reuses the
 * adapter's /exhibitors directory convention (the page that carries the actual
 * exhibitor data the poller reads), so "live" means "the data the poller needs
 * is really there", not just "some host answers".
 */
export function smallWorldLabsProbeUrl(subdomainOrUrl: string): string {
  if (/^https?:\/\//i.test(subdomainOrUrl)) return subdomainOrUrl;
  return `https://${subdomainOrUrl}.smallworldlabs.com/exhibitors`;
}

/**
 * Decide whether a probed page is a LIVE edition with real data versus a 404 /
 * empty shell / "coming soon" placeholder. Conservative on purpose: we only
 * rewrite a registry row to a new edition when we're confident, otherwise the
 * row is left for manual seeding (never silently broken).
 *
 *   • The HTTP fetch must have been ok (status passed in by the caller).
 *   • The body must be non-trivial (real pages are large; a redirect stub or a
 *     placeholder is tiny).
 *   • It must not look like an explicit not-found / coming-soon page.
 */
export function looksLikeLiveEdition(status: number, body: string): boolean {
  if (status < 200 || status >= 400) return false;
  const text = body ?? '';
  if (text.length < 1000) return false;
  if (/coming soon|page not found|404 error|not yet (?:open|available|published)/i.test(text)) {
    return false;
  }
  return true;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function iso(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * Extract the current edition's start/end dates from a stable-URL page's HTML
 * (terrapinn, informa). Pure + synchronous so the parse is unit-checkable
 * without a network call. Returns ISO yyyy-mm-dd strings, or nulls when a date
 * can't be confidently read.
 *
 * Stable-URL life-science show pages print a human date range near the top, in a
 * handful of shapes we cover here:
 *
 *   • machine-readable <time datetime="2027-04-13">…  (preferred when present)
 *   • "13 - 14 April 2027"  / "13-14 April 2027"        (terrapinn)
 *   • "April 13-14, 2027"   / "April 13 - 14, 2027"     (informa)
 *   • "8 - 11 March 2027"   spanning, same year
 *   • single day "23 September 2026" / "September 23, 2026"
 *
 * Cross-month / cross-year ranges are intentionally NOT inferred from a bare
 * "8 March - 2 April 2027" form here (rare for these shows); such a row reads a
 * single confident date and the caller treats a partial result conservatively.
 */
export function extractEditionDates(html: string): { startDate: string | null; endDate: string | null } {
  const text = (html ?? '').replace(/&nbsp;/g, ' ');

  // 1) Machine-readable <time datetime="..."> tags — most reliable when present.
  const timeRe = /<time[^>]*\bdatetime="(\d{4}-\d{2}-\d{2})/gi;
  const isoHits: string[] = [];
  let tm: RegExpExecArray | null;
  while ((tm = timeRe.exec(text)) !== null) {
    isoHits.push(tm[1]);
    if (isoHits.length >= 4) break;
  }
  if (isoHits.length >= 1) {
    const sorted = [...new Set(isoHits)].sort();
    return { startDate: sorted[0], endDate: sorted[sorted.length - 1] };
  }

  const monthAlt = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

  // 2) "13 - 14 April 2027" / "13-14 April 2027" (day range, month, year).
  const dayRange = new RegExp(
    `\\b(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2})\\s+(${monthAlt})\\s+(\\d{4})\\b`,
    'i',
  );
  let m = text.match(dayRange);
  if (m) {
    const month = MONTHS[m[3].toLowerCase()];
    const year = Number(m[4]);
    return { startDate: iso(year, month, Number(m[1])), endDate: iso(year, month, Number(m[2])) };
  }

  // 3) "April 13 - 14, 2027" / "April 13-14, 2027" (month, day range, year).
  const monthDayRange = new RegExp(
    `\\b(${monthAlt})\\s+(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2}),?\\s+(\\d{4})\\b`,
    'i',
  );
  m = text.match(monthDayRange);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    const year = Number(m[4]);
    return { startDate: iso(year, month, Number(m[2])), endDate: iso(year, month, Number(m[3])) };
  }

  // 4) Single day "23 September 2026".
  const singleDayFirst = new RegExp(`\\b(\\d{1,2})\\s+(${monthAlt})\\s+(\\d{4})\\b`, 'i');
  m = text.match(singleDayFirst);
  if (m) {
    const day = iso(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
    return { startDate: day, endDate: day };
  }

  // 5) Single day "September 23, 2026".
  const singleMonthFirst = new RegExp(`\\b(${monthAlt})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'i');
  m = text.match(singleMonthFirst);
  if (m) {
    const day = iso(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]));
    return { startDate: day, endDate: day };
  }

  return { startDate: null, endDate: null };
}
