import { employeeCountToSizeBucket, SENIORITY_LEVEL_OPTIONS, BUSINESS_AREA_OPTIONS } from '@/lib/arcova-taxonomy';
import { syncCompanyFitForCompanies } from '@/lib/company-fit';

export type EnrichedImportRecord = {
  raw_upload_id: string;
  batch_id?: string;
  user_id: string;
  enrichment_provider?: 'apollo' | 'fiber';
  full_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  linkedin_url?: string;
  profile_photo_url?: string;
  job_title?: string;
  job_title_standardised?: string;
  seniority_level?: string;
  business_area?: string;
  headline?: string;
  years_in_current_role?: number;
  location?: string;
  city?: string;
  country?: string;
  company_name?: string;
  company_domain?: string;
  company_linkedin_url?: string;
  company_description?: string;
  company_industry?: string;
  company_sub_industry?: string;
  company_employee_count?: number;
  company_employee_range?: string;
  company_founded_year?: number;
  company_hq_city?: string;
  company_hq_country?: string;
  company_funding_stage?: string;
  company_total_funding_usd?: number;
  company_latest_funding_date?: string;
  company_therapeutic_areas?: string[];
  company_modalities?: string[];
  company_clinical_stage?: string;
  raw_person_response?: unknown;
  raw_company_response?: unknown;
  raw_person?: unknown;
  raw_company?: unknown;
  fiber_lookup_metadata?: unknown;
  apollo_person_response_raw?: unknown;
  apollo_person_raw?: unknown;
  apollo_organization_raw?: unknown;
  apollo_lookup_metadata?: unknown;
};

type ExistingContact = {
  linkedin_url: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
};

type MinimalSupabase = {
  from: (table: string) => any;
};

const normalize = (value: string | null | undefined) => (value || '').trim().toLowerCase();

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function formatSupabaseErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;

  const candidate = error as {
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };

  const parts = [candidate.message, candidate.details, candidate.hint]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);

  return parts.length > 0 ? parts.join(' | ') : null;
}

function pickCanonicalString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return null;
}

function pickCanonicalNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(/[$,]/g, '').trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function pickCanonicalStringArray(...values: unknown[]): string[] | null {
  for (const value of values) {
    if (!Array.isArray(value)) continue;

    const normalized = value
      .map((item) => normalizeString(item))
      .filter(Boolean);

    if (normalized.length > 0) return normalized;
  }

  return null;
}

type ExistingCompany = {
  id: string;
  company_name: string | null;
  linkedin_url: string | null;
  description: string | null;
  industry: string | null;
  sub_industry: string | null;
  employee_count: number | string | null;
  employee_range: string | null;
  founded_year: number | string | null;
  headquarters_city: string | null;
  headquarters_country: string | null;
  therapeutic_areas: string[] | null;
  modalities: string[] | null;
  clinical_stage: string | null;
  source: string | null;
};

function isMissingColumnError(error: unknown): boolean {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : '';

  return message.includes('column') && message.includes('does not exist');
}

function isDuplicateContact(record: EnrichedImportRecord, existing: ExistingContact): boolean {
  const rLinkedin = normalize(record.linkedin_url);
  const rEmail = normalize(record.email);
  const rFirst = normalize(record.first_name);
  const rLast = normalize(record.last_name);
  const rCompany = normalize(record.company_name);

  const eLinkedin = normalize(existing.linkedin_url);
  const eEmail = normalize(existing.email);
  const eFirst = normalize(existing.first_name);
  const eLast = normalize(existing.last_name);
  const eCompany = normalize(existing.company_name);

  if (rLinkedin && eLinkedin && rLinkedin === eLinkedin) return true;
  if (rEmail && eEmail && rEmail === eEmail) return true;
  if (
    rFirst && rLast && rCompany &&
    eFirst && eLast && eCompany &&
    rFirst === eFirst && rLast === eLast && rCompany === eCompany
  ) return true;

  return false;
}

function splitLocation(location?: string | null) {
  if (!location) return { city: null, country: null };
  const parts = location.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { city: null, country: null };
  if (parts.length === 1) return { city: parts[0], country: null };
  return {
    city: parts[0] || null,
    country: parts[parts.length - 1] || null,
  };
}

