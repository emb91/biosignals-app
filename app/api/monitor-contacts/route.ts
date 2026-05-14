import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { runExternalContactMonitor } from '@/lib/signals/run-external-contact-monitor';

type MonitorContactsBody = {
  contact_ids?: string[];
  limit?: number;
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (typeof obj.details === 'string' && obj.details) return obj.details;
  }
  return 'Internal server error';
}

export async function POST(request: Request) {
  try {
    const authClient = await createClient();
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as MonitorContactsBody;
    const result = await runExternalContactMonitor({
      userId: user.id,
      contactIds: body.contact_ids,
      limit: body.limit,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[monitor-contacts] error:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
