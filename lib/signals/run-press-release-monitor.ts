/**
 * Press-release signal monitor — V1.
 *
 * For each of a user's active companies, query press_release_articles where
 * candidate_companies_normalized matches any of the company's normalized name
 * variants (primary + aliases). For each match, route classification.category
 * to the appropriate catalog signal via signalKeyForPressRelease().
 *
 * Cheap: zero LLM calls in the per-user path (classification was done once
 * during sync). All work is indexed Supabase queries.
 *
 * Signals this can emit (driven by classification.category):
 *   conference_presentation, licensing_deal, partnership_with_upfront_economics,
 *   co_development_deal, partnership_deal, milestone_payment, leadership_churn,
 *   layoffs, new_facility, facility_expansion, restructuring,
 *   acquisition_distraction, commercialization_move, fda_approval,
 *   phase_transition, funding_round, grant_award, ipo_or_follow_on,
 *   trial_failure_or_halt, program_discontinuation.
 */
import { createAdminClient } from '@/lib/supabase-admin';
import { ensureCompanyAliases } from '@/lib/signals/company-aliases';
import {
  signalKeyForPressRelease,
  type PressReleaseClassification,
} from '@/lib/signals/classify-press-release';
import { buildCompanyQueryVariants, normalizeCompanyForMatching } from '@/lib/signals/company-name-variants';
import {
  generateAccountReason,
  ingestSignalSourceEvent,
  normalizeSignalSourceEvent,
  recomputeAccountReadiness,
} from '@/lib/signals/readiness-service';
import type { SignalKey } from '@/lib/signals/readiness-types';

const SOURCE = 'newswire_press_release';

type AdminClient = ReturnType<typeof createAdminClient>;

type CompanyRow = {
  id: string;
  user_id: string;
  company_name: string | null;
  aliases: string[] | null;
};

type PressReleaseRow = {
  id: string;
  source: string;
  source_url: string;
  title: string;
  summary: string | null;
  published_at: string;
  classification: PressReleaseClassification | null;
  candidate_companies: string[] | null;
  candidate_companies_normalized: string[] | null;
};

type PressReleaseMonitorInput = {
  userId: string;
  companyIds?: string[];
  limit?: number;
  onlySignalKey?: SignalKey;
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

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function escapePostgrestPattern(term: string): string {
  return term.replace(/[,()]/g, ' ').trim();
}

async function fetchArticlesForCompany(
  admin: AdminClient,
  company: { name: string; aliases: string[] },
  limit = 100,
): Promise<PressReleaseRow[]> {
  // Match by candidate_companies_normalized (gin-indexed). We `cs.{value}`
  // (contains) for each candidate name variant. Postgres `.cs.` is array
  // containment — true if the array contains the value.
  const variants = buildCompanyQueryVariants(company.name, company.aliases)
    .map((v) => normalizeCompanyForMatching(v))
    .filter((v) => v.length >= 3);
  const uniqueVariants = [...new Set(variants)];
  if (uniqueVariants.length === 0) return [];

  const orClause = uniqueVariants
    .map((t) => `candidate_companies_normalized.cs.{"${escapePostgrestPattern(t)}"}`)
    .join(',');

  const { data, error } = await admin
    .from('press_release_articles')
    .select(
      'id, source, source_url, title, summary, published_at, classification, candidate_companies, candidate_companies_normalized',
    )
    .or(orClause)
    .not('classification', 'is', null)
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`press_release_articles query: ${error.message}`);
  return (data ?? []) as PressReleaseRow[];
}

async function fetchExistingSourceEventIds(
  admin: AdminClient,
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

async function emitSignal(
  admin: AdminClient,
  input: {
    userId: string;
    companyId: string;
    signalKey: SignalKey;
    sourceEventType: string;
    sourceEventId: string;
    sourceUrl: string;
    summary: string;
    eventAt: string | null;
    metadata: Record<string, unknown>;
    existingSourceEventIds: Set<string>;
  },
): Promise<'emitted' | 'duplicate'> {
  if (input.existingSourceEventIds.has(input.sourceEventId)) return 'duplicate';
  const title = `${input.signalKey} detected from press release`;

  const ingest = await ingestSignalSourceEvent(admin, {
    userId: input.userId,
    entityScope: 'company',
    companyId: input.companyId,
    source: SOURCE,
    sourceEventType: input.sourceEventType,
    sourceEventId: input.sourceEventId,
    sourceUrl: input.sourceUrl,
    title,
    summary: input.summary,
    excerpt: input.summary,
    eventAt: input.eventAt ?? new Date().toISOString(),
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
      title,
      summary: input.summary,
      excerpt: input.summary,
      eventAt: input.eventAt ?? null,
      observedAt: new Date().toISOString(),
      metadata: input.metadata,
    },
    signalKeys: [input.signalKey],
    companyId: input.companyId,
  });

  input.existingSourceEventIds.add(input.sourceEventId);
  return 'emitted';
}

