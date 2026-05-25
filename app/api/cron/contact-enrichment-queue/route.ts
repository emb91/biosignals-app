/**
 * Contact enrichment queue worker.
 *
 * Processes contacts with `enrichment_refresh_status = 'requested'` by running
 * the full contact resolution pipeline (Apollo + LinkedIn + LLM classification
 * + fit + company monitor for the resolved employer).
 *
 * Marked 'requested' by:
 *   - The user-facing /api/enrich/[id] refresh button (existing flow)
 *   - The contact-job-change cron when a `recently_changed_company` signal
 *     fires (new: Kumar moves Enzene → Illumina ⇒ both the contact and the
 *     new company stub need a fresh enrichment pass).
 *
 * Cadence: every 10 minutes (`*\/10 * * * *`). Batch size capped (default 3)
 * because each contact resolution can take 30–60s and we have a 300s ceiling.
 *
 * Idempotency: the pipeline itself transitions
 *   requested → running → completed | failed
 * so a re-run on the same row is a no-op (the pipeline returns early when
 * `enrichment_refresh_status` is already 'running').
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { runContactResolutionPipelineForContact } from '@/lib/enrichment-pipeline';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function messageFromUnknown(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const batchSize = Math.max(
    1,
    Math.min(10, Number(process.env.CONTACT_ENRICHMENT_QUEUE_BATCH ?? '3')),
  );

  // Pick oldest-requested contacts. Sort by updated_at so contacts that have
  // been waiting longest get processed first.
  const { data: pending, error: fetchErr } = await admin
    .from('contacts')
    .select('id, user_id, updated_at')
    .eq('enrichment_refresh_status', 'requested')
    .is('archived_at', null)
    .order('updated_at', { ascending: true, nullsFirst: true })
    .limit(batchSize);

  if (fetchErr) {
    console.error('[cron/contact-enrichment-queue] fetch failed:', fetchErr);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const pendingRows = (pending ?? []) as Array<{
    id: string;
    user_id: string;
    updated_at: string | null;
  }>;

  if (pendingRows.length === 0) {
    return NextResponse.json({ success: true, processed: 0, queue_empty: true });
  }

  let processed = 0;
  let failed = 0;
  const failures: Array<{ contact_id: string; error: string }> = [];

  for (const row of pendingRows) {
    try {
      // The pipeline transitions enrichment_refresh_status itself
      // (requested → running → completed/failed). It also calls
      // runCompanyMonitor for the resolved employer (the new Illumina stub
      // in the job-change case), so we don't need a separate company step.
      await runContactResolutionPipelineForContact(
        admin as unknown as Parameters<typeof runContactResolutionPipelineForContact>[0],
        {
          contactId: row.id,
          userId: row.user_id,
          emitExternalSignals: true,
        },
      );
      processed++;
    } catch (err) {
      const msg = messageFromUnknown(err);
      console.error(
        `[cron/contact-enrichment-queue] contact ${row.id} failed:`,
        msg,
      );
      failed++;
      failures.push({ contact_id: row.id, error: msg });

      // Best-effort: mark the row failed so it doesn't loop forever on the
      // same poisoned input. The pipeline normally does this itself; this
      // catches the edge case where it threw before transitioning the row.
      try {
        await admin
          .from('contacts')
          .update({
            enrichment_refresh_status: 'failed',
            enrichment_refresh_last_error: msg.slice(0, 1000),
            enrichment_refresh_finished_at: new Date().toISOString(),
          })
          .eq('id', row.id);
      } catch {
        /* swallow secondary failure */
      }
    }
  }

  return NextResponse.json({
    success: true,
    batch_size: batchSize,
    processed,
    failed,
    failures,
  });
}
