/**
 * Funding-signal monitor — V1.
 *
 * For each of a user's active companies, query the sec_filings_local mirror
 * (populated by syncSecDelta) for Form D / 8-K Item 3.02 / 424B prospectus
 * filings, and emit signal events:
 *
 *  - Form D / D/A              → funding_round            (private raise)
 *  - 8-K with item 3.02        → funding_round            (public PIPE)
 *  - 424B1..B7                 → ipo_or_follow_on         (cash event after shelf)
 *
 * All three map to the `new_budget` readiness dimension via the existing
 * catalog entries. Companies are joined on zero-padded CIK (preferred) or by
 * normalized entity name (fallback for private cos whose CIK we don't know).
 *
 * High-precision V1: deliberately skips 8-K Item 1.01 (material agreement)
 * and Item 8.01 (catch-all) — those need LLM classification to avoid
 * surfacing non-financing events. See project_funding_signal_v1.md in memory.
 */
import { createAdminClient } from '@/lib/supabase-admin';
import { ensureCompanyCik } from '@/lib/signals/company-cik';
import {
  signalKeyForClassification,
  type SecFilingClassification,
} from '@/lib/signals/classify-sec-filing';
import { shouldSkipFormDFundingSignal } from '@/lib/signals/sec-form-d-filters';
import {
  generateAccountReason,
  ingestSignalSourceEvent,
  normalizeSignalSourceEvent,
  recomputeAccountReadiness,
} from '@/lib/signals/readiness-service';
import type { SignalKey } from '@/lib/signals/readiness-types';
import { hasVerifiedCanonicalCompanyMatch } from '@/lib/companies/mention-provenance';

type CompanyRow = {
  id: string;
  company_name: string | null;
  cik: string | null;
};

type FundingMonitorInput = {
  userId: string;
  companyIds?: string[];
  limit?: number;
  onlySignalKey?: SignalKey;
  /** How many days back to look. Default 14, clamped to [1, 30]. */
  lookbackDays?: number;
};

const DEFAULT_LOOKBACK_DAYS = 14;
const MAX_LOOKBACK_DAYS = 30;

function clampLookback(value: number | undefined): number {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_LOOKBACK_DAYS;
  return Math.min(MAX_LOOKBACK_DAYS, Math.max(1, Math.floor(v)));
}

export type FundingMonitorResult = {
  processed: number;
  failed: number;
  records_scanned: number;
  candidate_events_matched_before_dedupe: number;
  events_skipped_as_duplicates: number;
  emitted_signal_types: string[];
  recomputed_companies: string[];
  failures: Array<{ company_id: string; error: string }>;
};

type SecFilingRow = {
  accession_number: string;
  form_type: string;
  filing_date: string | null;
  cik: string | null;
  entity_name: string | null;
  entity_name_normalized: string | null;
  filing_url: string;
  primary_doc_url: string | null;
  total_offering_amount: number | string | null;
  total_amount_sold: number | string | null;
  total_remaining: number | string | null;
  date_of_first_sale: string | null;
  entity_type: string | null;
  industry_group_type: string | null;
  items: string[] | null;
  classification: SecFilingClassification | null;
  classified_at: string | null;
  canonical_company_match?: unknown;
};

const SOURCE_FORM_D = 'sec_edgar_form_d';
const SOURCE_8K = 'sec_edgar_form_8k';
const SOURCE_424B = 'sec_edgar_424b';

const FORM_D_TYPES = new Set(['D', 'D/A']);
const FORM_8K_TYPES = new Set(['8-K', '8-K/A']);
const FORM_424B_TYPES = new Set(['424B1', '424B2', '424B3', '424B4', '424B5', '424B7']);

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (typeof obj.details === 'string' && obj.details) return obj.details;
  }
  return 'Internal server error';
}

function toIsoTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  // sec_filings_local.filing_date is a DATE; promote to ISO timestamp at noon
  // UTC so it's unambiguous and ordering-stable across the table.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T12:00:00Z`;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

