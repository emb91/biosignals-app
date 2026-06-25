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
 * COMPANY here. Company import may pre-reserve with the same idempotency key;
 * reserveCredits then returns that existing reservation instead of charging
 * twice. A company that fails to enrich is refunded, so the user is only charged
 * for companies that actually enrich.
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
import { runHeadcountSignalForCompany } from '@/lib/signals/run-headcount-monitor';
import { recomputeAccountReadiness } from '@/lib/signals/readiness-service';
import { companyEnrichmentCreditDisposition } from '@/lib/company-enrichment-credits';
import { reserveCredits, refundCredits, settleCredits, type CreditReservation } from '@/lib/billing/credits';
import { refreshMonitoringUniverse } from '@/lib/billing/monitoring';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// A 'running' row older than this is treated as a crashed invocation and
// reclaimed back to the queue.
const STALE_RUNNING_MS = 15 * 60 * 1000;
const STALE_IDLE_RESERVATION_MS = 20 * 60 * 1000;

function messageFromUnknown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function reconcileFinalizedCompanyReservations(admin: ReturnType<typeof createAdminClient>) {
  const { data: transactions, error } = await admin
    .from('org_credit_transactions')
    .select('id, entity_id, created_at')
    .eq('action_type', 'company_enrichment')
    .eq('entity_type', 'company')
    .eq('status', 'pending')
    .not('entity_id', 'is', null)
    .limit(100);

  if (error) {
    console.error('[cron/company-enrichment-queue] reservation reconciliation fetch failed:', error);
    return { settled: 0, refunded: 0, stale_refunded: 0 };
  }

  const pendingReservations = (transactions ?? []) as Array<{ id: string; entity_id: string | null; created_at: string | null }>;
  const companyIds = [...new Set(pendingReservations.map((tx) => tx.entity_id).filter((id): id is string => Boolean(id)))];
  if (companyIds.length === 0) return { settled: 0, refunded: 0, stale_refunded: 0 };

  const { data: companies, error: companyError } = await admin
    .from('companies')
    .select('id, enrichment_refresh_status')
    .in('id', companyIds);
  if (companyError) {
    console.error('[cron/company-enrichment-queue] reservation reconciliation company fetch failed:', companyError);
    return { settled: 0, refunded: 0, stale_refunded: 0 };
  }

  const statusByCompanyId = new Map(
    ((companies ?? []) as Array<{ id: string; enrichment_refresh_status: string | null }>).map((company) => [
      company.id,
      company.enrichment_refresh_status,
    ]),
  );
  let settled = 0;
  let refunded = 0;
  let staleRefunded = 0;
  const staleIdleCutoff = Date.now() - STALE_IDLE_RESERVATION_MS;

  for (const tx of pendingReservations) {
    const status = tx.entity_id ? statusByCompanyId.get(tx.entity_id) : null;
    if (status === 'succeeded') {
      await settleCredits(tx.id).then(() => {
        settled++;
      }).catch((settleError) => {
        console.error('[cron/company-enrichment-queue] reservation reconciliation settle failed:', settleError);
      });
    } else if (status === 'failed' || status === 'cancelled') {
      await refundCredits(tx.id).then(() => {
        refunded++;
      }).catch((refundError) => {
        console.error('[cron/company-enrichment-queue] reservation reconciliation refund failed:', refundError);
      });
    } else if ((status == null || status === 'idle') && tx.created_at && new Date(tx.created_at).getTime() < staleIdleCutoff) {
      await refundCredits(tx.id).then(() => {
        staleRefunded++;
      }).catch((refundError) => {
        console.error('[cron/company-enrichment-queue] stale reservation reconciliation refund failed:', refundError);
      });
    }
  }

  return { settled, refunded, stale_refunded: staleRefunded };
}

