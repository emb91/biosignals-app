/**
 * Sync recent SEC EDGAR filings (Form D, 8-K, 424B*) into the
 * sec_filings_local mirror.
 *
 * Walks EDGAR's pipe-delimited daily-index files day-by-day. For each
 * day:
 *  - Form D / D/A    → fetch primary_doc.xml, extract offering amounts
 *  - 8-K / 8-K/A     → fetch primary doc, regex item codes (only for
 *                      CIKs that match a tracked company — efficient)
 *  - 424B1..B7       → store row from daily-index alone (V2 enriches)
 *
 * Halts the entire run on a rate-limit error (429, or sustained 403s on
 * known-good URLs). Weekend/holiday daily-index 403s are expected and
 * skipped silently — S3 returns 403 for missing keys.
 *
 * See lib/signals/sec-edgar-client.ts and reference_sec_edgar_ingest.md.
 */
import type { createAdminClient } from '@/lib/supabase-admin';
import { normalizeCompanyForMatching } from '@/lib/signals/company-name-variants';
import { loadAllTrackedCiks } from '@/lib/signals/company-cik';
import { resolveCompanyMentions } from '@/lib/companies/resolve-mentions';
import { classifySecFiling, type SecFilingClassification } from '@/lib/signals/classify-sec-filing';
import {
  isRateLimitError,
  secFetchDailyIndex,
  secFetchJson,
  secFetchText,
  SecHttpError,
} from '@/lib/signals/sec-edgar-client';

// 8-K item codes that warrant a classification pass.
// '1.01', '5.02', '8.01' → ambiguous; full LLM classification required.
// '2.01', '2.03', '2.04', '2.05', '2.06', '3.01', '5.01', '1.03' → structurally
//   unambiguous; classifySecFiling returns a deterministic result at zero LLM cost.
// '3.02' is handled separately by the item-only PIPE path in run-funding-monitor.ts.
const CLASSIFIABLE_8K_ITEMS = new Set([
  '1.01', '1.02', '5.02', '8.01',   // needs LLM — content-dependent (1.02 = termination)
  '2.01', '5.01', '1.03',           // deterministic: acquisition / change-of-control / bankruptcy
  '2.03', '2.04', '2.05', '2.06',   // deterministic: financing / restructuring
  '3.01',                            // deterministic: delisting notice
]);

const TARGET_FORM_TYPES_FORM_D = new Set(['D', 'D/A']);
const TARGET_FORM_TYPES_8K = new Set(['8-K', '8-K/A']);
const TARGET_FORM_TYPES_424B = new Set(['424B1', '424B2', '424B3', '424B4', '424B5', '424B7']);

const ALL_TARGET_FORM_TYPES = new Set<string>([
  ...TARGET_FORM_TYPES_FORM_D,
  ...TARGET_FORM_TYPES_8K,
  ...TARGET_FORM_TYPES_424B,
]);

const UPSERT_CHUNK = 200;

/** Default backfill window for first-time runs. Subsequent runs use overlapDays. */
const DEFAULT_OVERLAP_DAYS = 90;

export type SyncSecDeltaInput = {
  admin: ReturnType<typeof createAdminClient>;
  overlapDays?: number;
  startDate?: string;
  endDate?: string;
};

export type SyncSecDeltaResult = {
  start_date: string;
  end_date: string;
  days_processed: number;
  days_skipped_no_data: number;
  filings_upserted: number;
  form_d_upserted: number;
  form_8k_upserted: number;
  form_424b_upserted: number;
  rate_limit_halted: boolean;
  duration_ms: number;
};

type DailyIndexRow = {
  cik: string; // zero-padded to 10
  cikRaw: string;
  entityName: string;
  formType: string;
  filingDate: string; // YYYY-MM-DD
  fileName: string;
  accessionNumber: string; // with dashes
  filingUrl: string;
  primaryDirUrl: string; // base for index.json + primary_doc
};

