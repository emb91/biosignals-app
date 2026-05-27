/**
 * Press-release RSS sync — three clean sources.
 *
 * Sources:
 *   1. GlobeNewswire Biotechnology industry feed (direct biotech articles)
 *   2. GlobeNewswire Pharmaceuticals industry feed (direct pharma articles)
 *   3. PR Newswire general news-releases feed + client-side biotech/pharma
 *      keyword pre-filter (PRN's category params are broken server-side)
 *
 * For each run:
 *   1. Fetch all three feeds, parse RSS XML.
 *   2. PRN items are pre-filtered by title/description keyword match.
 *   3. Upsert into press_release_articles (dedupe key: source_url).
 *   4. Classify up to MAX_CLASSIFY_PER_RUN unclassified articles with Haiku 4.5.
 *      Classification includes company-name extraction and signal category.
 *   5. Return structured stats for the cron response body.
 *
 * Cost notes:
 *   - Haiku 4.5 at ~4-6K input tokens + ~400 output tokens ≈ $0.001–0.003/call.
 *   - MAX_CLASSIFY_PER_RUN=60 caps a single cron run at ~$0.18.
 *   - Articles are classified exactly once — result cached in classification jsonb,
 *     never re-computed unless classification IS NULL (fresh upserts or failures).
 */

import { createAdminClient } from '@/lib/supabase-admin';
import { fetchWithRetry } from '@/lib/signals/fetch-with-retry';
import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_CLASSIFY_PER_RUN = 60;
const MAX_INPUT_CHARS = 6_000; // press releases are shorter than 8-Ks; 6K ≈ 1.5K tokens

type Feed = {
  source: 'globenewswire' | 'prnewswire';
  sourceFeed: string;
  url: string;
  preFilter: boolean; // apply biotech/pharma keyword pre-filter before upsert?
};

const FEEDS: Feed[] = [
  {
    source: 'globenewswire',
    sourceFeed: 'gnw-biotechnology',
    url: 'https://www.globenewswire.com/RssFeed/industry/4573-Biotechnology/',
    preFilter: false,
  },
  {
    source: 'globenewswire',
    sourceFeed: 'gnw-pharmaceuticals',
    url: 'https://www.globenewswire.com/RssFeed/industry/4577-Pharmaceuticals/',
    preFilter: false,
  },
  {
    source: 'prnewswire',
    sourceFeed: 'prn-general',
    url: 'https://www.prnewswire.com/rss/news-releases-list.rss',
    preFilter: true,
  },
];

// Keywords for PRN pre-filter. Match against title + description (case-insensitive).
// Cast wide enough to catch biotech/pharma but narrow enough to cut non-life-sci noise.
const BIOTECH_KEYWORDS = [
  'biotech',
  'biopharma',
  'biopharmaceutical',
  'pharmaceutical',
  'therapeutics',
  'biosciences',
  'genomics',
  'oncology',
  'immunology',
  'clinical trial',
  'fda approval',
  'fda granted',
  'drug candidate',
  'investigational',
  'phase 1',
  'phase 2',
  'phase 3',
  'phase i',
  'phase ii',
  'phase iii',
  'ind application',
  'nda submission',
  'bla submission',
  'anda submission',
  'new drug application',
  'biologics license',
  'preclinical',
  'antibody',
  'cell therapy',
  'gene therapy',
  'mrna',
  'adc',
  'antibody-drug conjugate',
  'small molecule',
  'precision medicine',
  'rare disease',
  'orphan drug',
  'funding round',
  'series a',
  'series b',
  'series c',
  'series d',
  'ipo',
  'initial public offering',
  'licensing agreement',
  'collaboration agreement',
  'milestone payment',
];

const BIOTECH_KEYWORDS_LOWER = BIOTECH_KEYWORDS.map((k) => k.toLowerCase());

// ── RSS parsing ────────────────────────────────────────────────────────────────

type RawRssItem = {
  title: string | null;
  link: string | null;
  description: string | null;
  pubDate: string | null;
  guid: string | null;
};

/**
 * Extract the content of a single XML/RSS field from a raw <item> block.
 * Handles both plain text and CDATA-wrapped content.
 */
function extractXmlField(block: string, tag: string): string | null {
  // CDATA form: <tag><![CDATA[...]]></tag>
  const cdataRe = new RegExp(
    `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`,
    'i',
  );
  const cdataMatch = block.match(cdataRe);
  if (cdataMatch) return cdataMatch[1].trim();

  // Plain-text form: <tag>...</tag>
  const plainRe = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const plainMatch = block.match(plainRe);
  if (plainMatch) return decodeXmlEntities(plainMatch[1].trim());

  return null;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)));
}

