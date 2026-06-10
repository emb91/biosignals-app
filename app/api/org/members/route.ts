/**
 * GET /api/org/members
 *
 * Lists the caller's org: members (with role + email) and pending invites. Used by the
 * Settings → Team section. Emails are resolved via the admin auth API (org_members only
 * stores user_id). Any member can view the roster; mutations are gated elsewhere.
 *
 * Returns: { orgId, role, members: [{ user_id, email, role, joined_at }], pendingInvites: [{ email, role, created_at }] }
 */
import { NextResponse } from 'next/server';
import { getOrgContext, canEditOrgSetup, isOrgOwner } from '@/lib/org-context';
import { createAdminClient } from '@/lib/supabase-admin';

export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  const { data: memberRows } = await admin
    .from('org_members')
    .select('user_id, role, joined_at, invited_at')
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: true });

  // Resolve emails from auth (best-effort; admin API paginates, our orgs are tiny).
  const members = await Promise.all(
    (memberRows ?? []).map(async (m) => {
      const row = m as { user_id: string; role: string; joined_at: string | null; invited_at: string | null };
      let email: string | null = null;
      try {
        const { data } = await admin.auth.admin.getUserById(row.user_id);
        email = data.user?.email ?? null;
      } catch {
        /* best-effort */
      }
      return {
        user_id: row.user_id,
        email,
        role: row.role,
        joined_at: row.joined_at,
        pending: !row.joined_at,
      };
    }),
  );

  const { data: invites } = await admin
    .from('org_invites')
    .select('email, role, created_at')
    .eq('org_id', ctx.orgId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  return NextResponse.json({
    orgId: ctx.orgId,
    role: ctx.role,
    selfUserId: ctx.user.id,
    members,
    pendingInvites: invites ?? [],
  });
}

/**
 * PATCH /api/org/members — change a teammate's role (member <-> admin).
 * Owner/admin only. The owner's role is immutable here, and you can't change your own.
 * Body: { user_id, role: 'admin' | 'member' }
 */
export async function PATCH(request: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canEditOrgSetup(ctx.role)) {
    return NextResponse.json({ error: 'Only an owner or admin can change roles' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { user_id?: string; role?: string } | null;
  const targetId = body?.user_id;
  const nextRole = body?.role;
  if (!targetId || (nextRole !== 'admin' && nextRole !== 'member')) {
    return NextResponse.json({ error: 'user_id and role (admin|member) are required' }, { status: 400 });
  }
  if (targetId === ctx.user.id) {
    return NextResponse.json({ error: "You can't change your own role" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from('org_members')
    .select('role')
    .eq('org_id', ctx.orgId)
    .eq('user_id', targetId)
    .maybeSingle<{ role: string }>();

  if (!target) return NextResponse.json({ error: 'Member not found in your org' }, { status: 404 });
  if (target.role === 'owner') {
    return NextResponse.json({ error: "The owner's role can't be changed" }, { status: 400 });
  }

  const { error } = await admin
    .from('org_members')
    .update({ role: nextRole })
    .eq('org_id', ctx.orgId)
    .eq('user_id', targetId);
  if (error) {
    console.error('[org/members PATCH] update failed:', error);
    return NextResponse.json({ error: 'Could not update role' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/org/members?user_id=… — remove a teammate from the org. Owner only.
 * The removed user keeps their own (user-scoped) data and gets a fresh solo org on
 * their next request (lazy creation in getOrgContext). Can't remove the owner.
 */
export async function DELETE(request: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isOrgOwner(ctx.role)) {
    return NextResponse.json({ error: 'Only the owner can remove members' }, { status: 403 });
  }

  const targetId = new URL(request.url).searchParams.get('user_id');
  if (!targetId) return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
  if (targetId === ctx.user.id) {
    return NextResponse.json({ error: "You can't remove yourself" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from('org_members')
    .select('role')
    .eq('org_id', ctx.orgId)
    .eq('user_id', targetId)
    .maybeSingle<{ role: string }>();

  if (!target) return NextResponse.json({ error: 'Member not found in your org' }, { status: 404 });
  if (target.role === 'owner') {
    return NextResponse.json({ error: "The owner can't be removed" }, { status: 400 });
  }

  const { error } = await admin
    .from('org_members')
    .delete()
    .eq('org_id', ctx.orgId)
    .eq('user_id', targetId);
  if (error) {
    console.error('[org/members DELETE] remove failed:', error);
    return NextResponse.json({ error: 'Could not remove member' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
