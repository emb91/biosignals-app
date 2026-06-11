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

  const admin = createAdminClient();
  const { data: owner } = await admin
    .from('org_members')
    .select('user_id')
    .eq('org_id', ctx.orgId)
    .eq('role', 'owner')
    .maybeSingle<{ user_id: string }>();
  if (!owner?.user_id) {
    return NextResponse.json({ error: 'Your team has no owner; contact support.' }, { status: 409 });
  }

  // Hand the leaver's contacts/accounts (+ children) to the owner so they stay with the org.
  const { error: reassignErr } = await admin.rpc('reassign_member_data_to', {
    p_from: ctx.user.id,
    p_to: owner.user_id,
  });
  if (reassignErr) {
    console.error('[org/leave] data reassignment failed:', reassignErr);
    return NextResponse.json({ error: 'Could not leave the team. Try again.' }, { status: 500 });
  }

  // Remove the membership. getOrgContext will lazily create a fresh solo org next request.
  const { error: delErr } = await admin
    .from('org_members')
    .delete()
    .eq('org_id', ctx.orgId)
    .eq('user_id', ctx.user.id);
  if (delErr) {
    console.error('[org/leave] membership delete failed:', delErr);
    return NextResponse.json({ error: 'Could not leave the team. Try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