function padCik(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/[^0-9]/g, '');
  if (!digits) return null;
  return digits.padStart(10, '0');
}

function quarterForDate(date: Date): number {
  const month = date.getUTCMonth(); // 0-based
  return Math.floor(month / 3) + 1;
}

function toYyyymmdd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function isoFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isWeekendUtc(date: Date): boolean {
  const dow = date.getUTCDay();
  return dow === 0 || dow === 6;
}

function dailyIndexUrl(date: Date): string {
  const y = date.getUTCFullYear();
  const q = quarterForDate(date);
  return `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${q}/master.${toYyyymmdd(date)}.idx`;
}

function parseAccessionFromFileName(fileName: string): string | null {
  // edgar/data/{cik}/0001234567-26-000123-index.htm  OR  0001234567-26-000123.txt
  const match = fileName.match(/(\d{10}-\d{2}-\d{6})/);
  return match ? match[1] : null;
}

function parseDailyIndex(text: string, filingDate: string): DailyIndexRow[] {
  const rows: DailyIndexRow[] = [];
  const lines = text.split(/\r?\n/);
  let inData = false;
  for (const line of lines) {
    if (!inData) {
      // Header separator is a long run of '-' or the column header line.
      if (line.startsWith('-----')) {
        inData = true;
        continue;
      }
      // Skip header until we see the dashed separator.
      continue;
    }
    if (!line || !line.includes('|')) continue;
    const parts = line.split('|');
    if (parts.length < 5) continue;
    const [cikRaw, entityName, formType, dateFiled, fileName] = parts;
    if (!cikRaw || !formType || !fileName) continue;
    if (!ALL_TARGET_FORM_TYPES.has(formType.trim())) continue;
    const accession = parseAccessionFromFileName(fileName);
    if (!accession) continue;
    const accessionNoDashes = accession.replace(/-/g, '');
    const cik = padCik(cikRaw);
    if (!cik) continue;
    const filingUrl = `https://www.sec.gov/Archives/${fileName.trim()}`;
    const primaryDirUrl = `https://www.sec.gov/Archives/edgar/data/${cikRaw.trim()}/${accessionNoDashes}`;
    rows.push({
      cik,
      cikRaw: cikRaw.trim(),
      entityName: (entityName ?? '').trim(),
      formType: formType.trim(),
      filingDate, // canonical from the daily-index date, not the column (same value anyway)
      fileName: fileName.trim(),
      accessionNumber: accession,
      filingUrl,
      primaryDirUrl,
    });
    // Echo dateFiled column to satisfy lint without enabling no-unused-vars rule changes.
    void dateFiled;
  }
  return rows;
}

// ── Form D primary_doc.xml extraction (namespace-prefix-tolerant regex) ──
// The Form D schema is simple enough that regex on text-children is safe and
// avoids pulling in an XML parser. We strip namespace prefixes by allowing
// an optional `\w+:` before the tag name.

