/**
 * Shared enrichment queue logic — used by both the import-contacts route and
 * the daily HubSpot cron so they both trigger the same background pipeline.
 */
import { enrichContact } from '@/lib/enrichment-provider';
import { recordProviderUsage } from '@/lib/provider-usage';
import { ingestEnrichedRecords, type EnrichedImportRecord, type ImportProgressCallback } from '@/lib/import-ingestion';
import { runContactResolutionPipelineForContact } from '@/lib/contact-resolution-pipeline';
import { createAdminClient } from '@/lib/supabase-admin';
import { resolveLinkedinUrl, type LinkedinResolutionInput } from '@/lib/linkedin-url-resolver';
import { triageContacts, TRIAGE_VERSION, type TriageGroup, type TriageIcpContext } from '@/lib/triage';
import { getOrgEntitlements } from '@/lib/billing/entitlements';
import { checkAndIncrementUsage } from '@/lib/billing/credits';
import { refreshMonitoringUniverse } from '@/lib/billing/monitoring';

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
    ['awaiting_triage', 'awaiting_enrichment', 'enriched', 'duplicate', 'failed'].includes((row as { status: string }).status)
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

/**
 * The contact's LinkedIn URL is the canonical key — a row with none is bounced
 * at storage. Prefer the one we already have (Apollo result or CSV); if there's
 * none, resolve it via web search BEFORE storage so the contact lands instead of
 * being silently dropped (important for HubSpot contacts + small biotechs Apollo
 * can't surface). Best-effort: returns '' only if it genuinely can't be resolved.
 */
async function linkedinForStorage(
  direct: string,
  identityRow: NormalisedRow,
  apolloPerson?: unknown,
): Promise<string> {
  const known = (direct || '').trim();
  if (known) return known;
  try {
    const resolved = await resolveLinkedinUrl({
      full_name: identityRow.full_name || null,
      first_name: identityRow.first_name || null,
      last_name: identityRow.last_name || null,
      email: identityRow.email || null,
      linkedin_url: null,
      company_name: identityRow.company_name || null,
      company_domain: identityRow.company_domain || null,
      location: identityRow.location || null,
      // Apollo's revealed record (employment history, city/country) materially
      // improves match precision — pass it through when enrichment produced one.
      apollo_person: (apolloPerson as LinkedinResolutionInput['apollo_person']) ?? null,
    });
    return (resolved?.linkedin_url || '').trim();
  } catch (e) {
    console.error('[import-queue] pre-storage LinkedIn resolution failed:', e);
    return '';
  }
}

/**
 * Load a coarse ICP description for ICP-aware triage. Aggregates the workspace's
 * ICP(s) and buyer persona(s) (org-scoped when the user belongs to an org, else
 * their own rows). Returns null when there is no usable signal so triage falls
 * back to the generic life-sciences prompt.
 */
async function loadIcpTriageContext(
  admin: ReturnType<typeof createAdminClient>,
  { orgId, userId }: { orgId?: string | null; userId: string },
): Promise<TriageIcpContext | null> {
  const uniq = (values: Array<string | null | undefined>): string[] => {
    const seen = new Set<string>();
    for (const v of values) {
      const t = (v ?? '').trim();
      if (t) seen.add(t);
    }
    return [...seen];
  };

  const scopeCol = orgId ? 'org_id' : 'user_id';
  const scopeVal = orgId ?? userId;

  const [{ data: icps }, { data: personas }] = await Promise.all([
    admin
      .from('icps')
      .select(
        'icp_summary, company_type, therapeutic_areas, modalities, development_stages, target_customers, buyer_types, example_companies, customer_therapeutic_areas, customer_modalities',
      )
      .eq(scopeCol, scopeVal)
      .limit(5),
    admin
      .from('personas')
      .select('functions, job_titles, seniority_levels')
      .eq(scopeCol, scopeVal)
      .limit(8),
  ]);

  if ((!icps || icps.length === 0) && (!personas || personas.length === 0)) return null;

  const icpRows = (icps ?? []) as Array<Record<string, unknown>>;
  const personaRows = (personas ?? []) as Array<Record<string, unknown>>;
  const arr = (row: Record<string, unknown>, key: string): string[] =>
    Array.isArray(row[key]) ? (row[key] as unknown[]).map((x) => String(x)) : [];

  const context: TriageIcpContext = {
    summary: uniq(icpRows.map((r) => r.icp_summary as string | null)).join(' | ') || null,
    companyTypes: uniq(icpRows.map((r) => r.company_type as string | null)),
    therapeuticAreas: uniq([
      ...icpRows.flatMap((r) => arr(r, 'therapeutic_areas')),
      ...icpRows.flatMap((r) => arr(r, 'customer_therapeutic_areas')),
    ]),
    modalities: uniq([
      ...icpRows.flatMap((r) => arr(r, 'modalities')),
      ...icpRows.flatMap((r) => arr(r, 'customer_modalities')),
    ]),
    developmentStages: uniq(icpRows.flatMap((r) => arr(r, 'development_stages'))),
    targetCustomers: uniq(icpRows.flatMap((r) => arr(r, 'target_customers'))),
    buyerTypes: uniq(icpRows.flatMap((r) => arr(r, 'buyer_types'))),
    exampleCompanies: uniq(icpRows.flatMap((r) => arr(r, 'example_companies'))),
    buyerRoles: uniq([
      ...personaRows.flatMap((r) => arr(r, 'functions')),
      ...personaRows.flatMap((r) => arr(r, 'job_titles')),
      ...personaRows.flatMap((r) => arr(r, 'seniority_levels')),
    ]),
  };

  const hasSignal =
    Boolean(context.summary) ||
    Object.values(context).some((v) => Array.isArray(v) && v.length > 0);
  return hasSignal ? context : null;
}

