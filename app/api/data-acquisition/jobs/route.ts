import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('data_acquisition_jobs')
      .select(
        `
        id,
        icp_id,
        upload_batch_id,
        request_type,
        source_strategy,
        status,
        target_company_count,
        target_contact_count,
        max_screened_companies,
        max_contact_enrichments,
        max_credit_units,
        estimated_min_credit_units,
        estimated_max_credit_units,
        actual_credit_units,
        screened_company_count,
        discovered_company_count,
        qualified_company_count,
        imported_company_count,
        discovered_contact_count,
        enriched_contact_count,
        imported_contact_count,
        skipped_duplicate_count,
        rejected_low_fit_count,
        error,
        requested_at,
        started_at,
        completed_at
      `,
      )
      .eq('user_id', user.id)
      .order('requested_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[data-acquisition/jobs] list', error);
      return NextResponse.json({ error: 'Failed to load acquisition jobs' }, { status: 500 });
    }

    return NextResponse.json({ jobs: data || [] });
  } catch (error) {
    console.error('[data-acquisition/jobs]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
