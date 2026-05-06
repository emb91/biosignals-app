import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('hubspot_sync_log')
    .select('synced_at, contacts_synced, contacts_errors, contacts_skipped, skipped_contacts')
    .eq('user_id', user.id)
    .single();

  return NextResponse.json({ data: data ?? null });
}
