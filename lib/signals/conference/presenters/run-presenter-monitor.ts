/**
 * Conference PRESENTER monitor — reads the shared appearances mirror (per-user).
 *
 * The contact-scoped analog of run-conference-monitor.ts. Resolution already
 * happened once at sync (sync-presenters-delta.ts → conference_appearances_local
 * with mentioned_contact_ids/matches + mentioned_company_ids/matches). This
 * monitor never re-resolves:
 *
 *   1. Load the user's active contacts (scoped by user_id) → map canonical
 *      people.id → the user's contacts (user_contacts.id, the signal entity id).
 *   2. For each non-expired conference, pull appearance rows whose
 *      mentioned_contact_ids overlap the user's people ids.
 *   3. Fail-closed admission: a CONTACT analog of companyMentionAdmission
 *      (matchType 'verified_presenter', acceptedSourceFields ['speaker_name']).
 *   4. Dedupe via signal_source_events on
 *      conference_presenter:{confId}:{contactId}:presenting_at_conference.
 *   5. Emit `presenting_at_conference` (entityScope 'contact'), carry the
 *      conference_phase + session/role/affiliation in metadata, then
 *      recomputeContactReadiness. When the affiliation also resolved to one of
 *      the user's companies, emit a company companion + recompute the account.
 *
 * `presenting_at_conference` is not yet in the SignalKey union (a shared file
 * another agent owns), so the key is cast at the emit sites. Expired conferences
 * (>21d after end) are skipped.
 */
import { createAdminClient } from '@/lib/supabase-admin';
import {
  generateAccountReason,
  ingestSignalSourceEvent,
  normalizeSignalSourceEvent,
  recomputeAccountReadiness,
  recomputeContactReadiness,
} from '@/lib/signals/readiness-service';
import { buildAdmissionMetadata } from '@/lib/signals/signal-admission';
import type { SignalKey } from '@/lib/signals/readiness-types';
import { conferencePhase, type ConferencePhase } from '../conference-phase';
import { presenterContactAdmission } from './presenter-resolution';
import { PRESENTER_SOURCE } from './sync-presenters-delta';

export { presenterContactAdmission } from './presenter-resolution';

const SIGNAL_KEY: SignalKey = 'presenting_at_conference';

type AdminClient = ReturnType<typeof createAdminClient>;

type PresenterMonitorInput = {
  userId: string;
  /** Restrict to a subset of the user's contacts (contacts.id / user_contacts.id). */
  contactIds?: string[];
  /** Restrict to specific conferences (else all active registry rows). */
  conferenceIds?: string[];
  limit?: number;
};

export type PresenterMonitorResult = {
  processed_conferences: number;
  failed_conferences: number;
  appearances_scanned: number;
  candidate_events_matched_before_dedupe: number;
  events_skipped_as_duplicates: number;
  emitted_signal_types: string[];
  recomputed_contacts: string[];
  recomputed_companies: string[];
  failures: Array<{ conference_id: string; error: string }>;
};

type ConferenceRow = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  event_url: string | null;
};

type MirrorRow = {
  speaker_name_raw: string;
  speaker_title: string | null;
  appearance_type: string;
  session_title: string | null;
  affiliation_raw: string | null;
  abstract_url: string | null;
  source_url: string | null;
  mentioned_contact_ids: string[] | null;
  mentioned_contact_matches: unknown;
  mentioned_company_ids: string[] | null;
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
  }
  return 'Internal server error';
}

