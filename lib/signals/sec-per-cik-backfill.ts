/**
 * Per-CIK 8-K catch-up backfill.
 *
 * The global sec_filings_local backfill (sync-sec-delta + sec-backfill) skips
 * 8-K primary-doc fetches when the filing's CIK isn't already in the
 * `companies` table — efficient, but means newly-resolved CIKs are missing
 * their last 90 days of 8-Ks. This module fixes the gap on a per-company basis
 * by hitting data.sec.gov/submissions/CIK{cik}.json (a single JSON listing
 * the last ~1000 filings for one CIK) and mirroring just the 8-Ks.
 *
 * Form D and 424B are NOT touched here — those are mirrored globally for the
 * whole market by the daily-index sync.
 *
 * Drained by /api/cron/funding-backfill between chunked-backfill jobs.
 */
import type { createAdminClient } from '@/lib/supabase-admin';
import { normalizeCompanyForMatching } from '@/lib/signals/company-name-variants';
import { classifySecFiling, type SecFilingClassification } from '@/lib/signals/classify-sec-filing';
import {
  isRateLimitError,
  secFetchJson,
  secFetchText,
} from '@/lib/signals/sec-edgar-client';

const CLASSIFIABLE_8K_ITEMS = new Set(['1.01', '5.02', '8.01']);

const SUBMISSIONS_URL_BASE = 'https://data.sec.gov/submissions';
const DEFAULT_CATCH_UP_DAYS = 90;
const DEFAULT_BATCH_SIZE = 5;

const TARGET_FORM_8K = new Set(['8-K', '8-K/A']);

type AdminClient = ReturnType<typeof createAdminClient>;

type SecSubmissionsRecent = {
  accessionNumber?: string[];
  filingDate?: string[];
  form?: string[];
  primaryDocument?: string[];
};

type SecSubmissionsResponse = {
  cik?: string;
  name?: string;
  filings?: {
    recent?: SecSubmissionsRecent;
  };
};

type SubmissionRow = {
  accession_number: string;
  filing_date: string;
  form_type: string;
  primary_doc_filename: string;
};

function padCik(cik: string): string {
  const digits = String(cik).replace(/[^0-9]/g, '');
  return digits.padStart(10, '0');
}

function zipSubmissions(recent: SecSubmissionsRecent | undefined): SubmissionRow[] {
  if (!recent) return [];
  const acc = recent.accessionNumber ?? [];
  const dates = recent.filingDate ?? [];
  const forms = recent.form ?? [];
  const docs = recent.primaryDocument ?? [];
  const rows: SubmissionRow[] = [];
  for (let i = 0; i < acc.length; i++) {
    if (!acc[i] || !dates[i] || !forms[i]) continue;
    rows.push({
      accession_number: acc[i],
      filing_date: dates[i],
      form_type: forms[i].trim(),
      primary_doc_filename: typeof docs[i] === 'string' ? docs[i] : '',
    });
  }
  return rows;
}

function isWithinDays(filingDateIso: string, days: number): boolean {
  const time = Date.parse(`${filingDateIso}T00:00:00Z`);
  if (Number.isNaN(time)) return false;
  return Date.now() - time < days * 24 * 60 * 60 * 1000;
}

// Mirrors the regex in sync-sec-delta.ts so dedupe via accession_number is
// transparent — same items[] shape, same upsert PK.
function extractEightKItems(rawText: string): string[] {
  const text = rawText
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  const items = new Set<string>();
  const re = /Item\s+(\d{1,2}\.\d{2})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    items.add(match[1]);
  }
  return [...items].sort();
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export type BackfillSecForCikResult = {
  companyId: string;
  cik: string;
  submissions_scanned: number;
  filings_upserted: number;
  rate_limit_halted: boolean;
};

/**
 * Pull a single CIK's recent filings and mirror any 8-Ks from the last
 * `days` days into sec_filings_local. Sets companies.cik_backfilled_at on
 * success so the company is removed from the catch-up queue.
 *
 * If we hit a rate-limit error mid-flight, we leave cik_backfilled_at null
 * so the next cron tick retries — partial progress (already-upserted rows)
 * is preserved.
 */
