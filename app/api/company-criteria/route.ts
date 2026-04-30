import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { assignSignalWeights } from '@/lib/signal-weights';

export async function GET() {
  try {
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('icps')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching ICPs:', error);
      return NextResponse.json({ error: 'Failed to fetch ICPs' }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('Error in GET /api/icp:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await request.json() as { id?: string };
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/company-criteria:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Every ICP must be modelled on a reference company — the URL is the
    // canonical input we re-enrich from. Reject the request early if missing
    // so the NOT NULL DB constraint never has to.
    const exampleCompanyUrl = typeof body.exampleCompanyUrl === 'string'
      ? body.exampleCompanyUrl.trim()
      : '';
    if (!exampleCompanyUrl) {
      return NextResponse.json(
        { error: 'exampleCompanyUrl is required — every ICP must be modelled on a reference company' },
        { status: 400 },
      );
    }

    // Calculate weights for signals based on their position (priority order)
    const weightedSignals = assignSignalWeights(body.signals || []);

    const icpData = {
      user_id: user.id,
      user_email: user.email,
      name: body.name || '',
      icp_summary: body.icpSummary || null,
      company_type: body.companyType || '',
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
      example_company_url: exampleCompanyUrl,
      example_company_enrichment: body.exampleCompanyEnrichment ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('icps')
      .insert(icpData)
      .select()
      .single();

    if (error) {
      console.error('Error saving ICP:', error);
      return NextResponse.json({ error: 'Failed to save ICP' }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error in POST /api/icp:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
