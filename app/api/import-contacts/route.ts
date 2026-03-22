import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

type ImportField =
  | 'first_name'
  | 'last_name'
  | 'full_name'
  | 'company_name'
  | 'job_title'
  | 'email_address'
  | 'linkedin_url'
  | 'ignore';

type RawImportRow = {
  contact_fullname: string;
  first_name: string;
  last_name: string;
  company_name: string;
  job_title: string;
  email: string;
  linkedin_url: string;
};

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
): RawImportRow[] => {
  return rows.map((row) => {
    const byField: Record<ImportField, string[]> = {
      first_name: [],
      last_name: [],
      full_name: [],
      company_name: [],
      job_title: [],
      email_address: [],
      linkedin_url: [],
      ignore: [],
    };

    headers.forEach((header, index) => {
      const mapping = columnMappings[header] || 'ignore';
      const value = (row[index] || '').trim();
      if (value) byField[mapping].push(value);
    });

    const explicitFirstName = byField.first_name[0] || '';
    const explicitLastName = byField.last_name[0] || '';
    const explicitFullName = byField.full_name.join(' ').trim();

    let firstName = explicitFirstName;
    let lastName = explicitLastName;
    let contactFullName = explicitFullName;

    if (!contactFullName && (firstName || lastName)) {
      contactFullName = `${firstName} ${lastName}`.trim();
    }

    if (contactFullName && (!firstName || !lastName)) {
      const split = splitFullName(contactFullName);
      firstName = firstName || split.first;
      lastName = lastName || split.last;
    }

    return {
      contact_fullname: contactFullName,
      first_name: firstName,
      last_name: lastName,
      company_name: byField.company_name[0] || '',
      job_title: byField.job_title[0] || '',
      email: byField.email_address[0] || '',
      linkedin_url: byField.linkedin_url[0] || '',
    };
  });
};

const isExactDuplicate = (row: RawImportRow, existingContact: Record<string, unknown>): boolean => {
  const rowLinkedin = normalize(row.linkedin_url);
  const rowEmail = normalize(row.email);
  const rowFirst = normalize(row.first_name);
  const rowLast = normalize(row.last_name);
  const rowCompany = normalize(row.company_name);

  const existingLinkedin = normalize(
    (existingContact.linkedin_url as string | undefined) || (existingContact.linkedin as string | undefined)
  );
  const existingEmail = normalize(
    (existingContact.email as string | undefined) || (existingContact.email_address as string | undefined)
  );
  const existingFirst = normalize(existingContact.first_name as string | undefined);
  const existingLast = normalize(existingContact.last_name as string | undefined);
  const existingCompany = normalize(existingContact.company_name as string | undefined);

  if (rowLinkedin && existingLinkedin && rowLinkedin === existingLinkedin) return true;
  if (rowEmail && existingEmail && rowEmail === existingEmail) return true;

  if (
    rowFirst &&
    rowLast &&
    rowCompany &&
    existingFirst &&
    existingLast &&
    existingCompany &&
    rowFirst === existingFirst &&
    rowLast === existingLast &&
    rowCompany === existingCompany
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

    if (headers.length === 0 || rows.length === 0) {
      return NextResponse.json({ error: 'No rows to import' }, { status: 400 });
    }

    const uploadBatchId = crypto.randomUUID();
    const uploadedAt = new Date().toISOString();

    const normalizedRows = normalizeIncomingRows(headers, rows, columnMappings);

    const insertPayload = normalizedRows.map((row) => ({
      user_id: user.id,
      contact_fullname: row.contact_fullname,
      first_name: row.first_name,
      last_name: row.last_name,
      company_name: row.company_name,
      job_title: row.job_title,
      email: row.email,
      linkedin_url: row.linkedin_url,
      upload_batch_id: uploadBatchId,
      uploaded_at: uploadedAt,
      status: 'pending',
    }));

    const { data: insertedRows, error: insertError } = await supabase
      .from('raw_uploads')
      .insert(insertPayload)
      .select('id, contact_fullname, first_name, last_name, company_name, job_title, email, linkedin_url');

    if (insertError) {
      console.error('Error inserting raw uploads:', insertError);
      return NextResponse.json({ error: 'Failed to store uploaded rows' }, { status: 500 });
    }

    const { data: existingContacts, error: contactsError } = await supabase
      .from('contacts')
      .select('*')
      .eq('user_id', user.id);

    if (contactsError) {
      console.error('Error loading existing contacts:', contactsError);
      return NextResponse.json({ error: 'Failed to check duplicates' }, { status: 500 });
    }

    const duplicateIds: string[] = [];
    const pendingRows = (insertedRows || []).filter((row) => {
      const duplicate = (existingContacts || []).some((contact) =>
        isExactDuplicate(
          {
            contact_fullname: row.contact_fullname || '',
            first_name: row.first_name || '',
            last_name: row.last_name || '',
            company_name: row.company_name || '',
            job_title: row.job_title || '',
            email: row.email || '',
            linkedin_url: row.linkedin_url || '',
          },
          contact
        )
      );

      if (duplicate) {
        duplicateIds.push(row.id as string);
        return false;
      }

      return true;
    });

    if (duplicateIds.length > 0) {
      const { error: duplicateMarkError } = await supabase
        .from('raw_uploads')
        .update({ status: 'duplicate' })
        .in('id', duplicateIds);
      if (duplicateMarkError) {
        console.error('Error marking duplicates:', duplicateMarkError);
      }
    }

    const pendingIds = pendingRows.map((row) => row.id as string);
    if (pendingIds.length > 0) {
      const { error: enrichingMarkError } = await supabase
        .from('raw_uploads')
        .update({ status: 'enriching' })
        .in('id', pendingIds);
      if (enrichingMarkError) {
        console.error('Error marking enriching rows:', enrichingMarkError);
      }

      const clayWebhookUrl = process.env.CLAY_IMPORT_WEBHOOK_URL || process.env.CLAY_WEBHOOK_URL;
      if (clayWebhookUrl) {
        await Promise.allSettled(
          pendingRows.map((row) =>
            fetch(clayWebhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                upload_batch_id: uploadBatchId,
                raw_upload_id: row.id,
                user_id: user.id,
                contact_fullname: row.contact_fullname,
                first_name: row.first_name,
                last_name: row.last_name,
                company_name: row.company_name,
                job_title: row.job_title,
                email: row.email,
                linkedin_url: row.linkedin_url,
              }),
            })
          )
        );
      } else {
        console.warn('CLAY_IMPORT_WEBHOOK_URL not configured, rows remain in enriching status');
      }
    }

    return NextResponse.json({
      batchId: uploadBatchId,
      totalUploaded: rows.length,
      duplicatesRemoved: duplicateIds.length,
      beingEnriched: pendingIds.length,
      complete: 0,
    });
  } catch (error) {
    console.error('Error in import-contacts POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
