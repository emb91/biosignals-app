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
import { getOrgContext } from '@/lib/org-context';
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
    members,
    pendingInvites: invites ?? [],
  });
}
