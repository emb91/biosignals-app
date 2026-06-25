import { after, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import {
  markCompanyEnrichmentRunning,
  runCompanyEnrichmentById,
} from '@/lib/company-enrichment';
import { syncCompanyFitForCompany } from '@/lib/company-fit';
import { refundCredits, reserveCredits, settleCredits } from '@/lib/billing/credits';
import { refreshMonitoringUniverse } from '@/lib/billing/monitoring';
import { companyEnrichmentCreditDisposition } from '@/lib/company-enrichment-credits';
import { cancelCompanyEnrichmentForUser } from '@/lib/company-enrichment-cancel';
import { WORKSPACE_REQUIRED_ERROR } from '@/lib/org-context';

// The enrichment runs in an after() job (Apollo + Apify + the parallelized
// funding/taxonomy/narrative web-search modules). Give it a generous ceiling so
// the platform doesn't kill it mid-run and leave the row stuck at 'running'.
// With the modules parallelized this completes in ~50-60s; 300s is ample
// headroom. (Vercel: 300s requires Pro/Enterprise; lower tiers cap lower —
// adjust to your plan's max.)
export const maxDuration = 300;

/**
 * POST /api/companies/[id]/enrich
 *
 * Kicks off the dedicated company-enrichment pipeline for a single company.
 * The work itself runs asynchronously via `after()` so the response returns
 * immediately — the caller polls the row's `enrichment_refresh_status` to
 * see when it flips to `succeeded` / `failed`.
 *
 * This is the path the Companies side-panel "Refresh enrichment" button
 * hits, and the path that `job_change_monitor` fires when it creates a
 * new company stub from a contact's job-change event.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const authClient = await createClient();
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!id) {
      return NextResponse.json({ error: 'company id required' }, { status: 400 });
    }

    // Use admin client to bypass RLS — this endpoint is gated by the auth
    // check above and only reads/writes the company row + dependent caches.
    const supabase = createAdminClient();
    const { data: member } = await supabase.from('org_members').select('org_id')
      .eq('user_id', user.id).maybeSingle<{ org_id: string }>();
    if (!member?.org_id) return NextResponse.json(WORKSPACE_REQUIRED_ERROR, { status: 409 });
    let owned = null as { company_id: string } | null;
    const { data: orgOwned } = await supabase.from('org_companies').select('company_id')
      .eq('org_id', member.org_id).eq('company_id', id).is('archived_at', null).maybeSingle();
    owned = orgOwned;
    if (!owned) {
      const { data } = await supabase.from('user_companies').select('company_id')
        .eq('user_id', user.id).eq('company_id', id).is('archived_at', null).maybeSingle();
      owned = data;
      if (owned) {
        await supabase.from('org_companies').upsert({
          org_id: member.org_id,
          company_id: id,
          source: 'legacy_user_company',
          created_by: user.id,
          archived_at: null,
          archived_by: null,
          archived_reason: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'org_id,company_id' });
      }
    }
    if (!owned) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    const operationId = request.headers.get('x-operation-id') || crypto.randomUUID();
    const reservation = await reserveCredits({
      orgId: member.org_id,
      userId: user.id,
      action: 'company_enrichment',
      idempotencyKey: `company-enrichment:${operationId}`,
      entityType: 'company',
      entityId: id,
    });
    if (!reservation.ok) return NextResponse.json(reservation, { status: 402 });

    // Flip the row to `running` SYNCHRONOUSLY so the UI sees the new state
    // on the next refetch, before the heavy lifting starts.
    await markCompanyEnrichmentRunning(supabase, id);

    // Run enrichment in the background. We don't await — the response
    // returns immediately. Next will keep the connection open for `after()`
    // work after the response is sent.
    after(async () => {
      let disposition: ReturnType<typeof companyEnrichmentCreditDisposition>;
      try {
        const result = await runCompanyEnrichmentById(supabase, id);
        disposition = companyEnrichmentCreditDisposition(result);
      } catch (err) {
        // runCompanyEnrichmentById already records the failure on the row;
        // this catch is just a belt-and-braces so the after() callback
        // never throws uncaught.
        console.error('[api/companies/enrich] background run threw:', err);
        await refundCredits(reservation.transactionId).catch(() => {});
        return;
      }
      if (disposition === 'refund') {
        await refundCredits(reservation.transactionId).catch((error) => {
          console.error('[api/companies/enrich] credit refund failed:', error);
        });
        return;
      }
      // Resync the user's fit score after enrichment finishes. Non-fatal.
      try {
        await syncCompanyFitForCompany(supabase, user.id, id);
      } catch (fitErr) {
        console.warn('[api/companies/enrich] syncCompanyFitForCompany failed:', fitErr);
      }
      await refreshMonitoringUniverse(member.org_id).catch(() => {});
      await settleCredits(reservation.transactionId).catch((error) => {
        console.error('[api/companies/enrich] credit settlement failed:', error);
      });
    });

    return NextResponse.json({ success: true, company_id: id, status: 'running' });
  } catch (error) {
    console.error('[api/companies/enrich] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/companies/[id]/enrich
 *
 * Stops a running company enrichment (mirrors the contacts stop control).
 * Flips the row to `cancelled`. The background after() job re-checks this
 * flag right before it would mark the row `succeeded` and bails if cancelled,
 * so a stop sticks even though we can't truly abort an in-flight scrape.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const authClient = await createClient();
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!id) {
      return NextResponse.json({ error: 'company id required' }, { status: 400 });
    }

    const result = await cancelCompanyEnrichmentForUser(createAdminClient(), user.id, id);
    if (!result.found) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }
    if (result.alreadyFinished) {
      return NextResponse.json({ success: true, company_id: id, status: result.status, alreadyFinished: true });
    }

    return NextResponse.json({ success: true, company_id: id, status: 'cancelled' });
  } catch (error) {
    console.error('[api/companies/enrich] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
