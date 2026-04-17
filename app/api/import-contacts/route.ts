import { after, NextResponse } from 'next/server';
import { enrichContact } from '@/lib/enrichment-provider';
import { ingestEnrichedRecords, type EnrichedImportRecord } from '@/lib/import-ingestion';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';

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

type NormalisedRow = {
  full_name: string;
  first_name: string;
  last_name: string;
  company_name: string;
  company_domain: string;
  job_title: string;
  email: string;
  linkedin_url: string;
  location: string;
  company_linkedin_url: string;
};

type EnrichmentCandidate = Awaited<ReturnType<typeof enrichContact>>;

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

function parseLocation(location?: string) {
  if (!location) return { city: null, country: null };
  const parts = location.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { city: null, country: null };
  return {
    city: parts[0] || null,
    country: parts[parts.length - 1] || null,
  };
}

function hasConfidentEnrichment(result: EnrichmentCandidate, fallback: NormalisedRow): boolean {
  const fullName = (result.full_name || fallback.full_name || '').trim();
  const contactDetail = (result.email || fallback.email || result.linkedin_url || fallback.linkedin_url || '').trim();
  const companySignal = (result.company_domain || result.company_name || fallback.company_domain || fallback.company_name || '').trim();

  return Boolean(fullName && contactDetail && companySignal);
}

