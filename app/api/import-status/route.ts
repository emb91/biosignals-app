import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase-server';
import {
  getLeadAction,
  isMonitorOrReachOutAction,
  type LeadLikeForAction,
} from '@/lib/lead-action';

const USER_LEADS_PAGE_SIZE = 750;

async function countMonitorOrReachOutAcrossAllLeads(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ count: number; error: Error | null }> {
  let from = 0;
  let total = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('contacts')
      .select('contact_fit_score, fit_score, intent_score, companies(company_fit_score)')
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .range(from, from + USER_LEADS_PAGE_SIZE - 1);

    if (error) {
      return { count: 0, error: new Error(error.message) };
    }

    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const action = getLeadAction(row as LeadLikeForAction);
      if (isMonitorOrReachOutAction(action)) total += 1;
    }

    if (rows.length < USER_LEADS_PAGE_SIZE) break;
    from += USER_LEADS_PAGE_SIZE;
  }

  return { count: total, error: null };
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batchId');

    if (!batchId) {
      return NextResponse.json({ error: 'batchId is required' }, { status: 400 });
    }

    const [{ data, error }, { data: batchData, error: batchError }] = await Promise.all([
      supabase
        .from('raw_uploads')
        .select('status')
        .eq('user_id', user.id)
        .eq('batch_id', batchId),
      supabase
        .from('upload_batches')
        .select('status')
        .eq('user_id', user.id)
        .eq('id', batchId)
        .single(),
    ]);

    if (error || batchError) {
      console.error('Error loading import status:', error, batchError);
      return NextResponse.json({ error: 'Failed to load import status' }, { status: 500 });
    }

    const batchStatus = (batchData?.status as string | undefined) || 'processing';

    let monitorOrReachOutTotal = 0;
    if (batchStatus === 'complete' || batchStatus === 'cancelled') {
      const reachOutCountResult = await countMonitorOrReachOutAcrossAllLeads(supabase, user.id);
      if (reachOutCountResult.error) {
        console.error('Error counting leads by action:', reachOutCountResult.error);
        return NextResponse.json({ error: 'Failed to load import status' }, { status: 500 });
      }
      monitorOrReachOutTotal = reachOutCountResult.count;
    }

    const statuses = data || [];
    const summary = statuses.reduce(
      (acc, row) => {
        const status = row.status as string;
        acc.total += 1;
        if (status === 'duplicate') acc.duplicates += 1;
        if (status === 'enriching') acc.enriching += 1;
        if (status === 'pending') acc.pending += 1;
        if (status === 'enriched') acc.enriched += 1;
        if (status === 'failed') acc.not_enriched += 1;
        return acc;
      },
      { total: 0, duplicates: 0, pending: 0, enriching: 0, enriched: 0, not_enriched: 0 }
    );

    const processed = summary.duplicates + summary.enriched + summary.not_enriched;
    const remaining = Math.max(summary.total - processed, 0);

    return NextResponse.json({
      ...summary,
      processed,
      remaining,
      /** All of your Leads that are not Deprioritised (Monitor, Source, or Reach out; same rules as the Leads page). */
      monitor_or_reach_out_total: monitorOrReachOutTotal,
      batch_status: batchStatus,
    });
  } catch (error) {
    console.error('Error in import-status GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
