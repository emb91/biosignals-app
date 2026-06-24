import { after, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';
import { getPostHogClient } from '@/lib/posthog-server';
import { orgIdForUser } from '@/lib/org-context';
import { refreshBatchProgress } from '@/lib/import-queue';
import {
  type CompanyImportField,
  type CompanyImportRow,
  COMPANY_IMPORT_CREDITS_PER_COMPANY,
  companyRowHasIdentifier,
  isOwnedCompany,
  loadOwnedCompanyKeys,
  mapRowToCompany,
  normalizeCompanyRows,
  processQueuedCompaniesInBackground,
} from '@/lib/company-import';

// Enrichment runs in the background after() job (per company: Apollo + Apify +
// web-search modules), so give the response a generous ceiling.
export const maxDuration = 300;

type PartitionResult = {
  totalRows: number;
  invalid: number;
  importable: CompanyImportRow[];
  alreadyImported: CompanyImportRow[];
};

/**
 * POST /api/import-companies
 *
 * Company-first import. Pass `preview: true` to get a cost + dedup breakdown
 * WITHOUT spending anything; pass `preview: false` (or omit) to actually import.
 */
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
        ? (body.columnMappings as Record<string, CompanyImportField>)
        : {};
    const filename = typeof body?.filename === 'string' ? body.filename : 'companies.csv';
    const preview = body?.preview === true;

    if (headers.length === 0 || rows.length === 0) {
      return NextResponse.json({ error: 'No rows to import' }, { status: 400 });
    }

    const admin = createAdminClient();

    // Partition: invalid (no usable identifier), already-owned, and importable.
    const invalid = rows.filter((row) => !companyRowHasIdentifier(mapRowToCompany(headers, row, columnMappings))).length;
    const uniqueRows = normalizeCompanyRows(headers, rows, columnMappings);
    const owned = await loadOwnedCompanyKeys(admin, user.id);
    const importable: CompanyImportRow[] = [];
    const alreadyImported: CompanyImportRow[] = [];
    for (const row of uniqueRows) {
      if (isOwnedCompany(row, owned)) alreadyImported.push(row);
      else importable.push(row);
    }
    const partition: PartitionResult = { totalRows: rows.length, invalid, importable, alreadyImported };

    if (preview) {
      return NextResponse.json({
        totalRows: partition.totalRows,
        importable: partition.importable.length,
        alreadyImported: partition.alreadyImported.length,
        invalid: partition.invalid,
        creditsPerCompany: COMPANY_IMPORT_CREDITS_PER_COMPANY,
        estimatedCredits: partition.importable.length * COMPANY_IMPORT_CREDITS_PER_COMPANY,
      });
    }

    const orgId = await orgIdForUser(supabase, user.id);

    const uploadedCount = partition.importable.length + partition.alreadyImported.length;
    const { data: batch, error: batchError } = await supabase
      .from('upload_batches')
      .insert({
        user_id: user.id,
        filename,
        total_rows: uploadedCount,
        duplicate_rows: partition.alreadyImported.length,
        status: 'processing',
      })
      .select('id')
      .single();
    if (batchError || !batch) {
      console.error('[import-companies] failed to create batch:', batchError);
      return NextResponse.json({ error: 'Failed to create upload batch' }, { status: 500 });
    }
    const batchId = batch.id as string;

    const rawUploadRow = (row: CompanyImportRow, status: 'pending' | 'duplicate') => ({
      user_id: user.id,
      org_id: orgId,
      batch_id: batchId,
      raw_data: {
        company_name: row.company_name,
        company_domain: row.company_domain,
        company_linkedin_url: row.company_linkedin_url,
        kind: 'company',
      } as Record<string, unknown>,
      company_name: row.company_name || null,
      status,
      failure_reason: status === 'duplicate' ? 'Already in your companies' : null,
    });

    const insertPayload = [
      ...partition.importable.map((row) => rawUploadRow(row, 'pending')),
      ...partition.alreadyImported.map((row) => rawUploadRow(row, 'duplicate')),
    ];

    const { data: insertedRows, error: insertError } = await supabase
      .from('raw_uploads')
      .insert(insertPayload)
      .select('id, status, raw_data');
    if (insertError || !insertedRows) {
      console.error('[import-companies] failed to insert raw uploads:', insertError);
      return NextResponse.json({ error: 'Failed to store uploaded rows' }, { status: 500 });
    }

    const queuedRows = (insertedRows as Array<{ id: string; status: string; raw_data: Record<string, unknown> }>)
      .filter((row) => row.status === 'pending')
      .map((row) => ({
        id: row.id,
        row: {
          company_name: (row.raw_data.company_name as string) || '',
          company_domain: (row.raw_data.company_domain as string) || '',
          company_linkedin_url: (row.raw_data.company_linkedin_url as string) || '',
        } as CompanyImportRow,
      }));

    if (queuedRows.length === 0) {
      await refreshBatchProgress(admin, batchId);
    } else {
      const backgroundTask = () =>
        processQueuedCompaniesInBackground({ queuedRows, batchId, userId: user.id });
      if (process.env.NODE_ENV === 'development') {
        setTimeout(() => void backgroundTask(), 0);
      } else {
        after(backgroundTask);
      }
    }

    getPostHogClient().capture({
      distinctId: user.id,
      event: 'companies_imported',
      properties: {
        batch_id: batchId,
        total_uploaded: uploadedCount,
        already_owned: partition.alreadyImported.length,
        invalid: partition.invalid,
        being_enriched: queuedRows.length,
      },
    });
    after(() => getPostHogClient().flush());

    return NextResponse.json({
      batchId,
      totalUploaded: uploadedCount,
      duplicatesRemoved: partition.alreadyImported.length,
      invalid: partition.invalid,
      beingEnriched: queuedRows.length,
    });
  } catch (error) {
    console.error('[import-companies] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
