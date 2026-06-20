import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getNangoClient, HUBSPOT_INTEGRATION_ID } from '@/lib/nango';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await getNangoClient().createConnectSession({
    end_user: { id: user.id, email: user.email },
    allowed_integrations: [HUBSPOT_INTEGRATION_ID],
  });

  return NextResponse.json({ sessionToken: data.token });
}