async function runCron(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const batchSize = Math.max(1, Math.min(10, Number(process.env.COMPANY_ENRICHMENT_QUEUE_BATCH ?? '3')));
  const reservationRecovery = await reconcileFinalizedCompanyReservations(admin);

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
    return NextResponse.json({ success: true, processed: 0, queue_empty: true, reservation_recovery: reservationRecovery });
  }

  let processed = 0;
  let failed = 0;
  const orgsToRefresh = new Set<string>();
  const failures: Array<{ company_id: string; error: string }> = [];

  for (const row of pendingRows) {
    const companyId = row.id;
    let reservations: CreditReservation[] = [];
    try {
      const reservationKey = `company-deep-enrich:${companyId}:${row.enrichment_refresh_started_at ?? 'na'}`;
      // Resolve the owning org (for billing) and linked users (for per-user fit).
      const existingReservationResponse = await admin
        .from('org_credit_transactions')
        .select('org_id, user_id')
        .eq('action_type', 'company_enrichment')
        .eq('entity_type', 'company')
        .eq('entity_id', companyId)
        .eq('idempotency_key', reservationKey)
        .eq('status', 'pending');
      const existingReservationList = (existingReservationResponse.data ?? []) as Array<{
        org_id: string;
        user_id: string | null;
      }>;

      const { data: orgLink } = existingReservationList.length > 0 ? { data: null } : await admin
        .from('org_companies')
        .select('org_id')
        .eq('company_id', companyId)
        .is('archived_at', null)
        .limit(1)
        .maybeSingle<{ org_id: string }>();
      const fallbackOrgId = orgLink?.org_id ?? null;

      const { data: ucLinks } = await admin
        .from('user_companies')
        .select('user_id')
        .eq('company_id', companyId)
        .is('archived_at', null);
      const userIds = (ucLinks ?? [])
        .map((r) => (r as { user_id: string | null }).user_id)
        .filter((id): id is string => Boolean(id));

      const billingContexts = existingReservationList.length > 0
        ? existingReservationList
        : fallbackOrgId
          ? [{ org_id: fallbackOrgId, user_id: userIds[0] ?? null }]
          : [];
      for (const context of billingContexts) {
        const reservation = await reserveCredits({
          orgId: context.org_id,
          userId: context.user_id,
          action: 'company_enrichment',
          idempotencyKey: reservationKey,
          entityType: 'company',
          entityId: companyId,
        });
        if (!reservation.ok) {
          reservations.push(reservation);
          break;
        }
        reservations.push(reservation);
      }
      const failedReservation = reservations.find((reservation) => !reservation.ok);
      if (failedReservation) {
        const successfulReservations = reservations.filter(
          (reservation): reservation is Extract<CreditReservation, { ok: true }> => reservation.ok,
        );
        await Promise.all(successfulReservations.map((reservation) => refundCredits(reservation.transactionId).catch(() => {})));
        // Not enough credits — leave the firmographic/preliminary data in place,
        // mark the row failed with the reason so it stops looping.
        await admin
          .from('companies')
          .update({
            enrichment_refresh_status: 'failed',
            enrichment_refresh_last_error: failedReservation.message || 'Not enough credits to enrich this company.',
            enrichment_refresh_finished_at: new Date().toISOString(),
          })
          .eq('id', companyId);
        failed++;
        failures.push({ company_id: companyId, error: 'insufficient_credits' });
        continue;
      }

      await markCompanyEnrichmentRunning(admin, companyId);
      const result = await runCompanyEnrichmentById(admin, companyId);
      const successfulReservations = reservations.filter(
        (reservation): reservation is Extract<CreditReservation, { ok: true }> => reservation.ok,
      );

      if (companyEnrichmentCreditDisposition(result) === 'refund') {
        await Promise.all(successfulReservations.map((reservation) => refundCredits(reservation.transactionId).catch(() => {})));
      } else {
        await Promise.all(successfulReservations.map((reservation) => settleCredits(reservation.transactionId).catch(() => {})));
      }

      // Upgrade each linked user's fit now that taxonomy is populated.
      for (const uid of userIds) {
        await syncCompanyFitForCompany(admin, uid, companyId).catch(() => {});
      }

      // Headcount-expansion readiness signal — free off the Apollo growth fields
      // captured during enrichment. Best-effort; never blocks the run.
      const growth = result.headcount_growth;
      if (result.status === 'succeeded' && growth && userIds.length > 0) {
        const { data: companyRow } = await admin
          .from('companies')
          .select('company_name')
          .eq('id', companyId)
          .maybeSingle<{ company_name: string | null }>();
        const companyName = companyRow?.company_name ?? null;
        for (const uid of userIds) {
          try {
            const outcome = await runHeadcountSignalForCompany(admin, {
              userId: uid,
              companyId,
              companyName,
              growth,
            });
            if (outcome === 'emitted') {
              await recomputeAccountReadiness(admin, { userId: uid, companyId }).catch(() => {});
            }
          } catch (signalErr) {
            console.warn(`[cron/company-enrichment-queue] headcount signal failed for ${companyId}:`, signalErr);
          }
        }
      }
      for (const context of billingContexts) orgsToRefresh.add(context.org_id);

      if (result.status === 'succeeded') processed++;
      else {
        failed++;
        failures.push({ company_id: companyId, error: result.error || 'enrichment_failed' });
      }
    } catch (err) {
      const msg = messageFromUnknown(err);
      console.error(`[cron/company-enrichment-queue] company ${companyId} failed:`, msg);
      const successfulReservations = reservations.filter(
        (reservation): reservation is Extract<CreditReservation, { ok: true }> => reservation.ok,
      );
      await Promise.all(successfulReservations.map((reservation) => refundCredits(reservation.transactionId).catch(() => {})));
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

  return NextResponse.json({ success: true, batch_size: batchSize, processed, failed, failures, reservation_recovery: reservationRecovery });
}

export const GET = observeCron('company-enrichment-queue', runCron);
