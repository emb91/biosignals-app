/**
 * Press-release signal monitor — per-user company matching.
 *
 * For each of a user's active companies, queries press_release_articles for
 * recently published articles where mentioned_company_ids contains the
 * company id. Emits appropriate signal events and recomputes account readiness.
 *
 * Matching strategy:
 *   - mentioned_company_ids is populated at ingest by the resolver
 *     (lib/companies/resolve-mentions.ts) and GIN-indexed.
 *   - Per-user lookup is a single SQL array-overlap (Postgrest .overlaps),
 *     then per-company filtering in memory.
 *   - Dedupes against signal_source_events so re-running the monitor is safe.
 *
 * Signal mapping (categories not listed here are skipped — negative/caution):
 *   funding_round                    → new_funding
 *   ipo_or_follow_on                 → ipo
 *   grant_award                      → grant_award
 *   licensing_deal                   → partnership_deal
 *   partnership_with_upfront_economics → partnership_deal
 *   co_development_deal              → partnership_deal
 *   partnership_deal                 → partnership_deal
 *   milestone_payment                → partnership_deal
 *   fda_approval                     → fda_approval
 *   phase_transition                 → phase_transition
 *   new_facility                     → new_facility
 *   facility_expansion               → new_facility
 *   commercialization_move           → fda_approval
 *   m_and_a                          → ma
 *
 * Skipped (negative/caution per product decision):
 *   m_and_a_target, leadership_churn, layoffs, restructuring, other
 */

import { createAdminClient } from '@/lib/supabase-admin';
import {
  generateAccountReason,
  ingestSignalSourceEvent,
  normalizeSignalSourceEvent,
  recomputeAccountReadiness,
} from '@/lib/signals/readiness-service';
import type { SignalKey } from '@/lib/signals/readiness-types';
import type { PressReleaseCategory, PressReleaseClassification } from '@/lib/signals/sync-press-release-delta';
import { hasVerifiedCompanyMention } from '@/lib/companies/mention-provenance';

// ── Types ──────────────────────────────────────────────────────────────────────

type CompanyRow = {
  id: string;
  company_name: string | null;
};

type ArticleRow = {
  id: string;
  source: string;
  source_url: string;
  title: string;
  summary: string | null;
  published_at: string;
  classification: PressReleaseClassification | null;
  candidate_companies: string[] | null;
  mentioned_company_ids: string[] | null;
  mentioned_company_matches: unknown;
};

export type PressReleaseMonitorInput = {
  userId: string;
  companyIds?: string[];
  /** How many days back to look for press release articles. Default: 7. */
  lookbackDays?: number;
};

export type PressReleaseMonitorResult = {
  processed: number;
  failed: number;
  records_scanned: number;
  candidate_events_matched_before_dedupe: number;
  events_skipped_as_duplicates: number;
  emitted_signal_types: string[];
  recomputed_companies: string[];
  failures: Array<{ company_id: string; error: string }>;
};

// ── Signal mapping ─────────────────────────────────────────────────────────────

const CATEGORY_TO_SIGNAL_KEY: Partial<Record<PressReleaseCategory, SignalKey>> = {
  funding_round: 'funding_round',
  ipo_or_follow_on: 'ipo_or_follow_on',
  grant_award: 'grant_award',
  licensing_deal: 'licensing_deal',
  partnership_with_upfront_economics: 'partnership_with_upfront_economics',
  co_development_deal: 'co_development_deal',
  partnership_deal: 'partnership_deal',
  milestone_payment: 'milestone_payment',
  fda_approval: 'fda_approval',
  phase_transition: 'phase_transition',
  new_facility: 'new_facility',
  facility_expansion: 'facility_expansion',
  // conference_presentation: intentionally skipped — see TalkingPoints task.
  // It's outreach context (a hook for "see you at X conference"), not intent.
  // Surfaces as raw key_facts on the article row; doesn't move readiness.
  commercialization_move: 'commercialization_move',
  m_and_a: 'ma_event',
  // m_and_a_target, leadership_churn, layoffs, restructuring, other → no mapping (skipped)
};

function signalKeyForCategory(category: PressReleaseCategory): SignalKey | null {
  return CATEGORY_TO_SIGNAL_KEY[category] ?? null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const SOURCE = 'press_release';

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (typeof obj.details === 'string' && obj.details) return obj.details;
  }
  return 'Internal server error';
}

// ── DB queries ─────────────────────────────────────────────────────────────────

/**
 * Fetch all classified articles in the lookback window that mention at least
 * one of the user's tracked companies. The mentioned_company_ids array is
 * populated at ingest by lib/companies/resolve-mentions.ts and indexed via
 * GIN, so the && (array overlap) lookup is a fast index seek.
 */
