import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { integrationId, connectionId } = await req.json();

  await supabase.from('nango_connections').upsert(
    { user_id: user.id, integration_id: integrationId, nango_connection_id: connectionId },
    { onConflict: 'user_id,integration_id' }
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { integrationId } = await req.json();

  await supabase
    .from('nango_connections')
    .delete()
    .eq('user_id', user.id)
    .eq('integration_id', integrationId);

  return NextResponse.json({ ok: true });
}
