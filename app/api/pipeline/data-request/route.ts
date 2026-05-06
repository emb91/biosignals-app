import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import type { PipelineDataRequestType } from '@/lib/pipeline-icp-health';

const REQUEST_TYPES: PipelineDataRequestType[] = [
  'expand_companies',
  'better_contacts',
  'more_contacts_at_accounts',
];

function requestFilename(
  userId: string,
  icpId: string,
  requestType: PipelineDataRequestType,
): string {
  const day = new Date().toISOString().slice(0, 10);
  const shortUser = userId.replace(/-/g, '').slice(0, 8);
  const shortIcp = icpId.replace(/-/g, '').slice(0, 8);
  return `arcova-pipeline-${requestType}-icp-${shortIcp}-user-${shortUser}-${day}.csv`;
}

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

    let body: { icpId?: string; requestType?: string };
    try {
      body = (await request.json()) as { icpId?: string; requestType?: string };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const icpId = typeof body.icpId === 'string' ? body.icpId.trim() : '';
    const requestType = body.requestType as PipelineDataRequestType;
    if (!icpId || !REQUEST_TYPES.includes(requestType)) {
      return NextResponse.json({ error: 'icpId and valid requestType required' }, { status: 400 });
    }

    const { data: icp, error: icpErr } = await supabase
      .from('icps')
      .select('id')
      .eq('user_id', user.id)
      .eq('id', icpId)
      .maybeSingle();

    if (icpErr || !icp) {
      return NextResponse.json({ error: 'ICP not found' }, { status: 404 });
    }

    const filename = requestFilename(user.id, icpId, requestType);
    const now = new Date().toISOString();

    const { data: batch, error: batchErr } = await supabase
      .from('upload_batches')
      .insert({
        user_id: user.id,
        filename,
        total_rows: 0,
        status: 'complete',
        duplicate_rows: 0,
        enriched_rows: 0,
        failed_rows: 0,
        processed_rows: 0,
        completed_at: now,
      })
      .select('id')
      .single();

    if (batchErr || !batch) {
      console.error('[pipeline/data-request]', batchErr);
      return NextResponse.json({ error: 'Failed to record data request' }, { status: 500 });
    }

    return NextResponse.json({
      batchId: batch.id as string,
      filename,
    });
  } catch (e) {
    console.error('[pipeline/data-request]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
