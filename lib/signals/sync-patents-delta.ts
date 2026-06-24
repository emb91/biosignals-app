/**
 * Sync the last few days of patent publications from BigQuery into the local
 * patent_events / patent_event_assignees mirror.
 *
 * Used by both:
 *  - The daily cron (/api/cron/patents-delta)
 *  - The patents-all admin test button (sync_first flag on /api/signals/run/patents)
 *
 * Streams rows from BigQuery and upserts in batches as they arrive, so partial
 * progress survives a mid-run failure or kill. Dry-runs first for cost
 * visibility + hard cap enforcement; max scan size is bounded by the caller's
 * maxScanBytes or DEFAULT_SCAN_CAP_BYTES.
 */
import { BigQuery } from '@google-cloud/bigquery';
import type { createAdminClient } from '@/lib/supabase-admin';
import { buildCompanyMentionMatches, hasVerifiedCanonicalCompanyMatch } from '@/lib/companies/mention-provenance';

const BIGQUERY_LOCATION = 'US';
const BIGQUERY_PUBLICATIONS_TABLE = 'patents-public-data.patents.publications';
// patents-public-data has a 2-4 week update lag, so an 8-day window often
// returns 0 rows. 45 days = weekly cadence + plenty of buffer for both the
// upstream lag and any cron miss. Scan cost is unchanged (~235 GB regardless
// of window length, since publication_date doesn't prune partitions).
const DEFAULT_OVERLAP_DAYS = 45;
const UPSERT_CHUNK = 500;
// 250 GB cap, ~6% headroom over the ~235 GB realistic scan.
const DEFAULT_SCAN_CAP_BYTES = 250 * 1e9;

let cachedBigQueryClient: BigQuery | null = null;

function getBigQueryClient(): BigQuery {
  if (cachedBigQueryClient) return cachedBigQueryClient;
  const projectId = process.env.GCP_PROJECT_ID;
  const keyBase64 = process.env.GCP_SA_KEY_BASE64;
  if (!projectId) throw new Error('GCP_PROJECT_ID is not set');
  if (!keyBase64) throw new Error('GCP_SA_KEY_BASE64 is not set');
  const parsed = JSON.parse(Buffer.from(keyBase64, 'base64').toString('utf-8')) as {
    client_email?: string;
    private_key?: string;
  };
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GCP_SA_KEY_BASE64 missing client_email or private_key');
  }
  cachedBigQueryClient = new BigQuery({
    projectId,
    credentials: { client_email: parsed.client_email, private_key: parsed.private_key },
  });
  return cachedBigQueryClient;
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
  }
  return String(error);
}

function yyyymmddIntToIsoDate(value: unknown): string | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 19000101) return null;
  const y = Math.floor(n / 10000);
  const m = Math.floor((n % 10000) / 100);
  const d = n % 100;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

function normalizeAssignee(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
    .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|gmbh|ag|sa|nv|pty)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type SyncPatentsDeltaResult = {
  cutoff_date: string;
  publications_upserted: number;
  assignees_upserted: number;
  bytes_billed: number | null;
  estimated_scan_gb: number | null;
  duration_ms: number;
  skipped?: boolean;
  reason?: 'recent_success';
  previous_run_id?: string;
  previous_finished_at?: string;
};

