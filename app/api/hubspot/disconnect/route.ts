import { after, NextResponse } from 'next/server';
import { getOrgContext, canEditOrgSetup } from '@/lib/org-context';
import { resolveOrgNangoConnectionId } from '@/lib/hubspot';
import { getNangoClient, HUBSPOT_INTEGRATION_ID } from '@/lib/nango';
import { getPostHogClient } from '@/lib/posthog-server';

export async function DELETE() {
  // Disconnecting the org's CRM is owner/admin only (one connection per org).
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canEditOrgSetup(ctx.role)) {
    return NextResponse.json({ error: 'Only an owner or admin can disconnect the CRM' }, { status: 403 });
  }

  const connectionId = await resolveOrgNangoConnectionId(ctx.supabase, ctx.user.id, HUBSPOT_INTEGRATION_ID);
  if (connectionId) {
    try {
      await getNangoClient().deleteConnection(HUBSPOT_INTEGRATION_ID, connectionId);
    } catch {
      // best-effort — remove from our DB regardless
    }
  }

  const del = ctx.supabase.from('nango_connections').delete().eq('integration_id', HUBSPOT_INTEGRATION_ID);
  await (ctx.orgId ? del.eq('org_id', ctx.orgId) : del.eq('user_id', ctx.user.id));

  getPostHogClient().capture({
    distinctId: ctx.user.id,
    event: 'hubspot_disconnected',
    properties: { integration: HUBSPOT_INTEGRATION_ID },
  });
  after(() => getPostHogClient().flush());

  return NextResponse.json({ ok: true });
}
