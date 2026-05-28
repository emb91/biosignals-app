import { createAdminClient } from '@/lib/supabase-admin';
import {
  generateAccountReason,
  ingestSignalSourceEvent,
  normalizeSignalSourceEvent,
  recomputeAccountReadiness,
} from '@/lib/signals/readiness-service';
import type { SignalKey } from '@/lib/signals/readiness-types';

type CompanyRow = {
  id: string;
  company_name: string | null;
};

type PatentsMonitorInput = {
  userId: string;
  companyIds?: string[];
  limit?: number;
  onlySignalKey?: SignalKey;
  /** How many days back to look. Default 14, clamped to [1, 30]. */
  lookbackDays?: number;
};

const DEFAULT_LOOKBACK_DAYS = 14;
const MAX_LOOKBACK_DAYS = 30;

function clampLookback(value: number | undefined): number {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_LOOKBACK_DAYS;
  return Math.min(MAX_LOOKBACK_DAYS, Math.max(1, Math.floor(v)));
}

export type PatentsMonitorResult = {
  processed: number;
  failed: number;
  records_scanned: number;
  candidate_events_matched_before_dedupe: number;
  events_skipped_as_duplicates: number;
  emitted_signal_types: string[];
  recomputed_companies: string[];
  failures: Array<{ company_id: string; error: string }>;
};

type PatentRow = {
  patent_id?: string;
  patent_title?: string;
  patent_date?: string;
  patent_kind?: string;
  patent_type?: string;
  patent_abstract?: string;
  patent_num_claims?: number;
  patent_processing_time?: number;
  applications?: Array<{
    app_number?: string;
    app_date?: string;
  }>;
};

const SOURCE = 'uspto_public_search';

const THERAPEUTIC_AREA_KEYWORDS: Record<string, string[]> = {
  oncology: ['oncology', 'cancer', 'tumor', 'neoplasm'],
  immunology: ['immunology', 'immune', 'immunotherapy', 'autoimmune'],
  neurology: ['neurology', 'neuro', 'alzheimer', 'parkinson', 'cns'],
  cardiometabolic: ['cardio', 'cardiovascular', 'metabolic', 'diabetes', 'obesity'],
  infectious_disease: ['infectious', 'antiviral', 'antibacterial', 'vaccine', 'pathogen'],
  rare_disease: ['rare disease', 'orphan'],
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (typeof obj.details === 'string' && obj.details) return obj.details;
  }
  return 'Internal server error';
}

