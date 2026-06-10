/**
 * Org context resolution — the shared choke point for the org/seats layer.
 *
 * `getOrgContext()` resolves the authenticated user AND their org membership in one
 * call. Routes that need org scope use this instead of bare `getUser()`.
 *
 * Lazy solo-org creation (audit #5): if an authenticated user has no membership yet
 * (a brand-new password signup, or any future entry point that skips the invite path),
 * we create a solo org on the spot via the admin client calling `ensure_user_org`.
 * Invited users already have a membership (written by the invite flow), so the lazy
 * path no-ops for them — but if they arrived via Supabase's invite token and carry
 * `user_metadata.org_id`, we finalise that membership's `joined_at` here.
 *
 * One org per user is enforced at the DB level (UNIQUE(user_id) on org_members), so
 * `user_org_id()` and this helper are deterministic.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getDisplayName } from '@/lib/auth-helpers';

export type OrgRole = 'owner' | 'admin' | 'member';

export interface OrgContext {
  /** RLS-scoped client for the request (use for all normal queries). */
  supabase: SupabaseClient;
  user: User;
  orgId: string;
  role: OrgRole;
}

/** Roles permitted to edit org-level setup (company profile + shared ICPs) and manage seats. */
export const ORG_ADMIN_ROLES: OrgRole[] = ['owner', 'admin'];

export function canEditOrgSetup(role: OrgRole): boolean {
  return ORG_ADMIN_ROLES.includes(role);
}

/** Owner-only actions (e.g. removing seats). */
export function isOrgOwner(role: OrgRole): boolean {
  return role === 'owner';
}

type MembershipRow = { org_id: string; role: OrgRole; joined_at: string | null };

/**
 * Resolve { user, orgId, role } for the current request, creating a solo org if the
 * user has none. Returns null only when there is no authenticated user.
 */
export async function getOrgContext(): Promise<OrgContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return null;

  // Fast path: membership already exists (RLS lets the user read their own row).
  const { data: existing } = await supabase
    .from('org_members')
    .select('org_id, role, joined_at')
    .eq('user_id', user.id)
    .maybeSingle<MembershipRow>();

  if (existing?.org_id) {
    // Finalise an invited member's membership the first time they actually log in.
    if (!existing.joined_at) {
      await createAdminClient()
        .from('org_members')
        .update({ joined_at: new Date().toISOString() })
        .eq('user_id', user.id);
    }
    return { supabase, user, orgId: existing.org_id, role: existing.role };
  }

  // No membership. If the invite token carried an org_id, attach to it; otherwise
  // create a solo org. Both go through the admin client (service role).
  const admin = createAdminClient();
  const invitedOrgId =
    typeof user.user_metadata?.org_id === 'string' ? (user.user_metadata.org_id as string) : null;
  const invitedRole =
    typeof user.user_metadata?.org_role === 'string'
      ? (user.user_metadata.org_role as OrgRole)
      : 'member';

  if (invitedOrgId) {
    await admin
      .from('org_members')
      .upsert(
        {
          org_id: invitedOrgId,
          user_id: user.id,
          role: invitedRole,
          joined_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
    return { supabase, user, orgId: invitedOrgId, role: invitedRole };
  }

  const orgName = deriveOrgName(user);
  const { data: orgId, error: ensureError } = await admin.rpc('ensure_user_org', {
    p_user_id: user.id,
    p_name: orgName,
  });

  if (ensureError || !orgId) {
    console.error('[org-context] ensure_user_org failed:', ensureError);
    return null;
  }

  return { supabase, user, orgId: orgId as string, role: 'owner' };
}

function deriveOrgName(user: User): string {
  // Prefer a human name, fall back to the email local part. The backfill prefers the
  // company profile name; for a fresh signup we don't have one yet, so this is fine —
  // the org can be renamed once the company profile is set.
  const display = getDisplayName(user);
  if (display && display !== 'User') return `${display}'s workspace`;
  return 'My workspace';
}
