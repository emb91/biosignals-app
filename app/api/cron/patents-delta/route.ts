/**
 * Daily patent-events delta sync — Vercel cron entrypoint.
 *
 * Wraps the shared syncPatentsDelta() function so the same code runs both for
 * the scheduled daily cron and for the admin "patents-all" button's optional
 * sync_first step.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { syncPatentsDelta } from '@/lib/signals/sync-patents-delta';

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
    const result = await syncPatentsDelta({ admin });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
