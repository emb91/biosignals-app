import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { LEMLIST_PROVIDER } from '@/lib/lemlist';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('user_outreach_credentials')
    .select('account_label, updated_at')
    .eq('user_id', user.id)
    .eq('provider', LEMLIST_PROVIDER)
    .maybeSingle();

  return NextResponse.json({
    connected: !!data,
    accountLabel: data?.account_label ?? null,
    updatedAt: data?.updated_at ?? null,
  });
}
