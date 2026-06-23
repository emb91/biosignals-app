import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { syncCompanyFitForCompany } from '@/lib/company-fit';
import { runCompanyMonitor } from '@/lib/company-monitor';
import { getOrgContext } from '@/lib/org-context';

/**
 * POST /api/monitor-company
 *
 * Runs the company monitor for a single company by ID.
 * Used for testing and manual triggering. Later this will be called
 * on a schedule for all companies.
 *
 * Body: { company_id: string }
 */
export async function POST(request: Request) {
  try {
    const ctx = await getOrgContext();
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use admin client to bypass RLS for this internal monitor endpoint
    const supabase = createAdminClient();

    const body = await request.json();
    const { company_id } = body as { company_id?: string };

    if (!company_id) {
      return NextResponse.json({ error: 'company_id required' }, { status: 400 });
    }

    const { data: userCompany, error: userCompanyError } = await supabase
      .from('user_companies')
      .select('company_id')
      .eq('user_id', ctx.user.id)
      .eq('company_id', company_id)
      .is('archived_at', null)
      .maybeSingle();

    if (userCompanyError) {
      console.error('[monitor-company] ownership check failed:', userCompanyError);
      return NextResponse.json({ error: 'Could not verify company access' }, { status: 500 });
    }

    if (!userCompany) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    // Fetch the company row
    const { data: company, error: fetchError } = await supabase
      .from('companies')
      .select('id, company_name, domain')
      .eq('id', company_id)
      .maybeSingle();

    if (fetchError || !company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    // Pull scraped/enriched company context from a contact linked to this company.
    const { data: linkedContact } = await supabase
      .from('contacts')
      .select('apollo_company_firmographics, apify_company_firmographics, apollo_organization_raw')
      .eq('user_id', ctx.user.id)
      .eq('company_id', company_id)
      .limit(1)
      .maybeSingle();

    const apolloFirmo = linkedContact?.apollo_company_firmographics as Record<string, unknown> | null;

    const result = await runCompanyMonitor(supabase, {
      company_id: company.id,
      company_name: company.company_name,
      domain: company.domain,
      apollo_funding_stage: (apolloFirmo?.funding_stage as string | null) ?? null,
      apollo_total_funding_usd: (apolloFirmo?.total_funding_usd as number | null) ?? null,
      apollo_latest_funding_date: (apolloFirmo?.latest_funding_date as string | null) ?? null,
      apify_company_firmographics:
        (linkedContact?.apify_company_firmographics as Record<string, unknown> | null) ?? null,
      apollo_company_firmographics: apolloFirmo,
      apollo_organization_raw:
        (linkedContact?.apollo_organization_raw as Record<string, unknown> | null) ?? null,
    });

    await syncCompanyFitForCompany(supabase, ctx.user.id, company.id);

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('[monitor-company] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
