/**
 * Org-wide outreach activity — "is a teammate already working this person?"
 *
 * Powers the collision-prevention surfaces: the contacts action cell ("In sequence with
 * Alice"), the side-panel assignment line, the Today best-leads exclusion, and the
 * friendly dispatch rejection. The hard race-proof guarantee itself lives in the DB
 * (partial unique index on outreach_sequences (org_id, person_id) over in-flight
 * statuses); this module is the read side.
 *
 * Semantics:
 * - "active" = draft | queued | sent | replied. A teammate's draft means they're working
 *   the lead (steer away); queued/sent/replied means it's customer-facing ("assigned").
 * - Only OTHER members' activity is returned — your own sequences are your business.
 */
import { orgIdForUser } from '@/lib/org-context';

export type OrgOutreachStatus = 'draft' | 'queued' | 'sent' | 'replied';

export interface OrgOutreachActivity {
  personId: string;
  userId: string;
  /** Teammate display name (their profile name, else email local part, else 'a teammate'). */
  userName: string;
  status: OrgOutreachStatus;
  /** True once the touch is customer-facing (queued/sent/replied) — drives "Assigned to". */
  customerFacing: boolean;
  lastStatusAt: string | null;
}

const ACTIVE_STATUSES: OrgOutreachStatus[] = ['draft', 'queued', 'sent', 'replied'];
const STATUS_RANK: Record<OrgOutreachStatus, number> = { replied: 4, sent: 3, queued: 2, draft: 1 };

type MinimalClient = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Activity by OTHER org members for a set of canonical person ids.
 * Returns a map personId → strongest activity (replied > sent > queued > draft).
 */
export async function fetchOrgOutreachActivityByPerson(
  client: MinimalClient,
  params: { userId: string; personIds: string[] },
): Promise<Map<string, OrgOutreachActivity>> {
  const personIds = [...new Set(params.personIds.filter(Boolean))];
  const out = new Map<string, OrgOutreachActivity>();
  if (personIds.length === 0) return out;

  const orgId = await orgIdForUser(client, params.userId);
  if (!orgId) return out;

  const { data } = await client
    .from('outreach_sequences')
    .select('person_id, user_id, dispatch_status, last_status_at')
    .eq('org_id', orgId)
    .neq('user_id', params.userId)
    .in('person_id', personIds)
    .in('dispatch_status', ACTIVE_STATUSES);

  const rows = (data ?? []) as Array<{
    person_id: string;
    user_id: string;
    dispatch_status: OrgOutreachStatus;
    last_status_at: string | null;
  }>;
  if (rows.length === 0) return out;

  // Teammate names from their profiles (org-readable), fallback handled below.
  const teammateIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: profiles } = await client
    .from('user_profiles')
    .select('user_id, full_name, email')
    .in('user_id', teammateIds);
  const nameById = new Map(
    ((profiles ?? []) as Array<{ user_id: string; full_name: string | null; email: string | null }>).map((p) => [
      p.user_id,
      p.full_name?.trim() || p.email?.split('@')[0] || null,
    ]),
  );

  for (const r of rows) {
    const existing = out.get(r.person_id);
    if (existing && STATUS_RANK[existing.status] >= STATUS_RANK[r.dispatch_status]) continue;
    out.set(r.person_id, {
      personId: r.person_id,
      userId: r.user_id,
      userName: nameById.get(r.user_id) ?? 'a teammate',
      status: r.dispatch_status,
      customerFacing: r.dispatch_status !== 'draft',
      lastStatusAt: r.last_status_at,
    });
  }
  return out;
}

/**
 * Convenience for contact-keyed callers: resolves the caller's contact ids → person ids
 * via user_contacts, then returns a map contactId → teammate activity.
 */
export async function fetchOrgOutreachActivityByContact(
  client: MinimalClient,
  params: { userId: string; contactIds: string[] },
): Promise<Map<string, OrgOutreachActivity>> {
  const contactIds = [...new Set(params.contactIds.filter(Boolean))];
  const out = new Map<string, OrgOutreachActivity>();
  if (contactIds.length === 0) return out;

  const { data: links } = await client
    .from('user_contacts')
    .select('id, person_id')
    .eq('user_id', params.userId)
    .in('id', contactIds);
  const personByContact = new Map(
    ((links ?? []) as Array<{ id: string; person_id: string | null }>)
      .filter((l) => l.person_id)
      .map((l) => [l.id, l.person_id as string]),
  );
  if (personByContact.size === 0) return out;

  const byPerson = await fetchOrgOutreachActivityByPerson(client, {
    userId: params.userId,
    personIds: [...personByContact.values()],
  });

  for (const [contactId, personId] of personByContact) {
    const activity = byPerson.get(personId);
    if (activity) out.set(contactId, activity);
  }
  return out;
}
