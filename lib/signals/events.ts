import type { SupabaseClient } from '@supabase/supabase-js';
import { getSignalById, type SignalScope } from '@/lib/signals/catalog';

type DatabaseClient = SupabaseClient<any, 'public', any>;

type BaseSignalEventInput = {
  userId: string;
  signalId: string;
  source?: string | null;
  title?: string | null;
  description?: string | null;
  evidenceUrl?: string | null;
  confidence?: number | null;
  detectedAt?: string | null;
  eventMetadata?: Record<string, unknown> | null;
  rawPayload?: Record<string, unknown> | null;
};

type CompanySignalEventInput = BaseSignalEventInput & {
  companyId: string;
};

type ContactSignalEventInput = BaseSignalEventInput & {
  contactId: string;
  companyId?: string | null;
};

function assertSignalScope(signalId: string, expectedScope: SignalScope) {
  const signal = getSignalById(signalId);
  if (!signal) {
    throw new Error(`Unknown signal id: ${signalId}`);
  }

  if (signal.scope !== expectedScope) {
    throw new Error(`Signal ${signalId} must be written as a ${signal.scope} signal`);
  }

  return signal;
}

export async function writeCompanySignalEvent(
  supabase: DatabaseClient,
  input: CompanySignalEventInput
) {
  assertSignalScope(input.signalId, 'company');

  const { data, error } = await supabase
    .from('signals')
    .insert({
      user_id: input.userId,
      signal_type: input.signalId,
      signal_scope: 'company',
      company_id: input.companyId,
      contact_id: null,
      source: input.source ?? null,
      title: input.title ?? null,
      description: input.description ?? null,
      evidence_url: input.evidenceUrl ?? null,
      confidence: input.confidence ?? null,
      detected_at: input.detectedAt ?? new Date().toISOString(),
      event_metadata: input.eventMetadata ?? null,
      raw_payload: input.rawPayload ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function writeContactSignalEvent(
  supabase: DatabaseClient,
  input: ContactSignalEventInput
) {
  assertSignalScope(input.signalId, 'contact');

  const { data, error } = await supabase
    .from('signals')
    .insert({
      user_id: input.userId,
      signal_type: input.signalId,
      signal_scope: 'contact',
      company_id: input.companyId ?? null,
      contact_id: input.contactId,
      source: input.source ?? null,
      title: input.title ?? null,
      description: input.description ?? null,
      evidence_url: input.evidenceUrl ?? null,
      confidence: input.confidence ?? null,
      detected_at: input.detectedAt ?? new Date().toISOString(),
      event_metadata: input.eventMetadata ?? null,
      raw_payload: input.rawPayload ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function listCompanySignalEvents(
  supabase: DatabaseClient,
  userId: string,
  companyId: string
) {
  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .eq('user_id', userId)
    .eq('signal_scope', 'company')
    .eq('company_id', companyId)
    .order('detected_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function listContactSignalEvents(
  supabase: DatabaseClient,
  userId: string,
  contactId: string
) {
  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .eq('user_id', userId)
    .eq('signal_scope', 'contact')
    .eq('contact_id', contactId)
    .order('detected_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function listLeadSignalEvents(
  supabase: DatabaseClient,
  userId: string,
  companyId: string | null,
  contactId: string | null
) {
  const [companyEvents, contactEvents] = await Promise.all([
    companyId ? listCompanySignalEvents(supabase, userId, companyId) : Promise.resolve([]),
    contactId ? listContactSignalEvents(supabase, userId, contactId) : Promise.resolve([]),
  ]);

  return {
    companyEvents,
    contactEvents,
  };
}

export const listCompanyEvents = listCompanySignalEvents;
export const listContactEvents = listContactSignalEvents;

export async function listLeadEvents(
  supabase: DatabaseClient,
  userId: string,
  opts: { companyId: string | null; contactId: string | null }
) {
  return listLeadSignalEvents(supabase, userId, opts.companyId, opts.contactId);
}