async function upsertCompany(
  supabase: MinimalSupabase,
  userId: string,
  record: EnrichedImportRecord
): Promise<string | null> {
  const domain = record.company_domain?.trim().toLowerCase();
  if (!domain) return null;

  const context = `user=${userId} domain=${domain}`;

  const existing = await supabase
    .from('companies')
    .select(
      'id, company_name, linkedin_url, description, industry, sub_industry, employee_count, employee_range, founded_year, headquarters_city, headquarters_country, therapeutic_areas, modalities, clinical_stage, source'
    )
    .eq('user_id', userId)
    .eq('domain', domain)
    .maybeSingle();

  const existingError = formatSupabaseErrorMessage(existing?.error);
  if (existingError) {
    throw new Error(`[import-ingestion] Failed to look up company (${context}): ${existingError}`);
  }

  const existingCompany = (existing?.data as ExistingCompany | null) || null;
  const now = new Date().toISOString();
  const companyPayload = {
    user_id: userId,
    domain,
    company_name: pickCanonicalString(record.company_name, existingCompany?.company_name),
    linkedin_url: pickCanonicalString(record.company_linkedin_url, existingCompany?.linkedin_url),
    description: pickCanonicalString(record.company_description, existingCompany?.description),
    industry: pickCanonicalString(record.company_industry, existingCompany?.industry),
    sub_industry: pickCanonicalString(record.company_sub_industry, existingCompany?.sub_industry),
    employee_count: pickCanonicalNumber(record.company_employee_count, existingCompany?.employee_count),
    employee_range: pickCanonicalString(record.company_employee_range, existingCompany?.employee_range),
    company_size_bucket: employeeCountToSizeBucket(
      pickCanonicalNumber(record.company_employee_count, existingCompany?.employee_count) ?? null,
      pickCanonicalString(record.company_employee_range, existingCompany?.employee_range) ?? null,
    )[0] ?? null,
    founded_year: pickCanonicalNumber(record.company_founded_year, existingCompany?.founded_year),
    headquarters_city: pickCanonicalString(record.company_hq_city, existingCompany?.headquarters_city),
    headquarters_country: pickCanonicalString(
      record.company_hq_country,
      existingCompany?.headquarters_country
    ),
    therapeutic_areas: pickCanonicalStringArray(
      record.company_therapeutic_areas,
      existingCompany?.therapeutic_areas
    ),
    modalities: pickCanonicalStringArray(record.company_modalities, existingCompany?.modalities),
    clinical_stage: pickCanonicalString(record.company_clinical_stage, existingCompany?.clinical_stage),
    source: record.enrichment_provider || existingCompany?.source || 'imported',
    last_enriched_at: now,
    updated_at: now,
  };

  if (existingCompany?.id) {
    const updateResult = await supabase
      .from('companies')
      .update(companyPayload)
      .eq('id', existingCompany.id);

    const updateError = formatSupabaseErrorMessage(updateResult?.error);
    if (updateError) {
      throw new Error(
        `[import-ingestion] Failed to update canonical company row (${context} id=${existingCompany.id}): ${updateError}`
      );
    }

    return existingCompany.id;
  }

  const insertResult = (await supabase
    .from('companies')
    .insert(companyPayload)
    .select('id')
    .single()) as { data: Record<string, unknown> | null; error?: unknown };

  const insertError = formatSupabaseErrorMessage(insertResult?.error);
  if (insertError) {
    throw new Error(`[import-ingestion] Failed to insert canonical company row (${context}): ${insertError}`);
  }

  return (insertResult.data?.id as string) ?? null;
}