function extractTagText(xml: string, tagName: string): string | null {
  const re = new RegExp(`<(?:\\w+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tagName}>`, 'i');
  const match = xml.match(re);
  if (!match) return null;
  // Strip nested tags and decode minimal entities.
  return match[1]
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function parseMoney(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[,$]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDateLoose(value: string | null): string | null {
  if (!value) return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  // MM/DD/YYYY
  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, mm, dd, yyyy] = slashMatch;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  const time = Date.parse(text);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}

type FormDFields = {
  entityName: string | null;
  entityType: string | null;
  industryGroupType: string | null;
  dateOfFirstSale: string | null;
  totalOfferingAmount: number | null;
  totalAmountSold: number | null;
  totalRemaining: number | null;
};

function parseFormDXml(xml: string): FormDFields {
  return {
    entityName: extractTagText(xml, 'entityName'),
    entityType: extractTagText(xml, 'entityType'),
    industryGroupType: extractTagText(xml, 'industryGroupType'),
    dateOfFirstSale: parseDateLoose(extractTagText(xml, 'dateOfFirstSale')),
    totalOfferingAmount: parseMoney(extractTagText(xml, 'totalOfferingAmount')),
    totalAmountSold: parseMoney(extractTagText(xml, 'totalAmountSold')),
    totalRemaining: parseMoney(extractTagText(xml, 'totalRemaining')),
  };
}

// ── 8-K item-code extraction ──────────────────────────────────────────────
// 8-K cover pages use literal "Item N.NN" headers. We strip HTML to text and
// regex the canonical pattern. Items are always two-decimal: 1.01, 3.02, 8.01.

function extractEightKItems(rawText: string): string[] {
  // Decode the most common HTML entities so "Item&nbsp;3.02" still matches.
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

// ── Filing-directory discovery ────────────────────────────────────────────
// Some Form D filings (paper, very old) have no primary_doc.xml; skip them.

type IndexJson = {
  directory?: {
    item?: Array<{
      name?: string;
      type?: string;
    }>;
  };
};

export async function discoverPrimaryDoc(
  primaryDirUrl: string,
  preferredExt: 'xml' | 'htm' | 'txt' | null,
): Promise<string | null> {
  try {
    const json = await secFetchJson<IndexJson>(`${primaryDirUrl}/index.json`);
    const items = json?.directory?.item ?? [];
    // Prefer primary_doc.xml/htm/txt by exact name, then any file matching the
    // preferred extension, then the first non-index document.
    const byExactName = items.find((i) =>
      preferredExt
        ? i.name?.toLowerCase() === `primary_doc.${preferredExt}`
        : i.name?.toLowerCase().startsWith('primary_doc.'),
    );
    if (byExactName?.name) return `${primaryDirUrl}/${byExactName.name}`;
    if (preferredExt) {
      const byExt = items.find((i) => i.name?.toLowerCase().endsWith(`.${preferredExt}`));
      if (byExt?.name) return `${primaryDirUrl}/${byExt.name}`;
    }
    const firstDoc = items.find((i) => i.name && !i.name.toLowerCase().includes('index'));
    if (firstDoc?.name) return `${primaryDirUrl}/${firstDoc.name}`;
    return null;
  } catch (error) {
    if (error instanceof SecHttpError && error.status === 404) return null;
    throw error;
  }
}

// ── Upserts ───────────────────────────────────────────────────────────────

type FilingUpsertRow = {
  accession_number: string;
  form_type: string;
  filing_date: string;
  cik: string;
  entity_name: string | null;
  entity_name_normalized: string | null;
  filing_url: string;
  primary_doc_url: string | null;
  total_offering_amount: number | null;
  total_amount_sold: number | null;
  total_remaining: number | null;
  date_of_first_sale: string | null;
  entity_type: string | null;
  industry_group_type: string | null;
  items: string[] | null;
  classification: SecFilingClassification | null;
  classified_at: string | null;
  extras: Record<string, unknown> | null;
  last_seen_at: string;
  canonical_company_id?: string | null;
};

function buildBaseUpsertRow(row: DailyIndexRow, primaryDocUrl: string | null, startedAtIso: string): FilingUpsertRow {
  return {
    accession_number: row.accessionNumber,
    form_type: row.formType,
    filing_date: row.filingDate,
    cik: row.cik,
    entity_name: row.entityName || null,
    entity_name_normalized: row.entityName ? normalizeCompanyForMatching(row.entityName) : null,
    filing_url: row.filingUrl,
    primary_doc_url: primaryDocUrl,
    total_offering_amount: null,
    total_amount_sold: null,
    total_remaining: null,
    date_of_first_sale: null,
    entity_type: null,
    industry_group_type: null,
    items: null,
    classification: null,
    classified_at: null,
    extras: null,
    last_seen_at: startedAtIso,
  };
}

/**
 * Try to classify a fetched 8-K / 424B body via Haiku. Failures are non-fatal
 * — caller carries on with null classification, and the row can be reclassified
 * later by a backfill of unclassified rows. Rate-limit errors bubble up so the
 * caller can halt the entire sync.
 */
async function tryClassify(
  formType: string,
  entityName: string | null,
  filingDate: string,
  items: string[],
  bodyText: string,
  accessionNumber: string,
): Promise<{ classification: SecFilingClassification | null; classifiedAt: string | null }> {
  try {
    const result = await classifySecFiling({
      formType,
      entityName,
      filingDate,
      items,
      primaryDocText: bodyText,
    });
    return { classification: result, classifiedAt: result ? new Date().toISOString() : null };
  } catch (error) {
    // Anthropic SDK throws plain Errors; no rate-limit shape to bubble up the
    // SEC pathway. Log and continue with null — the periodic reclassifier
    // will pick this up next run.
    console.warn(
      `[sync-sec-delta] classification failed (${accessionNumber}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { classification: null, classifiedAt: null };
  }
}

// ── Main sync ─────────────────────────────────────────────────────────────

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function syncSecDelta(input: SyncSecDeltaInput): Promise<SyncSecDeltaResult> {
  const admin = input.admin;
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const explicitStart = input.startDate ? new Date(`${input.startDate}T00:00:00Z`) : null;
  const explicitEnd = input.endDate ? new Date(`${input.endDate}T00:00:00Z`) : null;
  if ((explicitStart && !explicitEnd) || (!explicitStart && explicitEnd)) {
    throw new Error('syncSecDelta requires both startDate and endDate when either is provided');
  }
  let endDate: Date;
  let startDate: Date;
  if (explicitStart && explicitEnd) {
    startDate = explicitStart;
    endDate = explicitEnd;
  } else {
    const overlapDays = input.overlapDays ?? DEFAULT_OVERLAP_DAYS;
    endDate = new Date(Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), startedAt.getUTCDate()));
    startDate = new Date(endDate.getTime() - overlapDays * 24 * 60 * 60 * 1000);
  }
  if (startDate.getTime() > endDate.getTime()) {
    throw new Error(`syncSecDelta startDate ${isoFromDate(startDate)} is after endDate ${isoFromDate(endDate)}`);
  }

  const trackedCiks = await loadAllTrackedCiks(admin);

  const { data: runRow, error: runInsertErr } = await admin
    .from('sec_delta_sync_runs')
    .insert({
      status: 'running',
      start_date: isoFromDate(startDate),
      end_date: isoFromDate(endDate),
      started_at: startedAtIso,
    })
    .select('id')
    .single();
  if (runInsertErr) throw new Error(`sec_delta_sync_runs insert: ${runInsertErr.message}`);
  const runId = runRow?.id as string;

  let daysProcessed = 0;
  let daysSkipped = 0;
  let formDUpserted = 0;
  let form8kUpserted = 0;
  let form424bUpserted = 0;
  let rateLimitHalted = false;
  let lastError: string | null = null;

  const upsertBuffer: FilingUpsertRow[] = [];
  const flush = async (): Promise<void> => {
    if (upsertBuffer.length === 0) return;
    // Dedupe within the chunk by accession_number. The SEC daily-index
    // sometimes lists the same filing under multiple CIK rows (joint
    // filers, parent + subsidiary on a single Form D, related-issuer
    // 424B prospectuses), so the same accession can be queued twice in
    // one buffer. Postgres `ON CONFLICT DO UPDATE` rejects a statement
    // that touches the same row twice — collapsing here is the fix.
    // Last-write-wins: the most recent push has the freshest parse
    // (primary_doc XML or 8-K items) since later rows in the loop are
    // processed after earlier ones for the same accession.
    const byAccession = new Map<string, FilingUpsertRow>();
    for (const row of upsertBuffer) {
      byAccession.set(row.accession_number, row);
    }
    upsertBuffer.length = 0;
    const chunk = [...byAccession.values()];

    // Resolve entity_name → canonical company id for this chunk.
    const uniqueNames = [
      ...new Set(chunk.map((r) => r.entity_name).filter((n): n is string => Boolean(n))),
    ];
    if (uniqueNames.length > 0) {
      try {
        const resolved = await resolveCompanyMentions(admin, uniqueNames);
        for (const row of chunk) {
          row.canonical_company_id = row.entity_name
            ? (resolved.get(row.entity_name)?.canonicalId ?? null)
            : null;
        }
      } catch (e) {
        console.error('[sync-sec] resolver failed for chunk:', e);
        for (const row of chunk) row.canonical_company_id = null;
      }
    }

    const { error } = await admin
      .from('sec_filings_local')
      .upsert(chunk, { onConflict: 'accession_number' });
    if (error) throw new Error(`sec_filings_local upsert: ${error.message}`);
  };

  try {
    // Walk forward from startDate so partial progress is meaningful if we halt.
    const cursor = new Date(startDate.getTime());
    while (cursor.getTime() <= endDate.getTime()) {
      if (isWeekendUtc(cursor)) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        continue;
      }
      const filingDateIso = isoFromDate(cursor);
      const indexUrl = dailyIndexUrl(cursor);
      let indexText: string | null;
      try {
        indexText = await secFetchDailyIndex(indexUrl);
      } catch (error) {
        if (isRateLimitError(error)) {
          rateLimitHalted = true;
          lastError = messageFromUnknown(error);
          break;
        }
        throw error;
      }
      if (!indexText) {
        daysSkipped += 1;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        continue;
      }

      const rows = parseDailyIndex(indexText, filingDateIso);
      daysProcessed += 1;

      for (const row of rows) {
        try {
          if (TARGET_FORM_TYPES_FORM_D.has(row.formType)) {
            const primaryDocUrl = await discoverPrimaryDoc(row.primaryDirUrl, 'xml');
            const base = buildBaseUpsertRow(row, primaryDocUrl, startedAtIso);
            if (primaryDocUrl) {
              try {
                const xml = await secFetchText(primaryDocUrl);
                const parsed = parseFormDXml(xml);
                base.entity_name = parsed.entityName || base.entity_name;
                base.entity_name_normalized = base.entity_name
                  ? normalizeCompanyForMatching(base.entity_name)
                  : null;
                base.entity_type = parsed.entityType;
                base.industry_group_type = parsed.industryGroupType;
                base.date_of_first_sale = parsed.dateOfFirstSale;
                base.total_offering_amount = parsed.totalOfferingAmount;
                base.total_amount_sold = parsed.totalAmountSold;
                base.total_remaining = parsed.totalRemaining;
              } catch (error) {
                if (isRateLimitError(error)) throw error;
                // Non-fatal: paper or malformed primary_doc — fall back to index-only.
                console.warn(
                  `[sync-sec-delta] Form D primary_doc parse failed (${row.accessionNumber}): ${messageFromUnknown(error)}`,
                );
              }
            }
            upsertBuffer.push(base);
            formDUpserted += 1;
          } else if (TARGET_FORM_TYPES_8K.has(row.formType)) {
            // 8-K: only worth a primary-doc fetch if the CIK matches a tracked
            // company. Otherwise we'd be downloading ~120 8-Ks/day for nothing.
            if (!trackedCiks.has(row.cik)) {
              continue;
            }
            const primaryDocUrl = await discoverPrimaryDoc(row.primaryDirUrl, 'htm');
            const base = buildBaseUpsertRow(row, primaryDocUrl, startedAtIso);
            let body: string | null = null;
            if (primaryDocUrl) {
              try {
                body = await secFetchText(primaryDocUrl);
                base.items = extractEightKItems(body);
              } catch (error) {
                if (isRateLimitError(error)) throw error;
                console.warn(
                  `[sync-sec-delta] 8-K primary_doc parse failed (${row.accessionNumber}): ${messageFromUnknown(error)}`,
                );
              }
            }
            // Classify 8-Ks whose item codes (1.01 material agreement, 5.02
            // leadership change, 8.01 catch-all) need body inspection to
            // route to a specific signal. 3.02 (PIPE) is handled separately
            // by the item-only path in run-funding-monitor.ts.
            if (body && Array.isArray(base.items)
                && base.items.some((item) => CLASSIFIABLE_8K_ITEMS.has(item))) {
              const { classification, classifiedAt } = await tryClassify(
                row.formType,
                base.entity_name,
                row.filingDate,
                base.items,
                body,
                row.accessionNumber,
              );
              base.classification = classification;
              base.classified_at = classifiedAt;
            }
            upsertBuffer.push(base);
            form8kUpserted += 1;
          } else if (TARGET_FORM_TYPES_424B.has(row.formType)) {
            // 424B: default to index-only record for the global mirror; but if
            // the CIK is tracked, also fetch the prospectus body and classify
            // it to extract proceeds / use-of-proceeds. Untracked-CIK 424Bs
            // stay as basic ipo_or_follow_on rows with no body fetch.
            let base: FilingUpsertRow;
            if (trackedCiks.has(row.cik)) {
              const primaryDocUrl = await discoverPrimaryDoc(row.primaryDirUrl, 'htm');
              base = buildBaseUpsertRow(row, primaryDocUrl, startedAtIso);
              if (primaryDocUrl) {
                try {
                  const body = await secFetchText(primaryDocUrl);
                  const { classification, classifiedAt } = await tryClassify(
                    row.formType,
                    base.entity_name,
                    row.filingDate,
                    [],
                    body,
                    row.accessionNumber,
                  );
                  base.classification = classification;
                  base.classified_at = classifiedAt;
                } catch (error) {
                  if (isRateLimitError(error)) throw error;
                  console.warn(
                    `[sync-sec-delta] 424B primary_doc fetch failed (${row.accessionNumber}): ${messageFromUnknown(error)}`,
                  );
                }
              }
            } else {
              base = buildBaseUpsertRow(row, null, startedAtIso);
            }
            upsertBuffer.push(base);
            form424bUpserted += 1;
          }
          if (upsertBuffer.length >= UPSERT_CHUNK) await flush();
        } catch (error) {
          if (isRateLimitError(error)) {
            rateLimitHalted = true;
            lastError = messageFromUnknown(error);
            throw error; // bubble out of day loop
          }
          // Non-rate-limit errors for a single filing are non-fatal — log & continue.
          console.warn(
            `[sync-sec-delta] filing ${row.accessionNumber} (${row.formType}) failed: ${messageFromUnknown(error)}`,
          );
        }
      }

      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  } catch (error) {
    if (!isRateLimitError(error)) {
      lastError = messageFromUnknown(error);
    }
  }

  // Always try to flush whatever we've got before recording the run state.
  try {
    await flush();
  } catch (error) {
    lastError = messageFromUnknown(error);
  }

  const finishedAt = new Date();
  const status = rateLimitHalted ? 'halted_rate_limit' : lastError ? 'failed' : 'success';
  await admin
    .from('sec_delta_sync_runs')
    .update({
      finished_at: finishedAt.toISOString(),
      status,
      days_processed: daysProcessed,
      days_skipped_no_data: daysSkipped,
      filings_upserted: formDUpserted + form8kUpserted + form424bUpserted,
      form_d_upserted: formDUpserted,
      form_8k_upserted: form8kUpserted,
      form_424b_upserted: form424bUpserted,
      rate_limit_halted: rateLimitHalted,
      error: lastError,
    })
    .eq('id', runId);

  return {
    start_date: isoFromDate(startDate),
    end_date: isoFromDate(endDate),
    days_processed: daysProcessed,
    days_skipped_no_data: daysSkipped,
    filings_upserted: formDUpserted + form8kUpserted + form424bUpserted,
    form_d_upserted: formDUpserted,
    form_8k_upserted: form8kUpserted,
    form_424b_upserted: form424bUpserted,
    rate_limit_halted: rateLimitHalted,
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
  };
}
