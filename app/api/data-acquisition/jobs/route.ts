import { after, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { runDataAcquisitionJob } from '@/lib/data-acquisition/job-runner';

const ACTIVE_JOB_STATUSES = ['discovering', 'processing', 'importing', 'enriching'];

type JobRow = {
  id: string;
  icp_id: string | null;
  upload_batch_id: string | null;
  request_type: string;
  source_strategy: string | null;
  status: string;
  target_company_count: number | null;
  target_contact_count: number | null;
  screened_company_count: number | null;
  discovered_company_count: number | null;
  qualified_company_count: number | null;
  imported_company_count: number | null;
  discovered_contact_count: number | null;
  enriched_contact_count: number | null;
  imported_contact_count: number | null;
  skipped_duplicate_count: number | null;
  skipped_existing_count: number | null;
  rejected_low_fit_count: number | null;
  estimated_min_credit_units: number | string | null;
  estimated_max_credit_units: number | string | null;
  actual_credit_units: number | string | null;
  completion_note: string | null;
  metadata: Record<string, unknown> | null;
  error: string | null;
  requested_at: string | null;
  started_at: string | null;
  completed_at: string | null;
};

function companyNameFromMetadata(metadata: Record<string, unknown> | null): string | null {
  const company = metadata?.company;
  if (!company || typeof company !== 'object') return null;
  const name = (company as { company_name?: unknown }).company_name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('data_acquisition_jobs')
      .select(
        `
        id,
        icp_id,
        upload_batch_id,
        request_type,
        source_strategy,
        status,
        target_company_count,
        target_contact_count,
        screened_company_count,
        discovered_company_count,
        qualified_company_count,
        imported_company_count,
        discovered_contact_count,
        enriched_contact_count,
        imported_contact_count,
        skipped_duplicate_count,
        skipped_existing_count,
        rejected_low_fit_count,
        estimated_min_credit_units,
        estimated_max_credit_units,
        actual_credit_units,
        completion_note,
        metadata,
        error,
        requested_at,
        started_at,
        completed_at
      `,
      )
      .eq('user_id', user.id)
      .order('requested_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[data-acquisition/jobs] list', error);
      return NextResponse.json({ error: 'Failed to load acquisition jobs' }, { status: 500 });
    }

    const rows = (data || []) as JobRow[];
    const jobIds = rows.map((row) => row.id);
    const usageByJob = new Map<string, number>();
    if (jobIds.length > 0) {
      const { data: usageRows, error: usageError } = await supabase
        .from('data_acquisition_usage_events')
        .select('job_id, internal_credit_units')
        .in('job_id', jobIds);

      if (usageError) {
        console.error('[data-acquisition/jobs] usage', usageError);
      } else {
        for (const usage of usageRows ?? []) {
          const jobId = (usage as { job_id?: unknown }).job_id;
          const rawUnits = (usage as { internal_credit_units?: unknown }).internal_credit_units;
          const units =
            typeof rawUnits === 'number'
              ? rawUnits
              : typeof rawUnits === 'string'
                ? Number.parseFloat(rawUnits)
                : 0;
          if (typeof jobId === 'string' && Number.isFinite(units)) {
            usageByJob.set(jobId, Math.round(((usageByJob.get(jobId) ?? 0) + units) * 100) / 100);
          }
        }
      }
    }

    // Queue safety net: jobs run strictly sequentially per user, advanced at
    // the end of each run. If a previous process died mid-run nothing would
    // ever advance the queue, so when polling finds queued jobs with nothing
    // running, kick the oldest. runDataAcquisitionJob's atomic
    // queued -> discovering claim guards against double-starts.
    const anyActive = rows.some((row) => ACTIVE_JOB_STATUSES.includes(row.status));
    const queuedRows = rows.filter((row) => row.status === 'queued');
    if (!anyActive && queuedRows.length > 0) {
      const oldestQueued = queuedRows.reduce((oldest, row) =>
        (row.requested_at ?? '') < (oldest.requested_at ?? '') ? row : oldest,
      );
      const kick = () =>
        runDataAcquisitionJob(oldestQueued.id).catch((err) => {
          console.error('[data-acquisition/jobs] queue recovery kick failed', err);
        });
      if (process.env.NODE_ENV === 'development') {
        setTimeout(() => {
          void kick();
        }, 0);
      } else {
        after(kick);
      }
    }

    const jobs = rows.map(({ metadata, ...row }) => {
      const eventActual = usageByJob.get(row.id);
      return {
        ...row,
        actual_credit_units: eventActual ?? row.actual_credit_units ?? null,
        company_name: companyNameFromMetadata(metadata),
      };
    });

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('[data-acquisition/jobs]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