export async function ingestEnrichedRecords(
  supabase: MinimalSupabase,
  records: EnrichedImportRecord[]
): Promise<{ inserted: number; duplicates: number; failed: number }> {
  if (records.length === 0) {
    return { inserted: 0, duplicates: 0, failed: 0 };
  }

  const userId = records[0].user_id;

  const { data: existingContactsData } = await supabase
    .from('contacts')
    .select('linkedin_url, email, first_name, last_name, company_name')
    .eq('user_id', userId);

  const existingContacts = (existingContactsData || []) as ExistingContact[];

  const duplicateIds: string[] = [];
  const toProcess = records.filter((record) => {
    const duplicate = existingContacts.some((existing) => isDuplicateContact(record, existing));
    if (duplicate) {
      duplicateIds.push(record.raw_upload_id);
      return false;
    }
    return true;
  });

  if (duplicateIds.length > 0) {
    await supabase
      .from('raw_uploads')
      .update({ status: 'duplicate', enriched_at: new Date().toISOString() })
      .in('id', duplicateIds);
  }

  let inserted = 0;
  let failed = 0;
  const touchedCompanyIds = new Set<string>();

  for (let index = 0; index < toProcess.length; index += 1) {
    const record = toProcess[index];
    const parsedLocation = splitLocation(record.location);

    try {
      const companyId = await upsertCompany(supabase, userId, record);
      if (companyId) touchedCompanyIds.add(companyId);

      const contactPayload = {
        user_id: userId,
        raw_upload_id: record.raw_upload_id,
        batch_id: record.batch_id || null,
        linkedin_url: record.linkedin_url || null,
        email: record.email || null,
        full_name: record.full_name || null,
        first_name: record.first_name || null,
        last_name: record.last_name || null,
        profile_photo_url: record.profile_photo_url || null,
        job_title: record.job_title || null,
        job_title_standardised: record.job_title_standardised || null,
        seniority_level: SENIORITY_LEVEL_OPTIONS.includes(record.seniority_level as never)
          ? record.seniority_level
          : null,
        business_area: BUSINESS_AREA_OPTIONS.includes(record.business_area as never)
          ? record.business_area
          : null,
        headline: record.headline || null,
        years_in_current_role: record.years_in_current_role || null,
        location: record.location || null,
        city: record.city || parsedLocation.city,
        country: record.country || parsedLocation.country,
        company_name: record.company_name || null,
        company_domain: record.company_domain?.trim().toLowerCase() || null,
        apollo_company_domain: record.company_domain?.trim().toLowerCase() || null,
        company_linkedin_url: record.company_linkedin_url || null,
        company_id: companyId,
        fiber_person_response_raw: record.raw_person_response ?? null,
        fiber_company_response_raw: record.raw_company_response ?? null,
        fiber_person_raw: record.raw_person ?? null,
        fiber_company_raw: record.raw_company ?? null,
        fiber_lookup_metadata: record.fiber_lookup_metadata ?? null,
        apollo_person_response_raw: record.apollo_person_response_raw ?? null,
        apollo_person_raw: record.apollo_person_raw ?? null,
        apollo_organization_raw: record.apollo_organization_raw ?? null,
        apollo_lookup_metadata: record.apollo_lookup_metadata ?? null,
        contact_discovery_status: 'completed',
        email_status: record.email ? 'candidate' : 'missing',
        email_status_reasoning: record.email
          ? 'Candidate email from contact discovery. Current company alignment not resolved yet.'
          : 'No email returned during contact discovery.',
        linkedin_resolution_status: 'pending',
        profile_enrichment_status: 'pending',
        fit_score: 0,
        fit_score_reasoning: 'Not scored yet.',
        fit_score_matched_on: [],
        fit_score_gaps: null,
        scored_against_persona_id: null,
        intent_score: 1.0,
        source: 'imported',
        last_enriched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      let upsertResult = (await supabase
        .from('contacts')
        .upsert(contactPayload, {
          onConflict: 'user_id,linkedin_url',
          ignoreDuplicates: false,
        })) as { error?: unknown };

      if (upsertResult.error && isMissingColumnError(upsertResult.error)) {
        const {
          contact_discovery_status,
          email_status,
          email_status_reasoning,
          linkedin_resolution_status,
          profile_enrichment_status,
          ...legacyCompatiblePayload
        } = contactPayload;

        upsertResult = (await supabase
          .from('contacts')
          .upsert(legacyCompatiblePayload, {
            onConflict: 'user_id,linkedin_url',
            ignoreDuplicates: false,
          })) as { error?: unknown };
      }

      if (upsertResult.error) {
        throw upsertResult.error;
      }

      await supabase
        .from('raw_uploads')
        .update({ status: 'enriched', enriched_at: new Date().toISOString() })
        .eq('id', record.raw_upload_id);

      inserted += 1;
    } catch (error) {
      console.error('[import-ingestion] Failed to store contact:', record.raw_upload_id, error);
      failed += 1;

      await supabase
        .from('raw_uploads')
        .update({ status: 'failed', enriched_at: new Date().toISOString() })
        .eq('id', record.raw_upload_id);
    }
  }

  if (touchedCompanyIds.size > 0) {
    await syncCompanyFitForCompanies(supabase, userId, [...touchedCompanyIds]).catch((error) => {
      console.error('[import-ingestion] Failed syncing company fit scores:', error);
    });
  }

  const batchId = records[0]?.batch_id;
  if (batchId) {
    const { data: batchStats } = await supabase
      .from('raw_uploads')
      .select('status')
      .eq('batch_id', batchId);

    if (batchStats) {
      const processed = batchStats.filter((row: unknown) =>
        ['enriched', 'duplicate', 'failed'].includes((row as { status: string }).status)
      ).length;

      await supabase
        .from('upload_batches')
        .update({
          processed_rows: processed,
          duplicate_rows: batchStats.filter(
            (row: unknown) => (row as { status: string }).status === 'duplicate'
          ).length,
          failed_rows: batchStats.filter(
            (row: unknown) => (row as { status: string }).status === 'failed'
          ).length,
          status: processed >= batchStats.length ? 'complete' : 'processing',
          updated_at: new Date().toISOString(),
        })
        .eq('id', batchId);
    }
  }

  return {
    inserted,
    duplicates: duplicateIds.length,
    failed,
  };
}