async function fetchArticlesMentioning(
  admin: ReturnType<typeof createAdminClient>,
  ownedIds: string[],
  cutoffIso: string,
): Promise<ArticleRow[]> {
  if (ownedIds.length === 0) return [];
  // Postgrest array-overlap syntax: ov.{uuid1,uuid2,...}
  const { data, error } = await admin
    .from('press_release_articles')
    .select('id, source, source_url, title, summary, published_at, classification, candidate_companies, mentioned_company_ids, mentioned_company_matches')
    .not('classification', 'is', null)
    .gte('published_at', cutoffIso)
    .overlaps('mentioned_company_ids', ownedIds)
    .order('published_at', { ascending: false })
    .limit(500);

  if (error) throw new Error(`press_release_articles query: ${error.message}`);
  return (data ?? []) as ArticleRow[];
}

/**
 * Articles the resolver tagged with this company id.
 */
function articlesForCompany(articles: ArticleRow[], companyId: string): ArticleRow[] {
  return articles.filter((a) => hasVerifiedCompanyMention(a.mentioned_company_matches, companyId));
}

async function fetchExistingSourceEventIds(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  sourceEventIds: string[],
): Promise<Set<string>> {
  const uniqueIds = [...new Set(sourceEventIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Set<string>();
  const found = new Set<string>();
  for (let i = 0; i < uniqueIds.length; i += 200) {
    const slice = uniqueIds.slice(i, i + 200);
    const { data, error } = await admin
      .from('signal_source_events')
      .select('source_event_id')
      .eq('user_id', userId)
      .eq('source', SOURCE)
      .in('source_event_id', slice);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = (row as { source_event_id?: unknown }).source_event_id;
      if (typeof id === 'string' && id) found.add(id);
    }
  }
  return found;
}

// ── Emit ───────────────────────────────────────────────────────────────────────

async function emitCompanySignal(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    userId: string;
    companyId: string;
    signalKey: SignalKey;
    sourceEventType: string;
    sourceEventId: string;
    sourceUrl: string;
    title: string;
    summary: string;
    eventAt: string;
    metadata: Record<string, unknown>;
    existingSourceEventIds: Set<string>;
  },
): Promise<'emitted' | 'duplicate'> {
  if (input.existingSourceEventIds.has(input.sourceEventId)) return 'duplicate';

  const ingest = await ingestSignalSourceEvent(admin, {
    userId: input.userId,
    entityScope: 'company',
    companyId: input.companyId,
    source: SOURCE,
    sourceEventType: input.sourceEventType,
    sourceEventId: input.sourceEventId,
    sourceUrl: input.sourceUrl,
    title: input.title,
    summary: input.summary,
    excerpt: input.summary,
    eventAt: input.eventAt,
    metadata: input.metadata,
  });

  await normalizeSignalSourceEvent(admin, {
    userId: input.userId,
    rawEvent: {
      id: ingest.sourceEventId,
      userId: input.userId,
      entityId: input.companyId,
      entityScope: 'company',
      source: SOURCE,
      sourceUrl: input.sourceUrl,
      sourceEventType: input.sourceEventType,
      sourceEventId: input.sourceEventId,
      title: input.title,
      summary: input.summary,
      excerpt: input.summary,
      eventAt: input.eventAt,
      observedAt: new Date().toISOString(),
      metadata: input.metadata,
    },
    signalKeys: [input.signalKey],
    companyId: input.companyId,
  });

  input.existingSourceEventIds.add(input.sourceEventId);
  return 'emitted';
}

// ── Main monitor ───────────────────────────────────────────────────────────────

