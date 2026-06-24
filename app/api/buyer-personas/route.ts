import { NextResponse } from 'next/server';
import { assignFunctionWeights } from '@/lib/signal-weights';
import { rescoreAllContactsForUser } from '@/lib/rescore';
import { getOrgContext } from '@/lib/org-context';

export async function GET() {
  try {
    const ctx = await getOrgContext();
    if (!ctx) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('personas')
      .select('*')
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching buyer personas:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('Error in buyer-personas GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getOrgContext();
    if (!ctx) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();

    // Check if a buyer persona already exists for this ICP.
    if (body.icpId) {
      const { data: existingPersona } = await ctx.supabase
        .from('personas')
        .select('id')
        .eq('org_id', ctx.orgId)
        .eq('icp_id', body.icpId)
        .single();

      if (existingPersona) {
        return NextResponse.json(
          { error: 'A buyer persona already exists for this ICP. Please edit the existing profile instead.', existingPersonaId: existingPersona.id },
          { status: 409 }
        );
      }
    }

    const weightedFunctions = assignFunctionWeights(body.functions || []);

    const personaData = {
      user_id: ctx.user.id,
      org_id: ctx.orgId,
      name: body.name,
      functions: weightedFunctions.map(f => JSON.stringify(f)),
      seniority_levels: body.seniorityLevels || [],
      job_titles: body.jobTitles || [],
      icp_id: body.icpId || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await ctx.supabase
      .from('personas')
      .insert(personaData)
      .select()
      .single();

    if (error) {
      console.error('Error creating buyer persona:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    // Fire-and-forget rescore: new persona means existing contacts need re-evaluation.
    rescoreAllContactsForUser(ctx.user.id).catch((err) =>
      console.error('[buyer-personas POST] Background rescore failed:', err)
    );

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error in buyer-personas POST:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await getOrgContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });

    const { error } = await ctx.supabase
      .from('personas')
      .delete()
      .eq('id', id)
      .eq('org_id', ctx.orgId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in buyer-personas DELETE:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
