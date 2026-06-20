/**
 * POST /api/org/leave
 *
 * A member leaves their org. Their contacts + accounts stay with the org — they're
 * reassigned to the owner (the leaver doesn't take the org's data). The owner CANNOT
 * leave (the org would have no owner) — they must transfer ownership first. After leaving,
 * the user gets a fresh empty solo workspace on their next request (lazy creation in
 * getOrgContext).
 */
import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/org-context';
import { createAdminClient } from '@/lib/supabase-admin';

export async function POST() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (ctx.role === 'owner') {
    return NextResponse.json(
      { error: 'Transfer ownership to a teammate before leaving.' },
      { status: 400 },
    );
  }

  const { error } = await createAdminClient().rpc('leave_org_member', {
    p_org_id: ctx.orgId,
    p_user_id: ctx.user.id,
  });
  if (error) {
    console.error('[org/leave] failed:', error);
    return NextResponse.json({ error: 'Could not leave the team. Try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
