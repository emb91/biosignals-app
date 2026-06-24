import { NextResponse } from 'next/server';
import { getOrgContext, canEditOrgSetup } from '@/lib/org-context';
import { HUBSPOT_INTEGRATION_ID } from '@/lib/nango';

export async function POST(req: Request) {
  // Connecting the CRM is org-level setup (one per org) — owner/admin only.
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canEditOrgSetup(ctx.role)) {
    return NextResponse.json({ error: 'Only an owner or admin can connect the CRM' }, { status: 403 });
  }

  const { integrationId, connectionId } = await req.json();

  await ctx.supabase.from('nango_connections').upsert(
    { user_id: ctx.user.id, org_id: ctx.orgId, integration_id: integrationId, nango_connection_id: connectionId },
    { onConflict: 'user_id,integration_id' },
  );

  // For HubSpot, capture the portal id so inbound webhooks (no session) can map
  // back to this connection. Best-effort — never block the connect on it.
  if (integrationId === HUBSPOT_INTEGRATION_ID) {
    try {
      const { getNangoAccessToken } = await import('@/lib/nango');
      const { fetchHubSpotPortalId } = await import('@/lib/hubspot');
      const token = await getNangoAccessToken(HUBSPOT_INTEGRATION_ID, connectionId);
      const portalId = token ? await fetchHubSpotPortalId(token) : null;
      if (portalId != null) {
        await ctx.supabase
          .from('nango_connections')
          .update({ hubspot_portal_id: portalId })
          .eq('integration_id', integrationId)
          .eq(ctx.orgId ? 'org_id' : 'user_id', ctx.orgId ?? ctx.user.id);
      }
    } catch (error) {
      console.error('[nango/connection] portal id capture failed (non-fatal):', error);
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  // Disconnecting the org CRM is owner/admin only.
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canEditOrgSetup(ctx.role)) {
    return NextResponse.json({ error: 'Only an owner or admin can disconnect the CRM' }, { status: 403 });
  }

  const { integrationId } = await req.json();

  // Remove the org's connection(s) for this integration (any member's row in the org).
  const del = ctx.supabase.from('nango_connections').delete().eq('integration_id', integrationId);
  await (ctx.orgId ? del.eq('org_id', ctx.orgId) : del.eq('user_id', ctx.user.id));

  return NextResponse.json({ ok: true });
}
