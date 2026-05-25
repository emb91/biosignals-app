import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { runJobChangeMonitor } from '@/lib/signals/run-job-change-monitor';

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

    return NextResponse.json({ success: true, result });
  } catch (err) {
    console.error('[signals/run/job-change] error:', err);
    return NextResponse.json({ error: messageFromUnknown(err) }, { status: 500 });
  }
}
