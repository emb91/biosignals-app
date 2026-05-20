/**
 * Shared enrichment queue logic — used by both the import-contacts route and
 * the daily HubSpot cron so they both trigger the same background pipeline.
 */
import { enrichContact } from '@/lib/enrichment-provider';
import { ingestEnrichedRecords, type EnrichedImportRecord } from '@/lib/import-ingestion';
import { runContactResolutionPipelineForContact } from '@/lib/contact-resolution-pipeline';
import { createAdminClient } from '@/lib/supabase-admin';

// ── Types ────────────────────────────────────────────────────────────────────

export type NormalisedRow = {
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

export type QueuedRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  linkedin_url: string | null;
  company_name: string | null;
  raw_data: Record<string, unknown>;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export function parseLocation(location?: string): { city: string | null; country: string | null } {
  if (!location) return { city: null, country: null };
  const parts = location.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { city: null, country: null };
  return {
    city: parts[0] || null,
    country: parts[parts.length - 1] || null,
  };
}

type EnrichmentCandidate = Awaited<ReturnType<typeof enrichContact>>;

export function hasConfidentEnrichment(
  result: EnrichmentCandidate,
  fallback: NormalisedRow
): boolean {
  const fullName = (result.full_name || fallback.full_name || '').trim();
  const contactDetail =
    result.email ||
    fallback.email ||
    result.linkedin_url ||
    fallback.linkedin_url;
  return Boolean(fullName && contactDetail);
}

export async function refreshBatchProgress(
  supabase: ReturnType<typeof createAdminClient>,
  batchId: string
): Promise<void> {
  const [{ data: batchStats }, { data: batchMeta }] = await Promise.all([
    supabase.from('raw_uploads').select('status').eq('batch_id', batchId),
    supabase.from('upload_batches').select('status').eq('id', batchId).maybeSingle(),
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

export async function isBatchCancelled(
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

// ── Main worker ───────────────────────────────────────────────────────────────

export async function processQueuedRowsInBackground(params: {
  queuedRows: QueuedRow[];
  batchId: string;
  userId: string;
}): Promise<void> {
  const { queuedRows, batchId, userId } = params;
  const allQueuedIds = queuedRows.map((row) => row.id);

  const admin = createAdminClient();
  const enrichedRecords: EnrichedImportRecord[] = [];
  const failedIds: string[] = [];

  try {
    for (const row of queuedRows) {
      if (await isBatchCancelled(admin, batchId)) break;

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
        const enrichmentResult = await enrichContact({ ...fallbackRow });

        if (await isBatchCancelled(admin, batchId)) break;

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
          // Phones captured from the CSV row are passed through verbatim;
          // import-ingestion calls ensureImportPhoneEntry which normalises
          // and dedupes per (user, contact, phone).
          phone: typeof rawData.phone === 'string' ? rawData.phone : undefined,
          mobile_phone:
            typeof rawData.mobile_phone === 'string'
              ? rawData.mobile_phone
              : typeof rawData.mobile === 'string'
                ? rawData.mobile
                : typeof rawData.cell === 'string'
                  ? (rawData.cell as string)
                  : undefined,
          work_phone:
            typeof rawData.work_phone === 'string'
              ? rawData.work_phone
              : typeof rawData.direct_phone === 'string'
                ? (rawData.direct_phone as string)
                : typeof rawData.office_phone === 'string'
                  ? (rawData.office_phone as string)
                  : undefined,
          linkedin_url: enrichmentResult.linkedin_url || '',
          profile_photo_url: enrichmentResult.profile_photo_url,
          headline: enrichmentResult.headline,
          location: finalLocation,
          city: parsedLocation.city || undefined,
          country: parsedLocation.country || undefined,
          raw_person_response: enrichmentResult.raw_person_response,
          raw_person: enrichmentResult.raw_person,
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

      const { data: insertedContacts } = await admin
        .from('contacts')
        .select('id')
        .eq('user_id', userId)
        .eq('batch_id', batchId);

      for (const contact of insertedContacts || []) {
        const contactId = (contact as { id?: string }).id;
        if (!contactId) continue;
        await runContactResolutionPipelineForContact(
          admin as unknown as Parameters<typeof runContactResolutionPipelineForContact>[0],
          { contactId, userId }
        );
      }
    }

    await refreshBatchProgress(admin, batchId);
  } catch (outerError) {
    console.error('Background enrichment worker crashed — marking remaining rows as failed', outerError);
    const processedIds = [
      ...failedIds,
      ...enrichedRecords.map((record) => record.raw_upload_id),
    ];
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
