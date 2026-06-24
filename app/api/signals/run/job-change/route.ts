import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';
import { runJobChangeMonitor } from '@/lib/signals/run-job-change-monitor';
import { persistRunHistory } from '@/lib/signals/run-history';

function messageFromUnknown(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function POST(request: Request) {
  try {
    const authClient = await createClient();
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      contact_ids?: string[];
      limit?: number;
    };

    const result = await runJobChangeMonitor({
      userId: user.id,
      contactIds: body.contact_ids,
      limit: body.limit ?? 20,
    });
    await persistRunHistory(createAdminClient(), {
      userId: user.id,
      signalKey: 'job_change_all',
      runner: 'job_change',
      scope: 'contact',
      status: result.failed > 0 ? 'failed' : 'success',
      processed: result.processed,
      failed: result.failed,
      emittedSignalTypes: result.emitted_signal_types,
      recomputedCompanies: result.recomputed_contacts,
      failures: result.failures.map((failure) => ({
        entity_type: 'contact',
        entity_id: failure.contact_id,
        error: failure.error,
      })),
      contactIds: body.contact_ids,
      limitValue: body.limit ?? 20,
      trigger: 'button',
    });

    return NextResponse.json({ success: true, result });
  } catch (err) {
    console.error('[signals/run/job-change] error:', err);
    return NextResponse.json({ error: messageFromUnknown(err) }, { status: 500 });
  }
}
