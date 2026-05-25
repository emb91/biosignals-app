/**
 * Conferences signal monitor — V1.
 *
 * For each of a user's active companies:
 *   1. If conferences_checked_at is fresh (<14 days), use cached appearances
 *      from company_conference_appearances; skip the LLM call.
 *   2. Otherwise, run findConferenceAppearances (Sonnet 4.6 + web_search) and
 *      upsert results.
 *   3. For each appearance, emit:
 *        - conference_presentation (company-scope, always)
 *        - conference_speaker (contact-scope, when speaker_name fuzzy-matches
 *          an existing contact in the user's book at this company)
 *
 * Designed to be cheap to call repeatedly: the 14-day freshness gate keeps
 * the steady-state LLM spend tiny.
 */
import { createAdminClient } from '@/lib/supabase-admin';
import { ensureCompanyAliases } from '@/lib/signals/company-aliases';
import { normalizeCompanyForMatching } from '@/lib/signals/company-name-variants';
import {
  findConferenceAppearances,
  type ConferenceAppearance,
} from '@/lib/signals/find-conference-appearances';
import {
  generateAccountReason,
  ingestSignalSourceEvent,
  normalizeSignalSourceEvent,
  recomputeAccountReadiness,
} from '@/lib/signals/readiness-service';
import type { SignalKey } from '@/lib/signals/readiness-types';

const SOURCE = 'web_search_conferences';
const CONFERENCES_REFRESH_DAYS = 14;

type AdminClient = ReturnType<typeof createAdminClient>;

type CompanyRow = {
  id: string;
  user_id: string;
  company_name: string | null;
  domain: string | null;
  aliases: string[] | null;
  conferences_checked_at: string | null;
};

type ConferenceAppearanceRow = {
  id: string;
  user_id: string;
  company_id: string;
  conference_name: string | null;
  conference_name_normalized: string | null;
  conference_start_date: string | null;
  conference_end_date: string | null;
  location: string | null;
  appearance_type: string | null;
  session_title: string | null;
  speaker_name: string | null;
  speaker_title: string | null;
  matched_contact_id: string | null;
  abstract_url: string | null;
  source_url: string | null;
  confidence: string | null;
  rationale: string | null;
};

type ConferencesMonitorInput = {
  userId: string;
  companyIds?: string[];
  limit?: number;
  onlySignalKey?: SignalKey;
  /** Force a re-research even when cache is fresh. Used by the admin button. */
  forceRefresh?: boolean;
};

