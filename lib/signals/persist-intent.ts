/**
 * Persist model-based intent scores to companies.company_intent_score and contacts.intent_score.
 * Uses persona → ICP linkage for catalog-weighted selections; falls back gracefully.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadIcpSignalSelectionsDetailed } from '@/lib/signals/selections';
import {
  computeCompanyIntent01,
  computePersonIntent01,
} from '@/lib/signals/intent-scoring';
import {
  listCompanySignalEvents,
  listContactSignalEvents,
} from '@/lib/signals/events';

type DatabaseClient = SupabaseClient<any, 'public', any>;

type SlimEvent = { signal_type: string; detected_at: string | null };

function toSlim(events: Record<string, unknown>[]): SlimEvent[] {
  return events.map((e) => ({
    signal_type: String(e.signal_type ?? ''),
    detected_at:
      typeof e.detected_at === 'string'
        ? e.detected_at
        : typeof e.created_at === 'string'
          ? e.created_at
          : null,
  }));
}

async function resolvePersonaIdsForLead(
  supabase: DatabaseClient,
  userId: string,
  opts: {
    personaIdExplicit: string | null;
    companyId: string | null;
  }
): Promise<{ personaId: string | null; icpId: string | null }> {
  if (opts.personaIdExplicit) {
    const { data } = await supabase
      .from('personas')
      .select('id, icp_id')
      .eq('user_id', userId)
      .eq('id', opts.personaIdExplicit)
      .maybeSingle();

    return {
      personaId: data?.id ?? null,
      icpId: typeof data?.icp_id === 'string' ? data.icp_id : null,
    };
  }

  if (opts.companyId) {
    const { data } = await supabase
      .from('contacts')
      .select('scored_against_persona_id')
      .eq('user_id', userId)
      .eq('company_id', opts.companyId)
      .not('scored_against_persona_id', 'is', null)
      .limit(1)
      .maybeSingle();

    const pid =
      typeof data?.scored_against_persona_id === 'string'
        ? data.scored_against_persona_id
        : null;
    if (pid) {
      const { data: p } = await supabase
        .from('personas')
        .select('id, icp_id')
        .eq('user_id', userId)
        .eq('id', pid)
        .maybeSingle();
      return {
        personaId: p?.id ?? null,
        icpId: typeof p?.icp_id === 'string' ? p.icp_id : null,
      };
    }
  }

  const { data: anyPersona } = await supabase
    .from('personas')
    .select('id, icp_id')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    personaId: typeof anyPersona?.id === 'string' ? anyPersona.id : null,
    icpId: typeof anyPersona?.icp_id === 'string' ? anyPersona.icp_id : null,
  };
}

async function weightedIcpSelections(
  supabase: DatabaseClient,
  userId: string,
  icpId: string | null
): Promise<Array<{ signalId: string; weight: number }>> {
  if (!icpId) return [];

  const m = await loadIcpSignalSelectionsDetailed(supabase, userId, [icpId]);
  const rows = m.get(icpId);
  return (rows ?? []).map((r) => ({ signalId: r.signalId, weight: r.weight }));
}


/** Recomputes companies.company_intent_score from sampled persona's ICP + company events only. */
export async function persistCompanyIntentForCompanyRow(
  supabase: DatabaseClient,
  userId: string,
  companyId: string | null | undefined,
  personaHintId?: string | null
): Promise<number | null> {
  const cid = typeof companyId === 'string' && companyId.trim() ? companyId.trim() : null;
  if (!cid) return null;

  const { icpId } = await resolvePersonaIdsForLead(supabase, userId, {
    personaIdExplicit: personaHintId ?? null,
    companyId: cid,
  });
  const icpSelections = await weightedIcpSelections(supabase, userId, icpId);
  const companyEventsRaw = await listCompanySignalEvents(supabase, userId, cid);
  const slim = toSlim(companyEventsRaw as Record<string, unknown>[]);

  const score = computeCompanyIntent01(icpSelections, slim);

  const scoreValue = typeof score === 'number' ? score : 1;
  // Per-user intent score lives on user_companies.
  const { error } = await supabase
    .from('user_companies')
    .upsert(
      { user_id: userId, company_id: cid, intent_score: scoreValue, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,company_id' },
    );
  if (error) {
    console.error('[persistCompanyIntent]', error);
    throw error;
  }
  return score;
}

/** Updates contacts.intent_score (buyer-signal persona layer only — not blended with company intent). */
export async function persistContactIntentScore(
  supabase: DatabaseClient,
  userId: string,
  opts: {
    contactId: string;
    personaId?: string | null;
  }
): Promise<{ companyIntent01: number | null; contactIntent01: number | null }> {
  const { data: row, error: rowErr } = await supabase
    .from('contacts')
    .select('company_id, scored_against_persona_id')
    .eq('user_id', userId)
    .eq('id', opts.contactId)
    .maybeSingle();

  if (rowErr || !row) throw rowErr || new Error('Contact not found');

  const companyId = typeof row.company_id === 'string' ? row.company_id : null;
  const personaId =
    (typeof opts.personaId === 'string' ? opts.personaId : row.scored_against_persona_id) || null;

  const personaResolve = await resolvePersonaIdsForLead(supabase, userId, {
    personaIdExplicit: personaId,
    companyId,
  });

  const icpSelections = await weightedIcpSelections(supabase, userId, personaResolve.icpId);

  let companyIntent01: number | null = null;
  if (companyId) {
    const companyEv = await listCompanySignalEvents(supabase, userId, companyId);
    companyIntent01 = computeCompanyIntent01(
      icpSelections,
      toSlim(companyEv as Record<string, unknown>[])
    );
  }

  const contactEv = await listContactSignalEvents(supabase, userId, opts.contactId);
  const contactIntent01 = computePersonIntent01(
    toSlim(contactEv as Record<string, unknown>[])
  );

  const intentStored: number | null =
    typeof contactIntent01 === 'number' ? contactIntent01 : null;

  const { error: upErr } = await supabase
    .from('contacts')
    .update({
      intent_score: intentStored,
      updated_at: new Date().toISOString(),
    })
    .eq('id', opts.contactId)
    .eq('user_id', userId);

  if (upErr) {
    console.error('[persistContactIntentScore]', upErr);
    throw upErr;
  }

  if (companyId) {
    await persistCompanyIntentForCompanyRow(
      supabase,
      userId,
      companyId,
      personaResolve.personaId ?? personaId ?? null
    ).catch((e) => console.warn('[persistContactIntentScore] company intent refresh skipped', e));
  }

  return { companyIntent01, contactIntent01: contactIntent01 ?? null };
}
