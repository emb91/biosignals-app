import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { isAdminEmail } from '@/lib/admin-access';
import { createAdminClient } from '@/lib/supabase-admin';
import {
  cancelSecBackfillJob,
  createSecBackfillJob,
  loadLatestSecBackfillJob,
  loadSecBackfillLogs,
} from '@/lib/signals/sec-backfill';

type CreateBackfillBody = {
  start_date?: string;
  end_date?: string;
  chunk_business_days?: number;
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function requireAdminUser() {
  const authClient = await createClient();
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser();
  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!isAdminEmail(user.email)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { user };
}

export async function GET(request: Request) {
  const auth = await requireAdminUser();
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get('action') === 'cancel') {
      const jobId = searchParams.get('job_id');
      if (!jobId) {
        return NextResponse.json({ error: 'Missing job_id' }, { status: 400 });
      }
      const admin = createAdminClient();
      const job = await cancelSecBackfillJob(admin, jobId);
      const logs = await loadSecBackfillLogs(admin, job.id);
      return NextResponse.json({ job, logs });
    }
    if (searchParams.get('action') === 'start') {
      const admin = createAdminClient();
      const job = await createSecBackfillJob(admin, {
        userId: auth.user.id,
        startDate: searchParams.get('start_date') ?? undefined,
        endDate: searchParams.get('end_date') ?? undefined,
        chunkBusinessDays: searchParams.get('chunk_business_days')
          ? Number(searchParams.get('chunk_business_days'))
          : undefined,
      });
      const logs = await loadSecBackfillLogs(admin, job.id);
      return NextResponse.json({ job, logs });
    }
    const afterIdRaw = searchParams.get('after_id');
    const afterId = afterIdRaw ? Number(afterIdRaw) : undefined;
    const admin = createAdminClient();
    const job = await loadLatestSecBackfillJob(admin);
    const logs = job ? await loadSecBackfillLogs(admin, job.id, Number.isFinite(afterId) ? afterId : undefined) : [];
    return NextResponse.json({ job, logs });
  } catch (error) {
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminUser();
  if ('error' in auth) return auth.error;

  try {
    const body = (await request.json().catch(() => ({}))) as CreateBackfillBody;
    const admin = createAdminClient();
    const job = await createSecBackfillJob(admin, {
      userId: auth.user.id,
      startDate: body.start_date,
      endDate: body.end_date,
      chunkBusinessDays: body.chunk_business_days,
    });
    const logs = await loadSecBackfillLogs(admin, job.id);
    return NextResponse.json({ job, logs });
  } catch (error) {
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
