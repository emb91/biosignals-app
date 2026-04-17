import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: batches, error } = await supabase
      .from('upload_batches')
      .select('id, filename, total_rows, processed_rows, duplicate_rows, failed_rows, status, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ batches: batches || [] });
  } catch (error) {
    console.error('Error in import-history GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
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

    const admin = createAdminClient();

    const { data: batch, error: batchError } = await admin
      .from('upload_batches')
      .select('id')
      .eq('id', batchId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (batchError) {
      console.error('Error loading import batch for delete:', batchError);
      return NextResponse.json({ error: 'Failed to load import batch' }, { status: 500 });
    }

    if (!batch) {
      return NextResponse.json({ error: 'Import batch not found' }, { status: 404 });
    }

    const { error: detachContactsError } = await admin
      .from('contacts')
      .update({
        batch_id: null,
        raw_upload_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
      .eq('batch_id', batchId);

    if (detachContactsError) {
      console.error('Error detaching contacts from import batch:', detachContactsError);
      return NextResponse.json({ error: 'Failed to delete import batch' }, { status: 500 });
    }

    const { error: deleteRawUploadsError } = await admin
      .from('raw_uploads')
      .delete()
      .eq('user_id', user.id)
      .eq('batch_id', batchId);

    if (deleteRawUploadsError) {
      console.error('Error deleting raw uploads for import batch:', deleteRawUploadsError);
      return NextResponse.json({ error: 'Failed to delete import batch' }, { status: 500 });
    }

    const { error: deleteBatchError } = await admin
      .from('upload_batches')
      .delete()
      .eq('user_id', user.id)
      .eq('id', batchId);

    if (deleteBatchError) {
      console.error('Error deleting import batch:', deleteBatchError);
      return NextResponse.json({ error: 'Failed to delete import batch' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, batchId });
  } catch (error) {
    console.error('Error in import-history DELETE:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
