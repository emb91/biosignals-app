import { createAdminClient } from '@/lib/supabase-admin';
import { ensureTrackedCompanyCiks } from '@/lib/signals/company-cik';
import { syncSecDelta } from '@/lib/signals/sync-sec-delta';

const DEFAULT_BACKFILL_DAYS = 90;
const DEFAULT_CHUNK_BUSINESS_DAYS = 5;

export type SecBackfillJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'halted_rate_limit'
  | 'cancelled';

export type SecBackfillJobRow = {
  id: string;
  status: SecBackfillJobStatus;
  requested_by_user_id: string | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  start_date: string;
  end_date: string;
  next_date: string;
  last_processed_date: string | null;
  days_processed: number;
  days_skipped_no_data: number;
  filings_upserted: number;
  form_d_upserted: number;
  form_8k_upserted: number;
  form_424b_upserted: number;
  chunks_completed: number;
  requested_chunk_business_days: number;
  rate_limit_halted: boolean;
  worker_claimed_at: string | null;
  last_error: string | null;
};

export type SecBackfillJobLogRow = {
  id: number;
  job_id: string;
  created_at: string;
  level: string;
  message: string;
};

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDate(text: string): Date {
  return new Date(`${text}T00:00:00Z`);
}

function addUtcDays(text: string, days: number): string {
  const date = utcDate(text);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function isWeekendUtc(text: string): boolean {
  const date = utcDate(text);
  const dow = date.getUTCDay();
  return dow === 0 || dow === 6;
}

function nextBusinessDateInclusive(text: string): string {
  let cursor = text;
  while (isWeekendUtc(cursor)) {
    cursor = addUtcDays(cursor, 1);
  }
  return cursor;
}

function chunkEndBusinessDate(startDate: string, finalDate: string, maxBusinessDays: number): string {
  let cursor = nextBusinessDateInclusive(startDate);
  let remaining = Math.max(1, maxBusinessDays);
  let lastIncluded = cursor;

  while (remaining > 0 && utcDate(cursor).getTime() <= utcDate(finalDate).getTime()) {
    if (!isWeekendUtc(cursor)) {
      lastIncluded = cursor;
      remaining -= 1;
      if (remaining === 0) break;
    }
    cursor = addUtcDays(cursor, 1);
  }

  if (utcDate(lastIncluded).getTime() > utcDate(finalDate).getTime()) {
    return finalDate;
  }
  return lastIncluded;
}

function listBusinessDatesInclusive(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cursor = nextBusinessDateInclusive(startDate);
  while (utcDate(cursor).getTime() <= utcDate(endDate).getTime()) {
    if (!isWeekendUtc(cursor)) dates.push(cursor);
    cursor = addUtcDays(cursor, 1);
  }
  return dates;
}

function defaultBackfillStartDate(now = new Date()): string {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  return toIsoDate(start);
}

function defaultBackfillEndDate(now = new Date()): string {
  return toIsoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

type AdminClient = ReturnType<typeof createAdminClient>;

export async function appendSecBackfillLog(
  admin: AdminClient,
  jobId: string,
  message: string,
  level = 'info',
): Promise<void> {
  const { error } = await admin.from('sec_backfill_job_logs').insert({
    job_id: jobId,
    level,
    message,
  });
  if (error) {
    console.error(`[sec-backfill] log insert failed for ${jobId}:`, error);
  }
}

export async function loadLatestSecBackfillJob(
  admin: AdminClient,
): Promise<SecBackfillJobRow | null> {
  const { data, error } = await admin
    .from('sec_backfill_jobs')
    .select('*')
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`loadLatestSecBackfillJob: ${error.message}`);
  return (data as SecBackfillJobRow | null) ?? null;
}

export async function loadActiveSecBackfillJob(
  admin: AdminClient,
): Promise<SecBackfillJobRow | null> {
  const staleIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('sec_backfill_jobs')
    .select('*')
    .in('status', ['queued', 'running'])
    .or(`worker_claimed_at.is.null,worker_claimed_at.lt.${staleIso}`)
    .order('requested_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`loadActiveSecBackfillJob: ${error.message}`);
  return (data as SecBackfillJobRow | null) ?? null;
}

export async function loadOpenSecBackfillJob(
  admin: AdminClient,
): Promise<SecBackfillJobRow | null> {
  const { data, error } = await admin
    .from('sec_backfill_jobs')
    .select('*')
    .in('status', ['queued', 'running'])
    .order('requested_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`loadOpenSecBackfillJob: ${error.message}`);
  return (data as SecBackfillJobRow | null) ?? null;
}

export async function cancelSecBackfillJob(
  admin: AdminClient,
  jobId: string,
): Promise<SecBackfillJobRow> {
  const { data, error } = await admin
    .from('sec_backfill_jobs')
    .update({
      status: 'cancelled',
      finished_at: new Date().toISOString(),
      worker_claimed_at: null,
      last_error: null,
    })
    .eq('id', jobId)
    .in('status', ['queued', 'running'])
    .select('*')
    .single();
  if (error) throw new Error(`cancelSecBackfillJob: ${error.message}`);

  const job = data as SecBackfillJobRow;
  await appendSecBackfillLog(admin, job.id, 'SEC backfill cancelled by admin request.', 'warn');
  return job;
}

export async function loadSecBackfillLogs(
  admin: AdminClient,
  jobId: string,
  afterId?: number,
): Promise<SecBackfillJobLogRow[]> {
  let query = admin
    .from('sec_backfill_job_logs')
    .select('id, job_id, created_at, level, message')
    .eq('job_id', jobId)
    .order('id', { ascending: true })
    .limit(200);
  if (typeof afterId === 'number') {
    query = query.gt('id', afterId);
  }
  const { data, error } = await query;
  if (error) throw new Error(`loadSecBackfillLogs: ${error.message}`);
  return (data ?? []) as SecBackfillJobLogRow[];
}

export async function createSecBackfillJob(
  admin: AdminClient,
  input: {
    userId: string;
    startDate?: string;
    endDate?: string;
    chunkBusinessDays?: number;
  },
): Promise<SecBackfillJobRow> {
  const existing = await loadOpenSecBackfillJob(admin);
  if (existing) return existing;

  const startDate = nextBusinessDateInclusive(input.startDate ?? defaultBackfillStartDate());
  const endDate = input.endDate ?? defaultBackfillEndDate();
  const chunkBusinessDays = Math.max(1, Math.trunc(input.chunkBusinessDays ?? DEFAULT_CHUNK_BUSINESS_DAYS));
  if (utcDate(startDate).getTime() > utcDate(endDate).getTime()) {
    throw new Error(`SEC backfill start_date ${startDate} is after end_date ${endDate}`);
  }

  const { data, error } = await admin
    .from('sec_backfill_jobs')
    .insert({
      requested_by_user_id: input.userId,
      status: 'queued',
      start_date: startDate,
      end_date: endDate,
      next_date: startDate,
      requested_chunk_business_days: chunkBusinessDays,
    })
    .select('*')
    .single();
  if (error) throw new Error(`createSecBackfillJob: ${error.message}`);

  const job = data as SecBackfillJobRow;
  await appendSecBackfillLog(
    admin,
    job.id,
    `Queued SEC backfill for ${job.start_date}..${job.end_date} in ${job.requested_chunk_business_days}-business-day chunks.`,
  );
  return job;
}

export async function processSecBackfillJobChunk(
  admin: AdminClient,
  job: SecBackfillJobRow,
): Promise<SecBackfillJobRow> {
  const activeStart = nextBusinessDateInclusive(job.next_date);
  if (utcDate(activeStart).getTime() > utcDate(job.end_date).getTime()) {
    const { data, error } = await admin
      .from('sec_backfill_jobs')
      .update({
        status: 'completed',
        finished_at: new Date().toISOString(),
        worker_claimed_at: null,
      })
      .eq('id', job.id)
      .select('*')
      .single();
    if (error) throw new Error(`completeSecBackfillJob: ${error.message}`);
    await appendSecBackfillLog(admin, job.id, 'SEC backfill already complete.');
    return data as SecBackfillJobRow;
  }

  const chunkEnd = chunkEndBusinessDate(activeStart, job.end_date, job.requested_chunk_business_days);
  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: claimedRows, error: claimError } = await admin
    .from('sec_backfill_jobs')
    .update({
      status: 'running',
      started_at: job.started_at ?? nowIso,
      last_error: null,
      rate_limit_halted: false,
      worker_claimed_at: nowIso,
    })
    .eq('id', job.id)
    .or(`worker_claimed_at.is.null,worker_claimed_at.lt.${staleIso}`)
    .select('id');
  if (claimError) throw new Error(`claimSecBackfillJob: ${claimError.message}`);
  if (Array.isArray(claimedRows) && claimedRows.length === 0) {
    throw new Error(`claimSecBackfillJob: job ${job.id} is already claimed by another worker`);
  }

  await appendSecBackfillLog(admin, job.id, `Starting chunk ${activeStart}..${chunkEnd}.`);

  try {
    const cikPriming = await ensureTrackedCompanyCiks(admin);
    await appendSecBackfillLog(
      admin,
      job.id,
      `CIK priming complete: processed=${cikPriming.processed} resolved=${cikPriming.resolved} failed=${cikPriming.failed}.`,
    );
    const businessDates = listBusinessDatesInclusive(activeStart, chunkEnd);
    // Explicit annotation so later `running = data as SecBackfillJobRow`
    // assignments don't get narrowed to the object-literal type and reject
    // nullable fields (started_at, worker_claimed_at, last_error) on rebind.
    let running: SecBackfillJobRow = {
      ...job,
      status: 'running',
      started_at: job.started_at ?? nowIso,
      worker_claimed_at: nowIso,
      last_error: null,
      rate_limit_halted: false,
    };

    for (const day of businessDates) {
      const { data: latestRow, error: latestError } = await admin
        .from('sec_backfill_jobs')
        .select('*')
        .eq('id', job.id)
        .single();
      if (latestError) throw new Error(`reloadSecBackfillJob: ${latestError.message}`);
      if ((latestRow as SecBackfillJobRow).status === 'cancelled') {
        await appendSecBackfillLog(admin, job.id, 'Stopping chunk processing because the job was cancelled.', 'warn');
        return latestRow as SecBackfillJobRow;
      }

      await appendSecBackfillLog(admin, job.id, `Processing filing day ${day}.`);
      const result = await syncSecDelta({
        admin,
        startDate: day,
        endDate: day,
      });

      const nextDate = addUtcDays(day, 1);
      const halted = result.rate_limit_halted;
      const isFinalDayInChunk = day === chunkEnd;
      const isComplete = utcDate(nextDate).getTime() > utcDate(job.end_date).getTime();
      const shouldReleaseWorker = halted || isComplete || isFinalDayInChunk;

      const { data, error } = await admin
        .from('sec_backfill_jobs')
        .update({
          status: halted ? 'halted_rate_limit' : isComplete ? 'completed' : 'running',
          finished_at: halted || isComplete ? new Date().toISOString() : null,
          next_date: nextDate,
          last_processed_date: day,
          days_processed: running.days_processed + result.days_processed,
          days_skipped_no_data: running.days_skipped_no_data + result.days_skipped_no_data,
          filings_upserted: running.filings_upserted + result.filings_upserted,
          form_d_upserted: running.form_d_upserted + result.form_d_upserted,
          form_8k_upserted: running.form_8k_upserted + result.form_8k_upserted,
          form_424b_upserted: running.form_424b_upserted + result.form_424b_upserted,
          chunks_completed: running.chunks_completed + (isFinalDayInChunk ? 1 : 0),
          rate_limit_halted: halted,
          worker_claimed_at: shouldReleaseWorker ? null : nowIso,
          last_error: null,
        })
        .eq('id', job.id)
        .select('*')
        .single();
      if (error) throw new Error(`updateSecBackfillJob: ${error.message}`);

      running = data as SecBackfillJobRow;
      await appendSecBackfillLog(
        admin,
        job.id,
        `Finished filing day ${day}: filings=${result.filings_upserted} form_d=${result.form_d_upserted} 8k=${result.form_8k_upserted} 424b=${result.form_424b_upserted} skipped_days=${result.days_skipped_no_data}.`,
      );

      if (halted) {
        await appendSecBackfillLog(admin, job.id, 'SEC backfill halted due to SEC rate limiting.', 'warn');
        return running;
      }
      if (isComplete) {
        await appendSecBackfillLog(admin, job.id, 'SEC backfill completed.');
        return running;
      }
    }

    await appendSecBackfillLog(
      admin,
      job.id,
      `Finished chunk ${activeStart}..${chunkEnd}. Next chunk will begin at ${running.next_date}.`,
    );
    return running;
  } catch (error) {
    const message = messageFromUnknown(error);
    const { data: failedRow, error: updateError } = await admin
      .from('sec_backfill_jobs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        worker_claimed_at: null,
        last_error: message,
      })
      .eq('id', job.id)
      .select('*')
      .single();
    if (updateError) throw new Error(`failSecBackfillJob: ${updateError.message}`);
    await appendSecBackfillLog(admin, job.id, `Chunk failed: ${message}`, 'error');
    return failedRow as SecBackfillJobRow;
  }
}

export async function processActiveSecBackfillJob(
  admin: AdminClient,
): Promise<SecBackfillJobRow | null> {
  const job = await loadActiveSecBackfillJob(admin);
  if (!job) return null;
  return processSecBackfillJobChunk(admin, job);
}