export type ConferencesMonitorResult = {
  processed: number;
  failed: number;
  records_scanned: number;
  candidate_events_matched_before_dedupe: number;
  events_skipped_as_duplicates: number;
  llm_calls: number;
  emitted_signal_types: string[];
  recomputed_companies: string[];
  failures: Array<{ company_id: string; error: string }>;
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function toIsoTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T12:00:00Z`;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

function normalizeSpeakerName(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .toLowerCase()
    .replace(/^(dr|mr|mrs|ms|prof|professor|sir|dame)\.?\s+/i, '')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function appearanceDedupeKey(a: ConferenceAppearance): string {
  // Stable key per (conference, start_date, session, speaker). Matches the
  // unique constraint on company_conference_appearances so upserts dedupe
  // correctly across re-runs.
  return [
    normalizeCompanyForMatching(a.conference_name).slice(0, 80),
    a.conference_start_date ?? '',
    (a.session_title ?? '').slice(0, 120),
    (a.speaker_name ?? '').slice(0, 120),
  ].join('|');
}

async function findMatchingContactId(
  admin: AdminClient,
  userId: string,
  companyId: string,
  speakerName: string,
): Promise<string | null> {
  // Fuzzy-match the speaker name to an existing contact at this company.
  // Filtered by company_id, so false-positives are bounded — a "Jane Doe"
  // hit only matters if there's actually a Jane Doe at this company.
  const norm = normalizeSpeakerName(speakerName);
  if (!norm || norm.length < 4) return null;

  const { data, error } = await admin
    .from('contacts')
    .select('id, full_name, first_name, last_name')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .is('archived_at', null)
    .limit(50);
  if (error) {
    console.warn('[conferences] contact match query failed:', error.message);
    return null;
  }
  const rows = (data ?? []) as Array<{
    id: string;
    full_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  }>;
  const parts = norm.split(' ').filter(Boolean);
  if (parts.length === 0) return null;

  for (const row of rows) {
    const candidate = normalizeSpeakerName(
      row.full_name ?? [row.first_name, row.last_name].filter(Boolean).join(' '),
    );
    if (!candidate) continue;
    // Require both first and last name tokens to appear in the candidate
    // (handles "Dr. Jane M. Doe" → "jane m doe" matching "Jane Doe" contact).
    const candidateParts = new Set(candidate.split(' ').filter(Boolean));
    const allMatched = parts.every((p) => candidateParts.has(p));
    if (allMatched) return row.id;
  }
  return null;
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
      .eq('source', SOURCE)
      .in('source_event_id', slice);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = (row as { source_event_id?: unknown }).source_event_id;
      if (typeof id === 'string' && id) found.add(id);
    }
  }
  return found;
}

async function emitSignal(
  admin: AdminClient,
  input: {
    userId: string;
    entityScope: 'company' | 'contact';
    companyId: string;
    contactId?: string | null;
    signalKey: SignalKey;
    sourceEventType: string;
    sourceEventId: string;
    sourceUrl: string;
    summary: string;
    eventAt: string | null;
    metadata: Record<string, unknown>;
    existingSourceEventIds: Set<string>;
  },
): Promise<'emitted' | 'duplicate'> {
  if (input.existingSourceEventIds.has(input.sourceEventId)) return 'duplicate';
  const title = `${input.signalKey} detected from web search`;

  const ingest = await ingestSignalSourceEvent(admin, {
    userId: input.userId,
    entityScope: input.entityScope,
    companyId: input.entityScope === 'company' ? input.companyId : undefined,
    contactId: input.entityScope === 'contact' ? input.contactId ?? undefined : undefined,
    source: SOURCE,
    sourceEventType: input.sourceEventType,
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
      entityId: input.entityScope === 'company' ? input.companyId : (input.contactId ?? input.companyId),
      entityScope: input.entityScope,
      source: SOURCE,
      sourceUrl: input.sourceUrl,
      sourceEventType: input.sourceEventType,
      sourceEventId: input.sourceEventId,
      title,
      summary: input.summary,
      excerpt: input.summary,
      eventAt: input.eventAt ?? null,
      observedAt: new Date().toISOString(),
      metadata: input.metadata,
    },
    signalKeys: [input.signalKey],
    companyId: input.companyId,
    contactId: input.entityScope === 'contact' ? input.contactId ?? undefined : undefined,
  });

  input.existingSourceEventIds.add(input.sourceEventId);
  return 'emitted';
}

async function upsertAppearance(
  admin: AdminClient,
  row: {
    userId: string;
    companyId: string;
    appearance: ConferenceAppearance;
    matchedContactId: string | null;
  },
): Promise<ConferenceAppearanceRow | null> {
  const { appearance: a } = row;
  const conferenceNameNormalized = normalizeCompanyForMatching(a.conference_name);
  const payload = {
    user_id: row.userId,
    company_id: row.companyId,
    conference_name: a.conference_name,
    conference_name_normalized: conferenceNameNormalized,
    conference_start_date: a.conference_start_date,
    conference_end_date: a.conference_end_date,
    location: a.location,
    appearance_type: a.appearance_type,
    session_title: a.session_title,
    speaker_name: a.speaker_name,
    speaker_title: a.speaker_title,
    matched_contact_id: row.matchedContactId,
    abstract_url: a.abstract_url,
    source_url: a.source_url,
    confidence: a.confidence,
    rationale: a.rationale,
    raw_payload: a as unknown as Record<string, unknown>,
  };
  const { data, error } = await admin
    .from('company_conference_appearances')
    .upsert(payload, {
      onConflict: 'company_id,conference_name_normalized,conference_start_date,session_title,speaker_name',
    })
    .select('*')
    .single();
  if (error) {
    console.warn('[conferences] upsert appearance failed:', error.message);
    return null;
  }
  return data as ConferenceAppearanceRow;
}

export async function runConferencesMonitor(
  input: ConferencesMonitorInput,
): Promise<ConferencesMonitorResult> {
  const admin = createAdminClient();

  const { data: linkRows, error: linkError } = await admin
    .from('user_companies')
    .select('company_id')
    .eq('user_id', input.userId)
    .is('archived_at', null);
  if (linkError) throw new Error(`user_companies query: ${linkError.message}`);
  let ownedIds = (linkRows ?? [])
    .map((r) => (r as { company_id?: unknown }).company_id)
    .filter((v): v is string => typeof v === 'string' && Boolean(v));

  const companyIds = Array.isArray(input.companyIds)
    ? input.companyIds.filter((v): v is string => typeof v === 'string' && Boolean(v))
    : [];
  if (companyIds.length > 0) {
    const requestedSet = new Set(companyIds);
    ownedIds = ownedIds.filter((id) => requestedSet.has(id));
  } else {
    ownedIds = ownedIds.slice(0, Math.min(Math.max(input.limit ?? 25, 1), 200));
  }

  if (ownedIds.length === 0) {
    return {
      processed: 0,
      failed: 0,
      records_scanned: 0,
      candidate_events_matched_before_dedupe: 0,
      events_skipped_as_duplicates: 0,
      llm_calls: 0,
      emitted_signal_types: [],
      recomputed_companies: [],
      failures: [],
    };
  }

  const { data: companies, error: companiesError } = await admin
    .from('companies')
    .select('id, user_id, company_name, domain, aliases, conferences_checked_at')
    .in('id', ownedIds);
  if (companiesError) throw new Error(companiesError.message);

  let processed = 0;
  let failed = 0;
  let recordsScanned = 0;
  let candidateEventsMatched = 0;
  let eventsSkippedAsDuplicates = 0;
  let llmCalls = 0;
  const emittedSignalTypes = new Set<string>();
  const recomputedCompanyIds = new Set<string>();
  const failures: Array<{ company_id: string; error: string }> = [];

  const onlySignal = input.onlySignalKey;
  const shouldEmit = (signalKey: SignalKey): boolean => !onlySignal || onlySignal === signalKey;

  for (const row of (companies ?? []) as CompanyRow[]) {
    const companyName = row.company_name?.trim();
    if (!companyName) continue;
    try {
      // Lazy-populate aliases on first run, then use them for the LLM prompt.
      let aliases = row.aliases ?? [];
      if (aliases.length === 0) {
        try {
          const aliasResult = await ensureCompanyAliases(admin, row.id);
          aliases = aliasResult.aliases;
        } catch (e) {
          console.warn(`[conferences] ensureCompanyAliases failed for ${row.id}:`, e);
        }
      }

      // Freshness gate. If cached and not forcing refresh, query existing
      // appearances rather than hitting the LLM.
      const checkedAt = row.conferences_checked_at ? new Date(row.conferences_checked_at).getTime() : 0;
      const ageDays = checkedAt > 0 ? (Date.now() - checkedAt) / (1000 * 60 * 60 * 24) : Infinity;
      const cacheFresh = !input.forceRefresh && checkedAt > 0 && ageDays < CONFERENCES_REFRESH_DAYS;

      let appearances: ConferenceAppearance[] = [];
      if (cacheFresh) {
        const { data: cached, error: cachedErr } = await admin
          .from('company_conference_appearances')
          .select('*')
          .eq('company_id', row.id)
          .order('conference_start_date', { ascending: false });
        if (cachedErr) throw new Error(`cached appearances query: ${cachedErr.message}`);
        appearances = ((cached ?? []) as ConferenceAppearanceRow[]).map((r) => ({
          conference_name: r.conference_name ?? '',
          conference_dates_text: null,
          conference_start_date: r.conference_start_date,
          conference_end_date: r.conference_end_date,
          location: r.location,
          appearance_type: (r.appearance_type as ConferenceAppearance['appearance_type']) ?? 'other',
          session_title: r.session_title,
          speaker_name: r.speaker_name,
          speaker_title: r.speaker_title,
          abstract_url: r.abstract_url,
          source_url: r.source_url ?? '',
          confidence: (r.confidence as ConferenceAppearance['confidence']) ?? 'medium',
          rationale: r.rationale ?? '',
        }));
      } else {
        const result = await findConferenceAppearances({
          companyName,
          aliases,
          domain: row.domain,
        });
        appearances = result.appearances;
        llmCalls += 1;
        // Mark this company as researched even if no appearances were found —
        // we don't want to re-pay for an empty result on every cron tick.
        await admin
          .from('companies')
          .update({ conferences_checked_at: new Date().toISOString() })
          .eq('id', row.id);
      }

      // Dedupe map — defends against the LLM emitting two near-duplicate
      // appearances for the same session.
      const seen = new Set<string>();
      const candidateBySource: string[] = [];
      const appearancesToProcess: ConferenceAppearance[] = [];
      for (const a of appearances) {
        const key = appearanceDedupeKey(a);
        if (seen.has(key)) continue;
        seen.add(key);
        appearancesToProcess.push(a);
        candidateBySource.push(
          `${SOURCE}:${row.id}:${key}:conference_presentation`,
        );
      }
      const existingSourceEventIds = await fetchExistingSourceEventIds(
        admin,
        input.userId,
        candidateBySource,
      );

      let emittedAny = false;

      for (const a of appearancesToProcess) {
        recordsScanned += 1;
        // Upsert appearance row for query/UI consumption (only when we have
        // fresh data; cached path already has these in the table).
        let matchedContactId: string | null = null;
        if (a.speaker_name) {
          matchedContactId = await findMatchingContactId(admin, input.userId, row.id, a.speaker_name);
        }
        if (!cacheFresh) {
          await upsertAppearance(admin, {
            userId: input.userId,
            companyId: row.id,
            appearance: a,
            matchedContactId,
          });
        }

        const eventAt = toIsoTimestamp(a.conference_start_date) ?? new Date().toISOString();
        const baseMetadata: Record<string, unknown> = {
          conference_name: a.conference_name,
          conference_start_date: a.conference_start_date,
          conference_end_date: a.conference_end_date,
          location: a.location,
          appearance_type: a.appearance_type,
          session_title: a.session_title,
          speaker_name: a.speaker_name,
          speaker_title: a.speaker_title,
          abstract_url: a.abstract_url,
          confidence: a.confidence,
          matched_contact_id: matchedContactId,
        };

        // ── conference_presentation (company-scope) ─────────────────────
        if (shouldEmit('conference_presentation')) {
          candidateEventsMatched += 1;
          const key = appearanceDedupeKey(a);
          const sourceEventId = `${SOURCE}:${row.id}:${key}:conference_presentation`;
          const dateText = a.conference_dates_text ?? a.conference_start_date ?? 'upcoming';
          const summary = a.rationale && a.rationale.length > 0
            ? `${a.rationale} [${a.conference_name}, ${dateText}]`
            : `${companyName} appearance at ${a.conference_name} (${dateText}).`;
          const emitted = await emitSignal(admin, {
            userId: input.userId,
            entityScope: 'company',
            companyId: row.id,
            signalKey: 'conference_presentation',
            sourceEventType: `conference_${a.appearance_type}`,
            sourceEventId,
            sourceUrl: a.source_url ?? '',
            eventAt,
            summary,
            metadata: baseMetadata,
            existingSourceEventIds,
          });
          if (emitted === 'emitted') {
            emittedAny = true;
            emittedSignalTypes.add('conference_presentation');
          } else {
            eventsSkippedAsDuplicates += 1;
          }
        }

        // ── conference_speaker (contact-scope) ──────────────────────────
        // Only emit when we matched an actual contact in the user's book.
        if (matchedContactId && shouldEmit('conference_speaker')) {
          candidateEventsMatched += 1;
          const key = appearanceDedupeKey(a);
          const sourceEventId = `${SOURCE}:${matchedContactId}:${key}:conference_speaker`;
          if (!existingSourceEventIds.has(sourceEventId)) {
            const dateText = a.conference_dates_text ?? a.conference_start_date ?? 'upcoming';
            const summary = a.rationale && a.rationale.length > 0
              ? `${a.speaker_name ?? 'Speaker'} (${a.speaker_title ?? companyName}): ${a.rationale} [${a.conference_name}, ${dateText}]`
              : `${a.speaker_name ?? 'Speaker'} from ${companyName} speaking at ${a.conference_name} (${dateText}).`;
            const emitted = await emitSignal(admin, {
              userId: input.userId,
              entityScope: 'contact',
              companyId: row.id,
              contactId: matchedContactId,
              signalKey: 'conference_speaker',
              sourceEventType: `conference_${a.appearance_type}_speaker`,
              sourceEventId,
              sourceUrl: a.source_url ?? '',
              eventAt,
              summary,
              metadata: baseMetadata,
              existingSourceEventIds,
            });
            if (emitted === 'emitted') {
              emittedAny = true;
              emittedSignalTypes.add('conference_speaker');
            } else {
              eventsSkippedAsDuplicates += 1;
            }
          }
        }
      }

      if (emittedAny) {
        await recomputeAccountReadiness(admin, { userId: input.userId, companyId: row.id });
        await generateAccountReason(admin, { userId: input.userId, companyId: row.id });
        recomputedCompanyIds.add(row.id);
      }

      processed += 1;
    } catch (error) {
      failed += 1;
      failures.push({ company_id: row.id, error: messageFromUnknown(error) });
    }
  }

  return {
    processed,
    failed,
    records_scanned: recordsScanned,
    candidate_events_matched_before_dedupe: candidateEventsMatched,
    events_skipped_as_duplicates: eventsSkippedAsDuplicates,
    llm_calls: llmCalls,
    emitted_signal_types: [...emittedSignalTypes],
    recomputed_companies: [...recomputedCompanyIds],
    failures,
  };
}
