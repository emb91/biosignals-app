/**
 * Org context resolution — the shared choke point for the org/seats layer.
 *
 * `getOrgContext()` resolves the authenticated user AND their org membership in one
 * call. Routes that need org scope use this instead of bare `getUser()`.
 *
 * Lazy solo-org creation (audit #5): if an authenticated user has no membership yet
 * (a brand-new password signup, or any future entry point that skips the invite path),
 * we create a solo org on the spot via the admin client calling `ensure_user_org`.
 * Invited users already have a pending membership (written by the invite flow), so
 * the lazy path no-ops for them and finalises that membership's `joined_at` here.
 *
 * One org per user is enforced at the DB level (UNIQUE(user_id) on org_members), so
 * `user_org_id()` and this helper are deterministic.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getDisplayName } from '@/lib/auth-helpers';
import { ensureArcovaOwnerWorkspaceExempt } from '@/lib/billing/exemptions';

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

export const WORKSPACE_REQUIRED_ERROR = {
  code: 'workspace_required',
  error: 'Workspace not found',
  message: 'Finish company setup to continue.',
  setupPath: '/arcova-setup',
} as const;

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
    await ensureArcovaOwnerWorkspaceExempt({
      orgId: existing.org_id,
      email: user.email,
      role: existing.role,
    });
    return { supabase, user, orgId: existing.org_id, role: existing.role };
  }

  // No membership. Create a solo org. Do not trust auth user_metadata for org
  // attachment: Supabase user metadata is client-writable.
  const admin = createAdminClient();

  const orgName = deriveOrgName(user);
  const { data: orgId, error: ensureError } = await admin.rpc('ensure_user_org', {
    p_user_id: user.id,
    p_name: orgName,
  });

  if (ensureError || !orgId) {
    console.error('[org-context] ensure_user_org failed:', ensureError);
    return null;
  }

  await ensureArcovaOwnerWorkspaceExempt({
    orgId: orgId as string,
    email: user.email,
    role: 'owner',
  });
  return { supabase, user, orgId: orgId as string, role: 'owner' };
}

/**
 * Lightweight org-id lookup for a known user, for routes that already resolved the user
 * and just need to swap an ICP query from user-scope to org-scope. Returns null if the
 * user somehow has no membership (caller should fall back to user-scope).
 *
 * `client` should be an RLS-scoped request client; org_members RLS lets a user read
 * their own membership row.
 */
export async function orgIdForUser(
  // Accept any client exposing `.from()` — both the RLS SupabaseClient and the narrowed
  // `MinimalSupabase` shapes the lib layer uses satisfy this.
  client: { from: (table: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  userId: string,
): Promise<string | null> {
  const { data } = await client
    .from('org_members')
    .select('org_id')
    .eq('user_id', userId)
    .maybeSingle();
  return (data as { org_id: string } | null)?.org_id ?? null;
}

/**
 * Apply the "ICPs visible to user U" filter to an `icps` (or icp-child) query builder:
 * company-wide ICPs in U's org  +  U's own personal ICPs. Correct on BOTH the RLS client
 * and the service-role client (it encodes the same predicate the RLS policy uses), so
 * background jobs don't leak one member's personal ICPs into another member's scoring.
 *
 * For a solo owner this returns exactly their own ICPs (behavior-preserving), since their
 * org contains only their rows.
 *
 * Usage: `scopeIcpsToUser(supabase.from('icps').select('*'), orgId, userId)`
 * If orgId is null (no membership resolved), falls back to a plain user filter.
 */
// Query builder type varies (RLS vs minimal client) and the real Supabase builder type
// is too deep for a generic constraint here — `any` is the pragmatic choice for a filter
// passthrough that returns the same builder.
/* eslint-disable @typescript-eslint/no-explicit-any */
export function scopeIcpsToUser(query: any, orgId: string | null, userId: string): any {
  if (!orgId) return query.eq('user_id', userId);
  return query.eq('org_id', orgId).or(`scope.eq.org,user_id.eq.${userId}`);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function deriveOrgName(user: User): string {
  // Prefer a human name, fall back to the email local part. The backfill prefers the
  // company profile name; for a fresh signup we don't have one yet, so this is fine —
  // the org can be renamed once the company profile is set.
  const display = getDisplayName(user);
  if (display && display !== 'User') return `${display}'s workspace`;
  return 'My workspace';
}
