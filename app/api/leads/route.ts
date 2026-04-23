import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

function isMissingColumnError(error: unknown): boolean {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : '';

  return message.includes('column') && message.includes('does not exist');
}

type SupabaseClientLike = {
  from: (table: string) => any;
};

type LeadRow = Record<string, unknown>;

function normalizeCompanyRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    company_name: row.company_name ?? null,
    domain: row.domain ?? null,
    website: row.website ?? row.company_website ?? null,
    linkedin_url: row.linkedin_url ?? null,
    description: row.description ?? null,
    bio_summary: row.bio_summary ?? null,
    tagline: row.tagline ?? null,
    logo_url: row.logo_url ?? null,
    follower_count: row.follower_count ?? null,
    industry: row.industry ?? null,
    employee_count: row.employee_count ?? null,
    employee_range: row.employee_range ?? null,
    founded_year: row.founded_year ?? null,
    headquarters_city: row.headquarters_city ?? null,
    headquarters_country: row.headquarters_country ?? null,
    specialties: row.specialties ?? null,
    company_type: row.company_type ?? null,
    funding_stage: row.funding_stage ?? null,
    funding_status_label: row.funding_status_label ?? null,
    total_funding_usd: row.total_funding_usd ?? null,
    latest_funding_date: row.latest_funding_date ?? null,
    funding_data_source: row.funding_data_source ?? null,
    funding_resolution_confidence: row.funding_resolution_confidence ?? null,
    funding_resolution_summary: row.funding_resolution_summary ?? null,
    therapeutic_areas: row.therapeutic_areas ?? row.therapeutic_area ?? null,
    modalities: row.modalities ?? row.modality ?? null,
    clinical_stage: row.clinical_stage ?? null,
    last_enriched_at: row.last_enriched_at ?? row.updated_at ?? null,
  };
}

