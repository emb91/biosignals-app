import type { SupabaseClient } from '@supabase/supabase-js';
import { authoritativeAccountReadiness } from '@/lib/effective-priority';

type DatabaseClient = SupabaseClient<any, 'public', any>;

export type ActiveCompanyStateRow = {
  company_id: string;
  company_fit_score?: number | null;
  readiness_score?: number | null;
};

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function orgIdForCompanyStateUser(
  client: DatabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await client
    .from('org_members')
    .select('org_id')
    .eq('user_id', userId)
    .maybeSingle();
  return (data as { org_id?: string } | null)?.org_id ?? null;
}

export async function listActiveCompanyStateForUser(
  client: DatabaseClient,
  userId: string,
  select = 'company_id',
): Promise<ActiveCompanyStateRow[]> {
  const orgId = await orgIdForCompanyStateUser(client, userId);
  const query = orgId
    ? client
        .from('org_companies')
        .select(select)
        .eq('org_id', orgId)
        .is('archived_at', null)
    : client
        .from('user_companies')
        .select(select)
        .eq('user_id', userId)
        .is('archived_at', null);

  const { data, error } = await query;
  if (error) {
    throw new Error(`company state query: ${error.message}`);
  }

  const rows = ((data ?? []) as unknown as ActiveCompanyStateRow[]).filter(
    (row) => typeof row.company_id === 'string' && Boolean(row.company_id),
  );

  if (!select.includes('readiness_score') && select.trim() !== '*') return rows;

  const companyIds = [...new Set(rows.map((row) => row.company_id))];
  if (companyIds.length === 0) return rows;

  const { data: snapshots, error: snapshotError } = await client
    .from('account_readiness_snapshots')
    .select('company_id, overall_score')
    .eq('user_id', userId)
    .in('company_id', companyIds);

  if (snapshotError || !snapshots) return rows;

  const readinessByCompanyId = new Map(
    (snapshots as Array<{ company_id?: unknown; overall_score?: unknown }>)
      .filter((row) => typeof row.company_id === 'string')
      .map((row) => [row.company_id as string, finiteNumber(row.overall_score)]),
  );

  return rows.map((row) =>
    readinessByCompanyId.has(row.company_id)
      ? {
          ...row,
          readiness_score: authoritativeAccountReadiness(
            readinessByCompanyId.get(row.company_id),
            row.readiness_score,
          ),
        }
      : row,
  );
}

export async function userHasActiveCompany(
  client: DatabaseClient,
  userId: string,
  companyId: string,
): Promise<boolean> {
  const orgId = await orgIdForCompanyStateUser(client, userId);
  const query = orgId
    ? client
        .from('org_companies')
        .select('company_id')
        .eq('org_id', orgId)
        .eq('company_id', companyId)
        .is('archived_at', null)
        .maybeSingle()
    : client
        .from('user_companies')
        .select('company_id')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .is('archived_at', null)
        .maybeSingle();

  const { data, error } = await query;
  return !error && Boolean(data);
}

export async function updateCompanyStateForUser(
  client: DatabaseClient,
  userId: string,
  values: Record<string, unknown>,
  companyIds?: string[],
): Promise<{ updated: number | null }> {
  const orgId = await orgIdForCompanyStateUser(client, userId);
  let query = orgId
    ? client.from('org_companies').update(values, { count: 'exact' }).eq('org_id', orgId)
    : client.from('user_companies').update(values, { count: 'exact' }).eq('user_id', userId);

  if (companyIds?.length) {
    query = query.in('company_id', companyIds);
  }

  const { count, error } = await query;
  if (error) throw new Error(`company state update: ${error.message}`);
  return { updated: count ?? null };
}

export async function listUserIdsWithActiveCompanyState(
  client: DatabaseClient,
): Promise<string[]> {
  const ids = new Set<string>();

  const { data: orgRows, error: orgErr } = await client
    .from('org_companies')
    .select('org_id')
    .is('archived_at', null);
  if (orgErr) throw new Error(`active org company query: ${orgErr.message}`);

  const orgIds = [
    ...new Set(
      ((orgRows ?? []) as Array<{ org_id?: unknown }>)
        .map((row) => row.org_id)
        .filter((value): value is string => typeof value === 'string' && Boolean(value)),
    ),
  ];

  if (orgIds.length > 0) {
    const { data: members, error: membersErr } = await client
      .from('org_members')
      .select('user_id')
      .in('org_id', orgIds);
    if (membersErr) throw new Error(`active org members query: ${membersErr.message}`);
    for (const row of (members ?? []) as Array<{ user_id?: unknown }>) {
      if (typeof row.user_id === 'string' && row.user_id) ids.add(row.user_id);
    }
  }

  const { data: legacyRows, error: legacyErr } = await client
    .from('user_companies')
    .select('user_id')
    .is('archived_at', null);
  if (legacyErr) throw new Error(`legacy active user company query: ${legacyErr.message}`);
  for (const row of (legacyRows ?? []) as Array<{ user_id?: unknown }>) {
    if (typeof row.user_id === 'string' && row.user_id) ids.add(row.user_id);
  }

  return [...ids];
}
