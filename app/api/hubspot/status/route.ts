import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { resolveOrgNangoConnectionId } from '@/lib/hubspot';
import { HUBSPOT_INTEGRATION_ID } from '@/lib/nango';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Org-scoped: a member sees the org's HubSpot connection status.
  const connectionId = await resolveOrgNangoConnectionId(supabase, user.id, HUBSPOT_INTEGRATION_ID);

  return NextResponse.json({ connected: !!connectionId, hubDomain: null });
}