export async function processQueuedRowsInBackground(params: {
  queuedRows: QueuedRow[];
  batchId: string;
  userId: string;
  onBeforeIngest?: () => void | Promise<void>;
  onProgress?: ImportProgressCallback;
  /** Explicitly approved acquisition/enrichment jobs may continue past triage. */
  autoEnrich?: boolean;
}): Promise<void> {
  const { queuedRows, batchId, userId, onBeforeIngest, onProgress, autoEnrich = false } = params;
  const allQueuedIds = queuedRows.map((row) => row.id);

  const admin = createAdminClient();
  const enrichedRecords: EnrichedImportRecord[] = [];
  const failedIds: string[] = [];
  const failureReasons = new Map<string, string>();
  const markFailed = (id: string, reason: string) => {
    failedIds.push(id);
    failureReasons.set(id, reason);
  };

  const { data: member } = await admin.from('org_members').select('org_id')
    .eq('user_id', userId).maybeSingle<{ org_id: string }>();
  let triageRows = queuedRows;
  let overflowRows: QueuedRow[] = [];
  if (member?.org_id) {
    const entitlements = await getOrgEntitlements(member.org_id);
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const { data: usageRows } = await admin.from('org_usage_events').select('quantity')
      .eq('org_id', member.org_id).eq('action_type', 'import_triage').gte('occurred_at', monthStart);
    const used = (usageRows ?? []).reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
    const remaining = Math.max(0, entitlements.caps.importedRecordsTriagedMonthly - used);
    triageRows = queuedRows.slice(0, remaining);
    overflowRows = queuedRows.slice(remaining);
    if (triageRows.length) {
      await checkAndIncrementUsage({
        orgId: member.org_id,
        userId,
        action: 'import_triage',
        quantity: triageRows.length,
        operationKey: `import-triage:${batchId}`,
        limit: entitlements.caps.importedRecordsTriagedMonthly,
        window: 'utc_month',
      });
    }
  }

  if (overflowRows.length) {
    await admin.from('raw_uploads').update({
      status: 'awaiting_triage',
      failure_reason: null,
    }).in('id', overflowRows.map((row) => row.id));
  }

  // Batch-triage all rows before spending Apollo/Apify credits.
  // Triage is ICP-aware: load the org's ICP(s) + buyer persona(s) so the
  // classifier scores each row against who we actually target, not a generic
  // biotech yardstick. 'low'-classified rows are stored with minimal identity
  // data only (no enrichment).
  const icpContext = await loadIcpTriageContext(admin, { orgId: member?.org_id, userId });
  const triageMap = await triageContacts(
    triageRows.map((r) => ({
      id: r.id,
      job_title: (r.raw_data.job_title as string) || null,
      company_name: r.company_name,
      email: r.email,
    })),
    { icp: icpContext },
  );

  const triageNow = new Date().toISOString();
  for (const row of triageRows) {
    const result = triageMap.get(row.id) ?? { group: 'medium' as TriageGroup, version: TRIAGE_VERSION };
    await admin.from('raw_uploads').update({
      triage_group: result.group,
      triage_version: result.version,
      triage_scored_at: triageNow,
      status: autoEnrich ? 'enriching' : 'awaiting_enrichment',
      failure_reason: null,
    }).eq('id', row.id);
  }
  if (!autoEnrich) {
    await refreshBatchProgress(admin, batchId);
    return;
  }

  try {
    for (const row of triageRows) {
      if (await isBatchCancelled(admin, batchId)) break;

      const triageResult = triageMap.get(row.id) ?? { group: 'medium' as TriageGroup, version: TRIAGE_VERSION };

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

      // Apollo couldn't surface this person — but we can still find them from
      // LinkedIn. As long as we have the LinkedIn URL (the canonical key), keep
      // the contact from the raw CSV data and let the resolution pipeline run
      // (its profile step is an Apify LinkedIn scrape, which doesn't need Apollo).
      // Returns true if kept, false if it genuinely can't be stored (no key).
      const keepForLinkedinFallback = async (triage?: { group: TriageGroup; version: string }): Promise<boolean> => {
        const linkedin = await linkedinForStorage(fallbackRow.linkedin_url, fallbackRow);
        if (!linkedin) return false;
        enrichedRecords.push({
          raw_upload_id: row.id,
          batch_id: batchId,
          user_id: userId,
          full_name: fallbackRow.full_name || undefined,
          first_name: fallbackRow.first_name || undefined,
          last_name: fallbackRow.last_name || undefined,
          email: fallbackRow.email || undefined,
          job_title: fallbackRow.job_title || undefined,
          linkedin_url: linkedin,
          company_name: fallbackRow.company_name || undefined,
          company_domain: fallbackRow.company_domain || undefined,
          company_linkedin_url: fallbackRow.company_linkedin_url || undefined,
          location: fallbackRow.location || undefined,
          triage_group: triage?.group,
          triage_version: triage?.version,
        });
        return true;
      };

      // 'low'-triaged rows from unsolicited bulk imports are stored with minimal
      // identity only (skip paid Apollo/Apify enrichment). But contacts the user
      // EXPLICITLY sourced (autoEnrich — paid per contact, confirmed the
      // purchase) must be fully enriched and delivered regardless of fit triage:
      // skipping them strands the row at 'enriching' and silently loses a paid
      // lead. Apollo people-search rows are obfuscated, so they almost always
      // lack a LinkedIn here and would otherwise be dropped by this branch.
      if (triageResult.group === 'low' && !autoEnrich) {
        if (fallbackRow.linkedin_url) {
          await keepForLinkedinFallback(triageResult);
        }
        // No LinkedIn URL + low triage = nothing to store; skip silently.
        continue;
      }

      // People discovered via Apollo search (api_search) arrive obfuscated — no
      // plaintext last name/email/linkedin — so name/linkedin matching can't
      // identify them. The Apollo person id (captured at discovery) is the only
      // reliable people/match key, so thread it through when present.
      const apolloPersonId =
        ((rawData.apollo_person_raw as { id?: unknown } | null | undefined)?.id as string | undefined) || undefined;

      try {
        const enrichmentResult = await enrichContact({ ...fallbackRow, apollo_person_id: apolloPersonId });

        if (await isBatchCancelled(admin, batchId)) break;

        if (!hasConfidentEnrichment(enrichmentResult, fallbackRow)) {
          if (!(await keepForLinkedinFallback(triageResult))) {
            markFailed(
              row.id,
              fallbackRow.linkedin_url
                ? 'Enrichment returned no confident match'
                : 'No enrichment match and no LinkedIn URL for fallback'
            );
          }
          continue;
        }

        const finalLocation = enrichmentResult.location || location;
        const parsedLocation = parseLocation(finalLocation);

        // Resolve the canonical key before storage: Apollo's LinkedIn, else the
        // CSV's, else a web-search resolution. Feed the resolver the ENRICHED
        // identity (real email + revealed name from people/match), not the raw
        // search row — Apollo people-search (api_search) rows arrive obfuscated
        // (no email, first-name-only), and most Apollo people have no LinkedIn,
        // so a starved resolver would drop contacts we can actually resolve from
        // the revealed email/name.
        const identityForResolution: NormalisedRow = {
          ...fallbackRow,
          full_name: enrichmentResult.full_name || fallbackRow.full_name,
          first_name: enrichmentResult.first_name || fallbackRow.first_name,
          last_name: enrichmentResult.last_name || fallbackRow.last_name,
          email: enrichmentResult.email || fallbackRow.email,
          location: enrichmentResult.location || fallbackRow.location,
        };
        const resolvedLinkedinForStorage = await linkedinForStorage(
          enrichmentResult.linkedin_url || fallbackRow.linkedin_url || '',
          identityForResolution,
          enrichmentResult.apollo_person_raw,
        );
        if (!resolvedLinkedinForStorage) {
          markFailed(row.id, 'No LinkedIn URL found (Apollo, CSV, or web search) — cannot store');
          continue;
        }

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
          // Fall back to the CSV LinkedIn URL when Apollo matched the person but
          // returned no linkedin_url (common for small biotechs). The canonical
          // split REQUIRES a linkedin_url, so dropping it here silently failed the row.
          linkedin_url: resolvedLinkedinForStorage,
          profile_photo_url: enrichmentResult.profile_photo_url,
          headline: enrichmentResult.headline,
          // Persist title + employer onto the contact/company. Prefer the
          // enriched (Apollo) value, fall back to what the CSV provided. Without
          // these the ingested record dropped job_title and company_name/domain
          // to null, so the contact list showed blank role/company and contact
          // fit scored 0 even though Apollo returned the data.
          job_title: enrichmentResult.job_title || (rawData.job_title as string) || undefined,
          company_name: enrichmentResult.company_name || (rawData.company_name as string) || undefined,
          company_domain:
            enrichmentResult.company_domain || (rawData.company_domain as string) || undefined,
          location: finalLocation,
          city: parsedLocation.city || undefined,
          country: parsedLocation.country || undefined,
          raw_person_response: enrichmentResult.raw_person_response,
          raw_person: enrichmentResult.raw_person,
          apollo_person_response_raw: enrichmentResult.apollo_person_response_raw,
          apollo_person_raw: enrichmentResult.apollo_person_raw,
          apollo_organization_raw: enrichmentResult.apollo_organization_raw,
          apollo_lookup_metadata: enrichmentResult.apollo_lookup_metadata,
          triage_group: triageResult.group,
          triage_version: triageResult.version,
        });

        // Non-blocking cost metering for the Apollo enrichment just performed.
        if (enrichmentResult.apollo_person_raw) {
          recordProviderUsage({ userId, provider: 'apollo', eventType: 'apollo_person_enrichment' }).catch(() => {});
        }
        if (enrichmentResult.apollo_organization_raw) {
          recordProviderUsage({ userId, provider: 'apollo', eventType: 'apollo_company_enrichment' }).catch(() => {});
        }
      } catch (error) {
        console.error('Contact enrichment failed for row:', row.id, error);
        if (!(await keepForLinkedinFallback())) {
          const message = error instanceof Error ? error.message : String(error);
          markFailed(row.id, `Enrichment error: ${message.slice(0, 200)}`);
        }
      }
    }

    if (failedIds.length > 0) {
      const byReason = new Map<string, string[]>();
      for (const id of failedIds) {
        const reason = failureReasons.get(id) || 'Enrichment failed';
        const ids = byReason.get(reason) ?? [];
        ids.push(id);
        byReason.set(reason, ids);
      }
      for (const [reason, ids] of byReason) {
        await admin
          .from('raw_uploads')
          .update({ status: 'failed', failure_reason: reason, enriched_at: new Date().toISOString() })
          .in('id', ids);
      }
    }

    if (enrichedRecords.length > 0) {
      if (onBeforeIngest) await onBeforeIngest();
      await ingestEnrichedRecords(
        admin as unknown as Parameters<typeof ingestEnrichedRecords>[0],
        enrichedRecords,
        { onProgress },
      );

      const { data: insertedContacts } = await admin
        .from('contacts')
        .select('id')
        .eq('user_id', userId)
        .eq('batch_id', batchId);

      for (const contact of insertedContacts || []) {
        const contactId = (contact as { id?: string }).id;
        if (!contactId) continue;
        // Resolution pipeline = LinkedIn resolution + Apify profile scrape. This
        // is the fallback that surfaces data on people Apollo couldn't match.
        // Per-contact try/catch so one un-scrapeable profile doesn't fail the
        // whole batch (the contact is already stored either way).
        try {
          await runContactResolutionPipelineForContact(
            admin as unknown as Parameters<typeof runContactResolutionPipelineForContact>[0],
            { contactId, userId }
          );
        } catch (pipelineError) {
          console.error('Resolution pipeline failed for contact:', contactId, pipelineError);
        }
      }
    }

    await refreshBatchProgress(admin, batchId);
    if (member?.org_id) {
      await refreshMonitoringUniverse(member.org_id).catch((error) => {
        console.error('[import-queue] monitoring refresh failed:', error);
      });
    }
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
        .update({
          status: 'failed',
          failure_reason: 'Background enrichment worker crashed',
          enriched_at: new Date().toISOString(),
        })
        .in('id', stuckIds);
    }

    await refreshBatchProgress(admin, batchId);
  }
}
