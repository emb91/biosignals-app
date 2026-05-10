import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

type RawUploadRow = {
  id: string;
  status: string | null;
  full_name: string | null;
  email: string | null;
  linkedin_url: string | null;
  company_name: string | null;
  raw_data: Record<string, unknown> | null;
};

const stringValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const buildDisplayName = (row: RawUploadRow): string => {
  const raw = row.raw_data || {};
  const fullName = stringValue(row.full_name) || stringValue(raw.full_name);
  if (fullName) return fullName;

  const firstName = stringValue(raw.first_name);
  const lastName = stringValue(raw.last_name);
  return `${firstName} ${lastName}`.trim() || 'Unnamed contact';
};

const buildDisplayRow = (row: RawUploadRow) => {
  const raw = row.raw_data || {};

  return {
    id: row.id,
    status: row.status || 'unknown',
    full_name: buildDisplayName(row),
    email: stringValue(row.email) || stringValue(raw.email),
    linkedin_url: stringValue(row.linkedin_url) || stringValue(raw.linkedin_url),
    company_name: stringValue(row.company_name) || stringValue(raw.company_name),
    company_domain: stringValue(raw.company_domain),
    job_title: stringValue(raw.job_title),
  };
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ batchId: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { batchId } = await context.params;
    if (!batchId) {
      return NextResponse.json({ error: 'batchId is required' }, { status: 400 });
    }

    const { data: batch, error: batchError } = await supabase
      .from('upload_batches')
      .select('id, filename, status')
      .eq('user_id', user.id)
      .eq('id', batchId)
      .maybeSingle();

    if (batchError) {
      return NextResponse.json({ error: batchError.message }, { status: 500 });
    }

    if (!batch) {
      return NextResponse.json({ error: 'Import batch not found' }, { status: 404 });
    }

    const { data: rows, error: rowsError } = await supabase
      .from('raw_uploads')
      .select('id, status, full_name, email, linkedin_url, company_name, raw_data')
      .eq('user_id', user.id)
      .eq('batch_id', batchId)
      .order('full_name', { ascending: true });

    if (rowsError) {
      return NextResponse.json({ error: rowsError.message }, { status: 500 });
    }

    const mappedRows = ((rows || []) as RawUploadRow[]).map(buildDisplayRow);

    return NextResponse.json({
      batch,
      failedRows: mappedRows.filter((row) => row.status === 'failed'),
      duplicateRows: mappedRows.filter((row) => row.status === 'duplicate'),
      enrichedRows: mappedRows.filter((row) => row.status === 'enriched' || row.status === 'complete'),
      allRows: mappedRows,
    });
  } catch (error) {
    console.error('Error in import-history/[batchId] GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
