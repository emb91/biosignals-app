/**
 * "Invite your team" priority source.
 *
 * Nudges an org owner/admin who is still the only seat to add teammates. Cheap: a
 * membership lookup + two counts, no LLM. Dismissible like any /today agenda row (the
 * client persists done-state in localStorage). Disappears automatically once a second
 * seat or a pending invite exists.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ROUTES } from '@/lib/routes';
import type { TodayPriority } from '@/lib/priorities/types';

export async function computeInviteTeamPriority(
  supabase: SupabaseClient,
  userId: string,
): Promise<TodayPriority | null> {
  // The caller's own membership (RLS lets a user read their own row).
  const { data: me } = await supabase
    .from('org_members')
    .select('org_id, role')
    .eq('user_id', userId)
    .maybeSingle<{ org_id: string; role: string }>();

  if (!me?.org_id) return null;
  if (me.role !== 'owner' && me.role !== 'admin') return null;

  const [{ count: memberCount }, { count: inviteCount }] = await Promise.all([
    supabase.from('org_members').select('user_id', { count: 'exact', head: true }).eq('org_id', me.org_id),
    supabase
      .from('org_invites')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', me.org_id)
      .eq('status', 'pending'),
  ]);

  // Already has teammates or a pending invite → nothing to nudge.
  if ((memberCount ?? 0) > 1 || (inviteCount ?? 0) > 0) return null;

  return {
    source: 'invite-team',
    groupKey: 'default',
    severity: 'low',
    title: 'Invite your team',
    detail: 'Add your teammates so they can work alongside you.',
    href: ROUTES.settings,
    cta: 'Open settings',
  };
}
