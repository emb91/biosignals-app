import type { SupabaseClient } from '@supabase/supabase-js';
import { listActiveCompanyStateForUser } from '@/lib/org-company-state';

export type DatabaseClient = SupabaseClient<any, 'public', any>;

export type CrmDealMirrorRecord = {
  id: string;
  user_id: string;
  hubspot_deal_id: string;
  deal_name: string | null;
  deal_stage: string | null;
  pipeline: string | null;
  amount: number | null;
  close_date: string | null;
  created_date: string | null;
  hubspot_owner_id: string | null;
  hs_lastmodifieddate: string | null;
  raw_payload: Record<string, unknown>;
  synced_at: string;
};

export type CrmSyncCheckpointRecord = {
  id: string;
  user_id: string;
  provider: string;
  object_type: string;
  last_synced_remote_at: string | null;
  last_sync_status: 'success' | 'error' | null;
  last_sync_error: string | null;
  synced_at: string;
  metadata: Record<string, unknown>;
};

export type ArcovaCompanyRecord = {
  id: string;
  domain: string | null;
  website: string | null;
  company_name: string | null;
};

export type ArcovaContactRecord = {
  id: string;
  email: string | null;
  job_title?: string | null;
  seniority_level?: string | null;
  business_area?: string | null;
  company_id: string | null;
  company_name: string | null;
  company_domain: string | null;
  resolved_current_company_name: string | null;
  resolved_current_company_domain: string | null;
};

export type CrmContactMirrorRecord = {
  id: string;
  user_id: string;
  hubspot_contact_id: string;
  full_name: string | null;
  email: string | null;
  job_title: string | null;
  hubspot_owner_id: string | null;
  arcova_contact_id: string | null;
  arcova_company_id: string | null;
  arcova_company_name: string | null;
  arcova_company_domain: string | null;
  hs_lastmodifieddate: string | null;
  raw_payload: Record<string, unknown>;
  synced_at: string;
};

function toRecord<T>(value: unknown): T {
  return value as T;
}

export async function getCrmSyncCheckpoint(
  supabase: DatabaseClient,
  userId: string,
  provider: string,
  objectType: string
): Promise<CrmSyncCheckpointRecord | null> {
  const { data, error } = await supabase
    .from('crm_sync_checkpoints')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('object_type', objectType)
    .maybeSingle();

  if (error) throw error;
  return data ? toRecord<CrmSyncCheckpointRecord>(data) : null;
}

