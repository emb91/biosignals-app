/**
 * POST /api/org/invites/accept
 *
 * Accept an org invite (the copy-link path for already-registered users). The caller
 * must be logged in AND their session email must match the invite email — an owner
 * cannot silently absorb someone else's account (audit #4, consent required).
 *
 * On accept we repoint the user's single membership to the inviting org and abandon
 * their old solo org: if they were the sole member of their previous org, that org is
 * soft-archived. All current users are test accounts, so abandoning the throwaway solo
 * workspace is safe.
 *
 * Body: { token: string }
 * Returns: { ok: true, orgId } | { error }
 */
import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/org-context';
import { createAdminClient } from '@/lib/supabase-admin';

export async function POST(request: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { token?: string } | null;
  const token = body?.token?.trim();
  if (!token) return NextResponse.json({ error: 'Missing invite token' }, { status: 400 });

  const admin = createAdminClient();

  const { data: invite, error: inviteError } = await admin
    .from('org_invites')
    .select('id, org_id, email, role, status')
    .eq('token', token)
    .maybeSingle();

  if (inviteError || !invite) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
  }
  if (invite.status !== 'pending') {
    return NextResponse.json({ error: 'This invite is no longer valid' }, { status: 410 });
  }

  // Consent guard: the logged-in user must own the invited email.
  const sessionEmail = ctx.user.email?.trim().toLowerCase();
  if (!sessionEmail || sessionEmail !== invite.email.trim().toLowerCase()) {
    return NextResponse.json(
      { error: 'This invite was sent to a different email. Sign in as that user to accept.' },
      { status: 403 },
    );
  }

  // Already in the target org? Just mark the invite accepted.
  const previousOrgId = ctx.orgId;
  if (previousOrgId === invite.org_id) {
    await admin.from('org_invites').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', invite.id);
    return NextResponse.json({ ok: true, orgId: invite.org_id });
  }

  // Repoint the user's single membership to the inviting org.
  const { error: moveError } = await admin
    .from('org_members')
    .update({ org_id: invite.org_id, role: invite.role, joined_at: new Date().toISOString() })
    .eq('user_id', ctx.user.id);
  if (moveError) {
    console.error('[org/invites/accept] membership move failed:', moveError);
    return NextResponse.json({ error: 'Could not join the organisation' }, { status: 500 });
  }

  // Abandon the old solo org if it now has no members.
  const { count } = await admin
    .from('org_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('org_id', previousOrgId);
  if ((count ?? 0) === 0) {
    await admin.from('organizations').update({ archived_at: new Date().toISOString() }).eq('id', previousOrgId);
  }

  await admin.from('org_invites').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', invite.id);

  return NextResponse.json({ ok: true, orgId: invite.org_id });
}