function formatUsd(amount: number | string | null): string | null {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

async function fetchFilingsForCompany(
  admin: ReturnType<typeof createAdminClient>,
  company: { id: string; name: string; cik: string | null },
  cutoffIso: string,
  limit = 100,
): Promise<SecFilingRow[]> {
  // Two paths unioned via `.or()`:
  //   * cik = company.cik (when known, highest-confidence)
  //   * canonical_company_id = company.id (resolved at ingest from entity_name)
  const cikClause = company.cik ? `cik.eq.${company.cik}` : null;
  const canonicalClause = `canonical_company_id.eq.${company.id}`;
  const orClause = [cikClause, canonicalClause].filter(Boolean).join(',');

  const { data, error } = await admin
    .from('sec_filings_local')
    .select(
      'accession_number, form_type, filing_date, cik, entity_name, entity_name_normalized, filing_url, primary_doc_url, total_offering_amount, total_amount_sold, total_remaining, date_of_first_sale, entity_type, industry_group_type, items, classification, classified_at, canonical_company_match',
    )
    .or(orClause)
    .gte('filing_date', cutoffIso)
    .order('filing_date', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`sec_filings_local query: ${error.message}`);
  return ((data ?? []) as SecFilingRow[]).filter((row) => {
    if (company.cik && row.cik === company.cik) return true;
    return hasVerifiedCanonicalCompanyMatch(row.canonical_company_match, company.id);
  });
}

async function fetchExistingSourceEventIds(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  source: string,
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
      .eq('source', source)
      .in('source_event_id', slice);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = (row as { source_event_id?: unknown }).source_event_id;
      if (typeof id === 'string' && id) found.add(id);
    }
  }
  return found;
}

