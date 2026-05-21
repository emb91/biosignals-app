import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { processActiveSecBackfillJob } from '@/lib/signals/sec-backfill';
import { runPendingCikCatchups } from '@/lib/signals/sec-per-cik-backfill';

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
    // Priority: chunked global backfill > per-CIK 8-K catch-up.
    // We do AT MOST one of these per cron tick so the 300s maxDuration is
    // never at risk. Per-CIK catch-ups drain naturally during the idle
    // window after a 90-day chunked backfill completes.
    const job = await processActiveSecBackfillJob(admin);
    if (job) {
      return NextResponse.json({
        success: true,
        processed: 'chunked_backfill',
        job,
      });
    }
    const catchUps = await runPendingCikCatchups(admin);
    return NextResponse.json({
      success: true,
      processed: 'per_cik_catchup',
      catch_ups: catchUps,
    });
  } catch (error) {
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
