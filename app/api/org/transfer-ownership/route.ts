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

  const { error } = await createAdminClient().rpc('transfer_org_ownership', {
    p_org_id: ctx.orgId,
    p_current_owner: ctx.user.id,
    p_new_owner: targetId,
  });
  if (error) {
    console.error('[org/transfer-ownership] failed:', error);
    if (error.message.includes('target_not_found')) {
      return NextResponse.json({ error: 'That teammate could not be found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Could not transfer ownership' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
