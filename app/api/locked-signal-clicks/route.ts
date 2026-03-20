import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

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
    const signalId = typeof body?.signalId === 'string' ? body.signalId.trim() : '';
    const signalName = typeof body?.signalName === 'string' ? body.signalName.trim() : '';

    if (!signalId || !signalName) {
      return NextResponse.json({ error: 'signalId and signalName are required' }, { status: 400 });
    }

    const { error } = await supabase.from('locked_signal_clicks').insert({
      user_id: user.id,
      signal_id: signalId,
      signal_name: signalName,
      clicked_at: new Date().toISOString(),
    });

    if (error) {
      console.error('Error logging locked signal click:', error);
      return NextResponse.json({ error: 'Failed to log click' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in locked-signal-clicks POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
