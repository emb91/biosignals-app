/**
 * Sync recent FDA data from OpenFDA into local Supabase tables.
 *
 * Pulls three endpoints in parallel:
 *  - drug/drugsfda.json (drug applications + nested submissions)
 *  - device/510k.json   (medical device clearances)
 *  - device/pma.json    (premarket approvals + supplements)
 *
 * Each call is filtered by recent date and paginated up to MAX_PAGES. Volumes
 * are small (hundreds-low-thousands of rows per 60-day window across all
 * three endpoints), so this is a cheap weekly cron.
 *
 * Used by both the daily/weekly cron and the admin "fda-regulatory" button's
 * optional sync_first step.
 */
import { fetchWithRetry, TokenBucket } from '@/lib/signals/fetch-with-retry';
import { normalizeCompanyForMatching } from '@/lib/signals/company-name-variants';
import { resolveCompanyMentions } from '@/lib/companies/resolve-mentions';
import type { createAdminClient } from '@/lib/supabase-admin';

const DEFAULT_OVERLAP_DAYS = 60;
const PAGE_SIZE = 100;
const MAX_PAGES_PER_ENDPOINT = 25; // 2500 records max per endpoint per run
const UPSERT_CHUNK = 500;

// OpenFDA: 240 req/min with key = 4 req/sec. Token bucket prevents bursts.
const openFdaLimiter = new TokenBucket({
  capacity: 4,
  refillPerSecond: 4,
  label: 'openfda',
});

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function yyyymmddDashed(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function yyyymmddCompact(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function toIsoDateFromYyyymmdd(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // OpenFDA dates come as "YYYYMMDD" or "YYYY-MM-DD"
  const compact = value.replace(/-/g, '');
  if (!/^\d{8}$/.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function openFdaUrl(path: string, search: string, limit: number, skip: number): string {
  const apiKey = process.env.OPENFDA_API_KEY;
  const encodedSearch = encodeURIComponent(search);
  const base = `https://api.fda.gov/${path}?search=${encodedSearch}&limit=${limit}&skip=${skip}`;
  return apiKey ? `${base}&api_key=${encodeURIComponent(apiKey)}` : base;
}

async function fetchOpenFdaPage<T>(
  path: string,
  search: string,
  skip: number,
  label: string,
): Promise<{ results: T[]; total: number }> {
  const url = openFdaUrl(path, search, PAGE_SIZE, skip);
  const response = await fetchWithRetry(url, {
    headers: { Accept: 'application/json' },
    label,
    rateLimiter: openFdaLimiter,
  });
  if (!response.ok) {
    if (response.status === 404) return { results: [], total: 0 };
    throw new Error(`${label} request failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    meta?: { results?: { total?: number } };
    results?: T[];
  };
  return {
    results: Array.isArray(payload.results) ? payload.results : [],
    total: payload.meta?.results?.total ?? 0,
  };
}

async function* paginate<T>(
  path: string,
  search: string,
  label: string,
): AsyncGenerator<T[], void, void> {
  for (let page = 0; page < MAX_PAGES_PER_ENDPOINT; page += 1) {
    const skip = page * PAGE_SIZE;
    const { results, total } = await fetchOpenFdaPage<T>(path, search, skip, `${label} page ${page + 1}`);
    if (results.length === 0) return;
    yield results;
    if (skip + results.length >= total) return;
  }
}

type DrugApplicationResult = {
  application_number?: string;
  sponsor_name?: string;
  products?: Array<{ brand_name?: string }>;
  submissions?: Array<{
    submission_number?: string;
    submission_status?: string;
    submission_status_date?: string;
    submission_type?: string;
    submission_class_code?: string;
    submission_class_code_description?: string;
    review_priority?: string;
    submission_property_type?: Array<{ code?: string; value?: string }>;
  }>;
};

type Device510kResult = {
  k_number?: string;
  applicant?: string;
  device_name?: string;
  product_code?: string;
  decision_code?: string;
  decision_description?: string;
  decision_date?: string;
};

type DevicePmaResult = {
  pma_number?: string;
  supplement_number?: string;
  applicant?: string;
  trade_name?: string;
  generic_name?: string;
  supplement_type?: string;
  supplement_reason?: string;
  decision_code?: string;
  decision_date?: string;
  advisory_committee_description?: string;
};

export type SyncFdaDeltaResult = {
  cutoff_date: string;
  drug_submissions_upserted: number;
  device_510k_upserted: number;
  device_pma_upserted: number;
  duration_ms: number;
};

async function chunkedUpsert(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await admin.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
    upserted += chunk.length;
  }
  return upserted;
}

/**
 * Attach `mentioned_company_ids` to each row by resolving its `nameField`
 * (e.g. 'sponsor_name' or 'applicant') against the canonical directory.
 * Calls the resolver ONCE per dedup-set; result map is reused per row.
 */
async function attachMentionedIds(
  admin: ReturnType<typeof createAdminClient>,
  rows: Record<string, unknown>[],
  nameField: string,
): Promise<void> {
  const uniqueNames = [
    ...new Set(rows.map((r) => r[nameField]).filter((n): n is string => typeof n === 'string' && Boolean(n))),
  ];
  if (uniqueNames.length === 0) {
    for (const r of rows) r.mentioned_company_ids = [];
    return;
  }
  try {
    const resolved = await resolveCompanyMentions(admin, uniqueNames);
    for (const r of rows) {
      const name = r[nameField] as string | null;
      const id = name ? resolved.get(name)?.canonicalId : null;
      r.mentioned_company_ids = id ? [id] : [];
    }
  } catch (e) {
    console.error(`[sync-fda] resolver failed for ${nameField}:`, e);
    for (const r of rows) r.mentioned_company_ids = [];
  }
}

async function syncDrugSubmissions(
  admin: ReturnType<typeof createAdminClient>,
  cutoffCompact: string,
  startedAt: string,
): Promise<number> {
  const today = yyyymmddCompact(new Date());
  // OpenFDA Lucene range syntax wants spaces (not `+`). Our URL builder
  // calls encodeURIComponent which would turn `+` into %2B (literal +) and
  // break the range. Spaces → %20 → spaces on the server side. Works.
  const search = `submissions.submission_status_date:[${cutoffCompact} TO ${today}]`;
  const rows: Record<string, unknown>[] = [];
  for await (const page of paginate<DrugApplicationResult>('drug/drugsfda.json', search, 'fda drugsfda')) {
    for (const app of page) {
      const appNo = app.application_number;
      if (!appNo) continue;
      const sponsor = app.sponsor_name ?? null;
      const sponsorNormalized = sponsor ? normalizeCompanyForMatching(sponsor) : null;
      const brand = app.products?.[0]?.brand_name ?? null;
      const submissions = Array.isArray(app.submissions) ? app.submissions : [];
      for (const s of submissions) {
        const subNo = s.submission_number;
        if (!subNo) continue;
        const subDateIso = toIsoDateFromYyyymmdd(s.submission_status_date);
        // Only persist submissions actually within our window (the API
        // returns the whole application even when one nested submission
        // matches, so older nested rows leak in otherwise).
        if (!subDateIso || subDateIso.replace(/-/g, '') < cutoffCompact) continue;
        rows.push({
          application_number: appNo,
          submission_number: subNo,
          sponsor_name: sponsor,
          sponsor_normalized: sponsorNormalized,
          product_brand_name: brand,
          submission_status: s.submission_status ?? null,
          submission_status_date: subDateIso,
          submission_type: s.submission_type ?? null,
          submission_class_code: s.submission_class_code ?? null,
          submission_class_code_description: s.submission_class_code_description ?? null,
          review_priority: s.review_priority ?? null,
          submission_property_type: s.submission_property_type ?? null,
          last_seen_at: startedAt,
        });
      }
    }
  }
  await attachMentionedIds(admin, rows, 'sponsor_name');
  return chunkedUpsert(admin, 'fda_drug_submissions', rows, 'application_number,submission_number');
}

async function syncDevice510k(
  admin: ReturnType<typeof createAdminClient>,
  cutoffCompact: string,
  startedAt: string,
): Promise<number> {
  const today = yyyymmddCompact(new Date());
  const search = `decision_date:[${cutoffCompact} TO ${today}]`;
  const rows: Record<string, unknown>[] = [];
  for await (const page of paginate<Device510kResult>('device/510k.json', search, 'fda 510k')) {
    for (const d of page) {
      if (!d.k_number) continue;
      const applicant = d.applicant ?? null;
      rows.push({
        k_number: d.k_number,
        applicant,
        applicant_normalized: applicant ? normalizeCompanyForMatching(applicant) : null,
        device_name: d.device_name ?? null,
        product_code: d.product_code ?? null,
        decision_code: d.decision_code ?? null,
        decision_description: d.decision_description ?? null,
        decision_date: toIsoDateFromYyyymmdd(d.decision_date),
        last_seen_at: startedAt,
      });
    }
  }
  await attachMentionedIds(admin, rows, 'applicant');
  return chunkedUpsert(admin, 'fda_device_510k', rows, 'k_number');
}

async function syncDevicePma(
  admin: ReturnType<typeof createAdminClient>,
  cutoffCompact: string,
  startedAt: string,
): Promise<number> {
  const today = yyyymmddCompact(new Date());
  const search = `decision_date:[${cutoffCompact} TO ${today}]`;
  const rows: Record<string, unknown>[] = [];
  for await (const page of paginate<DevicePmaResult>('device/pma.json', search, 'fda pma')) {
    for (const d of page) {
      if (!d.pma_number) continue;
      const applicant = d.applicant ?? null;
      rows.push({
        pma_number: d.pma_number,
        supplement_number: d.supplement_number || '',
        applicant,
        applicant_normalized: applicant ? normalizeCompanyForMatching(applicant) : null,
        trade_name: d.trade_name ?? null,
        generic_name: d.generic_name ?? null,
        supplement_type: d.supplement_type ?? null,
        supplement_reason: d.supplement_reason ?? null,
        decision_code: d.decision_code ?? null,
        decision_date: toIsoDateFromYyyymmdd(d.decision_date),
        advisory_committee_description: d.advisory_committee_description ?? null,
        last_seen_at: startedAt,
      });
    }
  }
  await attachMentionedIds(admin, rows, 'applicant');
  return chunkedUpsert(admin, 'fda_device_pma', rows, 'pma_number,supplement_number');
}

export async function syncFdaDelta(opts: {
  admin: ReturnType<typeof createAdminClient>;
  overlapDays?: number;
}): Promise<SyncFdaDeltaResult> {
  const admin = opts.admin;
  const overlapDays = opts.overlapDays ?? DEFAULT_OVERLAP_DAYS;
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const cutoffDate = new Date(Date.now() - overlapDays * 24 * 60 * 60 * 1000);
  const cutoffIsoDate = yyyymmddDashed(cutoffDate);
  const cutoffCompact = yyyymmddCompact(cutoffDate);

  const { data: runRow, error: runInsertErr } = await admin
    .from('fda_delta_sync_runs')
    .insert({ status: 'running', cutoff_date: cutoffIsoDate, started_at: startedAtIso })
    .select('id')
    .single();
  if (runInsertErr) throw new Error(`fda_delta_sync_runs insert: ${runInsertErr.message}`);
  const runId = runRow?.id as string;

  try {
    const [drugSubmissions, device510k, devicePma] = await Promise.all([
      syncDrugSubmissions(admin, cutoffCompact, startedAtIso),
      syncDevice510k(admin, cutoffCompact, startedAtIso),
      syncDevicePma(admin, cutoffCompact, startedAtIso),
    ]);

    const finishedAt = new Date();
    await admin
      .from('fda_delta_sync_runs')
      .update({
        finished_at: finishedAt.toISOString(),
        status: 'success',
        drug_submissions_upserted: drugSubmissions,
        device_510k_upserted: device510k,
        device_pma_upserted: devicePma,
      })
      .eq('id', runId);

    return {
      cutoff_date: cutoffIsoDate,
      drug_submissions_upserted: drugSubmissions,
      device_510k_upserted: device510k,
      device_pma_upserted: devicePma,
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    };
  } catch (error) {
    await admin
      .from('fda_delta_sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: 'failed',
        error: messageFromUnknown(error),
      })
      .eq('id', runId);
    throw error;
  }
}