export async function syncPatentsDelta(opts: {
  admin: ReturnType<typeof createAdminClient>;
  overlapDays?: number;
  maxScanBytes?: number;
  reuseRecentSuccessSeconds?: number;
}): Promise<SyncPatentsDeltaResult> {
  const admin = opts.admin;
  const overlapDays = opts.overlapDays ?? DEFAULT_OVERLAP_DAYS;
  const maxScanBytes = Math.max(1, Math.floor(opts.maxScanBytes ?? DEFAULT_SCAN_CAP_BYTES));
  const reuseRecentSuccessSeconds = Math.max(0, opts.reuseRecentSuccessSeconds ?? 0);
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const cutoffDate = new Date(Date.now() - overlapDays * 24 * 60 * 60 * 1000);
  const cutoffIsoDate = cutoffDate.toISOString().slice(0, 10);
  const cutoffYyyymmdd = parseInt(cutoffIsoDate.replace(/-/g, ''), 10);

  if (reuseRecentSuccessSeconds > 0) {
    const freshSince = new Date(startedAt.getTime() - reuseRecentSuccessSeconds * 1000).toISOString();
    const { data: recentSuccess, error: recentErr } = await admin
      .from('patent_delta_sync_runs')
      .select('id, finished_at')
      .eq('status', 'success')
      .eq('cutoff_date', cutoffIsoDate)
      .gte('finished_at', freshSince)
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentErr) throw new Error(`patent_delta_sync_runs recent success lookup failed: ${recentErr.message}`);
    if (recentSuccess?.id && recentSuccess.finished_at) {
      return {
        cutoff_date: cutoffIsoDate,
        publications_upserted: 0,
        assignees_upserted: 0,
        bytes_billed: 0,
        estimated_scan_gb: 0,
        duration_ms: Date.now() - startedAt.getTime(),
        skipped: true,
        reason: 'recent_success',
        previous_run_id: recentSuccess.id as string,
        previous_finished_at: recentSuccess.finished_at as string,
      };
    }
  }

  const { data: runRow, error: runInsertErr } = await admin
    .from('patent_delta_sync_runs')
    .insert({ status: 'running', cutoff_date: cutoffIsoDate, started_at: startedAtIso })
    .select('id')
    .single();
  if (runInsertErr) throw new Error(`patent_delta_sync_runs insert failed: ${runInsertErr.message}`);
  const runId = runRow?.id as string;

  try {
    const bigquery = getBigQueryClient();
    const sql = `
      SELECT
        p.publication_number,
        p.kind_code,
        p.country_code,
        p.publication_date,
        p.filing_date,
        COALESCE(
          (SELECT t.text FROM UNNEST(p.title_localized) t WHERE t.language = 'en' LIMIT 1),
          (SELECT t.text FROM UNNEST(p.title_localized) t LIMIT 1)
        ) AS title,
        COALESCE(
          (SELECT a.text FROM UNNEST(p.abstract_localized) a WHERE a.language = 'en' LIMIT 1),
          (SELECT a.text FROM UNNEST(p.abstract_localized) a LIMIT 1)
        ) AS abstract,
        ARRAY(SELECT ah.name FROM UNNEST(p.assignee_harmonized) ah WHERE ah.name IS NOT NULL) AS assignees
      FROM \`${BIGQUERY_PUBLICATIONS_TABLE}\` p
      WHERE p.publication_date >= @cutoff
    `;

    const [dryJob] = await bigquery.createQueryJob({
      query: sql,
      params: { cutoff: cutoffYyyymmdd },
      types: { cutoff: 'INT64' },
      location: BIGQUERY_LOCATION,
      dryRun: true,
    });
    const dryMeta = dryJob.metadata as
      | { statistics?: { totalBytesProcessed?: string } }
      | undefined;
    const dryBytes = Number(dryMeta?.statistics?.totalBytesProcessed ?? 0);
    const dryGb = dryBytes / 1e9;
    if (dryBytes > maxScanBytes) {
      throw new Error(
        `delta sync aborted: dry-run estimate ${dryGb.toFixed(2)} GB exceeds hard cap ${(
          maxScanBytes / 1e9
        ).toFixed(0)} GB`,
      );
    }

    const stream = bigquery.createQueryStream({
      query: sql,
      params: { cutoff: cutoffYyyymmdd },
      types: { cutoff: 'INT64' },
      location: BIGQUERY_LOCATION,
      maximumBytesBilled: String(maxScanBytes),
    });

    let pubBatch: Record<string, unknown>[] = [];
    let assigneeBatch: Record<string, unknown>[] = [];
    let pubsUpserted = 0;
    let assigneesUpserted = 0;
    const seenAssigneeKeys = new Set<string>();

    const flushPubs = async () => {
      if (pubBatch.length === 0) return;
      const chunk = pubBatch;
      pubBatch = [];
      const { error } = await admin
        .from('patent_events')
        .upsert(chunk, { onConflict: 'publication_number' });
      if (error) throw new Error(`patent_events upsert: ${error.message}`);
      pubsUpserted += chunk.length;
    };
    const flushAssignees = async () => {
      if (assigneeBatch.length === 0) return;
      const chunk = assigneeBatch;
      assigneeBatch = [];

      // Resolve assignee names with provenance. Only verified matches populate
      // canonical_company_id; rejected matches remain in canonical_company_match.
      if (chunk.some((r) => typeof r.assignee_name === 'string' && Boolean(r.assignee_name))) {
        try {
          for (const row of chunk) {
            const name = row.assignee_name as string | null;
            const matches = await buildCompanyMentionMatches(admin, [
              { sourceText: name, sourceField: 'assignee_name' },
            ]);
            const match = matches[0] ?? null;
            row.canonical_company_match = match;
            row.canonical_company_id =
              match?.company_id && hasVerifiedCanonicalCompanyMatch(match, match.company_id)
                ? match.company_id
                : null;
          }
        } catch (e) {
          console.error('[sync-patents] resolver failed for chunk:', e);
          for (const row of chunk) {
            row.canonical_company_match = null;
            row.canonical_company_id = null;
          }
        }
      }

      const { error } = await admin
        .from('patent_event_assignees')
        .upsert(chunk, { onConflict: 'publication_number,assignee_name' });
      if (error) throw new Error(`patent_event_assignees upsert: ${error.message}`);
      assigneesUpserted += chunk.length;
    };

    for await (const row of stream as AsyncIterable<Record<string, unknown>>) {
      const publicationNumber =
        typeof row.publication_number === 'string' ? row.publication_number : '';
      if (!publicationNumber) continue;
      pubBatch.push({
        publication_number: publicationNumber,
        kind_code: typeof row.kind_code === 'string' ? row.kind_code : null,
        country_code: typeof row.country_code === 'string' ? row.country_code : null,
        publication_date: yyyymmddIntToIsoDate(row.publication_date),
        filing_date: yyyymmddIntToIsoDate(row.filing_date),
        title: typeof row.title === 'string' ? row.title : null,
        abstract: typeof row.abstract === 'string' ? row.abstract : null,
        last_seen_at: startedAtIso,
      });
      const assignees = Array.isArray(row.assignees) ? (row.assignees as string[]) : [];
      for (const name of assignees) {
        if (typeof name !== 'string' || !name.trim()) continue;
        const key = `${publicationNumber}::${name}`;
        if (seenAssigneeKeys.has(key)) continue;
        seenAssigneeKeys.add(key);
        assigneeBatch.push({
          publication_number: publicationNumber,
          assignee_name: name,
          assignee_name_normalized: normalizeAssignee(name),
        });
      }
      if (pubBatch.length >= UPSERT_CHUNK) {
        await flushPubs();
        await flushAssignees();
      }
    }
    await flushPubs();
    await flushAssignees();

    const finishedAt = new Date();
    await admin
      .from('patent_delta_sync_runs')
      .update({
        finished_at: finishedAt.toISOString(),
        status: 'success',
        publications_upserted: pubsUpserted,
        assignees_upserted: assigneesUpserted,
        bytes_billed: dryBytes,
      })
      .eq('id', runId);

    return {
      cutoff_date: cutoffIsoDate,
      publications_upserted: pubsUpserted,
      assignees_upserted: assigneesUpserted,
      bytes_billed: dryBytes,
      estimated_scan_gb: dryGb,
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    };
  } catch (error) {
    await admin
      .from('patent_delta_sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: 'failed',
        error: messageFromUnknown(error),
      })
      .eq('id', runId);
    throw error;
  }
}