export async function backfillSecForCik(
  admin: AdminClient,
  companyId: string,
  cik: string,
  opts: { days?: number } = {},
): Promise<BackfillSecForCikResult> {
  const cikPadded = padCik(cik);
  const days = opts.days ?? DEFAULT_CATCH_UP_DAYS;
  const url = `${SUBMISSIONS_URL_BASE}/CIK${cikPadded}.json`;

  const submissions = await secFetchJson<SecSubmissionsResponse>(url);
  const entityName = submissions.name ?? null;
  const entityNameNormalized = entityName ? normalizeCompanyForMatching(entityName) : null;

  const recentRows = zipSubmissions(submissions.filings?.recent).filter(
    (r) => TARGET_FORM_8K.has(r.form_type) && isWithinDays(r.filing_date, days),
  );

  let upserted = 0;
  let rateLimitHalted = false;
  const startedAtIso = new Date().toISOString();
  const cikUnpadded = String(parseInt(cikPadded, 10));

  for (const row of recentRows) {
    const accessionNoDashes = row.accession_number.replace(/-/g, '');
    const primaryDirUrl = `https://www.sec.gov/Archives/edgar/data/${cikUnpadded}/${accessionNoDashes}`;
    const primaryDocUrl = row.primary_doc_filename
      ? `${primaryDirUrl}/${row.primary_doc_filename}`
      : null;
    const filingUrl = primaryDocUrl ?? `${primaryDirUrl}/${row.accession_number}-index.htm`;

    let items: string[] | null = null;
    let body: string | null = null;
    if (primaryDocUrl) {
      try {
        body = await secFetchText(primaryDocUrl);
        items = extractEightKItems(body);
      } catch (error) {
        if (isRateLimitError(error)) {
          rateLimitHalted = true;
          break;
        }
        // Non-fatal — store the row without items so the funding monitor can
        // still see the 8-K exists; items can be reparsed later if needed.
        console.warn(
          `[sec-per-cik-backfill] item parse failed for ${row.accession_number}:`,
          messageFromUnknown(error),
        );
      }
    }

    // Mirror sync-sec-delta.ts: when an 8-K has item 1.01 / 5.02 / 8.01,
    // classify the body so the funding monitor can emit a specific signal
    // (licensing_deal, leadership_churn, restructuring, etc) instead of
    // dropping the filing on the floor.
    let classification: SecFilingClassification | null = null;
    let classifiedAt: string | null = null;
    if (body && Array.isArray(items) && items.some((item) => CLASSIFIABLE_8K_ITEMS.has(item))) {
      try {
        classification = await classifySecFiling({
          formType: row.form_type,
          entityName,
          filingDate: row.filing_date,
          items,
          primaryDocText: body,
        });
        classifiedAt = classification ? new Date().toISOString() : null;
      } catch (classifyError) {
        // Non-fatal — leave null so a future re-classification pass can pick
        // it up. Don't break the catch-up loop for a single LLM hiccup.
        console.warn(
          `[sec-per-cik-backfill] classify failed for ${row.accession_number}:`,
          messageFromUnknown(classifyError),
        );
      }
    }

    const { error } = await admin.from('sec_filings_local').upsert(
      {
        accession_number: row.accession_number,
        form_type: row.form_type,
        filing_date: row.filing_date,
        cik: cikPadded,
        entity_name: entityName,
        entity_name_normalized: entityNameNormalized,
        filing_url: filingUrl,
        primary_doc_url: primaryDocUrl,
        items,
        classification,
        classified_at: classifiedAt,
        last_seen_at: startedAtIso,
      },
      { onConflict: 'accession_number' },
    );
    if (error) throw new Error(`sec_filings_local upsert (per-cik): ${error.message}`);
    upserted += 1;
  }

  // Only mark as backfilled if we got through cleanly. If we halted, leave
  // the column null so the cron picks it up again next tick.
  if (!rateLimitHalted) {
    const { error: updateErr } = await admin
      .from('companies')
      .update({ cik_backfilled_at: new Date().toISOString() })
      .eq('id', companyId);
    if (updateErr) throw new Error(`update cik_backfilled_at: ${updateErr.message}`);
  }

  return {
    companyId,
    cik: cikPadded,
    submissions_scanned: recentRows.length,
    filings_upserted: upserted,
    rate_limit_halted: rateLimitHalted,
  };
}

export type RunPendingCikCatchupsResult = {
  processed: number;
  filings_upserted: number;
  failed: number;
  rate_limit_halted: boolean;
  failures: Array<{ company_id: string; error: string }>;
};

/**
 * Drain up to `limit` pending CIK catch-ups (companies with non-null cik but
 * cik_backfilled_at = null). Designed to be called from /api/cron/funding-backfill
 * when no chunked global-backfill job is active.
 *
 * Halts cleanly on rate-limit so the next cron tick can resume.
 */
export async function runPendingCikCatchups(
  admin: AdminClient,
  limit = DEFAULT_BATCH_SIZE,
): Promise<RunPendingCikCatchupsResult> {
  const { data, error } = await admin
    .from('companies')
    .select('id, cik')
    .not('cik', 'is', null)
    .is('cik_backfilled_at', null)
    .order('cik')
    .limit(limit);
  if (error) throw new Error(`runPendingCikCatchups query: ${error.message}`);

  const rows = (data ?? []) as Array<{ id: string; cik: string }>;
  let processed = 0;
  let filings = 0;
  let failed = 0;
  let rateLimitHalted = false;
  const failures: Array<{ company_id: string; error: string }> = [];

  for (const row of rows) {
    try {
      const result = await backfillSecForCik(admin, row.id, row.cik);
      processed += 1;
      filings += result.filings_upserted;
      if (result.rate_limit_halted) {
        rateLimitHalted = true;
        break;
      }
    } catch (caughtError) {
      const message = messageFromUnknown(caughtError);
      if (isRateLimitError(caughtError)) {
        // Don't count rate-limit as failure — just halt the batch.
        rateLimitHalted = true;
        break;
      }
      failed += 1;
      failures.push({ company_id: row.id, error: message });
    }
  }

  return {
    processed,
    filings_upserted: filings,
    failed,
    rate_limit_halted: rateLimitHalted,
    failures,
  };
}
