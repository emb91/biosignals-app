import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { assignSignalWeights, extractSignalIds } from '@/lib/signal-weights';
import { rescoreAllCompanyFitForUser } from '@/lib/company-fit';
import {
  hydrateIcpsWithSignals,
  replaceIcpSignalSelections,
} from '@/lib/signals/selections';
import { parsePlatformCategoryInput } from '@/lib/platform-category';
import {
  isMissingColumnError,
  withoutPlatformCategory,
  withoutIcpSegmentColumns,
} from '@/lib/supabase-column-compat';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('icps')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error) {
      console.error('Error fetching ICP:', error);
      return NextResponse.json({ error: 'ICP not found' }, { status: 404 });
    }

    const [hydrated] = await hydrateIcpsWithSignals(supabase, user.id, [data]);
    return NextResponse.json({ data: hydrated });
  } catch (error) {
    console.error('Error in GET /api/icp/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
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

    const signalIds = extractSignalIds((body.signals || []) as Parameters<typeof extractSignalIds>[0]);
    const weightedSignals = assignSignalWeights(signalIds);

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
      signals: weightedSignals.map(s => JSON.stringify(s)),
      example_companies: body.exampleCompanies || [],
      example_company_enrichment: body.exampleCompanyEnrichment ?? null,
      updated_at: new Date().toISOString(),
    };

    if (Array.isArray(body.targetCustomers)) icpData.target_customers = body.targetCustomers;
    if (Array.isArray(body.buyerTypes)) icpData.buyer_types = body.buyerTypes;
    if (Array.isArray(body.competitors)) icpData.competitors = body.competitors;

    // Preserve the existing stored summary on partial updates unless the client
    // explicitly provides a replacement.
    if (Object.prototype.hasOwnProperty.call(body, 'icpSummary')) {
      icpData.icp_summary = body.icpSummary || null;
    }

    // example_company_url is NOT NULL in the DB. Only update it if the client
    // explicitly provides a non-empty value — partial edits (e.g. inline tag
    // edits) shouldn't blank it out.
    if (typeof body.exampleCompanyUrl === 'string' && body.exampleCompanyUrl.trim()) {
      icpData.example_company_url = body.exampleCompanyUrl.trim();
    }

    let result = await supabase
      .from('icps')
      .update(icpData)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (result.error && isMissingColumnError(result.error, 'platform_category')) {
      result = await supabase
        .from('icps')
        .update(withoutPlatformCategory(icpData))
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single();
    }

    if (result.error && isMissingColumnError(result.error, 'target_customers')) {
      result = await supabase
        .from('icps')
        .update(withoutIcpSegmentColumns(icpData))
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single();
    }

    const { data, error } = result;

    if (error) {
      console.error('Error updating ICP:', error);
      return NextResponse.json({ error: 'Failed to update ICP' }, { status: 500 });
    }

    await replaceIcpSignalSelections(supabase, user.id, data.id, signalIds);
    const [hydrated] = await hydrateIcpsWithSignals(supabase, user.id, [data]);

    rescoreAllCompanyFitForUser(user.id).catch((err) =>
      console.error('[company-criteria PUT] Background company-fit rescore failed:', err),
    );

    return NextResponse.json({ data: hydrated });
  } catch (error) {
    console.error('Error in PUT /api/icp/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { error } = await supabase
      .from('icps')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) {
      console.error('Error deleting ICP:', error);
      return NextResponse.json({ error: 'Failed to delete ICP' }, { status: 500 });
    }

    rescoreAllCompanyFitForUser(user.id).catch((err) =>
      console.error('[company-criteria DELETE] Background company-fit rescore failed:', err),
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/icp/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
