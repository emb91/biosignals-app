import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function POST(request: Request) {
  try {
    const secret = process.env.IMPORT_WEBHOOK_SECRET;
    const incomingSecret = request.headers.get('x-import-webhook-secret');
    if (secret && incomingSecret !== secret) {
      return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 401 });
    }

    const supabase = await createClient();
    const body = await request.json();

    const explicitId = typeof body?.raw_upload_id === 'string' ? body.raw_upload_id : null;
    const explicitIds = Array.isArray(body?.raw_upload_ids) ? body.raw_upload_ids.filter((id: unknown) => typeof id === 'string') : [];
    const recordIds = Array.isArray(body?.records)
      ? body.records
          .map((record: { raw_upload_id?: unknown }) => (typeof record?.raw_upload_id === 'string' ? record.raw_upload_id : null))
          .filter((id: string | null): id is string => Boolean(id))
      : [];

    const uploadBatchId = typeof body?.upload_batch_id === 'string' ? body.upload_batch_id : null;

    const ids = Array.from(new Set([explicitId, ...explicitIds, ...recordIds].filter((id): id is string => Boolean(id))));

    if (ids.length === 0 && !uploadBatchId) {
      return NextResponse.json({ error: 'No matching IDs supplied' }, { status: 400 });
    }

    if (ids.length > 0) {
      const { error } = await supabase.from('raw_uploads').update({ status: 'complete' }).in('id', ids);
      if (error) {
        console.error('Error updating callback rows by id:', error);
        return NextResponse.json({ error: 'Failed to update rows' }, { status: 500 });
      }

      return NextResponse.json({ updated: ids.length });
    }

    const { error } = await supabase
      .from('raw_uploads')
      .update({ status: 'complete' })
      .eq('upload_batch_id', uploadBatchId)
      .eq('status', 'enriching');

    if (error) {
      console.error('Error updating callback rows by batch:', error);
      return NextResponse.json({ error: 'Failed to update rows' }, { status: 500 });
    }

    return NextResponse.json({ updated: 'batch' });
  } catch (error) {
    console.error('Error in import-clay-callback POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
