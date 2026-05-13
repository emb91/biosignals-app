import type { SupabaseClient } from '@supabase/supabase-js';

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

export async function findArcovaCompaniesByDomains(
  supabase: DatabaseClient,
  userId: string,
  domains: string[]
): Promise<Array<{ id: string; domain: string | null; company_website: string | null; company_name: string | null }>> {
  if (!domains.length) return [];
  const { data, error } = await supabase
    .from('companies')
    .select('id, domain, company_website, company_name')
    .eq('user_id', userId)
    .or(domains.map((domain) => `domain.eq.${domain},company_website.eq.${domain}`).join(','));

  if (error) throw error;
  return (data ?? []) as Array<{ id: string; domain: string | null; company_website: string | null; company_name: string | null }>;
}

export async function findArcovaContactsByEmails(
  supabase: DatabaseClient,
  userId: string,
  emails: string[]
): Promise<Array<{ id: string; email: string | null }>> {
  if (!emails.length) return [];
  const { data, error } = await supabase
    .from('contacts')
    .select('id, email')
    .eq('user_id', userId)
    .in('email', emails);

  if (error) throw error;
  return (data ?? []) as Array<{ id: string; email: string | null }>;
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