export async function runPressReleaseMonitor(
  input: PressReleaseMonitorInput,
): Promise<PressReleaseMonitorResult> {
  const admin = createAdminClient();

  const { data: linkRows, error: linkError } = await admin
    .from('user_companies')
    .select('company_id')
    .eq('user_id', input.userId)
    .is('archived_at', null);
  if (linkError) throw new Error(`user_companies query: ${linkError.message}`);
  let ownedIds = (linkRows ?? [])
    .map((r) => (r as { company_id?: unknown }).company_id)
    .filter((v): v is string => typeof v === 'string' && Boolean(v));

  const requestedIds = Array.isArray(input.companyIds)
    ? input.companyIds.filter((v): v is string => typeof v === 'string' && Boolean(v))
    : [];
  if (requestedIds.length > 0) {
    const requestedSet = new Set(requestedIds);
    ownedIds = ownedIds.filter((id) => requestedSet.has(id));
  } else {
    ownedIds = ownedIds.slice(0, Math.min(Math.max(input.limit ?? 25, 1), 500));
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
    .select('id, user_id, company_name, aliases')
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

  // Lazy-populate aliases (cheap when fresh).
  const aliasMap = new Map<string, string[]>();
  for (const row of (companies ?? []) as CompanyRow[]) {
    const name = row.company_name?.trim();
    if (!name) continue;
    let aliases = row.aliases ?? [];
    if (aliases.length === 0) {
      try {
        const result = await ensureCompanyAliases(admin, row.id);
        aliases = result.aliases;
      } catch (e) {
        console.warn(`[press-releases] ensureCompanyAliases failed for ${row.id}:`, e);
      }
    }
    aliasMap.set(row.id, aliases);
  }

  const onlySignal = input.onlySignalKey;
  const shouldEmit = (key: SignalKey) => !onlySignal || onlySignal === key;

  for (const row of (companies ?? []) as CompanyRow[]) {
    const companyName = row.company_name?.trim();
    if (!companyName) continue;
    try {
      const aliases = aliasMap.get(row.id) ?? [];
      const articles = await fetchArticlesForCompany(
        admin,
        { name: companyName, aliases },
        100,
      );

      // Pre-build all candidate source_event_ids so we can do one dedupe query
      const candidateSourceEventIds: string[] = [];
      const articleSignalPairs: Array<{ article: PressReleaseRow; signalKey: SignalKey }> = [];
      for (const article of articles) {
        const signalKey = signalKeyForPressRelease(article.classification);
        if (!signalKey || !shouldEmit(signalKey)) continue;
        articleSignalPairs.push({ article, signalKey });
        candidateSourceEventIds.push(`${SOURCE}:${row.id}:${article.id}:${signalKey}`);
      }
      const existingSourceEventIds = await fetchExistingSourceEventIds(
        admin,
        input.userId,
        candidateSourceEventIds,
      );

      let emittedAny = false;

      for (const { article, signalKey } of articleSignalPairs) {
        recordsScanned += 1;
        candidateEventsMatched += 1;
        const c = article.classification!;
        const sourceEventId = `${SOURCE}:${row.id}:${article.id}:${signalKey}`;
        const publishedDate = article.published_at.slice(0, 10);

        const summary = c.rationale && c.rationale.length > 0
          ? `${c.rationale} [${article.source}, ${publishedDate}]`
          : `${signalKey.replace(/_/g, ' ')} reported for ${c.primary_company ?? companyName} (${publishedDate}).`;

        const emitted = await emitSignal(admin, {
          userId: input.userId,
          companyId: row.id,
          signalKey,
          sourceEventType: `newswire_${c.category}`,
          sourceEventId,
          sourceUrl: article.source_url,
          eventAt: article.published_at,
          summary,
          metadata: {
            article_id: article.id,
            source: article.source,
            article_title: article.title,
            published_at: article.published_at,
            category: c.category,
            confidence: c.confidence,
            classification: c,
          },
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