function normalizeText(value?: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

function toIsoDate(value?: string): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

function isGrantedPatent(row: PatentRow): boolean {
  const kind = normalizeText(row.patent_kind);
  const type = normalizeText(row.patent_type);
  return kind.startsWith('b') || type === 'utility' || type === 'design' || type === 'plant';
}

function isPublishedApplication(row: PatentRow): boolean {
  const kind = normalizeText(row.patent_kind);
  return kind.startsWith('a');
}

function detectTherapeuticArea(row: PatentRow): string | null {
  const text = `${row.patent_title ?? ''} ${row.patent_abstract ?? ''}`.toLowerCase();
  for (const [area, keywords] of Object.entries(THERAPEUTIC_AREA_KEYWORDS)) {
    if (keywords.some((keyword) => text.includes(keyword))) return area;
  }
  return null;
}

async function fetchPatentsForCompaniesFromLocal(
  admin: ReturnType<typeof createAdminClient>,
  companies: Array<{ id: string; name: string }>,
  cutoffIso: string,
  limitPerCompany = 100,
): Promise<Map<string, PatentRow[]>> {
  const result = new Map<string, PatentRow[]>();
  if (companies.length === 0) return result;

  for (const company of companies) {
    // canonical_company_id was populated at ingest by the resolver.
    const { data: assigneeRows, error: assigneeErr } = await admin
      .from('patent_event_assignees')
      .select('publication_number')
      .eq('canonical_company_id', company.id)
      .limit(Math.max(limitPerCompany * 3, 200));

    if (assigneeErr) {
      throw new Error(`patent_event_assignees query failed for "${company.name}": ${assigneeErr.message}`);
    }

    const publicationNumbers = [
      ...new Set(
        (assigneeRows ?? [])
          .map((r) => (typeof (r as { publication_number?: unknown }).publication_number === 'string'
            ? (r as { publication_number: string }).publication_number
            : null))
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    if (publicationNumbers.length === 0) {
      result.set(company.id, []);
      continue;
    }

    // Time cutoff applied on patent_events (the table that carries dates);
    // assignees table has no date column.
    const { data: patents, error: patentsErr } = await admin
      .from('patent_events')
      .select('publication_number, kind_code, country_code, publication_date, filing_date, title, abstract')
      .in('publication_number', publicationNumbers)
      .gte('publication_date', cutoffIso)
      .order('publication_date', { ascending: false })
      .limit(limitPerCompany);

    if (patentsErr) {
      throw new Error(`patent_events query failed for "${company.name}": ${patentsErr.message}`);
    }

    const patentRows: PatentRow[] = (patents ?? []).map((p) => {
      const row = p as Record<string, unknown>;
      return {
        patent_id: typeof row.publication_number === 'string' ? row.publication_number : undefined,
        patent_title: typeof row.title === 'string' ? row.title : undefined,
        patent_abstract: typeof row.abstract === 'string' ? row.abstract : undefined,
        patent_date: typeof row.publication_date === 'string' ? row.publication_date : undefined,
        patent_kind: typeof row.kind_code === 'string' ? row.kind_code : undefined,
        patent_type: undefined,
        patent_num_claims: undefined,
        patent_processing_time: undefined,
      };
    });
    result.set(company.id, patentRows);
  }
  return result;
}

async function sourceEventExists(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  sourceEventId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('signal_source_events')
    .select('id')
    .eq('user_id', userId)
    .eq('source', SOURCE)
    .eq('source_event_id', sourceEventId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

async function fetchExistingSourceEventIds(
  admin: ReturnType<typeof createAdminClient>,
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

async function emitCompanySignal(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    userId: string;
    companyId: string;
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
  if (await sourceEventExists(admin, input.userId, input.sourceEventId)) {
    input.existingSourceEventIds.add(input.sourceEventId);
    return 'duplicate';
  }

  const ingest = await ingestSignalSourceEvent(admin, {
    userId: input.userId,
    entityScope: 'company',
    companyId: input.companyId,
    source: SOURCE,
    sourceEventType: input.sourceEventType,
    sourceEventId: input.sourceEventId,
    sourceUrl: input.sourceUrl,
    title: `${input.signalKey} detected from PatentsView`,
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
      source: SOURCE,
      sourceUrl: input.sourceUrl,
      sourceEventType: input.sourceEventType,
      sourceEventId: input.sourceEventId,
      title: `${input.signalKey} detected from PatentsView`,
      summary: input.summary,
      excerpt: input.summary,
      eventAt: input.eventAt ?? null,
      observedAt: new Date().toISOString(),
      metadata: input.metadata,
    },
    signalKeys: [input.signalKey],
    companyId: input.companyId,
  });

  input.existingSourceEventIds.add(input.sourceEventId);
  return 'emitted';
}

export async function runPatentsMonitor(input: PatentsMonitorInput): Promise<PatentsMonitorResult> {
  const admin = createAdminClient();
  const lookbackDays = clampLookback(input.lookbackDays);
  const cutoffIso = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  // Ownership + archive state live in user_companies (the per-user link table).
  // First find the active company ids for this user, then load shared metadata
  // from companies. Both lookups are indexed.
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
    ? input.companyIds.filter((value): value is string => typeof value === 'string' && Boolean(value))
    : [];
  if (companyIds.length > 0) {
    const requestedSet = new Set(companyIds);
    ownedIds = ownedIds.filter((id) => requestedSet.has(id));
  } else {
    ownedIds = ownedIds.slice(0, Math.min(Math.max(input.limit ?? 25, 1), 500));
  }

  if (ownedIds.length === 0) {
    return {
      processed: 0,
      failed: 0,
      records_scanned: 0,
      candidate_events_matched_before_dedupe: 0,
      events_skipped_as_duplicates: 0,
      emitted_signal_types: [],
      recomputed_companies: [],
      failures: [],
    };
  }

  const { data: companies, error: companiesError } = await admin
    .from('companies')
    .select('id, company_name')
    .in('id', ownedIds);
  if (companiesError) throw new Error(companiesError.message);

  let processed = 0;
  let failed = 0;
  let recordsScanned = 0;
  let candidateEventsMatched = 0;
  let eventsSkippedAsDuplicates = 0;
  const emittedSignalTypes = new Set<string>();
  const recomputedCompanyIds = new Set<string>();
  const failures: Array<{ company_id: string; error: string }> = [];

  // Reads from the local patent_events mirror (populated by the weekly
  // /api/cron/patents-delta cron). Per-user scans now do zero BigQuery
  // work — just indexed Supabase queries via canonical_company_id.
  const companiesForFetch = ((companies ?? []) as CompanyRow[]).flatMap((row) => {
    const name = row.company_name?.trim();
    return name ? [{ id: row.id, name }] : [];
  });
  const patentsByCompany = await fetchPatentsForCompaniesFromLocal(admin, companiesForFetch, cutoffIso, 100);

  for (const row of (companies ?? []) as CompanyRow[]) {
    const companyName = row.company_name?.trim();
    if (!companyName) continue;

    try {
      const records = patentsByCompany.get(row.id) ?? [];
      const onlySignal = input.onlySignalKey;
      const shouldEmit = (signalKey: SignalKey) => !onlySignal || onlySignal === signalKey;
      let emittedAny = false;
      let recentPatentCount = 0;
      const candidateSourceEventIds: string[] = [];

      for (const patent of records) {
        const patentId = patent.patent_id || 'unknown_patent';
        if (shouldEmit('patent_application_published') && isPublishedApplication(patent)) {
          candidateSourceEventIds.push(`${SOURCE}:${row.id}:${patentId}:patent_application_published`);
        }
        if (shouldEmit('patent_granted') && isGrantedPatent(patent)) {
          candidateSourceEventIds.push(`${SOURCE}:${row.id}:${patentId}:patent_granted`);
        }
        if (shouldEmit('patent_filed_or_granted') && (isGrantedPatent(patent) || isPublishedApplication(patent))) {
          candidateSourceEventIds.push(`${SOURCE}:${row.id}:${patentId}:patent_filed_or_granted`);
        }
        const area = detectTherapeuticArea(patent);
        if (area && shouldEmit('new_therapeutic_area_patent')) {
          candidateSourceEventIds.push(`${SOURCE}:${row.id}:${area}:new_therapeutic_area_patent`);
        }
      }
      if (shouldEmit('assignee_portfolio_acceleration')) {
        const period = new Date().toISOString().slice(0, 7);
        candidateSourceEventIds.push(`${SOURCE}:${row.id}:${period}:assignee_portfolio_acceleration`);
      }
      const existingSourceEventIds = await fetchExistingSourceEventIds(admin, input.userId, candidateSourceEventIds);

      for (const patent of records) {
        recordsScanned += 1;
        const patentId = patent.patent_id || 'unknown_patent';
        const eventAt = toIsoDate(patent.patent_date);
        const sourceUrl = `https://patents.google.com/patent/${patentId.replace(/-/g, '')}`;
        const metadata = {
          patent_id: patentId,
          patent_title: patent.patent_title ?? null,
          patent_kind: patent.patent_kind ?? null,
          patent_type: patent.patent_type ?? null,
          patent_date: patent.patent_date ?? null,
          patent_num_claims: patent.patent_num_claims ?? null,
        };

        if (eventAt) {
          const ageDays = Math.floor((Date.now() - new Date(eventAt).getTime()) / (1000 * 60 * 60 * 24));
          if (ageDays <= 90) recentPatentCount += 1;
        }

        if (shouldEmit('patent_application_published') && isPublishedApplication(patent)) {
          candidateEventsMatched += 1;
          const sourceEventId = `${SOURCE}:${row.id}:${patentId}:patent_application_published`;
          const emitted = await emitCompanySignal(admin, {
            userId: input.userId,
            companyId: row.id,
            signalKey: 'patent_application_published',
            sourceEventType: 'patent_application_published',
            sourceEventId,
            sourceUrl,
            eventAt,
            summary: `Published patent application detected for ${companyName}: ${patent.patent_title ?? patentId}.`,
            metadata,
            existingSourceEventIds,
          });
          if (emitted === 'emitted') {
            emittedAny = true;
            emittedSignalTypes.add('patent_application_published');
          } else {
            eventsSkippedAsDuplicates += 1;
          }
        }

        if (shouldEmit('patent_granted') && isGrantedPatent(patent)) {
          candidateEventsMatched += 1;
          const sourceEventId = `${SOURCE}:${row.id}:${patentId}:patent_granted`;
          const emitted = await emitCompanySignal(admin, {
            userId: input.userId,
            companyId: row.id,
            signalKey: 'patent_granted',
            sourceEventType: 'patent_granted',
            sourceEventId,
            sourceUrl,
            eventAt,
            summary: `Granted patent detected for ${companyName}: ${patent.patent_title ?? patentId}.`,
            metadata,
            existingSourceEventIds,
          });
          if (emitted === 'emitted') {
            emittedAny = true;
            emittedSignalTypes.add('patent_granted');
          } else {
            eventsSkippedAsDuplicates += 1;
          }
        }

        if (shouldEmit('patent_filed_or_granted') && (isGrantedPatent(patent) || isPublishedApplication(patent))) {
          candidateEventsMatched += 1;
          const sourceEventId = `${SOURCE}:${row.id}:${patentId}:patent_filed_or_granted`;
          const emitted = await emitCompanySignal(admin, {
            userId: input.userId,
            companyId: row.id,
            signalKey: 'patent_filed_or_granted',
            sourceEventType: 'patent_filed_or_granted',
            sourceEventId,
            sourceUrl,
            eventAt,
            summary: `Patent filing/grant activity detected for ${companyName}: ${patent.patent_title ?? patentId}.`,
            metadata,
            existingSourceEventIds,
          });
          if (emitted === 'emitted') {
            emittedAny = true;
            emittedSignalTypes.add('patent_filed_or_granted');
          } else {
            eventsSkippedAsDuplicates += 1;
          }
        }

        const area = detectTherapeuticArea(patent);
        if (area && shouldEmit('new_therapeutic_area_patent')) {
          candidateEventsMatched += 1;
          const sourceEventId = `${SOURCE}:${row.id}:${area}:new_therapeutic_area_patent`;
          const emitted = await emitCompanySignal(admin, {
            userId: input.userId,
            companyId: row.id,
            signalKey: 'new_therapeutic_area_patent',
            sourceEventType: 'new_therapeutic_area_patent',
            sourceEventId,
            sourceUrl,
            eventAt,
            summary: `Patent activity indicates therapeutic-area expansion (${area}) for ${companyName}.`,
            metadata: { ...metadata, therapeutic_area: area },
            existingSourceEventIds,
          });
          if (emitted === 'emitted') {
            emittedAny = true;
            emittedSignalTypes.add('new_therapeutic_area_patent');
          } else {
            eventsSkippedAsDuplicates += 1;
          }
        }
      }

      if (shouldEmit('assignee_portfolio_acceleration') && recentPatentCount >= 3) {
        candidateEventsMatched += 1;
        const period = new Date().toISOString().slice(0, 7);
        const sourceEventId = `${SOURCE}:${row.id}:${period}:assignee_portfolio_acceleration`;
        const emitted = await emitCompanySignal(admin, {
          userId: input.userId,
          companyId: row.id,
          signalKey: 'assignee_portfolio_acceleration',
          sourceEventType: 'assignee_portfolio_acceleration',
          sourceEventId,
          sourceUrl: `https://patents.google.com/?assignee=${encodeURIComponent(companyName)}`,
          eventAt: new Date().toISOString(),
          summary: `${companyName} shows elevated recent patent velocity (${recentPatentCount} patents in the last 90 days).`,
          metadata: { recent_patents_90d: recentPatentCount },
          existingSourceEventIds,
        });
        if (emitted === 'emitted') {
          emittedAny = true;
          emittedSignalTypes.add('assignee_portfolio_acceleration');
        } else {
          eventsSkippedAsDuplicates += 1;
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
    emitted_signal_types: [...emittedSignalTypes],
    recomputed_companies: [...recomputedCompanyIds],
    failures,
  };
}
