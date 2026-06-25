import { createAdminClient } from '@/lib/supabase-admin';

type ContactReadiness = {
  label: string | null;
  score: number | null;
};

type AccountReadiness = {
  score: number | null;
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

async function orgMemberIds(admin: ReturnType<typeof createAdminClient>, orgId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('org_members')
    .select('user_id')
    .eq('org_id', orgId);
  if (error) throw new Error(`org member lookup failed: ${error.message}`);
  return [...new Set((data ?? []).map((row) => row.user_id as string).filter(Boolean))];
}

function preferNewest<T extends { updated_at: string | null; user_id: string }>(
  current: T | undefined,
  candidate: T,
  preferredUserId: string,
): T {
  if (!current) return candidate;
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
  const memberIds = params.orgId ? await orgMemberIds(admin, params.orgId) : [params.userId];
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
  const orgContactIds: string[] = [];
  for (const row of orgContacts ?? []) {
    const contactId = row.id as string;
    const personId = row.person_id as string;
    if (!contactId || !personId) continue;
    personByOrgContact.set(contactId, personId);
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
    newestByPerson.set(
      personId,
      preferNewest(newestByPerson.get(personId), snapshot, params.userId),
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
  const memberIds = params.orgId ? await orgMemberIds(admin, params.orgId) : [params.userId];
  if (memberIds.length === 0) return out;

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
      preferNewest(newestByCompany.get(snapshot.company_id), snapshot, params.userId),
    );
  }

  for (const [companyId, snapshot] of newestByCompany) {
    out.set(companyId, { score: finiteScore(snapshot.overall_score) });
  }
  return out;
}
