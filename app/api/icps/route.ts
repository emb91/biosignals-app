import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { orgIdForUser } from '@/lib/org-context';
import { assignSignalWeights, extractSignalIds } from '@/lib/signal-weights';
import { rescoreAllContactsForUser } from '@/lib/rescore';
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

    // Org-scoped: every seat sees the org's shared ICPs. For a solo owner this returns
    // the same rows as a user_id filter (their ICPs carry their org_id). Falls back to
    // user-scope only if membership is somehow missing.
    const orgId = await orgIdForUser(supabase, user.id);

    let query = supabase.from('icps').select('*').order('created_at', { ascending: false });
    query = orgId ? query.eq('org_id', orgId) : query.eq('user_id', user.id);
    const { data, error } = await query;

    if (error) {
      console.error('Error fetching ICPs:', error);
      return NextResponse.json({ error: 'Failed to fetch ICPs' }, { status: 500 });
    }

    const hydrated = await hydrateIcpsWithSignals(supabase, user.id, data || []);
    return NextResponse.json({ data: hydrated });
  } catch (error) {
    console.error('Error in GET /api/icps:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = (await request.json()) as { id?: string };
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // Org-scoped delete so an admin can remove a shared ICP, not just its creator.
    // RLS additionally gates writes to owner/admin.
    const orgId = await orgIdForUser(supabase, user.id);
    const deleteQuery = supabase.from('icps').delete().eq('id', id);
    const { error } = orgId
      ? await deleteQuery.eq('org_id', orgId)
      : await deleteQuery.eq('user_id', user.id);

    if (error) {
      console.error('Error deleting ICP:', error);
      return NextResponse.json({ error: 'Failed to delete ICP' }, { status: 500 });
    }

    rescoreAllContactsForUser(user.id).catch((err) =>
      console.error('[icps DELETE] Background lead-fit rescore failed:', err),
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/icps:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    const exampleCompanyUrl =
      typeof body.exampleCompanyUrl === 'string' ? body.exampleCompanyUrl.trim() : '';
    if (!exampleCompanyUrl) {
      return NextResponse.json(
        {
          error:
            'exampleCompanyUrl is required — every ICP must be modelled on a reference company',
        },
        { status: 400 },
      );
    }

    const signalIds = extractSignalIds((body.signals || []) as Parameters<typeof extractSignalIds>[0]);
    const {
      value: platformCategory,
      error: platformCategoryError,
    } = parsePlatformCategoryInput(body.platformCategory);
    if (platformCategoryError) {
      return NextResponse.json({ error: platformCategoryError }, { status: 400 });
    }

    const weightedSignals = assignSignalWeights(signalIds);

    // Stamp org_id explicitly (the BEFORE INSERT trigger also fills it from user_id, but
    // being explicit keeps the write self-describing and survives trigger removal).
    const orgId = await orgIdForUser(supabase, user.id);

    const icpData = {
      user_id: user.id,
      org_id: orgId,
      user_email: user.email,
      name: body.name || '',
      icp_summary: body.icpSummary || null,
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
      signals: weightedSignals.map((s) => JSON.stringify(s)),
      example_companies: body.exampleCompanies || [],
      example_company_url: exampleCompanyUrl,
      example_company_enrichment: body.exampleCompanyEnrichment ?? null,
      target_customers: Array.isArray(body.targetCustomers) ? body.targetCustomers : [],
      buyer_types: Array.isArray(body.buyerTypes) ? body.buyerTypes : [],
      competitors: Array.isArray(body.competitors) ? body.competitors : [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let result = await supabase.from('icps').insert(icpData).select().single();

    if (result.error && isMissingColumnError(result.error, 'platform_category')) {
      result = await supabase.from('icps').insert(withoutPlatformCategory(icpData)).select().single();
    }

    if (result.error && isMissingColumnError(result.error, 'target_customers')) {
      result = await supabase.from('icps').insert(withoutIcpSegmentColumns(icpData)).select().single();
    }

    const { data, error } = result;

    if (error) {
      console.error('Error saving ICP:', error);
      return NextResponse.json({ error: 'Failed to save ICP' }, { status: 500 });
    }

    await replaceIcpSignalSelections(supabase, user.id, data.id, signalIds);
    const [hydrated] = await hydrateIcpsWithSignals(supabase, user.id, [data]);

    rescoreAllContactsForUser(user.id).catch((err) =>
      console.error('[icps POST] Background lead-fit rescore failed:', err),
    );

    return NextResponse.json({ data: hydrated });
  } catch (error) {
    console.error('Error in POST /api/icps:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
