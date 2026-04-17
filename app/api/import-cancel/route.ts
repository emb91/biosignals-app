import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const batchId = typeof body?.batchId === 'string' ? body.batchId : '';

    if (!batchId) {
      return NextResponse.json({ error: 'batchId is required' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: batch, error: batchError } = await admin
      .from('upload_batches')
      .select('id, status')
      .eq('id', batchId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (batchError) {
      console.error('Error loading batch for cancel:', batchError);
      return NextResponse.json({ error: 'Failed to load import batch' }, { status: 500 });
    }

    if (!batch) {
      return NextResponse.json({ error: 'Import batch not found' }, { status: 404 });
    }

    const now = new Date().toISOString();

    await admin
      .from('raw_uploads')
      .update({ status: 'failed', enriched_at: now })
      .eq('user_id', user.id)
      .eq('batch_id', batchId)
      .in('status', ['pending', 'enriching']);

    const { data: rawRows, error: rawRowsError } = await admin
      .from('raw_uploads')
      .select('status')
      .eq('user_id', user.id)
      .eq('batch_id', batchId);

    if (rawRowsError) {
      console.error('Error loading raw uploads after cancel:', rawRowsError);
      return NextResponse.json({ error: 'Failed to stop import batch' }, { status: 500 });
    }

    const processedRows = (rawRows || []).filter((row) =>
      ['enriched', 'duplicate', 'failed'].includes((row as { status: string }).status)
    ).length;
    const duplicateRows = (rawRows || []).filter(
      (row) => (row as { status: string }).status === 'duplicate'
    ).length;
    const failedRows = (rawRows || []).filter(
      (row) => (row as { status: string }).status === 'failed'
    ).length;

    const { error: updateBatchError } = await admin
      .from('upload_batches')
      .update({
        processed_rows: processedRows,
        duplicate_rows: duplicateRows,
        failed_rows: failedRows,
        status: 'cancelled',
        updated_at: now,
      })
      .eq('id', batchId)
      .eq('user_id', user.id);

    if (updateBatchError) {
      console.error('Error updating batch during cancel:', updateBatchError);
      return NextResponse.json({ error: 'Failed to stop import batch' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      batchId,
      batch_status: 'cancelled',
      processed_rows: processedRows,
      duplicate_rows: duplicateRows,
      failed_rows: failedRows,
    });
  } catch (error) {
    console.error('Error in import-cancel POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