export async function upsertCrmSyncCheckpoint(
  supabase: DatabaseClient,
  input: {
    userId: string;
    provider: string;
    objectType: string;
    lastSyncedRemoteAt: string | null;
    lastSyncStatus: 'success' | 'error';
    lastSyncError?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<CrmSyncCheckpointRecord> {
  const { data, error } = await supabase
    .from('crm_sync_checkpoints')
    .upsert(
      {
        user_id: input.userId,
        provider: input.provider,
        object_type: input.objectType,
        last_synced_remote_at: input.lastSyncedRemoteAt,
        last_sync_status: input.lastSyncStatus,
        last_sync_error: input.lastSyncError ?? null,
        metadata: input.metadata ?? {},
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider,object_type' }
    )
    .select()
    .single();

  if (error) throw error;
  return toRecord<CrmSyncCheckpointRecord>(data);
}

export async function listCrmDealsByHubSpotIds(
  supabase: DatabaseClient,
  userId: string,
  hubspotDealIds: string[]
): Promise<Map<string, CrmDealMirrorRecord>> {
  if (!hubspotDealIds.length) return new Map();

  const { data, error } = await supabase
    .from('crm_deals')
    .select('*')
    .eq('user_id', userId)
    .in('hubspot_deal_id', hubspotDealIds);

  if (error) throw error;

  return new Map((data ?? []).map((row) => [String(row.hubspot_deal_id), toRecord<CrmDealMirrorRecord>(row)]));
}

export async function upsertCrmDeal(
  supabase: DatabaseClient,
  input: {
    userId: string;
    hubspotDealId: string;
    dealName: string | null;
    dealStage: string | null;
    pipeline: string | null;
    amount: number | null;
    closeDate: string | null;
    createdDate: string | null;
    hubspotOwnerId: string | null;
    hsLastModifiedDate: string | null;
    rawPayload: Record<string, unknown>;
  }
): Promise<CrmDealMirrorRecord> {
  const { data, error } = await supabase
    .from('crm_deals')
    .upsert(
      {
        user_id: input.userId,
        hubspot_deal_id: input.hubspotDealId,
        deal_name: input.dealName,
        deal_stage: input.dealStage,
        pipeline: input.pipeline,
        amount: input.amount,
        close_date: input.closeDate,
        created_date: input.createdDate,
        hubspot_owner_id: input.hubspotOwnerId,
        hs_lastmodifieddate: input.hsLastModifiedDate,
        raw_payload: input.rawPayload,
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,hubspot_deal_id' }
    )
    .select()
    .single();

  if (error) throw error;
  return toRecord<CrmDealMirrorRecord>(data);
}

/**
 * Record a deal's stage transition into crm_deal_stage_history. Idempotent:
 * - if the deal is already in `toStage` (an open row exists for it), no-op
 * - otherwise close any open stage row(s) (`exited_at = at`) and open `toStage`
 *
 * `at` is the transition timestamp (hs_lastmodifieddate for a change, or the
 * deal's created_date for the first observed stage). Powers per-ICP funnel
 * conversion + sales-cycle length. Going-forward capture only — deals' history
 * prior to first sync is partial unless backfilled via HubSpot property history.
 */
export async function recordDealStageTransition(
  supabase: DatabaseClient,
  input: {
    userId: string;
    hubspotDealId: string;
    toStage: string;
    at: string;
    rawPayload?: Record<string, unknown> | null;
  }
): Promise<void> {
  const { userId, hubspotDealId, toStage, at } = input;

  const { data: openRows } = await supabase
    .from('crm_deal_stage_history')
    .select('id, stage')
    .eq('user_id', userId)
    .eq('hubspot_deal_id', hubspotDealId)
    .is('exited_at', null);

  const open = (openRows ?? []) as Array<{ id: string; stage: string }>;
  if (open.length === 1 && open[0].stage === toStage) return; // already in this stage

  if (open.length > 0) {
    await supabase
      .from('crm_deal_stage_history')
      .update({ exited_at: at })
      .eq('user_id', userId)
      .eq('hubspot_deal_id', hubspotDealId)
      .is('exited_at', null);
  }

  await supabase.from('crm_deal_stage_history').upsert(
    {
      user_id: userId,
      hubspot_deal_id: hubspotDealId,
      stage: toStage,
      entered_at: at,
      exited_at: null,
      raw_payload: input.rawPayload ?? null,
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,hubspot_deal_id,stage,entered_at', ignoreDuplicates: true }
  );
}

export async function listCrmContactsByHubSpotIds(
  supabase: DatabaseClient,
  userId: string,
  hubspotContactIds: string[]
): Promise<Map<string, CrmContactMirrorRecord>> {
  if (!hubspotContactIds.length) return new Map();

  const { data, error } = await supabase
    .from('crm_contacts')
    .select('*')
    .eq('user_id', userId)
    .in('hubspot_contact_id', hubspotContactIds);

  if (error) throw error;

  return new Map((data ?? []).map((row) => [String(row.hubspot_contact_id), toRecord<CrmContactMirrorRecord>(row)]));
}

export async function upsertCrmContact(
  supabase: DatabaseClient,
  input: {
    userId: string;
    hubspotContactId: string;
    fullName: string | null;
    email: string | null;
    jobTitle: string | null;
    hubspotOwnerId: string | null;
    arcovaContactId: string | null;
    arcovaCompanyId: string | null;
    arcovaCompanyName: string | null;
    arcovaCompanyDomain: string | null;
    hsLastModifiedDate: string | null;
    rawPayload: Record<string, unknown>;
  }
): Promise<CrmContactMirrorRecord> {
  const { data, error } = await supabase
    .from('crm_contacts')
    .upsert(
      {
        user_id: input.userId,
        hubspot_contact_id: input.hubspotContactId,
        full_name: input.fullName,
        email: input.email,
        job_title: input.jobTitle,
        hubspot_owner_id: input.hubspotOwnerId,
        arcova_contact_id: input.arcovaContactId,
        arcova_company_id: input.arcovaCompanyId,
        arcova_company_name: input.arcovaCompanyName,
        arcova_company_domain: input.arcovaCompanyDomain,
        hs_lastmodifieddate: input.hsLastModifiedDate,
        raw_payload: input.rawPayload,
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,hubspot_contact_id' }
    )
    .select()
    .single();

  if (error) throw error;
  return toRecord<CrmContactMirrorRecord>(data);
}

export async function replaceCrmDealCompanyLinks(
  supabase: DatabaseClient,
  input: {
    userId: string;
    hubspotDealId: string;
    rows: Array<{
      hubspotCompanyId: string;
      hubspotCompanyName: string | null;
      hubspotCompanyDomain: string | null;
      arcovaCompanyId: string | null;
      hsLastModifiedDate: string | null;
      rawPayload: Record<string, unknown>;
    }>;
  }
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('crm_deal_company_links')
    .delete()
    .eq('user_id', input.userId)
    .eq('hubspot_deal_id', input.hubspotDealId);

  if (deleteError) throw deleteError;

  if (!input.rows.length) return;

  const { error: insertError } = await supabase.from('crm_deal_company_links').insert(
    input.rows.map((row) => ({
      user_id: input.userId,
      hubspot_deal_id: input.hubspotDealId,
      hubspot_company_id: row.hubspotCompanyId,
      hubspot_company_name: row.hubspotCompanyName,
      hubspot_company_domain: row.hubspotCompanyDomain,
      arcova_company_id: row.arcovaCompanyId,
      hs_lastmodifieddate: row.hsLastModifiedDate,
      raw_payload: row.rawPayload,
      synced_at: new Date().toISOString(),
    }))
  );

  if (insertError) throw insertError;
}

export async function replaceCrmDealContactLinks(
  supabase: DatabaseClient,
  input: {
    userId: string;
    hubspotDealId: string;
    rows: Array<{
      hubspotContactId: string;
      hubspotContactEmail: string | null;
      hubspotContactName: string | null;
      arcovaContactId: string | null;
      hsLastModifiedDate: string | null;
      rawPayload: Record<string, unknown>;
    }>;
  }
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('crm_deal_contact_links')
    .delete()
    .eq('user_id', input.userId)
    .eq('hubspot_deal_id', input.hubspotDealId);

  if (deleteError) throw deleteError;

  if (!input.rows.length) return;

  const { error: insertError } = await supabase.from('crm_deal_contact_links').insert(
    input.rows.map((row) => ({
      user_id: input.userId,
      hubspot_deal_id: input.hubspotDealId,
      hubspot_contact_id: row.hubspotContactId,
      hubspot_contact_email: row.hubspotContactEmail,
      hubspot_contact_name: row.hubspotContactName,
      arcova_contact_id: row.arcovaContactId,
      hs_lastmodifieddate: row.hsLastModifiedDate,
      raw_payload: row.rawPayload,
      synced_at: new Date().toISOString(),
    }))
  );

  if (insertError) throw insertError;
}

export async function replaceCrmContactCompanyLinks(
  supabase: DatabaseClient,
  input: {
    userId: string;
    hubspotContactId: string;
    rows: Array<{
      hubspotCompanyId: string;
      hubspotCompanyName: string | null;
      hubspotCompanyDomain: string | null;
      arcovaCompanyId: string | null;
      hsLastModifiedDate: string | null;
      rawPayload: Record<string, unknown>;
    }>;
  }
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('crm_contact_company_links')
    .delete()
    .eq('user_id', input.userId)
    .eq('hubspot_contact_id', input.hubspotContactId);

  if (deleteError) throw deleteError;

  if (!input.rows.length) return;

  const { error: insertError } = await supabase.from('crm_contact_company_links').insert(
    input.rows.map((row) => ({
      user_id: input.userId,
      hubspot_contact_id: input.hubspotContactId,
      hubspot_company_id: row.hubspotCompanyId,
      hubspot_company_name: row.hubspotCompanyName,
      hubspot_company_domain: row.hubspotCompanyDomain,
      arcova_company_id: row.arcovaCompanyId,
      hs_lastmodifieddate: row.hsLastModifiedDate,
      raw_payload: row.rawPayload,
      synced_at: new Date().toISOString(),
    }))
  );

  if (insertError) throw insertError;
}

export async function findArcovaCompaniesByDomains(
  supabase: DatabaseClient,
  userId: string,
  domains: string[]
): Promise<ArcovaCompanyRecord[]> {
  if (!domains.length) return [];
  // First find canonical companies matching any of the domains/websites,
  // then filter to those this user actually tracks.
  const { data: candidates, error: candidatesError } = await supabase
    .from('companies')
    .select('id, domain, website, company_name')
    .or(domains.map((domain) => `domain.eq.${domain},website.eq.${domain}`).join(','));
  if (candidatesError) throw candidatesError;
  const candidateIds = (candidates ?? []).map((r) => (r as { id?: unknown }).id).filter((v): v is string => typeof v === 'string');
  if (!candidateIds.length) return [];

  const activeIds = new Set(
    (await listActiveCompanyStateForUser(supabase, userId, 'company_id')).map((row) => row.company_id),
  );
  const ownedIds = new Set(candidateIds.filter((id) => activeIds.has(id)));

  return (candidates ?? []).filter((r) => ownedIds.has((r as { id: string }).id)) as ArcovaCompanyRecord[];
}

export async function findArcovaContactsByEmails(
  supabase: DatabaseClient,
  userId: string,
  emails: string[]
): Promise<ArcovaContactRecord[]> {
  if (!emails.length) return [];
  const { data, error } = await supabase
    .from('contacts')
    .select('id, email, job_title, seniority_level, business_area, company_id, company_name, company_domain, resolved_current_company_name, resolved_current_company_domain')
    .eq('user_id', userId)
    .is('archived_at', null)
    .in('email', emails);

  if (error) throw error;
  return (data ?? []) as ArcovaContactRecord[];
}

export async function findArcovaCompaniesByIds(
  supabase: DatabaseClient,
  userId: string,
  ids: string[]
): Promise<ArcovaCompanyRecord[]> {
  if (!ids.length) return [];
  // Restrict to companies this user tracks.
  const activeIds = new Set(
    (await listActiveCompanyStateForUser(supabase, userId, 'company_id')).map((row) => row.company_id),
  );
  const ownedIds = ids.filter((id) => activeIds.has(id));
  if (!ownedIds.length) return [];

  const { data, error } = await supabase
    .from('companies')
    .select('id, domain, website, company_name')
    .in('id', ownedIds);
  if (error) throw error;
  return (data ?? []) as ArcovaCompanyRecord[];
}

export async function findArcovaContactsByIds(
  supabase: DatabaseClient,
  userId: string,
  ids: string[]
): Promise<ArcovaContactRecord[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('contacts')
    .select('id, email, job_title, seniority_level, business_area, company_id, company_name, company_domain, resolved_current_company_name, resolved_current_company_domain')
    .eq('user_id', userId)
    .is('archived_at', null)
    .in('id', ids);

  if (error) throw error;
  return (data ?? []) as ArcovaContactRecord[];
}

export async function sourceEventExists(
  supabase: DatabaseClient,
  userId: string,
  source: string,
  sourceEventId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('signal_source_events')
    .select('id')
    .eq('user_id', userId)
    .eq('source', source)
    .eq('source_event_id', sourceEventId)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.id);
}
