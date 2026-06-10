/**
 * Patent portfolio surge → the actual patents behind it.
 *
 * The patents monitor emits one aggregate `assignee_portfolio_acceleration`
 * signal whose source_url is a generic `patents.google.com/?assignee=<name>`
 * search link, plus individual patent_* events — each carrying the real USPTO
 * title in `metadata.patent_title` and a SPECIFIC `patents.google.com/patent/<id>`
 * link. This collects those individual events per company so a surge row can list
 * each patent (title + its own link + filing date) instead of a bare search URL.
 *
 * The same publication shows up under multiple keys (e.g. both
 * `patent_application_published` and `patent_filed_or_granted`), so we dedupe by
 * publication number. Titles arrive HTML-encoded (`3&#39;-hydroxy`) and are decoded.
 *
 * Pure + tested — see lib/signals/patent-surge.test.ts.
 */

export type PatentEventInput = {
  sourceEventType: string;
  companyId: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceSummary: string | null;
  metadata: Record<string, unknown> | null | undefined;
  eventAt: string | null;
  observedAt: string | null;
};

export type RecentPatent = {
  /** Publication number (or URL/title fallback) — the dedupe key. */
  key: string;
  /** HTML-decoded, human-readable patent title. */
  title: string;
  /** Specific google.com/patent/<id> link. */
  url: string | null;
  /** Filing / grant / publication date (event_at). */
  date: string | null;
};

/** Individual patent signal types that roll up into a portfolio surge. */
export const PATENT_DETAIL_TYPES = new Set([
  'patent_filed_or_granted',
  'patent_application_published',
  'patent_granted',
  'new_therapeutic_area_patent',
]);

/**
 * Recency window for the patents shown under a surge. Patents filed (event_at)
 * within this many days are surfaced; older filings are excluded. The /today UI
 * states this window on the list so the count is unambiguous. Single source of
 * truth — imported by both the feed route and the page label.
 */
export const PATENT_SURGE_WINDOW_DAYS = 60;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  quot: '"',
  lt: '<',
  gt: '>',
  nbsp: ' ',
};

function safeFromCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp <= 0) return '';
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

/** Decode the HTML entities PatentsView leaves in titles (numeric + the common named ones). */
export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&(amp|apos|quot|lt|gt|nbsp);/g, (m, n) => NAMED_ENTITIES[n] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Publication number from a `/patent/<id>` URL, falling back to metadata.patent_id. */
export function patentPublicationNumber(
  url: string | null | undefined,
  metadata?: Record<string, unknown> | null,
): string | null {
  if (url) {
    const m = url.match(/\/patent\/([^/?#]+)/i);
    if (m) return m[1].toUpperCase();
  }
  const pid = metadata && typeof metadata.patent_id === 'string' ? metadata.patent_id.trim() : '';
  if (pid) return pid.replace(/-/g, '').toUpperCase();
  return null;
}

/** Last resort title: the summary is "<verb> … for <Company>: <title>." — take after the colon. */
function titleFromSummary(summary: string | null): string | null {
  if (!summary) return null;
  const idx = summary.indexOf(': ');
  if (idx === -1) return null;
  const tail = summary.slice(idx + 2).replace(/\.\s*$/, '').trim();
  return tail || null;
}

/**
 * Group recent individual patents by company id — deduped by publication number,
 * newest filing first. Non-patent rows and rows with no usable link/title are skipped.
 *
 * Pass `withinDays` to keep only patents filed (event_at) within that many days
 * of `now` (default Date.now()); rows without a parseable date are excluded when
 * a window is set, since the window can't be honoured for them.
 */
export function collectRecentPatentsByCompany(
  rows: PatentEventInput[],
  opts?: { withinDays?: number; now?: number },
): Map<string, RecentPatent[]> {
  const byCompany = new Map<string, Map<string, RecentPatent>>();

  for (const r of rows) {
    if (!PATENT_DETAIL_TYPES.has(r.sourceEventType) || !r.companyId) continue;

    const meta = r.metadata ?? {};
    const rawTitle =
      typeof meta.patent_title === 'string' && meta.patent_title.trim()
        ? meta.patent_title.trim()
        : titleFromSummary(r.sourceSummary);
    const pubNo = patentPublicationNumber(r.sourceUrl, meta);

    // Need at least a link or a title to be worth showing.
    const key = pubNo ?? r.sourceUrl ?? rawTitle;
    if (!key) continue;

    const candidate: RecentPatent = {
      key,
      title: rawTitle ? decodeEntities(rawTitle) : (pubNo ?? 'Patent'),
      url: r.sourceUrl ?? null,
      date: r.eventAt ?? null,
    };

    if (!byCompany.has(r.companyId)) byCompany.set(r.companyId, new Map());
    const m = byCompany.get(r.companyId)!;
    const existing = m.get(key);
    if (!existing) {
      m.set(key, candidate);
    } else {
      // Merge across duplicate keys: keep the richest fields + the latest date.
      const existingHasRealTitle = existing.title && existing.title !== existing.key;
      if (!existingHasRealTitle && rawTitle) existing.title = candidate.title;
      if (!existing.url && candidate.url) existing.url = candidate.url;
      const existingT = Date.parse(existing.date ?? '') || 0;
      const candidateT = Date.parse(candidate.date ?? '') || 0;
      if (candidateT > existingT) existing.date = candidate.date;
    }
  }

  const cutoff =
    opts?.withinDays != null
      ? (opts.now ?? Date.now()) - opts.withinDays * 86_400_000
      : null;

  const out = new Map<string, RecentPatent[]>();
  for (const [companyId, m] of byCompany) {
    let list = [...m.values()];
    if (cutoff != null) {
      list = list.filter((p) => {
        const t = Date.parse(p.date ?? '');
        return Number.isFinite(t) && t >= cutoff;
      });
    }
    list.sort((a, b) => (Date.parse(b.date ?? '') || 0) - (Date.parse(a.date ?? '') || 0));
    out.set(companyId, list);
  }
  return out;
}