export async function runPressReleaseMonitor(
  input: PressReleaseMonitorInput,
): Promise<PressReleaseMonitorResult> {
  const admin = createAdminClient();
  // Default 14 days, clamped to [1, 30]. Matches the other monitors so the
  // signal feed has a consistent "recent activity" window across pipelines.
  const lookbackDays = Math.min(30, Math.max(1, Math.floor(input.lookbackDays ?? 14)));
  const cutoffIso = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  // Load the user's active companies
  const { data: linkRows, error: linkError } = await admin
    .from('user_companies')
    .select('company_id')
    .eq('user_id', input.userId)
    .is('archived_at', null);
  if (linkError) throw new Error(`user_companies query: ${linkError.message}`);

  let ownedIds = (linkRows ?? [])
    .map((r) => (r as { company_id?: unknown }).company_id)
    .filter((v): v is string => typeof v === 'string' && Boolean(v));

  // Optionally restrict to a specific subset of companies
  const companyIds = Array.isArray(input.companyIds)
    ? input.companyIds.filter((v): v is string => typeof v === 'string' && Boolean(v))
    : [];
  if (companyIds.length > 0) {
    const requestedSet = new Set(companyIds);
    ownedIds = ownedIds.filter((id) => requestedSet.has(id));
  }

  if (ownedIds.length === 0) {
    return {
      processed: 0,
      failed: 0,
      records_scanned: 0,
      candidate_events_matched_before_dedupe: 0,
      events_skipped_as_duplicates: 0,
      emitted_signal_types: [],
      recomputed_companies: [],
      failures: [],
    };
  }

  const { data: companies, error: companiesError } = await admin
    .from('companies')
    .select('id, company_name')
    .in('id', ownedIds);
  if (companiesError) throw new Error(companiesError.message);

  let processed = 0;
  let failed = 0;
  let recordsScanned = 0;
  let candidateEventsMatched = 0;
  let eventsSkippedAsDuplicates = 0;
  const emittedSignalTypes = new Set<string>();
  const recomputedCompanyIds = new Set<string>();
  const failures: Array<{ company_id: string; error: string }> = [];

  // One SQL hit — articles in the lookback window mentioning ANY of this
  // user's companies (index seek on mentioned_company_ids GIN).
  const allArticles = await fetchArticlesMentioning(admin, ownedIds, cutoffIso);

  for (const row of (companies ?? []) as CompanyRow[]) {
    const companyName = row.company_name?.trim();
    if (!companyName) continue;

    try {
      const articles = articlesForCompany(allArticles, row.id);

      // Build all candidate source_event_ids for bulk dedupe check
      const candidateSourceEventIds: string[] = [];
      for (const article of articles) {
        const classification = article.classification;
        if (!classification) continue;
        const signalKey = signalKeyForCategory(classification.category);
        if (!signalKey) continue; // skip negative/caution categories
        candidateSourceEventIds.push(`${SOURCE}:${article.id}:${row.id}:${signalKey}`);
      }

      const existingSourceEventIds = await fetchExistingSourceEventIds(
        admin,
        input.userId,
        candidateSourceEventIds,
      );

      let emittedAny = false;

      for (const article of articles) {
        recordsScanned += 1;
        const classification = article.classification;
        if (!classification) continue;

        const signalKey = signalKeyForCategory(classification.category);
        if (!signalKey) continue; // skip m_and_a_target, leadership_churn, layoffs, restructuring, other

        candidateEventsMatched += 1;

        const sourceEventId = `${SOURCE}:${article.id}:${row.id}:${signalKey}`;
        const sourceEventType = `press_release_${classification.category}`;

        // Build a concise title for the signal feed
        const signalTitle = article.title.length > 120
          ? `${article.title.slice(0, 117)}…`
          : article.title;

        const summary = classification.rationale || article.summary || article.title;

        const metadata: Record<string, unknown> = {
          article_id: article.id,
          source: article.source,
          press_release_category: classification.category,
          confidence: classification.confidence,
          candidate_companies: article.candidate_companies ?? [],
        };
        if (classification.counterparty) metadata.counterparty = classification.counterparty;
        if (classification.therapy_area) metadata.therapy_area = classification.therapy_area;
        if (classification.amount_usd) metadata.amount_usd = classification.amount_usd;
        if (classification.upfront_usd) metadata.upfront_usd = classification.upfront_usd;
        if (classification.milestone_max_usd) metadata.milestone_max_usd = classification.milestone_max_usd;
        if (classification.drug_name) metadata.drug_name = classification.drug_name;
        if (classification.indication) metadata.indication = classification.indication;
        if (classification.investors) metadata.investors = classification.investors;
        if (classification.key_facts) metadata.key_facts = classification.key_facts;

        const emitted = await emitCompanySignal(admin, {
          userId: input.userId,
          companyId: row.id,
          signalKey,
          sourceEventType,
          sourceEventId,
          sourceUrl: article.source_url,
          title: signalTitle,
          summary,
          eventAt: article.published_at,
          metadata,
          existingSourceEventIds,
        });

        if (emitted === 'emitted') {
          emittedAny = true;
          emittedSignalTypes.add(signalKey);
        } else {
          eventsSkippedAsDuplicates += 1;
        }
      }

      if (emittedAny) {
        await recomputeAccountReadiness(admin, { userId: input.userId, companyId: row.id });
        await generateAccountReason(admin, { userId: input.userId, companyId: row.id });
        recomputedCompanyIds.add(row.id);
      }

      processed += 1;
    } catch (error) {
      failed += 1;
      failures.push({ company_id: row.id, error: messageFromUnknown(error) });
      console.error(
        `[press-release-monitor] Failed for company ${row.id} (user ${input.userId}):`,
        error,
      );
    }
  }

  return {
    processed,
    failed,
    records_scanned: recordsScanned,
    candidate_events_matched_before_dedupe: candidateEventsMatched,
    events_skipped_as_duplicates: eventsSkippedAsDuplicates,
    emitted_signal_types: [...emittedSignalTypes],
    recomputed_companies: [...recomputedCompanyIds],
    failures,
  };
}
