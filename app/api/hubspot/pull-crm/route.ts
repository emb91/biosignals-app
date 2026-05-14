import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';
import { nango, HUBSPOT_INTEGRATION_ID } from '@/lib/nango';
import { syncHubSpotContactsIntoReadiness } from '@/lib/signals/readiness-hubspot-contacts';
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
    const contactResult = await syncHubSpotContactsIntoReadiness(admin, {
      userId: user.id,
      accessToken,
    });
    const result = await syncHubSpotDealsIntoReadiness(admin, {
      userId: user.id,
      nangoConnectionId: conn.nango_connection_id,
      accessToken,
    });
    const now = new Date().toISOString();

    await admin.from('hubspot_sync_events').insert({
      user_id: user.id,
      event_type: 'pull',
      created_at: now,
      pull_count: contactResult.fetchedContacts,
      deals_fetched: result.fetchedDeals,
      deals_mirrored: result.mirroredDeals,
      deal_events_emitted: result.emittedEvents,
      crm_contacts_fetched: contactResult.fetchedContacts,
      crm_contacts_mirrored: contactResult.mirroredContacts,
      contact_events_emitted: contactResult.emittedEvents,
      contact_context_only_events: contactResult.contextOnlyEvents,
      crm_recomputed_companies: contactResult.recomputedCompanies + result.recomputedCompanies,
      crm_unresolved_count: contactResult.skippedUnresolvedCompanies + result.skippedUnresolvedCompanies,
      contact_signal_types: contactResult.emittedSignalTypes,
      contact_context_signal_types: contactResult.contextOnlySignalTypes,
      deal_signal_types: result.emittedSignalTypes,
      skipped_contacts: [],
      error_details: [],
    });

    return NextResponse.json({
      ok: true,
      result: {
        fetchedContacts: contactResult.fetchedContacts,
        mirroredContacts: contactResult.mirroredContacts,
        contactEventsEmitted: contactResult.emittedEvents,
        contactContextOnlyEvents: contactResult.contextOnlyEvents,
        contactRecomputedCompanies: contactResult.recomputedCompanies,
        contactSkippedUnresolvedCompanies: contactResult.skippedUnresolvedCompanies,
        contactCheckpoint: contactResult.checkpoint,
        contactSignalTypes: contactResult.emittedSignalTypes,
        contactContextSignalTypes: contactResult.contextOnlySignalTypes,
        fetchedDeals: result.fetchedDeals,
        mirroredDeals: result.mirroredDeals,
        emittedEvents: result.emittedEvents,
        recomputedCompanies: result.recomputedCompanies,
        skippedUnresolvedCompanies: result.skippedUnresolvedCompanies,
        checkpoint: result.checkpoint,
        dealSignalTypes: result.emittedSignalTypes,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to pull HubSpot CRM changes.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
