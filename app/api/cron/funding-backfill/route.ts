import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { processActiveSecBackfillJob } from '@/lib/signals/sec-backfill';
import { runPendingCikCatchups } from '@/lib/signals/sec-per-cik-backfill';
import { runPendingSecClassifications } from '@/lib/signals/classify-pending-sec-filings';

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
    // Priority: chunked global backfill > per-CIK 8-K catch-up > LLM
    // classification sweep. At most one phase per cron tick so the 300s
    // maxDuration is never at risk. Catch-ups and classifications drain
    // naturally during the idle window after a 90-day chunked backfill
    // completes.
    const job = await processActiveSecBackfillJob(admin);
    if (job) {
      return NextResponse.json({
        success: true,
        processed: 'chunked_backfill',
        job,
      });
    }
    const catchUps = await runPendingCikCatchups(admin);
    if (catchUps.processed > 0 || catchUps.rate_limit_halted) {
      return NextResponse.json({
        success: true,
        processed: 'per_cik_catchup',
        catch_ups: catchUps,
      });
    }
    // No chunked job and no pending catch-ups → drain the LLM classification
    // queue for V1-era rows and any past-failed LLM calls. Caps the per-tick
    // work to a small batch so we stay well under maxDuration.
    const classifications = await runPendingSecClassifications(admin, 12);
    return NextResponse.json({
      success: true,
      processed: 'llm_classification_sweep',
      catch_ups: catchUps,
      classifications,
    });
  } catch (error) {
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
