import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase-server';
import { exchangeCodeForTokens } from '@/lib/hubspot';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const cookieStore = await cookies();
  const savedState = cookieStore.get('hubspot_oauth_state')?.value;

  if (!state || state !== savedState) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tokens = await exchangeCodeForTokens(code!);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase.from('hubspot_connections').upsert(
    {
      user_id: user.id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      hub_id: tokens.hub_id,
      hub_domain: tokens.hub_domain,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  cookieStore.delete('hubspot_oauth_state');

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/import?hubspot=connected`);
}
