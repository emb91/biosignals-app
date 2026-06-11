import { NextResponse } from 'next/server';
import { getOrgContext, canEditOrgSetup } from '@/lib/org-context';

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
