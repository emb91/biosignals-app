/**
 * Conference / tradeshow monitor — reads the shared mirror (the grants pattern).
 *
 * Resolution happens once at sync (sync-conference-delta.ts → conference_exhibitors_local
 * with mentioned_company_ids/matches). This monitor is per-user and never
 * re-resolves: it loads the user's active companies, finds mirror rows whose
 * mentioned_company_ids overlap them, applies the fail-closed admission guard
 * (companyMentionAdmission, matchType 'verified_exhibitor'), bulk-dedupes via
 * signal_source_events, and emits `exhibiting_at_conference` with the
 * conference-date phase (upcoming/live/recent) for the outreach angle. Expired
 * conferences (>21d after end) are skipped.
 */
import { createAdminClient } from '@/lib/supabase-admin';
import { listActiveCompanyStateForUser } from '@/lib/org-company-state';
import {
  generateAccountReason,
  ingestSignalSourceEvent,
  normalizeSignalSourceEvent,
  recomputeAccountReadiness,
} from '@/lib/signals/readiness-service';
import { companyMentionAdmission } from '@/lib/signals/resolver-provenance-admission';
import { buildAdmissionMetadata } from '@/lib/signals/signal-admission';
import { conferencePhase } from './conference-phase';
import { CONFERENCE_SOURCE } from './sync-conference-delta';

const SIGNAL_KEY = 'exhibiting_at_conference';

type AdminClient = ReturnType<typeof createAdminClient>;

type ConferenceMonitorInput = {
  userId: string;
  /** Restrict to a subset of the user's companies. */
  companyIds?: string[];
  /** Restrict to specific conferences (else all active registry rows). */
  conferenceIds?: string[];
  limit?: number;
};

export type ConferenceMonitorResult = {
  processed_conferences: number;
  failed_conferences: number;
  exhibitors_scanned: number;
  candidate_events_matched_before_dedupe: number;
  events_skipped_as_duplicates: number;
  emitted_signal_types: string[];
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
  company_name_raw: string;
  booth: string | null;
  website: string | null;
  category: string | null;
  source_url: string | null;
  mentioned_company_ids: string[] | null;
  mentioned_company_matches: unknown;
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
      .eq('source', CONFERENCE_SOURCE)
      .in('source_event_id', slice);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = (row as { source_event_id?: unknown }).source_event_id;
      if (typeof id === 'string' && id) found.add(id);
    }
  }
  return found;
}

