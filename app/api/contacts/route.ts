import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { assignFunctionWeights } from '@/lib/signal-weights';
import { rescoreAllContactsForUser } from '@/lib/rescore';

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

    const { data, error } = await supabase
      .from('personas')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching contacts:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error in contacts GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();

    // Check if a contact profile already exists for this company
    if (body.icpId) {
      const { data: existingContact } = await supabase
        .from('personas')
        .select('id')
        .eq('user_id', user.id)
        .eq('icp_id', body.icpId)
        .single();

      if (existingContact) {
        return NextResponse.json(
          { error: 'A contact profile already exists for this company. Please edit the existing profile instead.', existingContactId: existingContact.id },
          { status: 409 }
        );
      }
    }

    // Calculate weights for functions based on their position (priority order)
    const weightedFunctions = assignFunctionWeights(body.functions || []);

    const contactData = {
      user_id: user.id,
      name: body.name,
      functions: weightedFunctions.map(f => JSON.stringify(f)),
      seniority_levels: body.seniorityLevels || [],
      job_titles: body.jobTitles || [],
      signals: body.signals || [],
      icp_id: body.icpId || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('personas')
      .insert(contactData)
      .select()
      .single();

    if (error) {
      console.error('Error creating contact:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    // Fire-and-forget rescore: new persona means existing contacts need re-evaluation.
    rescoreAllContactsForUser(user.id).catch((err) =>
      console.error('[contacts POST] Background rescore failed:', err)
    );

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error in contacts POST:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
