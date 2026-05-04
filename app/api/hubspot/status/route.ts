import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('hubspot_connections')
    .select('hub_domain')
    .eq('user_id', user.id)
    .single();

  return NextResponse.json({
    connected: !!data,
    hubDomain: data?.hub_domain ?? null,
  });
}
