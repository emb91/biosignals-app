import { after, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';
import {
  classifyImportRowsForDedup,
  PENDING_IMPORT_DEDUP_STATUSES,
  type DuplicateCandidate,
  type InsertedImportRow,
} from '@/lib/import-contact-dedup';
import {
  type NormalisedRow,
  refreshBatchProgress,
  processQueuedRowsInBackground,
} from '@/lib/import-queue';
import { getPostHogClient } from '@/lib/posthog-server';
import { WORKSPACE_REQUIRED_ERROR, orgIdForUser } from '@/lib/org-context';

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

type SupabaseLike = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function loadExistingContactDedupCandidates(
  admin: SupabaseLike,
  orgId: string,
  userId: string,
): Promise<DuplicateCandidate[]> {
  const { data: members, error: membersError } = await admin
    .from('org_members')
    .select('user_id')
    .eq('org_id', orgId);
  const orgMemberIds = membersError
    ? []
    : [...new Set((members ?? []).map((row: { user_id?: string | null }) => row.user_id).filter(Boolean))] as string[];
  const contactOwnerIds = orgMemberIds.length > 0 ? orgMemberIds : [userId];

  const { data, error } = await admin
    .from('contacts')
    .select('linkedin_url, email, first_name, last_name, full_name, company_name')
    .in('user_id', contactOwnerIds);

  if (!error) return (data ?? []) as DuplicateCandidate[];
  if (contactOwnerIds.length === 1 && contactOwnerIds[0] === userId) {
    console.warn('[import-contacts] existing contact dedup lookup failed:', error.message);
    return [];
  }

  const { data: fallbackData, error: fallbackError } = await admin
    .from('contacts')
    .select('linkedin_url, email, first_name, last_name, full_name, company_name')
    .eq('user_id', userId);

  if (fallbackError) {
    console.warn('[import-contacts] fallback existing contact dedup lookup failed:', fallbackError.message);
    return [];
  }
  return (fallbackData ?? []) as DuplicateCandidate[];
}

async function loadPendingRawUploadDedupCandidates(
  admin: SupabaseLike,
  orgId: string,
  batchId: string,
): Promise<DuplicateCandidate[]> {
  const { data, error } = await admin
    .from('raw_uploads')
    .select('id, batch_id, full_name, email, linkedin_url, company_name, raw_data')
    .eq('org_id', orgId)
    .in('status', PENDING_IMPORT_DEDUP_STATUSES);

  if (error) {
    console.warn('[import-contacts] pending raw_upload dedup lookup failed:', error.message);
    return [];
  }

  return ((data ?? []) as Array<DuplicateCandidate & { batch_id?: string | null }>)
    .filter((row) => row.batch_id !== batchId);
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

    const orgId = await orgIdForUser(supabase, user.id);
    if (!orgId) {
      return NextResponse.json(WORKSPACE_REQUIRED_ERROR, { status: 409 });
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
      org_id: orgId,
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

    const admin = createAdminClient();
    const [existingContacts, pendingRawUploads] = await Promise.all([
      loadExistingContactDedupCandidates(admin, orgId, user.id),
      loadPendingRawUploadDedupCandidates(admin, orgId, batchId),
    ]);
    const { pendingRows, duplicateIds, duplicateReasons, clearedEmailIds } =
      classifyImportRowsForDedup({
        insertedRows: insertedRows as InsertedImportRow[],
        existingContacts,
        pendingRawUploads,
      });

    const quotaHeldIds: string[] = [];
    const rowsToEnrich = pendingRows;

    if (duplicateIds.length > 0) {
      const byReason = new Map<string, string[]>();
      for (const id of duplicateIds) {
        const reason = duplicateReasons.get(id) || 'Duplicate of existing contact';
        const ids = byReason.get(reason) ?? [];
        ids.push(id);
        byReason.set(reason, ids);
      }
      for (const [reason, ids] of byReason) {
        await supabase
          .from('raw_uploads')
          .update({ status: 'duplicate', failure_reason: reason })
          .in('id', ids);
      }
    }

    if (clearedEmailIds.length > 0) {
      // Persist the email-stripped state on raw_uploads so logs reflect what
      // actually got fed into enrichment.
      await supabase
        .from('raw_uploads')
        .update({ email: null })
        .in('id', clearedEmailIds);
    }

    if (quotaHeldIds.length > 0) {
      await supabase
        .from('raw_uploads')
        .update({
          status: 'failed',
          failure_reason: 'Held back by enrichment quota',
          enriched_at: new Date().toISOString(),
        })
        .in('id', quotaHeldIds);
    }

    const pendingIds = rowsToEnrich.map((row) => row.id as string);
    if (pendingIds.length > 0) {
      await supabase.from('raw_uploads').update({ status: 'enriching' }).in('id', pendingIds);
    }

    await supabase
      .from('upload_batches')
      .update({ duplicate_rows: duplicateIds.length, failed_rows: quotaHeldIds.length })
      .eq('id', batchId);

    if (rowsToEnrich.length === 0) {
      await refreshBatchProgress(admin, batchId);
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

    getPostHogClient().capture({
      distinctId: user.id,
      event: 'contacts_imported',
      properties: {
        batch_id: batchId,
        total_uploaded: rows.length,
        duplicates_removed: duplicateIds.length,
        being_enriched: pendingIds.length,
      },
    });
    after(() => getPostHogClient().flush());

    return NextResponse.json({
      batchId,
      totalUploaded: rows.length,
      duplicatesRemoved: duplicateIds.length,
      heldBackByQuota: quotaHeldIds.length,
      beingEnriched: pendingIds.length,
      complete: 0,
      failed: 0,
      warning: null,
    });
  } catch (error) {
    console.error('Error in import-contacts POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
