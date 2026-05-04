import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { nango, HUBSPOT_INTEGRATION_ID } from '@/lib/nango';

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('nango_connections')
    .select('nango_connection_id')
    .eq('user_id', user.id)
    .eq('integration_id', HUBSPOT_INTEGRATION_ID)
    .single();

  if (data?.nango_connection_id) {
    try {
      await nango.deleteConnection(HUBSPOT_INTEGRATION_ID, data.nango_connection_id);
    } catch {
      // best-effort — remove from our DB regardless
    }
  }

  await supabase
    .from('nango_connections')
    .delete()
    .eq('user_id', user.id)
    .eq('integration_id', HUBSPOT_INTEGRATION_ID);

  return NextResponse.json({ ok: true });
}
