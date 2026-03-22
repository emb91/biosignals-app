import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

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

    const { count, error } = await supabase
      .from('raw_uploads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'complete');

    if (error) {
      console.error('Error loading import-ready status:', error);
      return NextResponse.json({ error: 'Failed to load import-ready status' }, { status: 500 });
    }

    return NextResponse.json({ ready: (count || 0) > 0, completeCount: count || 0 });
  } catch (error) {
    console.error('Error in import-ready GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
