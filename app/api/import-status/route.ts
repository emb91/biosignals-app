import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

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
      { total: 0, duplicates: 0, pending: 0, enriching: 0, enriched: 0, not_enriched: 0 },
    );

    const processed = summary.duplicates + summary.enriched + summary.not_enriched;
    const remaining = Math.max(summary.total - processed, 0);

    return NextResponse.json({
      ...summary,
      processed,
      remaining,
      batch_status: batchStatus,
    });
  } catch (error) {
    console.error('Error in import-status GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
