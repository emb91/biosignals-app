import { after, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { runDataAcquisitionJob } from '@/lib/data-acquisition/job-runner';

const ACTIVE_JOB_STATUSES = ['discovering', 'processing', 'importing', 'enriching'];

type JobRow = {
  id: string;
  icp_id: string | null;
  upload_batch_id: string | null;
  request_type: string;
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

/** Post-job coverage snapshot the runner writes on completion: how many
 *  companies/contacts the job's ICP holds now. Counts only — never costs. */
function coverageAfterFromMetadata(
  metadata: Record<string, unknown> | null,
): { company_count: number; contact_count: number } | null {
  const receipt = metadata?.coverage_writeback;
  if (!receipt || typeof receipt !== 'object') return null;
  const { current_company_count, current_contact_count } = receipt as {
    current_company_count?: unknown;
    current_contact_count?: unknown;
  };
  if (typeof current_company_count !== 'number' || typeof current_contact_count !== 'number') {
    return null;
  }
  return { company_count: current_company_count, contact_count: current_contact_count };
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

    // NOTE: credit-unit columns are intentionally NOT selected. Costs are
    // internal-only (see app/api/admin/data-costs); the user-facing surface
    // shows counts and plain-language notes instead.
    const { data, error } = await supabase
      .from('data_acquisition_jobs')
      .select(
        `
        id,
        icp_id,
        upload_batch_id,
        request_type,
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

    const jobs = rows.map(({ metadata, ...row }) => ({
      ...row,
      company_name: companyNameFromMetadata(metadata),
      coverage_after: coverageAfterFromMetadata(metadata),
    }));

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('[data-acquisition/jobs]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
