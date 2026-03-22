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

    const { data, error } = await supabase
      .from('raw_uploads')
      .select('status')
      .eq('user_id', user.id)
      .eq('upload_batch_id', batchId);

    if (error) {
      console.error('Error loading import status:', error);
      return NextResponse.json({ error: 'Failed to load import status' }, { status: 500 });
    }

    const statuses = data || [];
    const summary = statuses.reduce(
      (acc, row) => {
        const status = row.status as string;
        acc.total += 1;
        if (status === 'duplicate') acc.duplicates += 1;
        if (status === 'enriching') acc.enriching += 1;
        if (status === 'complete') acc.complete += 1;
        return acc;
      },
      { total: 0, duplicates: 0, enriching: 0, complete: 0 }
    );

    return NextResponse.json(summary);
  } catch (error) {
    console.error('Error in import-status GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