async function emitCompanySignal(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    userId: string;
    companyId: string;
    source: string;
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

  const title = `${input.signalKey} detected from SEC EDGAR`;
  const ingest = await ingestSignalSourceEvent(admin, {
    userId: input.userId,
    entityScope: 'company',
    companyId: input.companyId,
    source: input.source,
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
      source: input.source,
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

export async function runFundingMonitor(input: FundingMonitorInput): Promise<FundingMonitorResult> {
  const admin = createAdminClient();
  const lookbackDays = clampLookback(input.lookbackDays);
  const cutoffIso = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: linkRows, error: linkError } = await admin
    .from('user_companies')
    .select('company_id')
    .eq('user_id', input.userId)
    .is('archived_at', null);
  if (linkError) throw new Error(`user_companies query: ${linkError.message}`);
  let ownedIds = (linkRows ?? [])
    .map((r) => (r as { company_id?: unknown }).company_id)
    .filter((v): v is string => typeof v === 'string' && Boolean(v));

  const companyIds = Array.isArray(input.companyIds)
    ? input.companyIds.filter((v): v is string => typeof v === 'string' && Boolean(v))
    : [];
  if (companyIds.length > 0) {
    const requestedSet = new Set(companyIds);
    ownedIds = ownedIds.filter((id) => requestedSet.has(id));
  } else {
    ownedIds = ownedIds.slice(0, Math.min(Math.max(input.limit ?? 25, 1), 200));
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
    .select('id, company_name, cik')
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

  // Lazy-populate CIK for each company — still useful as a strong signal
  // alongside the resolver's canonical_company_id match.
  const cikByCompany = new Map<string, string | null>();
  for (const row of (companies ?? []) as CompanyRow[]) {
    const name = row.company_name?.trim();
    if (!name) continue;
    let cik = row.cik;
    try {
      const result = await ensureCompanyCik(admin, row.id);
      cik = result.cik;
    } catch (error) {
      console.error(`[funding] ensureCompanyCik failed for ${row.id}:`, error);
    }
    cikByCompany.set(row.id, cik);
  }

  const onlySignal = input.onlySignalKey;
  const shouldEmit = (signalKey: SignalKey): boolean => !onlySignal || onlySignal === signalKey;

  for (const row of (companies ?? []) as CompanyRow[]) {
    const companyName = row.company_name?.trim();
    if (!companyName) continue;
    try {
      const cik = cikByCompany.get(row.id) ?? null;
      const filings = await fetchFilingsForCompany(
        admin,
        { id: row.id, name: companyName, cik },
        cutoffIso,
        100,
      );

      // CIK pin-back: if we matched filings via canonical_company_id (no CIK
      // yet on the canonical company) and all matched Form D filings agree on
      // a single CIK, write it back to companies.cik so future runs benefit
      // from the CIK path too. Only fires when cikSet.size === 1 — disagreement
      // means ambiguous, skip rather than risk pinning the wrong CIK.
      if (!cik && filings.length > 0) {
        const cikSet = new Set(
          filings
            .filter((f) => FORM_D_TYPES.has(f.form_type) && !shouldSkipFormDFundingSignal(f))
            .map((f) => f.cik)
            .filter((c): c is string => typeof c === 'string' && Boolean(c)),
        );
        if (cikSet.size === 1) {
          const pinnedCik = [...cikSet][0];
          try {
            await admin
              .from('companies')
              .update({ cik: pinnedCik, cik_checked_at: new Date().toISOString() })
              .eq('id', row.id)
              .is('cik', null); // guard: only write if still unset
            cikByCompany.set(row.id, pinnedCik);
          } catch (pinErr) {
            console.warn(`[funding] cik pin-back failed for ${row.id}:`, pinErr instanceof Error ? pinErr.message : String(pinErr));
          }
        }
      }

      // Build the candidate source-event-id list per source, dedupe in bulk.
      // A single 8-K can produce multiple signals (e.g., 3.02 PIPE +
      // classification-driven licensing_deal), so we collect all candidate IDs
      // across both code paths before the bulk existence check.
      const candidateBySource: Record<string, string[]> = {
        [SOURCE_FORM_D]: [],
        [SOURCE_8K]: [],
        [SOURCE_424B]: [],
      };
      for (const filing of filings) {
        if (
          FORM_D_TYPES.has(filing.form_type) &&
          !shouldSkipFormDFundingSignal(filing) &&
          shouldEmit('funding_round')
        ) {
          candidateBySource[SOURCE_FORM_D].push(
            `${SOURCE_FORM_D}:${row.id}:${filing.accession_number}:funding_round`,
          );
        } else if (FORM_8K_TYPES.has(filing.form_type)) {
          const items = Array.isArray(filing.items) ? filing.items : [];
          // Path 1: item-only PIPE detection → funding_round.
          if (items.includes('3.02') && shouldEmit('funding_round')) {
            candidateBySource[SOURCE_8K].push(
              `${SOURCE_8K}:${row.id}:${filing.accession_number}:funding_round`,
            );
          }
          // Path 2: classification-driven (licensing_deal / partnership_* /
          // co_development_deal / milestone_payment / acquisition_distraction
          // / leadership_churn / restructuring / financing).
          const classificationMapping = signalKeyForClassification(filing.classification);
          if (classificationMapping && shouldEmit(classificationMapping.signalKey)) {
            candidateBySource[SOURCE_8K].push(
              `${SOURCE_8K}:${row.id}:${filing.accession_number}:${classificationMapping.signalKey}`,
            );
          }
        } else if (FORM_424B_TYPES.has(filing.form_type) && shouldEmit('ipo_or_follow_on')) {
          candidateBySource[SOURCE_424B].push(
            `${SOURCE_424B}:${row.id}:${filing.accession_number}:ipo_or_follow_on`,
          );
        }
      }

      const existingBySource: Record<string, Set<string>> = {
        [SOURCE_FORM_D]: await fetchExistingSourceEventIds(admin, input.userId, SOURCE_FORM_D, candidateBySource[SOURCE_FORM_D]),
        [SOURCE_8K]: await fetchExistingSourceEventIds(admin, input.userId, SOURCE_8K, candidateBySource[SOURCE_8K]),
        [SOURCE_424B]: await fetchExistingSourceEventIds(admin, input.userId, SOURCE_424B, candidateBySource[SOURCE_424B]),
      };

      let emittedAny = false;

      for (const filing of filings) {
        recordsScanned += 1;
        const eventAt = toIsoTimestamp(filing.filing_date);
        const filingDate = filing.filing_date ?? 'unknown date';
        const baseMetadata = {
          accession_number: filing.accession_number,
          form_type: filing.form_type,
          filing_date: filing.filing_date,
          cik: filing.cik,
          entity_name: filing.entity_name,
          primary_doc_url: filing.primary_doc_url,
        };

        if (
          FORM_D_TYPES.has(filing.form_type) &&
          !shouldSkipFormDFundingSignal(filing) &&
          shouldEmit('funding_round')
        ) {
          candidateEventsMatched += 1;
          const amount = formatUsd(filing.total_offering_amount);
          const sold = formatUsd(filing.total_amount_sold);
          const sourceEventId = `${SOURCE_FORM_D}:${row.id}:${filing.accession_number}:funding_round`;
          const summaryAmount = amount ?? sold ?? 'undisclosed amount';
          const summary =
            `Form D filing (${filing.form_type}) by ${filing.entity_name ?? companyName}: ${summaryAmount} private placement (filed ${filingDate}).`;
          const emitted = await emitCompanySignal(admin, {
            userId: input.userId,
            companyId: row.id,
            source: SOURCE_FORM_D,
            signalKey: 'funding_round',
            sourceEventType: 'sec_form_d_filed',
            sourceEventId,
            sourceUrl: filing.filing_url,
            eventAt,
            summary,
            metadata: {
              ...baseMetadata,
              total_offering_amount: filing.total_offering_amount,
              total_amount_sold: filing.total_amount_sold,
              total_remaining: filing.total_remaining,
              date_of_first_sale: filing.date_of_first_sale,
              entity_type: filing.entity_type,
              industry_group_type: filing.industry_group_type,
            },
            existingSourceEventIds: existingBySource[SOURCE_FORM_D],
          });
          if (emitted === 'emitted') {
            emittedAny = true;
            emittedSignalTypes.add('funding_round');
            // Write back SEC funding data to the company record so the profile
            // shows fresh data without waiting for Apollo re-enrichment.
            // Only update when this filing is more recent than what's stored.
            // Deliberately never writes funding_stage — Form D doesn't disclose
            // the round letter, and overwriting it would break ICP fit scoring.
            const filingDateIso = filing.date_of_first_sale ?? filing.filing_date;
            if (filingDateIso) {
              try {
                await admin
                  .from('companies')
                  .update({
                    sec_latest_funding_date: filingDateIso,
                    sec_latest_funding_amount: filing.total_offering_amount ?? filing.total_amount_sold ?? null,
                    sec_latest_funding_accession: filing.accession_number,
                  })
                  .eq('id', row.id)
                  .or(`sec_latest_funding_date.is.null,sec_latest_funding_date.lt.${filingDateIso}`);
              } catch (writeErr) {
                console.warn(
                  `[funding] sec funding write-back failed for ${row.id}:`,
                  writeErr instanceof Error ? writeErr.message : String(writeErr),
                );
              }
            }
          } else {
            eventsSkippedAsDuplicates += 1;
          }
        } else if (FORM_8K_TYPES.has(filing.form_type)) {
          const items = Array.isArray(filing.items) ? filing.items : [];

          // Path 1: item-only PIPE detection (Item 3.02 = unregistered equity).
          // Stays a pure item-code check; no LLM dependency on the high-precision
          // financing path.
          if (items.includes('3.02') && shouldEmit('funding_round')) {
            candidateEventsMatched += 1;
            const sourceEventId = `${SOURCE_8K}:${row.id}:${filing.accession_number}:funding_round`;
            const summary = `8-K Item 3.02 (unregistered equity sales / PIPE) filed by ${filing.entity_name ?? companyName} (filed ${filingDate}).`;
            const emitted = await emitCompanySignal(admin, {
              userId: input.userId,
              companyId: row.id,
              source: SOURCE_8K,
              signalKey: 'funding_round',
              sourceEventType: 'sec_form_8k_item_3_02',
              sourceEventId,
              sourceUrl: filing.filing_url,
              eventAt,
              summary,
              metadata: { ...baseMetadata, items },
              existingSourceEventIds: existingBySource[SOURCE_8K],
            });
            if (emitted === 'emitted') {
              emittedAny = true;
              emittedSignalTypes.add('funding_round');
            } else {
              eventsSkippedAsDuplicates += 1;
            }
          }

          // Path 2: LLM-classified 8-K body → routed signal flavour. Catches
          // material agreements (1.01), leadership changes (5.02), and other
          // events (8.01) that the item code alone can't disambiguate.
          const classification = filing.classification;
          const classificationMapping = signalKeyForClassification(classification);
          if (classification && classificationMapping && shouldEmit(classificationMapping.signalKey)) {
            candidateEventsMatched += 1;
            const sourceEventId = `${SOURCE_8K}:${row.id}:${filing.accession_number}:${classificationMapping.signalKey}`;
            // Build a sales-facing summary: prefer the LLM's rationale, fall
            // back to a generic line if the model returned an empty string.
            const fallbackSummary = `${classificationMapping.signalKey.replace(/_/g, ' ')} detected at ${
              filing.entity_name ?? companyName
            } via 8-K (filed ${filingDate}).`;
            const summary = classification.rationale && classification.rationale.length > 0
              ? `${classification.rationale} [8-K, filed ${filingDate}]`
              : fallbackSummary;
            const emitted = await emitCompanySignal(admin, {
              userId: input.userId,
              companyId: row.id,
              source: SOURCE_8K,
              signalKey: classificationMapping.signalKey,
              sourceEventType: `sec_form_8k_${classification.category}`,
              sourceEventId,
              sourceUrl: filing.filing_url,
              eventAt,
              summary,
              metadata: {
                ...baseMetadata,
                items,
                classification,
                classified_at: filing.classified_at,
              },
              existingSourceEventIds: existingBySource[SOURCE_8K],
            });
            if (emitted === 'emitted') {
              emittedAny = true;
              emittedSignalTypes.add(classificationMapping.signalKey);
            } else {
              eventsSkippedAsDuplicates += 1;
            }
          }
        } else if (FORM_424B_TYPES.has(filing.form_type) && shouldEmit('ipo_or_follow_on')) {
          candidateEventsMatched += 1;
          const sourceEventId = `${SOURCE_424B}:${row.id}:${filing.accession_number}:ipo_or_follow_on`;
          // Enrich summary with LLM-extracted proceeds when available (only
          // populated for tracked-CIK 424B filings; otherwise we fall back to
          // the basic "they filed a prospectus" line).
          const c = filing.classification;
          const summary = c && c.rationale && c.rationale.length > 0
            ? `${c.rationale} [${filing.form_type}, filed ${filingDate}]`
            : `Prospectus ${filing.form_type} filed by ${filing.entity_name ?? companyName} — public follow-on / IPO pricing (filed ${filingDate}).`;
          const emitted = await emitCompanySignal(admin, {
            userId: input.userId,
            companyId: row.id,
            source: SOURCE_424B,
            signalKey: 'ipo_or_follow_on',
            sourceEventType: 'sec_prospectus_filed',
            sourceEventId,
            sourceUrl: filing.filing_url,
            eventAt,
            summary,
            metadata: c
              ? { ...baseMetadata, classification: c, classified_at: filing.classified_at }
              : baseMetadata,
            existingSourceEventIds: existingBySource[SOURCE_424B],
          });
          if (emitted === 'emitted') {
            emittedAny = true;
            emittedSignalTypes.add('ipo_or_follow_on');
          } else {
            eventsSkippedAsDuplicates += 1;
          }
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
