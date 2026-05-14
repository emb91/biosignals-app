import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';
import { nango, HUBSPOT_INTEGRATION_ID } from '@/lib/nango';
import { syncHubSpotDealsIntoReadiness } from '@/lib/signals/readiness-hubspot-deals';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: conn, error: connError } = await supabase
    .from('nango_connections')
    .select('nango_connection_id')
    .eq('user_id', user.id)
    .eq('integration_id', HUBSPOT_INTEGRATION_ID)
    .single();

  if (connError || !conn?.nango_connection_id) {
    return NextResponse.json({ error: 'HubSpot not connected' }, { status: 400 });
  }

  let accessToken: string;
  try {
    accessToken = (await nango.getToken(HUBSPOT_INTEGRATION_ID, conn.nango_connection_id)) as string;
  } catch {
    return NextResponse.json({ error: 'Failed to get HubSpot token' }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const result = await syncHubSpotDealsIntoReadiness(admin, {
      userId: user.id,
      nangoConnectionId: conn.nango_connection_id,
      accessToken,
    });

    return NextResponse.json({
      ok: true,
      result: {
        fetchedDeals: result.fetchedDeals,
        mirroredDeals: result.mirroredDeals,
        emittedEvents: result.emittedEvents,
        recomputedCompanies: result.recomputedCompanies,
        skippedUnresolvedCompanies: result.skippedUnresolvedCompanies,
        checkpoint: result.checkpoint,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to pull HubSpot CRM changes.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