async function attachCompaniesBestEffort(
  supabase: SupabaseClientLike,
  rows: LeadRow[]
): Promise<LeadRow[]> {
  const companyIds = [...new Set(rows.map((row) => row.company_id).filter(Boolean))] as string[];
  if (companyIds.length === 0) {
    return rows.map((row) => ({ ...row, companies: null }));
  }

  const companySelects = [
    'id, company_name, domain, website, linkedin_url, description, bio_summary, tagline, logo_url, follower_count, industry, employee_count, employee_range, founded_year, headquarters_city, headquarters_country, specialties, company_type, funding_stage, funding_status_label, total_funding_usd, latest_funding_date, funding_data_source, funding_resolution_confidence, funding_resolution_summary, therapeutic_areas, modalities, clinical_stage, last_enriched_at',
    'id, company_name, domain, website, linkedin_url, description, bio_summary, tagline, logo_url, follower_count, industry, employee_count, employee_range, founded_year, headquarters_city, headquarters_country, specialties, company_type, funding_stage, funding_status_label, total_funding_usd, latest_funding_date, funding_data_source, funding_resolution_confidence, funding_resolution_summary, therapeutic_area, modality, clinical_stage, last_enriched_at',
    'id, company_name, domain, website, linkedin_url, description, industry, employee_count, employee_range, founded_year, headquarters_city, headquarters_country, company_type, funding_stage, therapeutic_area, modality, updated_at',
    'id, company_name, company_website, linkedin_url, company_type, funding_stage, therapeutic_area, modality, updated_at',
    'id, company_name, linkedin_url, company_type, funding_stage, updated_at',
    'id, company_name',
  ];

  let companies: Record<string, Record<string, unknown>> = {};

  for (const selectClause of companySelects) {
    const result = await supabase.from('companies').select(selectClause).in('id', companyIds);

    if (result.error && isMissingColumnError(result.error)) {
      continue;
    }

    if (result.error) {
      console.warn('Best-effort company fetch failed:', result.error);
      break;
    }

    companies = Object.fromEntries(
      ((result.data || []) as Record<string, unknown>[])
        .filter((company) => typeof company.id === 'string')
        .map((company) => [company.id as string, normalizeCompanyRow(company)])
    );
    break;
  }

  return rows.map((row) => ({
    ...row,
    companies:
      typeof row.company_id === 'string' && companies[row.company_id]
        ? companies[row.company_id]
        : null,
  }));
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)));
    const search = searchParams.get('search') || '';

    const offset = (page - 1) * pageSize;

    // Find company IDs matching taxonomy search terms (company type, TA, modality)
    let taxonomyCompanyIds: string[] = [];
    if (search) {
      const { data: taxonomyMatches } = await supabase
        .from('companies')
        .select('id')
        .or(
          `company_type.ilike.%${search}%,company_type_display.ilike.%${search}%,therapeutic_areas.cs.{"${search}"},modalities.cs.{"${search}"},development_stages.cs.{"${search}"}`
        );
      taxonomyCompanyIds = (taxonomyMatches || []).map((c) => c.id as string).filter(Boolean);
    }

    const runQuery = (selectClause: string) => {
      let query = supabase
        .from('contacts')
        .select(selectClause, { count: 'exact' })
        .eq('user_id', user.id);

      if (search) {
        const contactFilter = `full_name.ilike.%${search}%,company_name.ilike.%${search}%,job_title.ilike.%${search}%`;
        const filter =
          taxonomyCompanyIds.length > 0
            ? `${contactFilter},company_id.in.(${taxonomyCompanyIds.join(',')})`
            : contactFilter;
        query = query.or(filter);
      }

      return query
        .order('priority_score', { ascending: false, nullsFirst: false })
        .order('fit_score', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);
    };

    const baseLeadSelect =
      'id, full_name, first_name, last_name, job_title, job_title_standardised, seniority_level, business_area, company_name, company_domain, company_linkedin_url, email, email_status, email_status_reasoning, linkedin_url, profile_photo_url, headline, location, resolved_current_company_name, resolved_current_company_domain, resolved_current_job_title, resolved_employment_history, contact_bio, contact_discovery_status, linkedin_resolution_status, profile_enrichment_status, fit_score, intent_score, priority_score, source, created_at, updated_at, company_id';
    const companySelectCore =
      'companies(company_name, domain, website, linkedin_url, description, bio_summary, tagline, logo_url, follower_count, industry, employee_count, employee_range, founded_year, headquarters_city, headquarters_country, specialties, company_type, company_type_display, funding_stage, funding_status_label, total_funding_usd, latest_funding_date, funding_data_source, therapeutic_areas, modalities, development_stages, clinical_stage, last_enriched_at)';
    const companySelectStable =
      'companies(company_name, domain, website, linkedin_url, description, bio_summary, tagline, logo_url, follower_count, industry, employee_count, employee_range, founded_year, headquarters_city, headquarters_country, specialties, company_type, company_type_display, funding_stage, total_funding_usd, latest_funding_date, funding_data_source, therapeutic_areas, modalities, development_stages, clinical_stage, last_enriched_at)';
    const companySelectWithFundingDebug =
      'companies(company_name, domain, website, linkedin_url, description, bio_summary, tagline, logo_url, follower_count, industry, employee_count, employee_range, founded_year, headquarters_city, headquarters_country, specialties, company_type, company_type_display, funding_stage, funding_status_label, total_funding_usd, latest_funding_date, funding_data_source, funding_resolution_confidence, funding_resolution_summary, clinical_stage, therapeutic_areas, modalities, development_stages, last_enriched_at)';
    const companySelectCoreLegacyTaxonomy =
      'companies(company_name, domain, website, linkedin_url, description, bio_summary, tagline, logo_url, follower_count, industry, employee_count, employee_range, founded_year, headquarters_city, headquarters_country, specialties, company_type, funding_stage, funding_status_label, total_funding_usd, latest_funding_date, funding_data_source, therapeutic_areas:therapeutic_area, modalities:modality, clinical_stage, last_enriched_at)';
    const companySelectStableLegacyTaxonomy =
      'companies(company_name, domain, website, linkedin_url, description, bio_summary, tagline, logo_url, follower_count, industry, employee_count, employee_range, founded_year, headquarters_city, headquarters_country, specialties, company_type, funding_stage, total_funding_usd, latest_funding_date, funding_data_source, therapeutic_areas:therapeutic_area, modalities:modality, clinical_stage, last_enriched_at)';
    const companySelectMinimalLegacy =
      'companies(company_name, website:company_website, linkedin_url, company_type, funding_stage, therapeutic_areas:therapeutic_area, modalities:modality, updated_at)';

    const primarySelect =
      `${baseLeadSelect}, ${companySelectWithFundingDebug}`;
    const secondarySelect =
      `${baseLeadSelect}, ${companySelectCore}`;
    const tertiarySelect =
      `${baseLeadSelect}, ${companySelectStable}`;
    const fallbackSelect =
      'id, full_name, first_name, last_name, job_title, job_title_standardised, seniority_level, business_area, company_name, company_domain, company_linkedin_url, email, linkedin_url, profile_photo_url, headline, location, resolved_current_company_name, resolved_current_company_domain, resolved_current_job_title, resolved_employment_history, contact_bio, contact_discovery_status, linkedin_resolution_status, profile_enrichment_status, fit_score, intent_score, priority_score, source, created_at, updated_at, company_id';

    let { data, error, count } = await runQuery(primarySelect);

    if (error && isMissingColumnError(error)) {
      const secondaryResult = await runQuery(secondarySelect);

      if (secondaryResult.error && isMissingColumnError(secondaryResult.error)) {
        const tertiaryResult = await runQuery(tertiarySelect);

        if (tertiaryResult.error && isMissingColumnError(tertiaryResult.error)) {
          const legacyCoreResult = await runQuery(`${baseLeadSelect}, ${companySelectCoreLegacyTaxonomy}`);

          if (legacyCoreResult.error && isMissingColumnError(legacyCoreResult.error)) {
            const legacyStableResult = await runQuery(`${baseLeadSelect}, ${companySelectStableLegacyTaxonomy}`);

            if (legacyStableResult.error && isMissingColumnError(legacyStableResult.error)) {
              const minimalLegacyResult = await runQuery(`${baseLeadSelect}, ${companySelectMinimalLegacy}`);

              if (minimalLegacyResult.error && isMissingColumnError(minimalLegacyResult.error)) {
                const fallbackResult = await runQuery(fallbackSelect);
                const fallbackData = ((fallbackResult.data || []) as unknown) as Array<Record<string, unknown>>;
                data = ((await attachCompaniesBestEffort(supabase, fallbackData.map((row) => ({
                  ...(row && typeof row === 'object' ? row : {}),
                  email_status: null,
                  email_status_reasoning: null,
                })))) as unknown) as typeof data;
                error = fallbackResult.error;
                count = fallbackResult.count;
              } else {
                const minimalLegacyData = ((minimalLegacyResult.data || []) as unknown) as Array<Record<string, unknown>>;
                data = (minimalLegacyData.map((row) => ({
                  ...(row && typeof row === 'object' ? row : {}),
                  companies:
                    row?.companies && typeof row.companies === 'object'
                      ? {
                          ...(row.companies as Record<string, unknown>),
                          domain: null,
                          description: null,
                          bio_summary: null,
                          tagline: null,
                          logo_url: null,
                          follower_count: null,
                          industry: null,
                          employee_count: null,
                          employee_range: null,
                          founded_year: null,
                          headquarters_city: null,
                          headquarters_country: null,
                          specialties: null,
                          funding_status_label: null,
                          total_funding_usd: null,
                          latest_funding_date: null,
                          funding_data_source: null,
                          funding_resolution_confidence: null,
                          funding_resolution_summary: null,
                          clinical_stage: null,
                          last_enriched_at: (row.companies as Record<string, unknown>).updated_at ?? null,
                        }
                      : row?.companies ?? null,
                })) as unknown) as typeof data;
                error = minimalLegacyResult.error;
                count = minimalLegacyResult.count;
              }
            } else {
              const legacyStableData = ((legacyStableResult.data || []) as unknown) as Array<Record<string, unknown>>;
              data = (legacyStableData.map((row) => ({
                ...(row && typeof row === 'object' ? row : {}),
                companies:
                  row?.companies && typeof row.companies === 'object'
                    ? {
                        ...(row.companies as Record<string, unknown>),
                        funding_status_label: null,
                        funding_resolution_confidence: null,
                        funding_resolution_summary: null,
                      }
                    : row?.companies ?? null,
              })) as unknown) as typeof data;
              error = legacyStableResult.error;
              count = legacyStableResult.count;
            }
          } else {
            const legacyCoreData = ((legacyCoreResult.data || []) as unknown) as Array<Record<string, unknown>>;
            data = (legacyCoreData.map((row) => ({
              ...(row && typeof row === 'object' ? row : {}),
              companies:
                row?.companies && typeof row.companies === 'object'
                  ? {
                      ...(row.companies as Record<string, unknown>),
                      funding_resolution_confidence: null,
                      funding_resolution_summary: null,
                    }
                  : row?.companies ?? null,
            })) as unknown) as typeof data;
            error = legacyCoreResult.error;
            count = legacyCoreResult.count;
          }
        } else {
          const tertiaryData = ((tertiaryResult.data || []) as unknown) as Array<Record<string, unknown>>;
          data = (tertiaryData.map((row) => ({
            ...(row && typeof row === 'object' ? row : {}),
            companies:
              row?.companies && typeof row.companies === 'object'
                ? {
                    ...(row.companies as Record<string, unknown>),
                    funding_status_label: null,
                    funding_resolution_confidence: null,
                    funding_resolution_summary: null,
                  }
                : row?.companies ?? null,
          })) as unknown) as typeof data;
          error = tertiaryResult.error;
          count = tertiaryResult.count;
        }
      } else {
        const secondaryData = ((secondaryResult.data || []) as unknown) as Array<Record<string, unknown>>;
        data = (secondaryData.map((row) => ({
          ...(row && typeof row === 'object' ? row : {}),
          companies:
            row?.companies && typeof row.companies === 'object'
              ? {
                  ...(row.companies as Record<string, unknown>),
                  funding_resolution_confidence: null,
                  funding_resolution_summary: null,
                }
              : row?.companies ?? null,
        })) as unknown) as typeof data;
        error = secondaryResult.error;
        count = secondaryResult.count;
      }
    }

    if (error) {
      console.error('Error fetching leads:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      data: data || [],
      total: count ?? 0,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('Error in leads GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
