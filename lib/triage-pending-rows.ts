export type TriageGroup = 'high' | 'medium' | 'low';

export type RawTriageRow = {
  id: string;
  user_id: string;
  batch_id: string | null;
  full_name: string | null;
  email: string | null;
  linkedin_url: string | null;
  company_name: string | null;
  status: string | null;
  raw_data: Record<string, unknown> | null;
  uploaded_at: string | null;
  triage_group: TriageGroup | null;
  triage_override_group?: TriageGroup | null;
  triage_version: string | null;
  triage_scored_at: string | null;
  triage_overridden_by?: string | null;
  triage_overridden_at?: string | null;
  pinned_at?: string | null;
  pinned_by?: string | null;
};

export type PendingTriagePatch = {
  triage_override_group?: TriageGroup | null;
  triage_overridden_by?: string;
  triage_overridden_at?: string;
  pinned_at?: string;
  pinned_by?: string;
};

type DbError = { message: string };
type SupabaseLike = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const PENDING_TRIAGE_STATUSES = ['awaiting_triage', 'awaiting_enrichment'] as const;
const PENDING_TRIAGE_SELECT =
  'id, user_id, batch_id, full_name, email, linkedin_url, company_name, status, raw_data, uploaded_at, triage_group, triage_override_group, triage_version, triage_scored_at, triage_overridden_by, triage_overridden_at, pinned_at, pinned_by';

export async function listPendingTriageRowsForOrg(
  admin: SupabaseLike,
  orgId: string,
): Promise<{ data: RawTriageRow[]; error: DbError | null }> {
  const { data, error } = await admin
    .from('raw_uploads')
    .select(PENDING_TRIAGE_SELECT)
    .eq('org_id', orgId)
    .in('status', PENDING_TRIAGE_STATUSES)
    .limit(1000);

  return { data: (data ?? []) as RawTriageRow[], error: (error as DbError | null) ?? null };
}

export async function findPendingTriageRowForOrg(
  admin: SupabaseLike,
  orgId: string,
  id: string,
): Promise<{ data: { id: string; org_id: string | null } | null; error: DbError | null }> {
  const { data, error } = await admin
    .from('raw_uploads')
    .select('id, org_id')
    .eq('id', id)
    .eq('org_id', orgId)
    .in('status', PENDING_TRIAGE_STATUSES)
    .maybeSingle();

  return {
    data: (data as { id: string; org_id: string | null } | null) ?? null,
    error: (error as DbError | null) ?? null,
  };
}

export async function updatePendingTriageRowForOrg(
  admin: SupabaseLike,
  orgId: string,
  id: string,
  patch: PendingTriagePatch,
): Promise<{ error: DbError | null }> {
  const { error } = await admin
    .from('raw_uploads')
    .update(patch)
    .eq('id', id)
    .eq('org_id', orgId)
    .in('status', PENDING_TRIAGE_STATUSES);

  return { error: (error as DbError | null) ?? null };
}
