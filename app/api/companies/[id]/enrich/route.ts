import { after, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import {
  markCompanyEnrichmentRunning,
  runCompanyEnrichmentById,
} from '@/lib/company-enrichment';
import { syncCompanyFitForCompany } from '@/lib/company-fit';

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
 * This is the path the Accounts side-panel "Refresh enrichment" button
 * hits, and the path that `job_change_monitor` fires when it creates a
 * new company stub from a contact's job-change event.
 */
export async function POST(
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

    // Use admin client to bypass RLS — this endpoint is gated by the auth
    // check above and only reads/writes the company row + dependent caches.
    const supabase = createAdminClient();

    // Flip the row to `running` SYNCHRONOUSLY so the UI sees the new state
    // on the next refetch, before the heavy lifting starts.
    await markCompanyEnrichmentRunning(supabase, id);

    // Run enrichment in the background. We don't await — the response
    // returns immediately. Next will keep the connection open for `after()`
    // work after the response is sent.
    after(async () => {
      try {
        await runCompanyEnrichmentById(supabase, id);
      } catch (err) {
        // runCompanyEnrichmentById already records the failure on the row;
        // this catch is just a belt-and-braces so the after() callback
        // never throws uncaught.
        console.error('[api/companies/enrich] background run threw:', err);
        return;
      }
      // Resync the user's fit score after enrichment finishes. Non-fatal.
      try {
        await syncCompanyFitForCompany(supabase, user.id, id);
      } catch (fitErr) {
        console.warn('[api/companies/enrich] syncCompanyFitForCompany failed:', fitErr);
      }
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

    const supabase = createAdminClient();
    // Only cancel a row that's actually running — don't clobber a succeeded /
    // failed terminal state if the job already finished (409-style no-op).
    const { data: row } = await supabase
      .from('companies')
      .select('enrichment_refresh_status')
      .eq('id', id)
      .maybeSingle();
    const status = (row as { enrichment_refresh_status?: string | null } | null)?.enrichment_refresh_status ?? null;
    if (status !== 'running') {
      return NextResponse.json({ success: true, company_id: id, status, alreadyFinished: true });
    }

    const finishedAt = new Date().toISOString();
    await supabase
      .from('companies')
      .update({
        enrichment_refresh_status: 'cancelled',
        enrichment_refresh_finished_at: finishedAt,
        updated_at: finishedAt,
      })
      .eq('id', id);

    return NextResponse.json({ success: true, company_id: id, status: 'cancelled' });
  } catch (error) {
    console.error('[api/companies/enrich] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
