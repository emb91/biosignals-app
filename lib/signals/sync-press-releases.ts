/**
 * Sync biotech / pharma press releases from major newswire RSS feeds.
 *
 * Currently active feeds (verified accessible 2026-05-24):
 *   - GlobeNewswire — Health subject feed
 *   - GlobeNewswire — Pharmaceuticals industry feed
 *   - PRNewswire — health-latest-news
 *   - PRNewswire — biotech-latest-news
 *
 * BusinessWire is blocked (403 from their CDN edge) — would need Apify's
 * stealth scraper or a proxy. Deferred to V2.
 *
 * Flow:
 *   1. Fetch each feed XML
 *   2. Parse <item> elements → upsert into press_release_articles (dedupe by URL)
 *   3. Haiku-classify each newly-inserted (or null-classified) row
 *   4. Extract candidate_companies + classification metadata
 *
 * Idempotent — re-running over the same cutoff window no-ops via the
 * source_url unique constraint, and classification is cached forever.
 */
import type { createAdminClient } from '@/lib/supabase-admin';
import {
  classifyPressRelease,
  type PressReleaseClassification,
} from '@/lib/signals/classify-press-release';
import { normalizeCompanyForMatching } from '@/lib/signals/company-name-variants';

type AdminClient = ReturnType<typeof createAdminClient>;

export type PressReleaseFeed = {
  source: 'globenewswire' | 'prnewswire' | 'businesswire';
  feed_slug: string;
  url: string;
};

// Verified live. Keep this list explicit (no auto-discovery) so we know exactly
// what we ingest.
export const PRESS_RELEASE_FEEDS: PressReleaseFeed[] = [
  {
    source: 'globenewswire',
    feed_slug: 'health',
    url: 'https://www.globenewswire.com/RssFeed/subjectcode/9-Health/feedTitle/GlobeNewswire',
  },
  {
    source: 'globenewswire',
    feed_slug: 'pharmaceuticals',
    url: 'https://www.globenewswire.com/RssFeed/industry/9576-Pharmaceuticals',
  },
  {
    source: 'prnewswire',
    feed_slug: 'health-latest-news',
    url: 'https://www.prnewswire.com/rss/health-latest-news/health-latest-news-list.rss',
  },
  {
    source: 'prnewswire',
    feed_slug: 'biotech-latest-news',
    url: 'https://www.prnewswire.com/rss/biotech-latest-news/biotech-latest-news-list.rss',
  },
];

const DEFAULT_LOOKBACK_DAYS = 2;
const DEFAULT_MAX_TO_CLASSIFY = 60;            // safety cap per run
const USER_AGENT = 'Arcova GTM press-release monitor (contact: emma@arcova.bio)';

type ParsedItem = {
  source_url: string;
  source_guid: string | null;
  title: string;
  summary: string;
  published_at: string; // ISO
};

// ── XML parsing ────────────────────────────────────────────────────────────
// We avoid a dep by doing tolerant regex parsing — RSS is simple enough.

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripCData(s: string): string {
  return s.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
}

function extractChild(itemXml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = itemXml.match(re);
  if (!m) return null;
  return decodeEntities(stripCData(m[1].trim()));
}