async function emitCompanySignal(
  admin: AdminClient,
  input: {
    userId: string;
    companyId: string;
    sourceEventId: string;
    sourceUrl: string;
    summary: string;
    eventAt: string | null;
    metadata: Record<string, unknown>;
    existingSourceEventIds: Set<string>;
  },
): Promise<'emitted' | 'duplicate'> {
  if (input.existingSourceEventIds.has(input.sourceEventId)) return 'duplicate';

  const title = 'exhibiting_at_conference detected from conference exhibitor list';
  const ingest = await ingestSignalSourceEvent(admin, {
    userId: input.userId,
    entityScope: 'company',
    companyId: input.companyId,
    source: CONFERENCE_SOURCE,
    sourceEventType: 'conference_exhibitor_listed',
    sourceEventId: input.sourceEventId,
    sourceUrl: input.sourceUrl,
    title,
    summary: input.summary,
    excerpt: input.summary,
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
      source: CONFERENCE_SOURCE,
      sourceUrl: input.sourceUrl,
      sourceEventType: 'conference_exhibitor_listed',
      sourceEventId: input.sourceEventId,
      title,
      summary: input.summary,
      excerpt: input.summary,
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

export async function runConferenceMonitor(
  input: ConferenceMonitorInput,
): Promise<ConferenceMonitorResult> {
  const admin = createAdminClient();

  let ownedIds = (await listActiveCompanyStateForUser(admin, input.userId)).map((r) => r.company_id);
  const requested = Array.isArray(input.companyIds)
    ? input.companyIds.filter((v): v is string => typeof v === 'string' && Boolean(v))
    : [];
  if (requested.length > 0) {
    const set = new Set(requested);
    ownedIds = ownedIds.filter((id) => set.has(id));
  } else {
    ownedIds = ownedIds.slice(0, Math.min(Math.max(input.limit ?? 1000, 1), 5000));
  }
  const ownedSet = new Set(ownedIds);

  const result: ConferenceMonitorResult = {
    processed_conferences: 0,
    failed_conferences: 0,
    exhibitors_scanned: 0,
    candidate_events_matched_before_dedupe: 0,
    events_skipped_as_duplicates: 0,
    emitted_signal_types: [],
    recomputed_companies: [],
    failures: [],
  };
  if (ownedSet.size === 0) return result;

  // Load conferences from the registry (optionally filtered).
  let confQuery = admin.from('conferences').select('id,name,start_date,end_date,event_url');
  if (input.conferenceIds?.length) confQuery = confQuery.in('id', input.conferenceIds);
  const { data: confs, error: confError } = await confQuery;
  if (confError) throw new Error(`conferences query: ${confError.message}`);

  const emittedSignalTypes = new Set<string>();
  const recomputedCompanyIds = new Set<string>();
  const now = new Date();

  for (const conf of (confs ?? []) as ConferenceRow[]) {
    try {
      const phase = conferencePhase(conf.start_date, conf.end_date, now);
      if (phase === 'expired') continue; // hard expiry: dead >21d after the event

      // Mirror rows for this conference that resolved to one of the user's companies.
      const { data: rows, error: rowsError } = await admin
        .from('conference_exhibitors_local')
        .select('company_name_raw,booth,website,category,source_url,mentioned_company_ids,mentioned_company_matches')
        .eq('conference_id', conf.id)
        .overlaps('mentioned_company_ids', ownedIds);
      if (rowsError) throw new Error(rowsError.message);

      const mirrorRows = (rows ?? []) as MirrorRow[];
      result.exhibitors_scanned += mirrorRows.length;

      // Expand to (row, companyId) hits for owned companies.
      const hits = mirrorRows.flatMap((row) =>
        (row.mentioned_company_ids ?? [])
          .filter((id) => ownedSet.has(id))
          .map((companyId) => ({ row, companyId })),
      );

      const candidateSourceEventIds = hits.map(
        (h) => `${CONFERENCE_SOURCE}:${conf.id}:${h.companyId}:exhibiting_at_conference`,
      );
      const existingSourceEventIds = await fetchExistingSourceEventIds(
        admin,
        input.userId,
        candidateSourceEventIds,
      );

      const emittedCompanyIds = new Set<string>();
      const eventAt = conf.start_date ?? null;

      for (const hit of hits) {
        result.candidate_events_matched_before_dedupe += 1;

        const admission = companyMentionAdmission({
          companyId: hit.companyId,
          matches: hit.row.mentioned_company_matches,
          matchType: 'verified_exhibitor',
          acceptedSourceFields: ['company_name'],
          admittedReason: 'Exhibitor name is verified as the tracked company.',
          rejectedReason: 'Exhibitor name was not verified as the tracked company.',
        });
        if (!admission.admitted) continue;

        const sourceEventId = `${CONFERENCE_SOURCE}:${conf.id}:${hit.companyId}:exhibiting_at_conference`;
        const boothText = hit.row.booth ? ` (booth ${hit.row.booth})` : '';
        const summary = `${hit.row.company_name_raw} is exhibiting at ${conf.name}${boothText}.`;

        const emitted = await emitCompanySignal(admin, {
          userId: input.userId,
          companyId: hit.companyId,
          sourceEventId,
          sourceUrl: conf.event_url ?? hit.row.source_url ?? '',
          summary,
          eventAt,
          metadata: {
            conference_id: conf.id,
            conference_name: conf.name,
            booth: hit.row.booth ?? null,
            website: hit.row.website ?? null,
            category: hit.row.category ?? null,
            event_start_date: conf.start_date ?? null,
            event_end_date: conf.end_date ?? null,
            conference_phase: phase, // upcoming | live | recent — drives outreach angle
            exhibitor_name_raw: hit.row.company_name_raw,
            ...buildAdmissionMetadata(admission),
          },
          existingSourceEventIds,
        });

        if (emitted === 'emitted') {
          emittedCompanyIds.add(hit.companyId);
          emittedSignalTypes.add(SIGNAL_KEY);
        } else {
          result.events_skipped_as_duplicates += 1;
        }
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
  result.recomputed_companies = [...recomputedCompanyIds];
  return result;
}
