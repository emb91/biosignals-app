import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { HUBSPOT_INTEGRATION_ID } from '@/lib/nango';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('nango_connections')
    .select('nango_connection_id')
    .eq('user_id', user.id)
    .eq('integration_id', HUBSPOT_INTEGRATION_ID)
    .single();

  return NextResponse.json({ connected: !!data, hubDomain: null });
}
