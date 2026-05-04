import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase-server';
import { getHubSpotAuthUrl } from '@/lib/hubspot';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const state = crypto.randomUUID();
  const cookieStore = await cookies();
  cookieStore.set('hubspot_oauth_state', state, {
    httpOnly: true,
    maxAge: 60 * 10,
    path: '/',
  });

  return NextResponse.redirect(getHubSpotAuthUrl(state));
}
