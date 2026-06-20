import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { assignFunctionWeights, assignSignalWeights, extractSignalIds } from '@/lib/signal-weights';
import { isContactSignalComingSoon } from '@/lib/signals/catalog';
import { rescoreAllContactsForUser } from '@/lib/rescore';
import { hydratePersonasWithSignals, replacePersonaSignalSelections } from '@/lib/signals/selections';
import { getOrgContext } from '@/lib/org-context';

export async function GET(
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

    const { data, error } = await ctx.supabase
      .from('personas')
      .select('*')
      .eq('id', id)
      .eq('org_id', ctx.orgId)
      .single();

    if (error) {
      console.error('Error fetching contact:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Contact not found' },
        { status: 404 }
      );
    }

    const [hydrated] = await hydratePersonasWithSignals(ctx.supabase, ctx.user.id, [data]);
    return NextResponse.json({ data: hydrated });
  } catch (error) {
    console.error('Error in contact GET:', error);
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
    const signalIds = extractSignalIds(
      (body.signals || []) as Parameters<typeof extractSignalIds>[0],
    ).filter((id) => !isContactSignalComingSoon(id));
    const weightedSignals = assignSignalWeights(signalIds);

    const contactData = {
      name: body.name,
      functions: weightedFunctions.map(f => JSON.stringify(f)),
      seniority_levels: body.seniorityLevels || [],
      job_titles: body.jobTitles || [],
      signals: weightedSignals.map((s) => JSON.stringify(s)),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await ctx.supabase
      .from('personas')
      .update(contactData)
      .eq('id', id)
      .eq('org_id', ctx.orgId)
      .select()
      .single();

    if (error) {
      console.error('Error updating contact:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    await replacePersonaSignalSelections(ctx.supabase, ctx.user.id, id, signalIds);
    const [hydrated] = await hydratePersonasWithSignals(ctx.supabase, ctx.user.id, [data]);

    // Fire-and-forget rescore: persona changed, so all contacts need re-evaluation.
    // We don't await this — the UI can show stale scores briefly while rescoring runs.
    rescoreAllContactsForUser(ctx.user.id).catch((err) =>
      console.error('[contacts PUT] Background rescore failed:', err)
    );

    return NextResponse.json({ data: hydrated });
  } catch (error) {
    console.error('Error in contact PUT:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    const { error } = await ctx.supabase
      .from('personas')
      .delete()
      .eq('id', id)
      .eq('org_id', ctx.orgId);

    if (error) {
      console.error('Error deleting contact:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in contact DELETE:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
