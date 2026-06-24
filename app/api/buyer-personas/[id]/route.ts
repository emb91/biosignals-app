import { NextResponse } from 'next/server';
import { assignFunctionWeights } from '@/lib/signal-weights';
import { rescoreAllContactsForUser } from '@/lib/rescore';
import { getOrgContext } from '@/lib/org-context';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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
      .eq('id', id)
      .eq('org_id', ctx.orgId)
      .single();

    if (error) {
      console.error('Error fetching buyer persona:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Buyer persona not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error in buyer-personas GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getOrgContext();
    if (!ctx) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const weightedFunctions = assignFunctionWeights(body.functions || []);

    const personaData = {
      name: body.name,
      functions: weightedFunctions.map(f => JSON.stringify(f)),
      seniority_levels: body.seniorityLevels || [],
      job_titles: body.jobTitles || [],
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await ctx.supabase
      .from('personas')
      .update(personaData)
      .eq('id', id)
      .eq('org_id', ctx.orgId)
      .select()
      .single();

    if (error) {
      console.error('Error updating buyer persona:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    // Fire-and-forget rescore: persona changed, so all contacts need re-evaluation.
    rescoreAllContactsForUser(ctx.user.id).catch((err) =>
      console.error('[buyer-personas PUT] Background rescore failed:', err)
    );

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error in buyer-personas PUT:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getOrgContext();
    if (!ctx) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { error } = await ctx.supabase
      .from('personas')
      .delete()
      .eq('id', id)
      .eq('org_id', ctx.orgId);

    if (error) {
      console.error('Error deleting buyer persona:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in buyer-personas DELETE:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
