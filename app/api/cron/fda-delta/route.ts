/**
 * Weekly FDA delta sync — Vercel cron entrypoint.
 *
 * Wraps the shared syncFdaDelta() function. Runs every Tuesday morning
 * (FDA Drug Approvals publish Tuesdays).
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { syncFdaDelta } from '@/lib/signals/sync-fda-delta';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const admin = createAdminClient();
    const result = await syncFdaDelta({ admin });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
