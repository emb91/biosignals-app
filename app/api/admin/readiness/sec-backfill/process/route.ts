import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { isAdminEmail } from '@/lib/admin-access';
import { createAdminClient } from '@/lib/supabase-admin';
import { loadSecBackfillLogs, processActiveSecBackfillJob } from '@/lib/signals/sec-backfill';

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function POST() {
  const authClient = await createClient();
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const admin = createAdminClient();
    const job = await processActiveSecBackfillJob(admin);
    const logs = job ? await loadSecBackfillLogs(admin, job.id) : [];
    return NextResponse.json({ job, logs });
  } catch (processError) {
    return NextResponse.json({ error: messageFromUnknown(processError) }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
