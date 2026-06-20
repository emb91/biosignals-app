import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/org-context';
import { normalizePlatformTaxonomyFields } from '@/lib/platform-category';
import { isMissingColumnError } from '@/lib/supabase-column-compat';

export async function GET() {
  try {
    const ctx = await getOrgContext();
    if (!ctx) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    let result = await ctx.supabase
      .from('user_company')
      .select('company_name, description, customers_we_serve, good_fit, bad_fit, value_propositions, products_services, services, technologies, company_type, platform_category, therapeutic_areas, modalities, development_stages, employee_count, funding_stage, hq_country')
      .eq('org_id', ctx.orgId)
      .limit(1)
      .maybeSingle();

    if (result.error && isMissingColumnError(result.error, 'platform_category')) {
      result = await ctx.supabase
        .from('user_company')
        .select('company_name, description, customers_we_serve, good_fit, bad_fit, value_propositions, products_services, services, technologies, company_type, therapeutic_areas, modalities, development_stages, employee_count, funding_stage, hq_country')
        .eq('org_id', ctx.orgId)
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
