import {
  buildPersistedAccountReadinessContext,
  generateAccountReason,
  ingestSignalSourceEvent,
  normalizeSignalSourceEvent,
  recomputeAccountReadiness,
  recomputeContactReadiness,
} from '@/lib/signals/readiness-service';
import type { BuyerFunction, SignalKey } from '@/lib/signals/readiness-types';
import type { SupabaseClient } from '@supabase/supabase-js';

type DatabaseClient = SupabaseClient<any, 'public', any>;

type SignalEventScope = 'company' | 'contact';

type SignalEventRow = {
  id: string;
  signal_type: string;
  signal_scope: SignalEventScope;
  company_id: string | null;
  contact_id: string | null;
  source: string | null;
  title: string | null;
  description: string | null;
  evidence_url: string | null;
  detected_at: string | null;
  event_metadata: Record<string, unknown> | null;
};

const SIGNAL_EVENT_TO_READINESS: Partial<Record<string, { signalKeys: SignalKey[]; buyerFunctionsOverride?: BuyerFunction[] }>> = {
  demo_requested: { signalKeys: ['demo_requested'] },
  inbound_enquiry: { signalKeys: ['inbound_enquiry'] },
  open_opportunity_in_crm: { signalKeys: ['open_opportunity_in_crm'] },
  lapsed_customer: { signalKeys: ['lapsed_customer'] },
  visited_your_website: { signalKeys: ['visited_your_website'] },
  attended_your_webinar_or_event: { signalKeys: ['attended_your_webinar_or_event'] },
  downloaded_your_content: { signalKeys: ['downloaded_your_content'] },
  responded_to_a_previous_outreach: { signalKeys: ['responded_to_previous_outreach'] },
  attended_your_webinar_or_event_contact: { signalKeys: ['attended_your_webinar_or_event'] },
  downloaded_your_content_contact: { signalKeys: ['downloaded_your_content'] },
};

function getReadinessMapping(signalType: string) {
  return SIGNAL_EVENT_TO_READINESS[signalType];
}

export async function mirrorSignalEventToReadiness(
  supabase: DatabaseClient,
  userId: string,
  signalRow: SignalEventRow
) {
  const mapping = getReadinessMapping(signalRow.signal_type);
  if (!mapping) {
    return null;
  }

  const entityScope = signalRow.signal_scope;
  const companyId = signalRow.company_id;
  const contactId = signalRow.contact_id;

  if (entityScope === 'company' && !companyId) {
    return null;
  }

  if (entityScope === 'contact' && !contactId) {
    return null;
  }

  const { data: existingMirror, error: existingMirrorError } = await supabase
    .from('signal_source_events')
    .select('id')
    .eq('user_id', userId)
    .eq('entity_scope', entityScope)
    .eq('source_event_id', signalRow.id)
    .limit(1)
    .maybeSingle();

  if (existingMirrorError) {
    throw existingMirrorError;
  }

  if (existingMirror) {
    return {
      skipped: true as const,
      reason: 'already_mirrored' as const,
      sourceEventId: existingMirror.id,
    };
  }

  const ingestResult = await ingestSignalSourceEvent(supabase, {
    userId,
    entityScope,
    companyId,
    contactId,
    source: signalRow.source ?? 'signal_events_route',
    sourceEventType: signalRow.signal_type,
    sourceEventId: signalRow.id,
    sourceUrl: signalRow.evidence_url,
    title: signalRow.title,
    summary: signalRow.description,
    excerpt: signalRow.description,
    eventAt: signalRow.detected_at,
    metadata: {
      signal_event_id: signalRow.id,
      signal_event_type: signalRow.signal_type,
      signal_event_origin: 'signal_events_route',
      ...(signalRow.event_metadata ?? {}),
    },
  });

  const rawEvent = {
    id: ingestResult.sourceEventId,
    userId,
    entityId: entityScope === 'company' ? companyId ?? '' : contactId ?? '',
    entityScope,
    source: signalRow.source ?? 'signal_events_route',
    sourceUrl: signalRow.evidence_url,
    sourceEventType: signalRow.signal_type,
    sourceEventId: signalRow.id,
    title: signalRow.title,
    summary: signalRow.description,
    excerpt: signalRow.description,
    eventAt: signalRow.detected_at,
    observedAt: new Date().toISOString(),
    metadata: {
      signal_event_id: signalRow.id,
      signal_event_type: signalRow.signal_type,
      signal_event_origin: 'signal_events_route',
      ...(signalRow.event_metadata ?? {}),
    },
  } as const;

  const normalized = await normalizeSignalSourceEvent(supabase, {
    userId,
    rawEvent,
    signalKeys: mapping.signalKeys,
    buyerFunctionsOverride: mapping.buyerFunctionsOverride,
    companyId,
    contactId,
  });

  const affectedCompanyIds = normalized.affectedCompanyIds.filter(Boolean);

  const companies = await Promise.all(
    affectedCompanyIds.map(async (affectedCompanyId) => {
      const readiness = await recomputeAccountReadiness(supabase, {
        userId,
        companyId: affectedCompanyId,
      });

      await generateAccountReason(supabase, {
        userId,
        companyId: affectedCompanyId,
      });

      const context = await buildPersistedAccountReadinessContext(supabase, {
        userId,
        companyId: affectedCompanyId,
      });

      return {
        companyId: affectedCompanyId,
        readiness,
        context,
      };
    })
  );

  // For contact-scoped signals, also recompute the contact's own readiness snapshot
  let contactReadiness = null;
  if (entityScope === 'contact' && contactId) {
    contactReadiness = await recomputeContactReadiness(supabase, {
      userId,
      contactId,
    }).catch((e) => {
      console.warn('[mirrorSignalEventToReadiness] contact readiness recompute skipped', e);
      return null;
    });
  }

  return {
    ingestResult,
    normalized,
    companies,
    contactReadiness,
  };
}
