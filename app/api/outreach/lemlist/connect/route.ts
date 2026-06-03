import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { checkAuth, LemlistError, LEMLIST_PROVIDER } from '@/lib/lemlist';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { apiKey } = (await req.json().catch(() => ({}))) as { apiKey?: string };
  if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 16) {
    return NextResponse.json({ error: 'Missing or invalid apiKey' }, { status: 400 });
  }

  // Verify the key + capture the team name as the display label.
  let teamName: string | null = null;
  try {
    const team = await checkAuth(apiKey);
    teamName = team?.name ?? null;
  } catch (err) {
    if (err instanceof LemlistError) {
      return NextResponse.json(
        { error: 'lemlist rejected the API key', detail: err.body },
        { status: 400 },
      );
    }
    throw err;
  }

  const { error } = await supabase
    .from('user_outreach_credentials')
    .upsert(
      {
        user_id: user.id,
        provider: LEMLIST_PROVIDER,
        api_key: apiKey,
        account_label: teamName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' },
    );

  if (error) {
    return NextResponse.json({ error: 'Failed to store key', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, accountLabel: teamName });
}
