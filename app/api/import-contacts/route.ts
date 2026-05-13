import { after, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';
import { looksLikeEmail } from '@/lib/contact-emails';
import {
  type NormalisedRow,
  refreshBatchProgress,
  processQueuedRowsInBackground,
} from '@/lib/import-queue';

type ImportField =
  | 'first_name'
  | 'last_name'
  | 'full_name'
  | 'company_name'
  | 'company_domain'
  | 'job_title'
  | 'email_address'
  | 'linkedin_url'
  | 'location'
  | 'company_linkedin_url'
  | 'ignore';

const normalize = (value: string | null | undefined) => (value || '').trim().toLowerCase();

const splitFullName = (fullName: string): { first: string; last: string } => {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { first: '', last: '' };
  if (tokens.length === 1) return { first: tokens[0], last: '' };
  return { first: tokens[0], last: tokens.slice(1).join(' ') };
};

const normalizeIncomingRows = (
  headers: string[],
  rows: string[][],
  columnMappings: Record<string, ImportField>
): NormalisedRow[] =>
  rows.map((row) => {
    const byField: Record<ImportField, string[]> = {
      first_name: [],
      last_name: [],
      full_name: [],
      company_name: [],
      company_domain: [],
      job_title: [],
      email_address: [],
      linkedin_url: [],
      location: [],
      company_linkedin_url: [],
      ignore: [],
    };

    headers.forEach((header, index) => {
      const mapping = columnMappings[header] || 'ignore';
      const value = (row[index] || '').trim();
      if (value) byField[mapping].push(value);
    });

    const explicitFirst = byField.first_name[0] || '';
    const explicitLast = byField.last_name[0] || '';
    const explicitFull = byField.full_name.join(' ').trim();

    let firstName = explicitFirst;
    let lastName = explicitLast;
    let fullName = explicitFull;

    if (!fullName && (firstName || lastName)) {
      fullName = `${firstName} ${lastName}`.trim();
    }

    if (fullName && (!firstName || !lastName)) {
      const split = splitFullName(fullName);
      firstName = firstName || split.first;
      lastName = lastName || split.last;
    }

    return {
      full_name: fullName,
      first_name: firstName,
      last_name: lastName,
      company_name: byField.company_name[0] || '',
      company_domain: byField.company_domain[0] || '',
      job_title: byField.job_title[0] || '',
      email: byField.email_address[0] || '',
      linkedin_url: byField.linkedin_url[0] || '',
      location: byField.location[0] || '',
      company_linkedin_url: byField.company_linkedin_url[0] || '',
    };
  });

const isExactDuplicate = (row: NormalisedRow, existing: Record<string, unknown>): boolean => {
  const rowLinkedin = normalize(row.linkedin_url);
  const rowEmail = normalize(row.email);
  const rowFirst = normalize(row.first_name);
  const rowLast = normalize(row.last_name);
  const rowCompany = normalize(row.company_name);

  const exLinkedin = normalize(existing.linkedin_url as string | undefined);
  const exEmail = normalize(existing.email as string | undefined);
  const exFirst = normalize(existing.first_name as string | undefined);
  const exLast = normalize(existing.last_name as string | undefined);
  const exCompany = normalize(existing.company_name as string | undefined);

  if (rowLinkedin && exLinkedin && rowLinkedin === exLinkedin) return true;
  if (rowEmail && exEmail && rowEmail === exEmail) return true;
  if (
    rowFirst &&
    rowLast &&
    rowCompany &&
    exFirst &&
    exLast &&
    exCompany &&
    rowFirst === exFirst &&
    rowLast === exLast &&
    rowCompany === exCompany
  ) {
    return true;
  }

  return false;
};

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
    const headers = Array.isArray(body?.headers) ? (body.headers as string[]) : [];
    const rows = Array.isArray(body?.rows) ? (body.rows as string[][]) : [];
    const columnMappings =
      body?.columnMappings && typeof body.columnMappings === 'object'
        ? (body.columnMappings as Record<string, ImportField>)
        : {};
    const filename = typeof body?.filename === 'string' ? body.filename : 'upload.csv';

    if (headers.length === 0 || rows.length === 0) {
      return NextResponse.json({ error: 'No rows to import' }, { status: 400 });
    }

    const normalizedRows = normalizeIncomingRows(headers, rows, columnMappings);

    const { data: batch, error: batchError } = await supabase
      .from('upload_batches')
      .insert({
        user_id: user.id,
        filename,
        total_rows: normalizedRows.length,
        status: 'processing',
      })
      .select('id')
      .single();

    if (batchError || !batch) {
      console.error('Error creating upload batch:', batchError);
      return NextResponse.json({ error: 'Failed to create upload batch' }, { status: 500 });
    }

    const batchId = batch.id as string;

    const insertPayload = normalizedRows.map((row) => ({
      user_id: user.id,
      batch_id: batchId,
      raw_data: row as unknown as Record<string, unknown>,
      full_name: row.full_name || null,
      email: row.email || null,
      linkedin_url: row.linkedin_url || null,
      company_name: row.company_name || null,
      status: 'pending',
    }));

    const { data: insertedRows, error: insertError } = await supabase
      .from('raw_uploads')
      .insert(insertPayload)
      .select('id, full_name, email, linkedin_url, company_name, raw_data');

    if (insertError || !insertedRows) {
      console.error('Error inserting raw uploads:', insertError);
      return NextResponse.json({ error: 'Failed to store uploaded rows' }, { status: 500 });
    }

    const { data: existingContacts } = await supabase
      .from('contacts')
      .select('linkedin_url, email, first_name, last_name, company_name')
      .eq('user_id', user.id);

    const duplicateIds: string[] = [];
    const invalidEmailIds: string[] = [];
    const pendingRows = insertedRows.filter((row) => {
      const rawData = row.raw_data as Record<string, unknown>;
      const rowNorm: NormalisedRow = {
        full_name: (rawData.full_name as string) || '',
        first_name: (rawData.first_name as string) || '',
        last_name: (rawData.last_name as string) || '',
        company_name: (row.company_name as string) || '',
        company_domain: (rawData.company_domain as string) || '',
        job_title: (rawData.job_title as string) || '',
        email: (row.email as string) || '',
        linkedin_url: (row.linkedin_url as string) || '',
        location: (rawData.location as string) || '',
        company_linkedin_url: (rawData.company_linkedin_url as string) || '',
      };

      if (rowNorm.email && !looksLikeEmail(rowNorm.email)) {
        invalidEmailIds.push(row.id as string);
        return false;
      }

      const isDupe = (existingContacts || []).some((contact) =>
        isExactDuplicate(rowNorm, contact as Record<string, unknown>)
      );

      if (isDupe) {
        duplicateIds.push(row.id as string);
        return false;
      }
      return true;
    });

    const quotaHeldIds: string[] = [];
    const rowsToEnrich = pendingRows;

    if (duplicateIds.length > 0) {
      await supabase.from('raw_uploads').update({ status: 'duplicate' }).in('id', duplicateIds);
    }

    if (invalidEmailIds.length > 0) {
      await supabase
        .from('raw_uploads')
        .update({ status: 'failed', enriched_at: new Date().toISOString() })
        .in('id', invalidEmailIds);
    }

    if (quotaHeldIds.length > 0) {
      await supabase
        .from('raw_uploads')
        .update({ status: 'failed', enriched_at: new Date().toISOString() })
        .in('id', quotaHeldIds);
    }

    const pendingIds = rowsToEnrich.map((row) => row.id as string);
    if (pendingIds.length > 0) {
      await supabase.from('raw_uploads').update({ status: 'enriching' }).in('id', pendingIds);
    }

    await supabase
      .from('upload_batches')
      .update({ duplicate_rows: duplicateIds.length, failed_rows: quotaHeldIds.length + invalidEmailIds.length })
      .eq('id', batchId);

    if (rowsToEnrich.length === 0) {
      await refreshBatchProgress(createAdminClient(), batchId);
    } else {
      const queuedRows = rowsToEnrich.map((row) => ({
        id: row.id as string,
        full_name: row.full_name as string | null,
        email: row.email as string | null,
        linkedin_url: row.linkedin_url as string | null,
        company_name: row.company_name as string | null,
        raw_data: row.raw_data as Record<string, unknown>,
      }));

      const backgroundTask = () =>
        processQueuedRowsInBackground({
          queuedRows,
          batchId,
          userId: user.id,
        });

      if (process.env.NODE_ENV === 'development') {
        setTimeout(() => {
          void backgroundTask();
        }, 0);
      } else {
        after(backgroundTask);
      }
    }

    return NextResponse.json({
      batchId,
      totalUploaded: rows.length,
      duplicatesRemoved: duplicateIds.length,
      heldBackByQuota: quotaHeldIds.length,
      beingEnriched: pendingIds.length,
      complete: 0,
      failed: invalidEmailIds.length,
      warning:
        invalidEmailIds.length > 0
          ? `${invalidEmailIds.length} row${invalidEmailIds.length === 1 ? '' : 's'} were skipped because the email address looked invalid. Fix those emails and re-import to include them.`
          : null,
    });
  } catch (error) {
    console.error('Error in import-contacts POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
