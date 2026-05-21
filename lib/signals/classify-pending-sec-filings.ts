/**
 * Drain unclassified SEC filings via Haiku.
 *
 * Self-healing path for the V2 LLM classifier. Two real-world cases produce
 * unclassified rows:
 *   1. Filings ingested before the V2 classifier shipped (V1 daily-index
 *      backfill rows where we either didn't fetch the body, or fetched it
 *      but only extracted item codes — no classification).
 *   2. Transient LLM failures during sync that left classification null.
 *
 * Scope:
 *   - 8-K / 8-K/A with items in {1.01, 5.02, 8.01} from any tracked CIK
 *   - 424B1..B7 from any tracked CIK (no item code on 424B; classification
 *     extracts proceeds + use-of-proceeds)
 *   - Skips Form D — those have structured XML, no LLM needed
 *
 * Cached forever by accession_number: once classification is non-null, the row
 * is removed from the queue.
 *
 * Hooked into /api/cron/funding-backfill after the chunked backfill drains and
 * the per-CIK catch-ups complete, so classification piggy-backs on idle worker
 * time without competing with the higher-priority backfill phases.
 */
import type { createAdminClient } from '@/lib/supabase-admin';
import { classifySecFiling } from '@/lib/signals/classify-sec-filing';
import { loadAllTrackedCiks } from '@/lib/signals/company-cik';
import {
  isRateLimitError,
  secFetchText,
} from '@/lib/signals/sec-edgar-client';
import { discoverPrimaryDoc } from '@/lib/signals/sync-sec-delta';

const CLASSIFIABLE_8K_ITEMS = ['1.01', '5.02', '8.01'];
const DEFAULT_BATCH_SIZE = 10;
const FORM_424B_LIKE = ['424B1', '424B2', '424B3', '424B4', '424B5', '424B7'];

type AdminClient = ReturnType<typeof createAdminClient>;

type PendingFilingRow = {
  accession_number: string;
  form_type: string;
  filing_date: string | null;
  cik: string | null;
  entity_name: string | null;
  primary_doc_url: string | null;
  items: string[] | null;
};

export type RunPendingSecClassificationsResult = {
  candidates_seen: number;
  classified: number;
  skipped_no_body: number;
  failed: number;
  rate_limit_halted: boolean;
  failures: Array<{ accession_number: string; error: string }>;
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function deriveDirUrl(filingUrlOrDocUrl: string | null, accessionNumber: string, cik: string): string | null {
  // Try to recover the filing's primary directory URL from either the
  // existing primary_doc_url (strip the file part) or the canonical CIK
  // + accession_no_dashes shape. Used when primary_doc_url is null on
  // legacy V1 rows.
  if (filingUrlOrDocUrl) {
    const lastSlash = filingUrlOrDocUrl.lastIndexOf('/');
    if (lastSlash > 0) return filingUrlOrDocUrl.slice(0, lastSlash);
  }
  const noDashes = accessionNumber.replace(/-/g, '');
  const cikUnpadded = String(parseInt(cik, 10) || 0);
  if (!cikUnpadded) return null;
  return `https://www.sec.gov/Archives/edgar/data/${cikUnpadded}/${noDashes}`;
}

/**
 * Drain up to `limit` unclassified tracked-CIK 8-K / 424B filings. Stops on
 * SEC rate-limit. Designed to live alongside the chunked backfill in the
 * funding-backfill cron — process a small batch each tick.
 */
export async function runPendingSecClassifications(
  admin: AdminClient,
  limit = DEFAULT_BATCH_SIZE,
): Promise<RunPendingSecClassificationsResult> {
  const trackedCiks = await loadAllTrackedCiks(admin);
  if (trackedCiks.size === 0) {
    return {
      candidates_seen: 0,
      classified: 0,
      skipped_no_body: 0,
      failed: 0,
      rate_limit_halted: false,
      failures: [],
    };
  }
  const trackedList = [...trackedCiks];

  // Pull a wider candidate set than `limit` so we can post-filter 8-Ks for
  // having a classifiable item code. Most tracked-CIK 8-Ks already have
  // items populated (V1 ran extractEightKItems), so the post-filter is fast.
  const SCAN_MULTIPLIER = 4;
  const { data, error } = await admin
    .from('sec_filings_local')
    .select('accession_number, form_type, filing_date, cik, entity_name, primary_doc_url, items')
    .is('classification', null)
    .in('cik', trackedList)
    .or(
      // Mirror the V2 classification scope: 8-Ks OR 424Bs from tracked CIKs.
      // Form D handled separately by structured XML parse — never classified.
      'form_type.like.8-K%,form_type.in.(' + FORM_424B_LIKE.join(',') + ')',
    )
    .order('filing_date', { ascending: false })
    .limit(limit * SCAN_MULTIPLIER);
  if (error) throw new Error(`runPendingSecClassifications query: ${error.message}`);

  const candidates = (data ?? []) as PendingFilingRow[];
  // Post-filter 8-Ks down to ones that have at least one classifiable item.
  // 8-K rows with no items (or only items like 2.02 earnings, 7.01 reg-FD)
  // aren't candidates for V2 classification — they'd return category=other
  // and waste an LLM call.
  const filtered = candidates
    .filter((c) => {
      if (FORM_424B_LIKE.includes(c.form_type)) return true;
      if (c.form_type.startsWith('8-K')) {
        const items = Array.isArray(c.items) ? c.items : [];
        return items.some((i) => CLASSIFIABLE_8K_ITEMS.includes(i));
      }
      return false;
    })
    .slice(0, limit);

  let classified = 0;
  let skippedNoBody = 0;
  let failed = 0;
  let rateLimitHalted = false;
  const failures: Array<{ accession_number: string; error: string }> = [];

  for (const row of filtered) {
    try {
      // Recover the primary doc URL for legacy V1 rows where it's null.
      let primaryDocUrl = row.primary_doc_url;
      if (!primaryDocUrl) {
        if (!row.cik) {
          skippedNoBody += 1;
          continue;
        }
        const dirUrl = deriveDirUrl(null, row.accession_number, row.cik);
        if (!dirUrl) {
          skippedNoBody += 1;
          continue;
        }
        const preferred = row.form_type.startsWith('8-K') ? 'htm' : 'htm';
        primaryDocUrl = await discoverPrimaryDoc(dirUrl, preferred);
        if (!primaryDocUrl) {
          skippedNoBody += 1;
          continue;
        }
      }

      const body = await secFetchText(primaryDocUrl);
      const classification = await classifySecFiling({
        formType: row.form_type,
        entityName: row.entity_name,
        filingDate: row.filing_date,
        items: row.items ?? [],
        primaryDocText: body,
      });

      const { error: updateError } = await admin
        .from('sec_filings_local')
        .update({
          classification,
          classified_at: classification ? new Date().toISOString() : new Date().toISOString(),
          primary_doc_url: primaryDocUrl,
        })
        .eq('accession_number', row.accession_number);
      if (updateError) {
        throw new Error(`update classification: ${updateError.message}`);
      }
      classified += 1;
    } catch (caughtError) {
      const message = messageFromUnknown(caughtError);
      if (isRateLimitError(caughtError)) {
        rateLimitHalted = true;
        break;
      }
      failed += 1;
      failures.push({ accession_number: row.accession_number, error: message });
    }
  }

  return {
    candidates_seen: filtered.length,
    classified,
    skipped_no_body: skippedNoBody,
    failed,
    rate_limit_halted: rateLimitHalted,
    failures,
  };
}