/**
 * Strip HTML tags and collapse whitespace for plain-text summaries.
 * Also strips common RSS feed boilerplate like "Read more..." anchors.
 */
function stripHtml(html: string | null): string | null {
  if (!html) return null;
  const stripped = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return null;
  return stripped;
}

function parseRssXml(xml: string): RawRssItem[] {
  const items: RawRssItem[] = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    items.push({
      title: extractXmlField(block, 'title'),
      link: extractXmlField(block, 'link'),
      description: extractXmlField(block, 'description'),
      pubDate: extractXmlField(block, 'pubDate'),
      guid: extractXmlField(block, 'guid'),
    });
  }

  return items;
}

function parsePubDate(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function isBiotechRelevant(item: RawRssItem): boolean {
  const hay = `${item.title ?? ''} ${item.description ?? ''}`.toLowerCase();
  return BIOTECH_KEYWORDS_LOWER.some((kw) => hay.includes(kw));
}

// ── Classification ─────────────────────────────────────────────────────────────

export type PressReleaseCategory =
  | 'funding_round'
  | 'ipo_or_follow_on'
  | 'grant_award'
  | 'licensing_deal'
  | 'partnership_with_upfront_economics'
  | 'co_development_deal'
  | 'partnership_deal'
  | 'milestone_payment'
  | 'fda_approval'
  | 'phase_transition'
  | 'new_facility'
  | 'facility_expansion'
  | 'conference_presentation'
  | 'commercialization_move'
  | 'm_and_a'       // company is the BUYER — positive expansion signal
  | 'm_and_a_target' // company is being acquired — skip (negative)
  | 'leadership_churn' // skip (negative)
  | 'layoffs'          // skip (negative)
  | 'restructuring'    // skip (negative)
  | 'other';           // no emit

export type PressReleaseClassification = {
  category: PressReleaseCategory;
  confidence: 'low' | 'medium' | 'high';
  rationale: string;           // single sentence, shown to sales rep
  key_facts?: string[];         // 2-5 bullets
  candidate_companies: string[]; // company names extracted from the article
  // Deal/partnership extras
  counterparty?: string | null;
  upfront_usd?: number | null;
  milestone_max_usd?: number | null;
  deal_structure?: string | null;
  therapy_area?: string | null;
  // Funding extras
  amount_usd?: number | null;
  investors?: string[] | null;
  // Regulatory extras
  drug_name?: string | null;
  indication?: string | null;
};

function buildClassificationPrompt(opts: {
  title: string;
  summary: string | null;
}): string {
  const body = opts.summary ? `${opts.title}\n\n${opts.summary}` : opts.title;
  return `You are classifying a biotech/pharma press release for a B2B sales-intelligence platform. Your job is to (a) identify the category of event and (b) extract the names of all companies mentioned.

Press release text (truncated to ${MAX_INPUT_CHARS} chars):
\`\`\`
${body.slice(0, MAX_INPUT_CHARS)}
\`\`\`

Classify into EXACTLY ONE category:

- "funding_round"                    — private funding: seed, Series A/B/C/D, venture debt, etc.
- "ipo_or_follow_on"                 — IPO, follow-on public offering, SPAC merger completing
- "grant_award"                      — NIH, DOD, BARDA, EU, or other non-dilutive grant/award
- "licensing_deal"                   — licensing in or out a specific asset/technology/IP (with or without disclosed economics)
- "partnership_with_upfront_economics" — strategic partnership or collaboration with upfront cash + milestones
- "co_development_deal"              — joint development program, shared costs, no or small upfront
- "partnership_deal"                 — partnership/collaboration announced but no upfront economics disclosed
- "milestone_payment"                — company received a milestone payment from an existing partner
- "fda_approval"                     — FDA NDA/BLA/510(k)/EUA approval or clearance; also breakthrough, fast track, orphan, priority review designation from FDA
- "phase_transition"                 — drug moving from preclinical → Phase 1, Phase 1 → 2, Phase 2 → 3, or Phase 3 → NDA/BLA filing
- "new_facility"                     — opening a new manufacturing, lab, or office facility
- "facility_expansion"               — expanding an existing facility (adding capacity, new wing, etc.)
- "conference_presentation"          — presentation, poster, or abstract at a major conference (ASCO, ASH, ESMO, JPM, BIO, ADA, etc.)
- "commercialization_move"           — product launch, commercial partnership, first patient treated commercially, distribution deal
- "m_and_a"                          — company is ACQUIRING another company (they are the buyer)
- "m_and_a_target"                   — company is BEING ACQUIRED (they are the target/seller)
- "leadership_churn"                 — CEO, CFO, CMO, or other C-suite/VP appointment or departure
- "layoffs"                          — workforce reduction, RIF, headcount cut
- "restructuring"                    — strategic reprioritization, program discontinuation, reorganization
- "other"                            — anything else: routine corporate filings, real estate, IR events, investor presentations

For "candidate_companies": list ALL company names you see in the article text — the issuing company and any counterparties, partners, or mentioned companies. Use the full legal name when possible (e.g. "Pfizer Inc." not "Pfizer").

Return ONLY a JSON object (no prose, no markdown fences):
{
  "category": "<one of the above>",
  "confidence": "low" | "medium" | "high",
  "rationale": "<single sentence in plain English — this is shown to a salesperson to explain why this article matters>",
  "key_facts": ["<2-5 short bullet-point facts>"],
  "candidate_companies": ["<company name 1>", "<company name 2>"],

  // Include only when applicable:
  "counterparty": "<partner or acquiree name, or null>",
  "upfront_usd": <number in USD, or null>,
  "milestone_max_usd": <number in USD, or null>,
  "deal_structure": "<short description, or null>",
  "therapy_area": "<e.g. oncology, immunology, or null>",
  "amount_usd": <funding amount in USD, or null>,
  "investors": ["<lead investor name>"],
  "drug_name": "<INN or brand name, or null>",
  "indication": "<disease/indication, or null>"
}

Be conservative on dollar amounts — only fill numeric fields when explicitly stated. Never invent numbers.`;
}

function tolerantJsonParse(text: string): Record<string, unknown> | null {
  try {
    // Strip markdown fences if the model adds them despite instructions
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    // Try extracting the first {...} block
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

const VALID_CATEGORIES = new Set<PressReleaseCategory>([
  'funding_round', 'ipo_or_follow_on', 'grant_award', 'licensing_deal',
  'partnership_with_upfront_economics', 'co_development_deal', 'partnership_deal',
  'milestone_payment', 'fda_approval', 'phase_transition', 'new_facility',
  'facility_expansion', 'conference_presentation', 'commercialization_move',
  'm_and_a', 'm_and_a_target', 'leadership_churn', 'layoffs', 'restructuring', 'other',
]);

function normalizeClassification(raw: Record<string, unknown> | null): PressReleaseClassification {
  if (!raw) {
    return {
      category: 'other',
      confidence: 'low',
      rationale: 'Classification parse error.',
      candidate_companies: [],
    };
  }
  const category =
    typeof raw.category === 'string' && VALID_CATEGORIES.has(raw.category as PressReleaseCategory)
      ? (raw.category as PressReleaseCategory)
      : 'other';

  const confidence =
    raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low'
      ? raw.confidence
      : 'low';

  const rationale = typeof raw.rationale === 'string' && raw.rationale.trim()
    ? raw.rationale.trim()
    : `Press release classified as ${category}.`;

  const key_facts = Array.isArray(raw.key_facts)
    ? (raw.key_facts as unknown[]).filter((f): f is string => typeof f === 'string').slice(0, 5)
    : undefined;

  const candidate_companies = Array.isArray(raw.candidate_companies)
    ? (raw.candidate_companies as unknown[])
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        .map((c) => c.trim())
    : [];

  const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : null;
    return n !== null && Number.isFinite(n) ? n : null;
  };

  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null;

  const strArr = (v: unknown): string[] | null => {
    if (!Array.isArray(v)) return null;
    const arr = (v as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
    return arr.length > 0 ? arr : null;
  };

  return {
    category,
    confidence,
    rationale,
    ...(key_facts && key_facts.length > 0 ? { key_facts } : {}),
    candidate_companies,
    counterparty: str(raw.counterparty),
    upfront_usd: num(raw.upfront_usd),
    milestone_max_usd: num(raw.milestone_max_usd),
    deal_structure: str(raw.deal_structure),
    therapy_area: str(raw.therapy_area),
    amount_usd: num(raw.amount_usd),
    investors: strArr(raw.investors),
    drug_name: str(raw.drug_name),
    indication: str(raw.indication),
  };
}

async function classifyArticle(opts: {
  title: string;
  summary: string | null;
}): Promise<PressReleaseClassification> {
  const prompt = buildClassificationPrompt(opts);
  const completion = await completeLlm({
    feature: 'press_release_classifier',
    prompt,
    maxTokens: 500,
  });

  await recordLlmUsageEvent({
    provider: completion.provider,
    feature: 'press_release_classifier',
    route: 'lib/signals/sync-press-release-delta#classifyArticle',
    model: completion.model,
    usage: completion.usage,
    metadata: { title: opts.title.slice(0, 120) },
  });

  const raw = tolerantJsonParse(completion.text);
  return normalizeClassification(raw);
}

// ── Company name normalization ─────────────────────────────────────────────────

/**
 * Normalize a company name for trgm/ilike matching.
 * Mirrors normalizeCompanyForMatching from company-name-variants.ts but
 * inlined here to avoid a circular dependency chain.
 *
 * Rules:
 *   - Lower-case
 *   - Strip common legal suffixes (inc, llc, ltd, corp, plc, gmbh, ag, bv, nv, sa, sas, oy, ab, as)
 *   - Strip trailing punctuation
 *   - Collapse whitespace
 */
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.]?\s*(inc\.?|llc\.?|ltd\.?|limited|corp\.?|corporation|plc\.?|gmbh|ag|bv|nv|sa|sas|oy|ab|as)\s*$/i, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Sync ───────────────────────────────────────────────────────────────────────

export type SyncPressReleaseDeltaResult = {
  feeds_fetched: number;
  feeds_failed: number;
  articles_upserted: number;
  articles_pre_filtered_out: number;
  articles_classified: number;
  articles_classification_failed: number;
  cutoff_date: string;
  sync_run_id: string;
};

type ArticleUpsertRow = {
  source: string;
  source_feed: string | null;
  source_url: string;
  source_guid: string | null;
  title: string;
  summary: string | null;
  published_at: string;
  fetched_at: string;
  last_seen_at: string;
};

type UnclassifiedArticle = {
  id: string;
  title: string;
  summary: string | null;
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
  }
  return String(error);
}

export async function syncPressReleaseDelta(opts?: {
  admin?: ReturnType<typeof createAdminClient>;
  cutoffDays?: number;
  maxClassify?: number;
}): Promise<SyncPressReleaseDeltaResult> {
  const admin = opts?.admin ?? createAdminClient();
  const maxClassify = opts?.maxClassify ?? MAX_CLASSIFY_PER_RUN;
  const cutoffDays = opts?.cutoffDays ?? 3;

  const now = new Date();
  const cutoffDate = new Date(now.getTime() - cutoffDays * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoffDate.toISOString();

  // Create sync run record
  const { data: runRow, error: runInsertError } = await admin
    .from('press_release_sync_runs')
    .insert({
      status: 'running',
      cutoff_date: cutoffIso,
    })
    .select('id')
    .single();
  if (runInsertError) throw new Error(`Failed to create sync run: ${runInsertError.message}`);
  const syncRunId = (runRow as { id: string }).id;

  let feedsFetched = 0;
  let feedsFailed = 0;
  let articlesUpserted = 0;
  let articlesPreFilteredOut = 0;
  let articlesClassified = 0;
  let articlesClassificationFailed = 0;

  try {
    // ── Step 1: Fetch + upsert RSS items ──────────────────────────────────────
    const fetchedAt = now.toISOString();

    for (const feed of FEEDS) {
      let xml: string;
      try {
        const response = await fetchWithRetry(feed.url, {
          label: `press-release-rss:${feed.sourceFeed}`,
          timeoutMs: 20_000,
          maxRetries: 2,
          headers: {
            'User-Agent': 'Arcova-BioSignals/1.0 (+https://arcova.bio)',
            Accept: 'application/rss+xml, application/xml, text/xml;q=0.9',
          },
        });
        if (!response.ok) {
          console.warn(`[sync-press-releases] ${feed.sourceFeed}: HTTP ${response.status}`);
          feedsFailed += 1;
          continue;
        }
        xml = await response.text();
        feedsFetched += 1;
      } catch (error) {
        console.error(`[sync-press-releases] Failed to fetch ${feed.sourceFeed}:`, error);
        feedsFailed += 1;
        continue;
      }

      const items = parseRssXml(xml);
      const rowsToUpsert: ArticleUpsertRow[] = [];

      for (const item of items) {
        const url = item.link?.trim();
        if (!url) continue;

        const publishedAt = parsePubDate(item.pubDate);
        if (!publishedAt) continue;

        // Skip articles older than cutoff
        if (publishedAt < cutoffIso) continue;

        // Apply biotech/pharma keyword pre-filter for PRN
        if (feed.preFilter && !isBiotechRelevant(item)) {
          articlesPreFilteredOut += 1;
          continue;
        }

        const summary = stripHtml(item.description);
        rowsToUpsert.push({
          source: feed.source,
          source_feed: feed.sourceFeed,
          source_url: url,
          source_guid: item.guid?.trim() ?? null,
          title: item.title?.trim() ?? '(no title)',
          summary,
          published_at: publishedAt,
          fetched_at: fetchedAt,
          last_seen_at: fetchedAt,
        });
      }

      if (rowsToUpsert.length === 0) continue;

      // Upsert in chunks of 100 (Supabase recommends ≤500; 100 is safe)
      const CHUNK = 100;
      for (let i = 0; i < rowsToUpsert.length; i += CHUNK) {
        const chunk = rowsToUpsert.slice(i, i + CHUNK);
        const { error: upsertError } = await admin
          .from('press_release_articles')
          .upsert(chunk, {
            onConflict: 'source_url',
            ignoreDuplicates: false, // update last_seen_at on re-seen
          });
        if (upsertError) {
          console.error(`[sync-press-releases] Upsert error for ${feed.sourceFeed}:`, upsertError.message);
        } else {
          articlesUpserted += chunk.length;
        }
      }
    }

    // ── Step 2: Classify unclassified articles ────────────────────────────────
    // Fetch articles without a classification, ordered by published_at desc.
    // We limit to maxClassify per run to cap per-run LLM spend.
    const { data: unclassified, error: fetchError } = await admin
      .from('press_release_articles')
      .select('id, title, summary')
      .is('classification', null)
      .is('classification_error', null)
      .order('published_at', { ascending: false })
      .limit(maxClassify);

    if (fetchError) {
      console.error('[sync-press-releases] Failed to fetch unclassified articles:', fetchError.message);
    } else {
      const toClassify = (unclassified ?? []) as UnclassifiedArticle[];

      for (const article of toClassify) {
        try {
          await admin
            .from('press_release_articles')
            .update({
              classification_attempts: 1, // will be incremented if retried
              last_classification_attempt_at: new Date().toISOString(),
            })
            .eq('id', article.id);

          const classification = await classifyArticle({
            title: article.title,
            summary: article.summary,
          });

          // Normalize candidate company names for trgm matching
          const candidateCompanies = classification.candidate_companies;
          const candidateCompaniesNormalized = [
            ...new Set(candidateCompanies.map(normalizeCompanyName).filter((n) => n.length >= 3)),
          ];

          const { error: updateError } = await admin
            .from('press_release_articles')
            .update({
              classification,
              classified_at: new Date().toISOString(),
              candidate_companies: candidateCompanies,
              candidate_companies_normalized: candidateCompaniesNormalized,
              classification_error: null,
            })
            .eq('id', article.id);

          if (updateError) {
            console.error(`[sync-press-releases] Failed to store classification for ${article.id}:`, updateError.message);
            articlesClassificationFailed += 1;
          } else {
            articlesClassified += 1;
          }
        } catch (error) {
          console.error(`[sync-press-releases] Classification error for article ${article.id}:`, error);
          await admin
            .from('press_release_articles')
            .update({
              classification_error: messageFromUnknown(error).slice(0, 500),
              last_classification_attempt_at: new Date().toISOString(),
            })
            .eq('id', article.id);
          articlesClassificationFailed += 1;
        }
      }
    }

    // ── Finalize run record ───────────────────────────────────────────────────
    await admin
      .from('press_release_sync_runs')
      .update({
        status: 'success',
        finished_at: new Date().toISOString(),
        articles_upserted: articlesUpserted,
        articles_classified: articlesClassified,
        feeds_fetched: feedsFetched,
        feeds_failed: feedsFailed,
        cutoff_date: cutoffIso,
      })
      .eq('id', syncRunId);

    return {
      feeds_fetched: feedsFetched,
      feeds_failed: feedsFailed,
      articles_upserted: articlesUpserted,
      articles_pre_filtered_out: articlesPreFilteredOut,
      articles_classified: articlesClassified,
      articles_classification_failed: articlesClassificationFailed,
      cutoff_date: cutoffIso,
      sync_run_id: syncRunId,
    };
  } catch (error) {
    await admin
      .from('press_release_sync_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error: messageFromUnknown(error).slice(0, 1000),
      })
      .eq('id', syncRunId);
    throw error;
  }
}
