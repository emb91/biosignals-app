/**
 * Company enrichment queue worker (deep pass for company-first import).
 *
 * Processes companies with `enrichment_refresh_status = 'requested'` by running
 * the full company enrichment pipeline (Apollo identity + Apify LinkedIn scrape +
 * taxonomy + narrative + funding). This is phase 2 of the company-first import:
 * phase 1 (the import itself) lands every company instantly with a fast Apollo
 * bulk-enrich firmographic pass + preliminary fit and marks it 'requested'; this
 * cron then deepens each one and upgrades the fit to the real biotech score.
 *
 * Why a queue: each company deep-enrichment takes 30–90s (Apify + web_search),
 * so a few-hundred-company import can't finish in one 300s request. The queue
 * drains a bounded chunk per run until empty — no list size loses rows.
 *
 * Cadence: every 5 minutes. Batch size capped (default 3) for the 300s ceiling.
 *
 * Billing: credits (action `company_enrichment`) are reserved + settled PER
 * COMPANY here, so a company that fails to enrich is refunded — the user is only
 * charged for companies that actually enrich.
 *
 * Idempotency: runCompanyEnrichmentById transitions requested → running →
 * succeeded | failed, so a re-run skips rows already 'running'/'succeeded'.
 * Stale 'running' rows (a crashed invocation) are reclaimed back to 'requested'.
 */
import { NextResponse } from 'next/server';
import { observeCron } from '@/lib/cron-observability';
import { createAdminClient } from '@/lib/supabase-admin';
import {
  markCompanyEnrichmentRunning,
  runCompanyEnrichmentById,
} from '@/lib/company-enrichment';
import { syncCompanyFitForCompany } from '@/lib/company-fit';
import { companyEnrichmentCreditDisposition } from '@/lib/company-enrichment-credits';
import { reserveCredits, refundCredits, settleCredits } from '@/lib/billing/credits';
import { refreshMonitoringUniverse } from '@/lib/billing/monitoring';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// A 'running' row older than this is treated as a crashed invocation and
// reclaimed back to the queue.
const STALE_RUNNING_MS = 15 * 60 * 1000;

function messageFromUnknown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function runCron(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const batchSize = Math.max(1, Math.min(10, Number(process.env.COMPANY_ENRICHMENT_QUEUE_BATCH ?? '3')));

  // Reclaim crashed runs: 'running' rows that have been stuck too long go back
  // to 'requested' so they get another pass.
  const staleCutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  await admin
    .from('companies')
    .update({ enrichment_refresh_status: 'requested' })
    .eq('enrichment_refresh_status', 'running')
    .lt('enrichment_refresh_started_at', staleCutoff);

  const { data: pending, error: fetchErr } = await admin
    .from('companies')
    .select('id, enrichment_refresh_started_at')
    .eq('enrichment_refresh_status', 'requested')
    .order('enrichment_refresh_started_at', { ascending: true, nullsFirst: true })
    .limit(batchSize);

  if (fetchErr) {
    console.error('[cron/company-enrichment-queue] fetch failed:', fetchErr);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const pendingRows = (pending ?? []) as Array<{ id: string; enrichment_refresh_started_at: string | null }>;
  if (pendingRows.length === 0) {
    return NextResponse.json({ success: true, processed: 0, queue_empty: true });
  }

  let processed = 0;
  let failed = 0;
  const orgsToRefresh = new Set<string>();
  const failures: Array<{ company_id: string; error: string }> = [];

  for (const row of pendingRows) {
    const companyId = row.id;
    try {
      // Resolve the owning org (for billing) and linked users (for per-user fit).
      const { data: orgLink } = await admin
        .from('org_companies')
        .select('org_id')
        .eq('company_id', companyId)
        .is('archived_at', null)
        .limit(1)
        .maybeSingle<{ org_id: string }>();
      const orgId = orgLink?.org_id ?? null;

      const { data: ucLinks } = await admin
        .from('user_companies')
        .select('user_id')
        .eq('company_id', companyId)
        .is('archived_at', null);
      const userIds = (ucLinks ?? [])
        .map((r) => (r as { user_id: string | null }).user_id)
        .filter((id): id is string => Boolean(id));

      const reservation = orgId
        ? await reserveCredits({
            orgId,
            userId: userIds[0] ?? null,
            action: 'company_enrichment',
            idempotencyKey: `company-deep-enrich:${companyId}:${row.enrichment_refresh_started_at ?? 'na'}`,
            entityType: 'company',
            entityId: companyId,
          })
        : { ok: true as const, transactionId: null };

      if (!reservation.ok) {
        // Not enough credits — leave the firmographic/preliminary data in place,
        // mark the row failed with the reason so it stops looping.
        await admin
          .from('companies')
          .update({
            enrichment_refresh_status: 'failed',
            enrichment_refresh_last_error: reservation.message || 'Not enough credits to enrich this company.',
            enrichment_refresh_finished_at: new Date().toISOString(),
          })
          .eq('id', companyId);
        failed++;
        failures.push({ company_id: companyId, error: 'insufficient_credits' });
        continue;
      }

      await markCompanyEnrichmentRunning(admin, companyId);
      const result = await runCompanyEnrichmentById(admin, companyId);

      if (companyEnrichmentCreditDisposition(result) === 'refund') {
        await refundCredits(reservation.transactionId).catch(() => {});
      } else {
        await settleCredits(reservation.transactionId).catch(() => {});
      }

      // Upgrade each linked user's fit now that taxonomy is populated.
      for (const uid of userIds) {
        await syncCompanyFitForCompany(admin, uid, companyId).catch(() => {});
      }
      if (orgId) orgsToRefresh.add(orgId);

      if (result.status === 'succeeded') processed++;
      else {
        failed++;
        failures.push({ company_id: companyId, error: result.error || 'enrichment_failed' });
      }
    } catch (err) {
      const msg = messageFromUnknown(err);
      console.error(`[cron/company-enrichment-queue] company ${companyId} failed:`, msg);
      failed++;
      failures.push({ company_id: companyId, error: msg });
      try {
        await admin
          .from('companies')
          .update({
            enrichment_refresh_status: 'failed',
            enrichment_refresh_last_error: msg.slice(0, 1000),
            enrichment_refresh_finished_at: new Date().toISOString(),
          })
          .eq('id', companyId);
      } catch {
        /* swallow secondary failure */
      }
    }
  }

  for (const orgId of orgsToRefresh) {
    await refreshMonitoringUniverse(orgId).catch(() => {});
  }

  return NextResponse.json({ success: true, batch_size: batchSize, processed, failed, failures });
}

export const GET = observeCron('company-enrichment-queue', runCron);
