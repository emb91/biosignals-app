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

/**
 * Claim cooldowns — how long each status holds the one-active-outreach-per-person claim
 * (and keeps steering teammates away). Past its window a claim is treated as expired:
 * the badge/Today exclusion drop it, and the next dispatch attempt releases it for real
 * (claim_released_at) before claiming. Shared by every surface so they never disagree.
 *   queued  — a send that crashed mid-flight; release fast.
 *   sent    — sequence steps span ~21 days; hold a few days past the end.
 *   replied — the rep owns the live conversation; hold a quarter.
 *   draft   — not a claim (not in the unique index), but a stale draft stops steering.
 */
export const CLAIM_WINDOW_MS: Record<OrgOutreachStatus, number> = {
  queued: 60 * 60 * 1000, // 1 hour
  sent: 30 * 86_400_000, // 30 days
  replied: 90 * 86_400_000, // 90 days
  draft: 14 * 86_400_000, // 14 days
};

/** Is this sequence still actively holding (or steering) given its age + release flag? */
export function isClaimFresh(
  row: { dispatch_status: string; last_status_at: string | null; created_at?: string | null; claim_released_at?: string | null },
  nowMs: number = Date.now(),
): boolean {
  if (row.claim_released_at) return false;
  const status = row.dispatch_status as OrgOutreachStatus;
  const windowMs = CLAIM_WINDOW_MS[status];
  if (!windowMs) return false;
  const anchor = Date.parse(row.last_status_at ?? row.created_at ?? '') || 0;
  if (!anchor) return true; // no timestamp — be conservative, treat as fresh
  return nowMs - anchor <= windowMs;
}

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
    .select('person_id, user_id, dispatch_status, last_status_at, created_at, claim_released_at')
    .eq('org_id', orgId)
    .neq('user_id', params.userId)
    .in('person_id', personIds)
    .in('dispatch_status', ACTIVE_STATUSES);

  // Drop released + expired claims (cooldown windows) — a 30-day-old sent sequence with
  // no reply shouldn't keep steering teammates away.
  const nowMs = Date.now();
  const rows = ((data ?? []) as Array<{
    person_id: string;
    user_id: string;
    dispatch_status: OrgOutreachStatus;
    last_status_at: string | null;
    created_at: string | null;
    claim_released_at: string | null;
  }>).filter((r) => isClaimFresh(r, nowMs));
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
 * Dispatch-time gatekeeping: release any EXPIRED in-flight claims on this person (lazy
 * cooldown — stamps claim_released_at via the service-role client so the unique index
 * frees the slot), then report whether a FRESH claim still blocks. Returns the fresh
 * holder's activity (for the friendly rejection message) or null when the way is clear.
 *
 * `admin` must be the service-role client: releasing a teammate's stale claim is a write
 * to their row, which RLS (rightly) won't allow the caller to do.
 */
export async function releaseExpiredAndFindBlocker(
  admin: MinimalClient,
  params: { userId: string; orgId: string; personId: string },
): Promise<OrgOutreachActivity | null> {
  const { data } = await admin
    .from('outreach_sequences')
    .select('id, person_id, user_id, dispatch_status, last_status_at, created_at, claim_released_at')
    .eq('org_id', params.orgId)
    .eq('person_id', params.personId)
    .in('dispatch_status', ['queued', 'sent', 'replied'])
    .is('claim_released_at', null);

  const rows = (data ?? []) as Array<{
    id: string;
    person_id: string;
    user_id: string;
    dispatch_status: OrgOutreachStatus;
    last_status_at: string | null;
    created_at: string | null;
    claim_released_at: string | null;
  }>;
  if (rows.length === 0) return null;

  const nowMs = Date.now();
  const expired = rows.filter((r) => !isClaimFresh(r, nowMs));
  if (expired.length > 0) {
    await admin
      .from('outreach_sequences')
      .update({ claim_released_at: new Date().toISOString() })
      .in('id', expired.map((r) => r.id));
  }

  const fresh = rows.filter((r) => isClaimFresh(r, nowMs) && r.user_id !== params.userId);
  if (fresh.length === 0) return null;

  const blocker = fresh.sort((a, b) => STATUS_RANK[b.dispatch_status] - STATUS_RANK[a.dispatch_status])[0];
  const { data: profile } = await admin
    .from('user_profiles')
    .select('full_name, email')
    .eq('user_id', blocker.user_id)
    .maybeSingle();
  const p = profile as { full_name: string | null; email: string | null } | null;
  return {
    personId: blocker.person_id,
    userId: blocker.user_id,
    userName: p?.full_name?.trim() || p?.email?.split('@')[0] || 'a teammate',
    status: blocker.dispatch_status,
    customerFacing: blocker.dispatch_status !== 'draft',
    lastStatusAt: blocker.last_status_at,
  };
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