async function fetchExistingSourceEventIds(
  admin: AdminClient,
  userId: string,
  sourceEventIds: string[],
): Promise<Set<string>> {
  const uniqueIds = [...new Set(sourceEventIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Set<string>();
  const found = new Set<string>();
  for (let i = 0; i < uniqueIds.length; i += 200) {
    const slice = uniqueIds.slice(i, i + 200);
    const { data, error } = await admin
      .from('signal_source_events')
      .select('source_event_id')
      .eq('user_id', userId)
      .eq('source', PRESENTER_SOURCE)
      .in('source_event_id', slice);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = (row as { source_event_id?: unknown }).source_event_id;
      if (typeof id === 'string' && id) found.add(id);
    }
  }
  return found;
}

async function emitContactSignal(
  admin: AdminClient,
  input: {
    userId: string;
    contactId: string;
    companyId: string | null;
    sourceEventId: string;
    sourceUrl: string;
    title: string;
    summary: string;
    eventAt: string | null;
    metadata: Record<string, unknown>;
    existingSourceEventIds: Set<string>;
  },
): Promise<'emitted' | 'duplicate'> {
  if (input.existingSourceEventIds.has(input.sourceEventId)) return 'duplicate';

  const ingest = await ingestSignalSourceEvent(admin, {
    userId: input.userId,
    entityScope: 'contact',
    contactId: input.contactId,
    companyId: input.companyId ?? undefined,
    source: PRESENTER_SOURCE,
    sourceEventType: 'conference_presenter_listed',
    sourceEventId: input.sourceEventId,
    sourceUrl: input.sourceUrl,
    title: input.title,
    summary: input.summary,
    excerpt: input.summary.slice(0, 300),
    eventAt: input.eventAt ?? new Date().toISOString(),
    metadata: input.metadata,
  });

  await normalizeSignalSourceEvent(admin, {
    userId: input.userId,
    rawEvent: {
      id: ingest.sourceEventId,
      userId: input.userId,
      entityId: input.contactId,
      entityScope: 'contact',
      source: PRESENTER_SOURCE,
      sourceUrl: input.sourceUrl,
      sourceEventType: 'conference_presenter_listed',
      sourceEventId: input.sourceEventId,
      title: input.title,
      summary: input.summary,
      excerpt: input.summary.slice(0, 300),
      eventAt: input.eventAt ?? null,
      observedAt: new Date().toISOString(),
      metadata: input.metadata,
    },
    signalKeys: [SIGNAL_KEY],
    contactId: input.contactId,
    companyId: input.companyId ?? undefined,
  });

  input.existingSourceEventIds.add(input.sourceEventId);
  return 'emitted';
}

async function emitCompanyCompanionSignal(
  admin: AdminClient,
  input: {
    userId: string;
    companyId: string;
    sourceEventId: string;
    sourceUrl: string;
    title: string;
    summary: string;
    eventAt: string | null;
    metadata: Record<string, unknown>;
    existingSourceEventIds: Set<string>;
  },
): Promise<'emitted' | 'duplicate'> {
  if (input.existingSourceEventIds.has(input.sourceEventId)) return 'duplicate';

  const ingest = await ingestSignalSourceEvent(admin, {
    userId: input.userId,
    entityScope: 'company',
    companyId: input.companyId,
    source: PRESENTER_SOURCE,
    sourceEventType: 'conference_presenter_company',
    sourceEventId: input.sourceEventId,
    sourceUrl: input.sourceUrl,
    title: input.title,
    summary: input.summary,
    excerpt: input.summary.slice(0, 300),
    eventAt: input.eventAt ?? new Date().toISOString(),
    metadata: input.metadata,
  });

  await normalizeSignalSourceEvent(admin, {
    userId: input.userId,
    rawEvent: {
      id: ingest.sourceEventId,
      userId: input.userId,
      entityId: input.companyId,
      entityScope: 'company',
      source: PRESENTER_SOURCE,
      sourceUrl: input.sourceUrl,
      sourceEventType: 'conference_presenter_company',
      sourceEventId: input.sourceEventId,
      title: input.title,
      summary: input.summary,
      excerpt: input.summary.slice(0, 300),
      eventAt: input.eventAt ?? null,
      observedAt: new Date().toISOString(),
      metadata: input.metadata,
    },
    signalKeys: [SIGNAL_KEY],
    companyId: input.companyId,
  });

  input.existingSourceEventIds.add(input.sourceEventId);
  return 'emitted';
}

/** Phase → person-level outreach summary fragment. */
function phraseForPhase(phase: ConferencePhase, name: string, conf: string, session: string | null): string {
  const sessionClause = session ? ` (${session})` : '';
  switch (phase) {
    case 'upcoming':
      return `${name} is presenting at ${conf}${sessionClause}.`;
    case 'live':
      return `${name} is presenting at ${conf} today${sessionClause}.`;
    case 'recent':
      return `${name} recently presented at ${conf}${sessionClause}.`;
    default:
      return `${name} presented at ${conf}${sessionClause}.`;
  }
}

export async function runPresenterMonitor(
  input: PresenterMonitorInput,
): Promise<PresenterMonitorResult> {
  const admin = createAdminClient();

  // ── Load the user's active contacts (scoped by user_id) ─────────────────────
  // Map canonical people.id → user_contacts rows. The mirror keys people.id; the
  // signal entity id is the user's contact id (user_contacts.id = contacts.id).
  let ucQuery = admin
    .from('user_contacts')
    .select('id, person_id, company_id')
    .eq('user_id', input.userId)
    .is('archived_at', null)
    .not('person_id', 'is', null);
  if (Array.isArray(input.contactIds) && input.contactIds.length > 0) {
    ucQuery = ucQuery.in('id', input.contactIds.filter(Boolean));
  }
  const { data: ucRows, error: ucError } = await ucQuery;
  if (ucError) throw new Error(`user_contacts query: ${ucError.message}`);

  type UcRow = { id: string; person_id: string | null; company_id: string | null };
  const personToContacts = new Map<string, Array<{ contactId: string; companyId: string | null }>>();
  for (const r of (ucRows ?? []) as UcRow[]) {
    if (!r.person_id) continue;
    const arr = personToContacts.get(r.person_id) ?? [];
    arr.push({ contactId: r.id, companyId: r.company_id });
    personToContacts.set(r.person_id, arr);
  }

  const result: PresenterMonitorResult = {
    processed_conferences: 0,
    failed_conferences: 0,
    appearances_scanned: 0,
    candidate_events_matched_before_dedupe: 0,
    events_skipped_as_duplicates: 0,
    emitted_signal_types: [],
    recomputed_contacts: [],
    recomputed_companies: [],
    failures: [],
  };
  if (personToContacts.size === 0) return result;

  let ownedPeopleIds = [...personToContacts.keys()];
  ownedPeopleIds = ownedPeopleIds.slice(0, Math.min(Math.max(input.limit ?? 2000, 1), 10000));
  const ownedPeopleSet = new Set(ownedPeopleIds);

  // ── Load conferences ────────────────────────────────────────────────────────
  let confQuery = admin.from('conferences').select('id,name,start_date,end_date,event_url');
  if (input.conferenceIds?.length) confQuery = confQuery.in('id', input.conferenceIds);
  const { data: confs, error: confError } = await confQuery;
  if (confError) throw new Error(`conferences query: ${confError.message}`);

  const emittedSignalTypes = new Set<string>();
  const recomputedContactIds = new Set<string>();
  const recomputedCompanyIds = new Set<string>();
  const now = new Date();

  for (const conf of (confs ?? []) as ConferenceRow[]) {
    try {
      const phase = conferencePhase(conf.start_date, conf.end_date, now);
      if (phase === 'expired') continue;

      const { data: rows, error: rowsError } = await admin
        .from('conference_appearances_local')
        .select(
          'speaker_name_raw,speaker_title,appearance_type,session_title,affiliation_raw,abstract_url,source_url,mentioned_contact_ids,mentioned_contact_matches,mentioned_company_ids',
        )
        .eq('conference_id', conf.id)
        .overlaps('mentioned_contact_ids', ownedPeopleIds);
      if (rowsError) throw new Error(rowsError.message);

      const mirrorRows = (rows ?? []) as MirrorRow[];
      result.appearances_scanned += mirrorRows.length;

      // Expand to (row, personId, contactId) hits for owned people.
      const hits = mirrorRows.flatMap((row) =>
        (row.mentioned_contact_ids ?? [])
          .filter((pid) => ownedPeopleSet.has(pid))
          .flatMap((personId) =>
            (personToContacts.get(personId) ?? []).map(({ contactId, companyId }) => ({
              row,
              personId,
              contactId,
              contactCompanyId: companyId,
            })),
          ),
      );

      const candidateSourceEventIds = hits.map(
        (h) => `${PRESENTER_SOURCE}:${conf.id}:${h.contactId}:presenting_at_conference`,
      );
      const existingSourceEventIds = await fetchExistingSourceEventIds(
        admin,
        input.userId,
        candidateSourceEventIds,
      );

      const emittedContactIds = new Set<string>();
      const emittedCompanyIds = new Set<string>();
      const eventAt = conf.start_date ?? null;

      for (const hit of hits) {
        result.candidate_events_matched_before_dedupe += 1;

        const admission = presenterContactAdmission({
          personId: hit.personId,
          matches: hit.row.mentioned_contact_matches,
          acceptedSourceFields: ['speaker_name', 'affiliation'],
        });
        if (!admission.admitted) continue;

        const sourceEventId = `${PRESENTER_SOURCE}:${conf.id}:${hit.contactId}:presenting_at_conference`;
        const speaker = hit.row.speaker_name_raw;
        const summary = phraseForPhase(phase, speaker, conf.name, hit.row.session_title);
        const title = 'presenting_at_conference detected from conference program';

        const emitted = await emitContactSignal(admin, {
          userId: input.userId,
          contactId: hit.contactId,
          companyId: hit.contactCompanyId,
          sourceEventId,
          sourceUrl: conf.event_url ?? hit.row.abstract_url ?? hit.row.source_url ?? '',
          title,
          summary,
          eventAt,
          metadata: {
            conference_id: conf.id,
            conference_name: conf.name,
            session_title: hit.row.session_title,
            appearance_type: hit.row.appearance_type,
            affiliation_raw: hit.row.affiliation_raw,
            speaker_title: hit.row.speaker_title,
            abstract_url: hit.row.abstract_url,
            event_start_date: conf.start_date ?? null,
            event_end_date: conf.end_date ?? null,
            conference_phase: phase, // upcoming | live | recent — drives outreach angle
            speaker_name_raw: speaker,
            ...buildAdmissionMetadata(admission),
          },
          existingSourceEventIds,
        });

        if (emitted === 'emitted') {
          emittedContactIds.add(hit.contactId);
          emittedSignalTypes.add(SIGNAL_KEY);
        } else {
          result.events_skipped_as_duplicates += 1;
        }
      }

      // ── Company companion ──────────────────────────────────────────────────
      // When the affiliation resolved to one of the user's companies that also
      // owns a tracked contact above, surface the program appearance on the
      // account too. We reuse the contact's own company_id (the §3 guard already
      // tied the person to that company at sync).
      for (const hit of hits) {
        const companyId = hit.contactCompanyId;
        if (!companyId) continue;
        if (!(hit.row.mentioned_company_ids ?? []).includes(companyId)) continue;
        if (!emittedContactIds.has(hit.contactId)) continue; // only companion an emitted contact

        const companySourceEventId = `${PRESENTER_SOURCE}:${conf.id}:${companyId}:presenting_at_conference_company`;
        const emitted = await emitCompanyCompanionSignal(admin, {
          userId: input.userId,
          companyId,
          sourceEventId: companySourceEventId,
          sourceUrl: conf.event_url ?? hit.row.source_url ?? '',
          title: 'presenting_at_conference detected from conference program',
          summary: `A tracked person from this account is on the program at ${conf.name}.`,
          eventAt,
          metadata: {
            conference_id: conf.id,
            conference_name: conf.name,
            conference_phase: phase,
            companion_of_contact: hit.contactId,
            session_title: hit.row.session_title,
            appearance_type: hit.row.appearance_type,
          },
          existingSourceEventIds,
        });
        if (emitted === 'emitted') {
          emittedCompanyIds.add(companyId);
          emittedSignalTypes.add(SIGNAL_KEY);
        }
      }

      for (const contactId of emittedContactIds) {
        await recomputeContactReadiness(admin, { userId: input.userId, contactId });
        recomputedContactIds.add(contactId);
      }
      for (const companyId of emittedCompanyIds) {
        await recomputeAccountReadiness(admin, { userId: input.userId, companyId });
        await generateAccountReason(admin, { userId: input.userId, companyId });
        recomputedCompanyIds.add(companyId);
      }

      result.processed_conferences += 1;
    } catch (error) {
      result.failed_conferences += 1;
      result.failures.push({ conference_id: conf.id, error: messageFromUnknown(error) });
    }
  }

  result.emitted_signal_types = [...emittedSignalTypes];
  result.recomputed_contacts = [...recomputedContactIds];
  result.recomputed_companies = [...recomputedCompanyIds];
  return result;
}
