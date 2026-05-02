import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { normalizePlatformTaxonomyFields } from '@/lib/platform-category';
import { isMissingColumnError } from '@/lib/supabase-column-compat';

export async function GET() {
  try {
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    let result = await supabase
      .from('user_company')
      .select('company_name, description, customers_we_serve, good_fit, bad_fit, value_propositions, products_services, services, technologies, company_type, platform_category, therapeutic_areas, modalities, development_stages, employee_count, funding_stage, hq_country')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (result.error && isMissingColumnError(result.error, 'platform_category')) {
      result = await supabase
        .from('user_company')
        .select('company_name, description, customers_we_serve, good_fit, bad_fit, value_propositions, products_services, services, technologies, company_type, therapeutic_areas, modalities, development_stages, employee_count, funding_stage, hq_country')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
    }

    const { data, error } = result;

    if (error) {
      console.error('Error fetching company profile:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: data ? normalizePlatformTaxonomyFields(data as Record<string, unknown>) : null,
    });
  } catch (error) {
    console.error('Error in user-company-profile GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