async function refreshBatchProgress(
  supabase: ReturnType<typeof createAdminClient>,
  batchId: string
) {
  const [{ data: batchStats }, { data: batchMeta }] = await Promise.all([
    supabase
      .from('raw_uploads')
      .select('status')
      .eq('batch_id', batchId),
    supabase
      .from('upload_batches')
      .select('status')
      .eq('id', batchId)
      .maybeSingle(),
  ]);

  if (!batchStats) return;

  const processed = batchStats.filter((row) =>
    ['enriched', 'duplicate', 'failed'].includes((row as { status: string }).status)
  ).length;

  const currentBatchStatus = (batchMeta?.status as string | undefined) || 'processing';
  const nextBatchStatus =
    currentBatchStatus === 'cancelled'
      ? 'cancelled'
      : processed >= batchStats.length
      ? 'complete'
      : 'processing';

  await supabase
    .from('upload_batches')
    .update({
      processed_rows: processed,
      duplicate_rows: batchStats.filter((row) => (row as { status: string }).status === 'duplicate').length,
      failed_rows: batchStats.filter((row) => (row as { status: string }).status === 'failed').length,
      status: nextBatchStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', batchId);
}

async function isBatchCancelled(
  supabase: ReturnType<typeof createAdminClient>,
  batchId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('upload_batches')
    .select('status')
    .eq('id', batchId)
    .maybeSingle();

  return (data?.status as string | undefined) === 'cancelled';
}

async function processQueuedRowsInBackground(params: {
  queuedRows: Array<{
    id: string;
    full_name: string | null;
    email: string | null;
    linkedin_url: string | null;
    company_name: string | null;
    raw_data: Record<string, unknown>;
  }>;
  batchId: string;
  userId: string;
}) {
  const { queuedRows, batchId, userId } = params;
  const allQueuedIds = queuedRows.map((row) => row.id);

  const admin = createAdminClient();
  const enrichedRecords: EnrichedImportRecord[] = [];
  const failedIds: string[] = [];

  try {
    for (const row of queuedRows) {
      if (await isBatchCancelled(admin, batchId)) {
        break;
      }

      const rawData = row.raw_data;
      const location = (rawData.location as string) || '';
      const fallbackRow: NormalisedRow = {
        full_name: (rawData.full_name as string) || row.full_name || '',
        first_name: (rawData.first_name as string) || '',
        last_name: (rawData.last_name as string) || '',
        company_name: row.company_name || '',
        company_domain: (rawData.company_domain as string) || '',
        job_title: (rawData.job_title as string) || '',
        email: row.email || '',
        linkedin_url: row.linkedin_url || '',
        location,
        company_linkedin_url: (rawData.company_linkedin_url as string) || '',
      };

      try {
        const enrichmentResult = await enrichContact({
          ...fallbackRow,
        });

        if (await isBatchCancelled(admin, batchId)) {
          break;
        }

        if (!hasConfidentEnrichment(enrichmentResult, fallbackRow)) {
          failedIds.push(row.id);
          continue;
        }

        const finalLocation = enrichmentResult.location || location;
        const parsedLocation = parseLocation(finalLocation);

        enrichedRecords.push({
          raw_upload_id: row.id,
          batch_id: batchId,
          user_id: userId,
          enrichment_provider: enrichmentResult.provider,
          full_name: enrichmentResult.full_name || (rawData.full_name as string) || row.full_name || '',
          first_name: enrichmentResult.first_name || (rawData.first_name as string) || '',
          last_name: enrichmentResult.last_name || (rawData.last_name as string) || '',
          email: enrichmentResult.email || row.email || '',
          linkedin_url: enrichmentResult.linkedin_url || row.linkedin_url || '',
          profile_photo_url: enrichmentResult.profile_photo_url,
          job_title: enrichmentResult.job_title || (rawData.job_title as string) || '',
          headline: enrichmentResult.headline,
          location: finalLocation,
          city: parsedLocation.city || undefined,
          country: parsedLocation.country || undefined,
          company_name: enrichmentResult.company_name || row.company_name || '',
          company_domain: enrichmentResult.company_domain || (rawData.company_domain as string) || '',
          company_linkedin_url:
            enrichmentResult.company_linkedin_url || (rawData.company_linkedin_url as string) || '',
          company_description: enrichmentResult.company_description,
          company_industry: enrichmentResult.company_industry,
          company_sub_industry: enrichmentResult.company_sub_industry,
          company_employee_count: enrichmentResult.company_employee_count,
          company_employee_range: enrichmentResult.company_employee_range,
          company_founded_year: enrichmentResult.company_founded_year,
          company_hq_city: enrichmentResult.company_hq_city,
          company_hq_country: enrichmentResult.company_hq_country,
          company_funding_stage: enrichmentResult.company_funding_stage,
          company_total_funding_usd: enrichmentResult.company_total_funding_usd,
          company_latest_funding_date: enrichmentResult.company_latest_funding_date,
          company_therapeutic_areas: enrichmentResult.company_therapeutic_areas,
          company_modalities: enrichmentResult.company_modalities,
          company_clinical_stage: enrichmentResult.company_clinical_stage,
          raw_person_response: enrichmentResult.raw_person_response,
          raw_company_response: enrichmentResult.raw_company_response,
          raw_person: enrichmentResult.raw_person,
          raw_company: enrichmentResult.raw_company,
          fiber_lookup_metadata: enrichmentResult.fiber_lookup_metadata,
          apollo_person_response_raw: enrichmentResult.apollo_person_response_raw,
          apollo_person_raw: enrichmentResult.apollo_person_raw,
          apollo_organization_raw: enrichmentResult.apollo_organization_raw,
          apollo_lookup_metadata: enrichmentResult.apollo_lookup_metadata,
        });
      } catch (error) {
        console.error('Contact enrichment failed for row:', row.id, error);
        failedIds.push(row.id);
      }
    }

    if (failedIds.length > 0) {
      await admin
        .from('raw_uploads')
        .update({ status: 'failed', enriched_at: new Date().toISOString() })
        .in('id', failedIds);
    }

    if (enrichedRecords.length > 0) {
      await ingestEnrichedRecords(
        admin as unknown as Parameters<typeof ingestEnrichedRecords>[0],
        enrichedRecords
      );
    }

    await refreshBatchProgress(admin, batchId);
  } catch (outerError) {
    console.error('Background enrichment worker crashed — marking remaining rows as failed', outerError);
    const processedIds = [...failedIds, ...enrichedRecords.map((record) => record.raw_upload_id)];
    const stuckIds = allQueuedIds.filter((id) => !processedIds.includes(id));

    if (stuckIds.length > 0) {
      await admin
        .from('raw_uploads')
        .update({ status: 'failed', enriched_at: new Date().toISOString() })
        .in('id', stuckIds);
    }

    await refreshBatchProgress(admin, batchId);
  }
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

      const isDupe = (existingContacts || []).some((contact) =>
        isExactDuplicate(rowNorm, contact as Record<string, unknown>)
      );

      if (isDupe) {
        duplicateIds.push(row.id as string);
        return false;
      }
      return true;
    });

    if (duplicateIds.length > 0) {
      await supabase.from('raw_uploads').update({ status: 'duplicate' }).in('id', duplicateIds);
    }

    const pendingIds = pendingRows.map((row) => row.id as string);
    if (pendingIds.length > 0) {
      await supabase.from('raw_uploads').update({ status: 'enriching' }).in('id', pendingIds);
    }

    await supabase
      .from('upload_batches')
      .update({ duplicate_rows: duplicateIds.length })
      .eq('id', batchId);

    if (pendingRows.length === 0) {
      await refreshBatchProgress(createAdminClient(), batchId);
    } else {
      const queuedRows = pendingRows.map((row) => ({
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
      beingEnriched: pendingIds.length,
      complete: 0,
      failed: 0,
    });
  } catch (error) {
    console.error('Error in import-contacts POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
