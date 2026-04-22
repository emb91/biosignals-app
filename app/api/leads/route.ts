import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

function isMissingColumnError(error: unknown): boolean {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : '';

  return message.includes('column') && message.includes('does not exist');
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

    const runQuery = (selectClause: string) => {
      let query = supabase
        .from('contacts')
        .select(selectClause, { count: 'exact' })
        .eq('user_id', user.id);

      if (search) {
        query = query.or(
          `full_name.ilike.%${search}%,company_name.ilike.%${search}%,job_title.ilike.%${search}%`
        );
      }

      return query
        .order('priority_score', { ascending: false, nullsFirst: false })
        .order('fit_score', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);
    };

    const primarySelect =
      'id, full_name, first_name, last_name, job_title, job_title_standardised, seniority_level, business_area, company_name, company_domain, company_linkedin_url, email, email_status, email_status_reasoning, linkedin_url, profile_photo_url, headline, location, resolved_current_company_name, resolved_current_company_domain, resolved_current_job_title, resolved_employment_history, contact_bio, contact_discovery_status, linkedin_resolution_status, profile_enrichment_status, fit_score, intent_score, priority_score, source, created_at, updated_at, company_id, companies(company_name, domain, website, linkedin_url, description, bio_summary, tagline, logo_url, follower_count, industry, employee_count, employee_range, founded_year, headquarters_city, headquarters_country, specialties, funding_stage, total_funding_usd, latest_funding_date, funding_data_source, therapeutic_areas, modalities, clinical_stage, last_enriched_at)';
    const fallbackSelect =
      'id, full_name, first_name, last_name, job_title, job_title_standardised, seniority_level, business_area, company_name, company_domain, company_linkedin_url, email, linkedin_url, profile_photo_url, headline, location, resolved_current_company_name, resolved_current_company_domain, resolved_current_job_title, resolved_employment_history, contact_bio, contact_discovery_status, linkedin_resolution_status, profile_enrichment_status, fit_score, intent_score, priority_score, source, created_at, updated_at, company_id';

    let { data, error, count } = await runQuery(primarySelect);

    if (error && isMissingColumnError(error)) {
      const fallbackResult = await runQuery(fallbackSelect);
      const fallbackData = ((fallbackResult.data || []) as unknown) as Array<Record<string, unknown>>;
      data = (fallbackData.map((row) => ({
        ...(row && typeof row === 'object' ? row : {}),
        email_status: null,
        email_status_reasoning: null,
        companies: null,
      })) as unknown) as typeof data;
      error = fallbackResult.error;
      count = fallbackResult.count;
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
