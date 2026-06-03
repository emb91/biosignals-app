import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { LEMLIST_PROVIDER } from '@/lib/lemlist';

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await supabase
    .from('user_outreach_credentials')
    .delete()
    .eq('user_id', user.id)
    .eq('provider', LEMLIST_PROVIDER);

  if (error) {
    return NextResponse.json({ error: 'Failed to disconnect', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
