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
  findOrCreateCompany,
  isOwnedCompany,
  loadOwnedCompanyKeys,
  mapRowToCompany,
  normalizeCompanyRows,
} from '@/lib/company-import';
import { syncCompanyFitForCompanies } from '@/lib/company-fit';
import { refundCredits, reserveCredits } from '@/lib/billing/credits';

// The request creates/links company records synchronously so the user can land
// in /companies immediately. The provider-heavy deep enrichment runs later via
// the company-enrichment queue, so give the request a generous ceiling for large
// CSV validation + linking work.
export const maxDuration = 300;

type PartitionResult = {
  totalRows: number;
  duplicateRows: number;
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

    // Partition: invalid (no usable identifier), in-file duplicates,
    // already-owned, and importable. This is validation only; company-only
    // imports do not run contact/Haiku triage.
    const mappedRows = rows.map((row) => mapRowToCompany(headers, row, columnMappings));
    const validRows = mappedRows.filter(companyRowHasIdentifier);
    const invalid = mappedRows.length - validRows.length;
    const uniqueRows = normalizeCompanyRows(headers, rows, columnMappings);
    const duplicateRows = Math.max(validRows.length - uniqueRows.length, 0);
    const owned = await loadOwnedCompanyKeys(admin, user.id);
    const importable: CompanyImportRow[] = [];
    const alreadyImported: CompanyImportRow[] = [];
    for (const row of uniqueRows) {
      if (isOwnedCompany(row, owned)) alreadyImported.push(row);
      else importable.push(row);
    }
    const partition: PartitionResult = { totalRows: rows.length, duplicateRows, invalid, importable, alreadyImported };

    if (preview) {
      return NextResponse.json({
        totalRows: partition.totalRows,
        importable: partition.importable.length,
        duplicateRows: partition.duplicateRows,
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

    const acceptedCompanies: Array<{
      rawUploadId: string;
      companyId: string;
      created: boolean;
      startedAt: string | null;
      shouldSetRequested: boolean;
      transactionId: string | null;
    }> = [];
    let failedRows = 0;
    let firstFailureMessage: string | null = null;
    for (const queued of queuedRows) {
      try {
        const {
          companyId,
          created,
          alreadyEnriched,
          enrichmentStatus,
          enrichmentStartedAt,
        } = await findOrCreateCompany(admin, user.id, orgId, queued.row);
        const alreadyRequested = enrichmentStatus === 'requested' && Boolean(enrichmentStartedAt);
        const alreadyRunning = enrichmentStatus === 'running' && Boolean(enrichmentStartedAt);
        const startedAt = alreadyEnriched || alreadyRunning
          ? null
          : alreadyRequested
            ? enrichmentStartedAt
            : new Date().toISOString();
        const shouldSetRequested = Boolean(startedAt && !alreadyRequested);
        let transactionId: string | null = null;

        if (startedAt) {
          const reservation = orgId
            ? await reserveCredits({
                orgId,
                userId: user.id,
                action: 'company_enrichment',
                idempotencyKey: `company-deep-enrich:${companyId}:${startedAt}`,
                entityType: 'company',
                entityId: companyId,
              })
            : { ok: true as const, transactionId: null };

          if (!reservation.ok) {
            if (orgId) {
              await admin.from('org_companies').delete().eq('org_id', orgId).eq('company_id', companyId);
            }
            await admin.from('user_companies').delete().eq('user_id', user.id).eq('company_id', companyId);
            if (created) {
              await admin.from('companies').delete().eq('id', companyId);
            }
            throw new Error(reservation.message);
          }
          transactionId = reservation.transactionId;
        }

        acceptedCompanies.push({
          rawUploadId: queued.id,
          companyId,
          created,
          startedAt,
          shouldSetRequested,
          transactionId,
        });
      } catch (error) {
        failedRows++;
        firstFailureMessage = error instanceof Error ? error.message : 'Import failed.';
        break;
      }
    }
    if (firstFailureMessage) {
      await Promise.all(
        acceptedCompanies.map((accepted) => refundCredits(accepted.transactionId).catch(() => {})),
      );
      for (const accepted of acceptedCompanies) {
        if (orgId) {
          await admin.from('org_companies').delete().eq('org_id', orgId).eq('company_id', accepted.companyId);
        }
        await admin.from('user_companies').delete().eq('user_id', user.id).eq('company_id', accepted.companyId);
        if (accepted.created) {
          await admin.from('companies').delete().eq('id', accepted.companyId);
        }
      }
      const failedAt = new Date().toISOString();
      await admin
        .from('raw_uploads')
        .update({
          status: 'failed',
          failure_reason: firstFailureMessage.slice(0, 200),
          enriched_at: failedAt,
        })
        .eq('batch_id', batchId)
        .eq('status', 'pending');
      await refreshBatchProgress(admin, batchId);
      return NextResponse.json(
        {
          error: firstFailureMessage,
          failed: queuedRows.length,
        },
        { status: 402 },
      );
    }

    const touchedCompanyIds = acceptedCompanies.map((accepted) => accepted.companyId);
    const now = new Date().toISOString();
    for (const accepted of acceptedCompanies) {
      if (accepted.shouldSetRequested && accepted.startedAt) {
        await admin
          .from('companies')
          .update({
            enrichment_refresh_status: 'requested',
            enrichment_refresh_started_at: accepted.startedAt,
            enrichment_refresh_last_error: null,
          })
          .eq('id', accepted.companyId);
      }
      await admin
        .from('raw_uploads')
        .update({ status: 'enriched', failure_reason: null, enriched_at: now })
        .eq('id', accepted.rawUploadId);
    }
    if (touchedCompanyIds.length > 0) {
      await syncCompanyFitForCompanies(admin, user.id, touchedCompanyIds).catch((error) => {
        console.error('[import-companies] preliminary fit sync failed:', error);
      });
    }
    await refreshBatchProgress(admin, batchId);

    getPostHogClient().capture({
      distinctId: user.id,
      event: 'companies_imported',
      properties: {
        batch_id: batchId,
        total_uploaded: uploadedCount,
        duplicate_rows: partition.duplicateRows,
        already_owned: partition.alreadyImported.length,
        invalid: partition.invalid,
        being_enriched: touchedCompanyIds.length,
        failed_rows: failedRows,
      },
    });
    after(() => getPostHogClient().flush());

    return NextResponse.json({
      batchId,
      totalUploaded: uploadedCount,
      duplicateRows: partition.duplicateRows,
      duplicatesRemoved: partition.alreadyImported.length,
      invalid: partition.invalid,
      beingEnriched: touchedCompanyIds.length,
      failed: failedRows,
    });
  } catch (error) {
    console.error('[import-companies] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
