/**
 * POST /api/org/transfer-ownership  body { user_id }
 *
 * The current owner hands ownership to another member of the org. The new owner becomes
 * 'owner'; the previous owner is demoted to 'admin'. Owner-only.
 */
import { NextResponse } from 'next/server';
import { getOrgContext, isOrgOwner } from '@/lib/org-context';
import { createAdminClient } from '@/lib/supabase-admin';

export async function POST(request: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isOrgOwner(ctx.role)) {
    return NextResponse.json({ error: 'Only the owner can transfer ownership' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { user_id?: string } | null;
  const targetId = body?.user_id;
  if (!targetId) return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
  if (targetId === ctx.user.id) {
    return NextResponse.json({ error: 'You are already the owner' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from('org_members')
    .select('user_id')
    .eq('org_id', ctx.orgId)
    .eq('user_id', targetId)
    .maybeSingle<{ user_id: string }>();
  if (!target) return NextResponse.json({ error: 'That teammate could not be found' }, { status: 404 });

  // Promote the new owner, demote the previous owner to admin.
  const { error: e1 } = await admin.from('org_members').update({ role: 'owner' }).eq('org_id', ctx.orgId).eq('user_id', targetId);
  const { error: e2 } = await admin.from('org_members').update({ role: 'admin' }).eq('org_id', ctx.orgId).eq('user_id', ctx.user.id);
  if (e1 || e2) {
    console.error('[org/transfer-ownership] failed:', e1 || e2);
    return NextResponse.json({ error: 'Could not transfer ownership' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