function htmlToText(s: string | null): string {
  if (!s) return '';
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseRssDate(value: string | null): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function parseRssItems(xml: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const itemRegex = /<item[\s>][\s\S]*?<\/item>/gi;
  for (const match of xml.matchAll(itemRegex)) {
    const itemXml = match[0];
    const link = extractChild(itemXml, 'link');
    const title = extractChild(itemXml, 'title');
    const guid = extractChild(itemXml, 'guid');
    const description = extractChild(itemXml, 'description');
    const pubDate = extractChild(itemXml, 'pubDate');
    if (!link || !title || !pubDate) continue;
    const publishedAt = parseRssDate(pubDate);
    if (!publishedAt) continue;
    items.push({
      source_url: link,
      source_guid: guid,
      title,
      summary: htmlToText(description),
      published_at: publishedAt,
    });
  }
  return items;
}

// ── Fetching ───────────────────────────────────────────────────────────────

async function fetchFeed(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`feed ${url} returned HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

// ── Main sync ──────────────────────────────────────────────────────────────

export type SyncPressReleasesInput = {
  admin: AdminClient;
  lookbackDays?: number;
  maxToClassify?: number;
  /**
   * When false, skip the Haiku classification pass — useful for cheap
   * "just ingest titles" runs while debugging.
   */
  classify?: boolean;
};

export type SyncPressReleasesResult = {
  cutoff_date: string;
  feeds_fetched: number;
  feeds_failed: number;
  articles_upserted: number;
  articles_classified: number;
  duration_ms: number;
  feed_failures: Array<{ url: string; error: string }>;
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function syncPressReleases(
  input: SyncPressReleasesInput,
): Promise<SyncPressReleasesResult> {
  const admin = input.admin;
  const lookbackDays = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const maxToClassify = input.maxToClassify ?? DEFAULT_MAX_TO_CLASSIFY;
  const classify = input.classify ?? true;
  const startedAt = new Date();
  const cutoff = new Date(startedAt.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  const { data: runRow, error: runInsertErr } = await admin
    .from('press_release_sync_runs')
    .insert({
      status: 'running',
      cutoff_date: cutoff.toISOString(),
      started_at: startedAt.toISOString(),
    })
    .select('id')
    .single();
  if (runInsertErr) throw new Error(`press_release_sync_runs insert: ${runInsertErr.message}`);
  const runId = runRow?.id as string;

  let feedsFetched = 0;
  let feedsFailed = 0;
  let articlesUpserted = 0;
  let articlesClassified = 0;
  const feedFailures: Array<{ url: string; error: string }> = [];

  try {
    // ── Fetch + upsert items ─────────────────────────────────────────────
    const allItems: Array<ParsedItem & { source: string; feed_slug: string }> = [];
    for (const feed of PRESS_RELEASE_FEEDS) {
      try {
        const xml = await fetchFeed(feed.url);
        const items = parseRssItems(xml).filter(
          (item) => new Date(item.published_at).getTime() >= cutoff.getTime(),
        );
        for (const item of items) {
          allItems.push({ ...item, source: feed.source, feed_slug: feed.feed_slug });
        }
        feedsFetched += 1;
      } catch (error) {
        feedsFailed += 1;
        const message = messageFromUnknown(error);
        feedFailures.push({ url: feed.url, error: message });
        console.warn(`[press-releases] feed fetch failed: ${feed.url}: ${message}`);
      }
    }

    // Dedupe by source_url before upsert (some items appear in multiple feeds)
    const byUrl = new Map<string, ParsedItem & { source: string; feed_slug: string }>();
    for (const item of allItems) {
      const existing = byUrl.get(item.source_url);
      if (!existing) byUrl.set(item.source_url, item);
    }
    const uniqueItems = [...byUrl.values()];

    if (uniqueItems.length > 0) {
      const rows = uniqueItems.map((item) => ({
        source: item.source,
        source_feed: item.feed_slug,
        source_url: item.source_url,
        source_guid: item.source_guid,
        title: item.title,
        summary: item.summary,
        published_at: item.published_at,
        last_seen_at: new Date().toISOString(),
      }));
      // Upsert by source_url. Don't overwrite classification/candidate_companies
      // on existing rows — the classifier path below handles those.
      const { error } = await admin
        .from('press_release_articles')
        .upsert(rows, { onConflict: 'source_url', ignoreDuplicates: false });
      if (error) throw new Error(`press_release_articles upsert: ${error.message}`);
      articlesUpserted = rows.length;
    }

    // ── Classify any unclassified rows (newest first) ────────────────────
    if (classify) {
      const { data: pending, error: pendingErr } = await admin
        .from('press_release_articles')
        .select('id, title, summary, body_text')
        .is('classification', null)
        .order('published_at', { ascending: false })
        .limit(maxToClassify);
      if (pendingErr) throw new Error(`press_release_articles pending query: ${pendingErr.message}`);

      for (const row of (pending ?? []) as Array<{
        id: string;
        title: string;
        summary: string | null;
        body_text: string | null;
      }>) {
        const nowIso = new Date().toISOString();
        let classification: PressReleaseClassification | null = null;
        let attemptError: string | null = null;
        try {
          classification = await classifyPressRelease({
            title: row.title,
            summary: row.summary ?? '',
            body: row.body_text,
          });
        } catch (classifyError) {
          attemptError = messageFromUnknown(classifyError);
          console.warn(`[press-releases] classify failed for ${row.id}: ${attemptError}`);
        }

        // Record the attempt regardless of outcome. When classification is
        // null OR an error fired, write the failure reason so the row is
        // distinguishable from "not yet attempted". Increment attempt counter
        // so we can surface stuck rows.
        if (!classification) {
          await admin
            .from('press_release_articles')
            .update({
              classification_error: attemptError ?? 'classifier_returned_null',
              last_classification_attempt_at: nowIso,
              classification_attempts: (await admin
                .from('press_release_articles')
                .select('classification_attempts')
                .eq('id', row.id)
                .maybeSingle()
              ).data?.classification_attempts ?? 0 + 1,
            })
            .eq('id', row.id);
          continue;
        }

        const candidateNormalized = (classification.candidate_companies ?? [])
          .map((name) => normalizeCompanyForMatching(name))
          .filter((s) => s.length >= 3);

        const { error: updateErr } = await admin
          .from('press_release_articles')
          .update({
            classification,
            classified_at: nowIso,
            candidate_companies: classification.candidate_companies ?? [],
            candidate_companies_normalized: candidateNormalized,
            // Clear any prior error since we succeeded
            classification_error: null,
            last_classification_attempt_at: nowIso,
          })
          .eq('id', row.id);
        if (updateErr) {
          console.warn(`[press-releases] update classification failed: ${updateErr.message}`);
          continue;
        }
        articlesClassified += 1;
      }
    }

    const finishedAt = new Date();
    await admin
      .from('press_release_sync_runs')
      .update({
        finished_at: finishedAt.toISOString(),
        status: 'success',
        articles_upserted: articlesUpserted,
        articles_classified: articlesClassified,
        feeds_fetched: feedsFetched,
        feeds_failed: feedsFailed,
      })
      .eq('id', runId);

    return {
      cutoff_date: cutoff.toISOString(),
      feeds_fetched: feedsFetched,
      feeds_failed: feedsFailed,
      articles_upserted: articlesUpserted,
      articles_classified: articlesClassified,
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      feed_failures: feedFailures,
    };
  } catch (error) {
    await admin
      .from('press_release_sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: 'failed',
        articles_upserted: articlesUpserted,
        articles_classified: articlesClassified,
        feeds_fetched: feedsFetched,
        feeds_failed: feedsFailed,
        error: messageFromUnknown(error),
      })
      .eq('id', runId);
    throw error;
  }
}
