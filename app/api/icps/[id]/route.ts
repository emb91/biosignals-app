import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { orgIdForUser } from '@/lib/org-context';
import { rescoreAllContactsForUser } from '@/lib/rescore';
import { hydrateIcpsWithSignals } from '@/lib/signals/selections';
import { parsePlatformCategoryInput } from '@/lib/platform-category';
import {
  isMissingColumnError,
  withoutPlatformCategory,
  withoutIcpSegmentColumns,
} from '@/lib/supabase-column-compat';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Org-scoped so any seat can open a shared ICP (solo owner: same row set).
    const orgId = await orgIdForUser(supabase, user.id);
    const baseSelect = supabase.from('icps').select('*').eq('id', id);
    const { data, error } = await (orgId
      ? baseSelect.eq('org_id', orgId)
      : baseSelect.eq('user_id', user.id)
    ).single();

    if (error) {
      console.error('Error fetching ICP:', error);
      return NextResponse.json({ error: 'ICP not found' }, { status: 404 });
    }

    const [hydrated] = await hydrateIcpsWithSignals(supabase, user.id, [data]);
    return NextResponse.json({ data: hydrated });
  } catch (error) {
    console.error('Error in GET /api/icps/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      value: platformCategory,
      error: platformCategoryError,
    } = parsePlatformCategoryInput(body.platformCategory);
    if (platformCategoryError) {
      return NextResponse.json({ error: platformCategoryError }, { status: 400 });
    }

    // Org-scoped update so an admin can edit a shared ICP. RLS also gates to owner/admin.
    const orgId = await orgIdForUser(supabase, user.id);
    const scopeCol = orgId ? 'org_id' : 'user_id';
    const scopeVal = orgId ?? user.id;

    const icpData: Record<string, unknown> = {
      name: body.name || '',
      company_type: body.companyType || '',
      platform_category: platformCategory,
      therapeutic_areas: body.therapeuticAreas || [],
      modalities: body.modalities || [],
      development_stages: body.developmentStages || [],
      customer_therapeutic_areas: body.customerTherapeuticAreas ?? [],
      customer_modalities: body.customerModalities ?? [],
      customer_development_stages: body.customerDevelopmentStages ?? [],
      company_sizes: body.companySizes || [],
      li_follower_sizes: body.liFollowerSizes || [],
      funding_stages: body.fundingStages || [],
      // Signals are now universal; per-ICP selection is no longer collected. Omit the column on
      // update so any existing legacy data is left untouched (back-compat until cleanup migration).
      example_companies: body.exampleCompanies || [],
      example_company_enrichment: body.exampleCompanyEnrichment ?? null,
      updated_at: new Date().toISOString(),
    };

    if (Array.isArray(body.targetCustomers)) icpData.target_customers = body.targetCustomers;
    if (Array.isArray(body.buyerTypes)) icpData.buyer_types = body.buyerTypes;
    if (Array.isArray(body.competitors)) icpData.competitors = body.competitors;

    if (Object.prototype.hasOwnProperty.call(body, 'icpSummary')) {
      icpData.icp_summary = body.icpSummary || null;
    }

    if (typeof body.exampleCompanyUrl === 'string' && body.exampleCompanyUrl.trim()) {
      icpData.example_company_url = body.exampleCompanyUrl.trim();
    }

    let result = await supabase
      .from('icps')
      .update(icpData)
      .eq('id', id)
      .eq(scopeCol, scopeVal)
      .select()
      .single();

    if (result.error && isMissingColumnError(result.error, 'platform_category')) {
      result = await supabase
        .from('icps')
        .update(withoutPlatformCategory(icpData))
        .eq('id', id)
        .eq(scopeCol, scopeVal)
        .select()
        .single();
    }

    if (result.error && isMissingColumnError(result.error, 'target_customers')) {
      result = await supabase
        .from('icps')
        .update(withoutIcpSegmentColumns(icpData))
        .eq('id', id)
        .eq(scopeCol, scopeVal)
        .select()
        .single();
    }

    const { data, error } = result;

    if (error) {
      console.error('Error updating ICP:', error);
      return NextResponse.json({ error: 'Failed to update ICP' }, { status: 500 });
    }

    const [hydrated] = await hydrateIcpsWithSignals(supabase, user.id, [data]);

    rescoreAllContactsForUser(user.id).catch((err) =>
      console.error('[icps PUT] Background lead-fit rescore failed:', err),
    );

    return NextResponse.json({ data: hydrated });
  } catch (error) {
    console.error('Error in PUT /api/icps/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // RLS enforces: a member may delete their OWN (personal) ICP; owner/admin may delete
    // company-wide ('org') ICPs. Target the id and let RLS decide.
    const { error } = await supabase.from('icps').delete().eq('id', id);

    if (error) {
      console.error('Error deleting ICP:', error);
      return NextResponse.json({ error: 'Failed to delete ICP' }, { status: 500 });
    }

    rescoreAllContactsForUser(user.id).catch((err) =>
      console.error('[icps id DELETE] Background lead-fit rescore failed:', err),
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/icps/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
