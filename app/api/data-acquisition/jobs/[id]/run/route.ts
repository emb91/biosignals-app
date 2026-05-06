import { after, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { runDataAcquisitionJob } from '@/lib/data-acquisition/job-runner';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: job, error } = await supabase
      .from('data_acquisition_jobs')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (error || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const backgroundTask = () =>
      runDataAcquisitionJob(id).catch((err) => {
        console.error('[data-acquisition/jobs/run] job failed', err);
      });

    if (process.env.NODE_ENV === 'development') {
      setTimeout(() => {
        void backgroundTask();
      }, 0);
    } else {
      after(backgroundTask);
    }

    return NextResponse.json({ jobId: id, status: 'started' });
  } catch (error) {
    console.error('[data-acquisition/jobs/run]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
