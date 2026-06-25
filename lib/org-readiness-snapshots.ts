import { createAdminClient } from '@/lib/supabase-admin';

type ContactReadiness = {
  label: string | null;
  score: number | null;
};

type AccountReadiness = {
  score: number | null;
};

type OrgMember = {
  userId: string;
  role: string | null;
  joinedAt: string | null;
  createdAt: string | null;
};

const ROLE_RANK: Record<string, number> = {
  owner: 0,
  admin: 1,
  member: 2,
};

function finiteScore(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function updatedAtMs(value: string | null | undefined): number {
  return value ? Date.parse(value) || 0 : 0;
}

async function orgMembers(admin: ReturnType<typeof createAdminClient>, orgId: string): Promise<OrgMember[]> {
  const { data, error } = await admin
    .from('org_members')
    .select('user_id, role, joined_at, created_at')
    .eq('org_id', orgId);
  if (error) throw new Error(`org member lookup failed: ${error.message}`);
  return (data ?? [])
    .map((row) => ({
      userId: row.user_id as string,
      role: (row.role as string | null | undefined) ?? null,
      joinedAt: (row.joined_at as string | null | undefined) ?? null,
      createdAt: (row.created_at as string | null | undefined) ?? null,
    }))
    .filter((row) => Boolean(row.userId));
}

function pickRepresentative(members: OrgMember[]): OrgMember | null {
  const sorted = [...members].sort((a, b) => {
    const roleDiff = (ROLE_RANK[a.role ?? ''] ?? 99) - (ROLE_RANK[b.role ?? ''] ?? 99);
    if (roleDiff !== 0) return roleDiff;
    const aJoined = Date.parse(a.joinedAt ?? a.createdAt ?? '') || Number.MAX_SAFE_INTEGER;
    const bJoined = Date.parse(b.joinedAt ?? b.createdAt ?? '') || Number.MAX_SAFE_INTEGER;
    if (aJoined !== bJoined) return aJoined - bJoined;
    return a.userId.localeCompare(b.userId);
  });
  return sorted[0] ?? null;
}

// Sweeps now collapse work to a single org representative. Prefer that user's
// snapshot when present; otherwise fall back to the freshest legacy/member row.
function preferRepresentativeThenNewest<T extends { updated_at: string | null; user_id: string }>(
  current: T | undefined,
  candidate: T,
  preferredUserId: string,
): T {
  if (!current) return candidate;
  if (candidate.user_id === preferredUserId && current.user_id !== preferredUserId) return candidate;
  if (current.user_id === preferredUserId && candidate.user_id !== preferredUserId) return current;
  const candidateTime = updatedAtMs(candidate.updated_at);
  const currentTime = updatedAtMs(current.updated_at);
  if (candidateTime > currentTime) return candidate;
  if (candidateTime < currentTime) return current;
  if (candidate.user_id === preferredUserId && current.user_id !== preferredUserId) return candidate;
  return current;
}

export async function contactReadinessByContactIdForOrg(params: {
  orgId: string | null;
  userId: string;
  contactIds: string[];
}): Promise<Map<string, ContactReadiness>> {
  const contactIds = [...new Set(params.contactIds.filter(Boolean))];
  const out = new Map<string, ContactReadiness>();
  if (contactIds.length === 0) return out;

  const admin = createAdminClient();
  const members = params.orgId
    ? await orgMembers(admin, params.orgId)
    : [{ userId: params.userId, role: 'owner', joinedAt: null, createdAt: null }];
  const memberIds = [...new Set(members.map((member) => member.userId))];
  if (memberIds.length === 0) return out;

  const { data: requestedLinks, error: requestedLinksError } = await admin
    .from('user_contacts')
    .select('id, person_id')
    .in('id', contactIds);
  if (requestedLinksError) throw new Error(`contact person lookup failed: ${requestedLinksError.message}`);

  const personByRequestedContact = new Map(
    (requestedLinks ?? [])
      .filter((row) => typeof row.id === 'string' && typeof row.person_id === 'string')
      .map((row) => [row.id as string, row.person_id as string]),
  );
  const personIds = [...new Set([...personByRequestedContact.values()])];
  if (personIds.length === 0) return out;

  const { data: orgContacts, error: orgContactsError } = await admin
    .from('user_contacts')
    .select('id, person_id, user_id')
    .in('user_id', memberIds)
    .in('person_id', personIds)
    .is('archived_at', null);
  if (orgContactsError) throw new Error(`org contact lookup failed: ${orgContactsError.message}`);

  const personByOrgContact = new Map<string, string>();
  const usersByPerson = new Map<string, Set<string>>();
  const orgContactIds: string[] = [];
  for (const row of orgContacts ?? []) {
    const contactId = row.id as string;
    const personId = row.person_id as string;
    const userId = row.user_id as string;
    if (!contactId || !personId) continue;
    personByOrgContact.set(contactId, personId);
    const users = usersByPerson.get(personId) ?? new Set<string>();
    if (userId) users.add(userId);
    usersByPerson.set(personId, users);
    orgContactIds.push(contactId);
  }
  if (orgContactIds.length === 0) return out;

  const { data: snapshots, error: snapshotsError } = await admin
    .from('contact_readiness_snapshots')
    .select('user_id, contact_id, overall_label, overall_score, updated_at')
    .in('user_id', memberIds)
    .in('contact_id', orgContactIds);
  if (snapshotsError) throw new Error(`contact readiness lookup failed: ${snapshotsError.message}`);

  type SnapshotRow = {
    user_id: string;
    contact_id: string;
    overall_label: string | null;
    overall_score: unknown;
    updated_at: string | null;
  };
  const newestByPerson = new Map<string, SnapshotRow>();
  for (const snapshot of (snapshots ?? []) as SnapshotRow[]) {
    const personId = personByOrgContact.get(snapshot.contact_id);
    if (!personId) continue;
    const preferredUserId = pickRepresentative(
      members.filter((member) => usersByPerson.get(personId)?.has(member.userId)),
    )?.userId ?? params.userId;
    newestByPerson.set(
      personId,
      preferRepresentativeThenNewest(newestByPerson.get(personId), snapshot, preferredUserId),
    );
  }

  for (const [contactId, personId] of personByRequestedContact) {
    const snapshot = newestByPerson.get(personId);
    if (!snapshot) continue;
    out.set(contactId, {
      label: snapshot.overall_label ?? null,
      score: finiteScore(snapshot.overall_score),
    });
  }
  return out;
}

export async function accountReadinessByCompanyIdForOrg(params: {
  orgId: string | null;
  userId: string;
  companyIds: string[];
}): Promise<Map<string, AccountReadiness>> {
  const companyIds = [...new Set(params.companyIds.filter(Boolean))];
  const out = new Map<string, AccountReadiness>();
  if (companyIds.length === 0) return out;

  const admin = createAdminClient();
  const members = params.orgId
    ? await orgMembers(admin, params.orgId)
    : [{ userId: params.userId, role: 'owner', joinedAt: null, createdAt: null }];
  const memberIds = [...new Set(members.map((member) => member.userId))];
  if (memberIds.length === 0) return out;
  const preferredUserId = pickRepresentative(members)?.userId ?? params.userId;

  const { data, error } = await admin
    .from('account_readiness_snapshots')
    .select('user_id, company_id, overall_score, updated_at')
    .in('user_id', memberIds)
    .in('company_id', companyIds);
  if (error) throw new Error(`account readiness lookup failed: ${error.message}`);

  type SnapshotRow = {
    user_id: string;
    company_id: string;
    overall_score: unknown;
    updated_at: string | null;
  };
  const newestByCompany = new Map<string, SnapshotRow>();
  for (const snapshot of (data ?? []) as SnapshotRow[]) {
    if (!snapshot.company_id) continue;
    newestByCompany.set(
      snapshot.company_id,
      preferRepresentativeThenNewest(newestByCompany.get(snapshot.company_id), snapshot, preferredUserId),
    );
  }

  for (const [companyId, snapshot] of newestByCompany) {
    out.set(companyId, { score: finiteScore(snapshot.overall_score) });
  }
  return out;
}
