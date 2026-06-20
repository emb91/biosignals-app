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
    .select('id, org_id, email, role, status, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (inviteError || !invite) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
  }
  if (invite.status !== 'pending') {
    return NextResponse.json({ error: 'This invite is no longer valid' }, { status: 410 });
  }
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    await admin.from('org_invites').update({ status: 'revoked' }).eq('id', invite.id);
    return NextResponse.json({ error: 'This invite has expired. Ask for a new one.' }, { status: 410 });
  }

  // Consent guard: the logged-in user must own the invited email.
  const sessionEmail = ctx.user.email?.trim().toLowerCase();
  if (!sessionEmail || sessionEmail !== invite.email.trim().toLowerCase()) {
    return NextResponse.json(
      { error: 'This invite was sent to a different email. Sign in as that user to accept.' },
      { status: 403 },
    );
  }

  const { data: orgId, error: acceptError } = await admin.rpc('accept_org_invite', {
    p_invite_id: invite.id,
    p_user_id: ctx.user.id,
  });
  if (acceptError) {
    console.error('[org/invites/accept] failed:', acceptError);
    if (
      acceptError.message.includes('existing_team_workspace') ||
      acceptError.message.includes('existing_workspace_has_data')
    ) {
      return NextResponse.json(
        {
          error:
            'This account already has a workspace with data. Contact support before joining another workspace.',
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Could not join the organisation' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, orgId: orgId ?? invite.org_id });
}
