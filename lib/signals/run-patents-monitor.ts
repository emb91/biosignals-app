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
  user_id: string;
  company_name: string | null;
};

type PatentsMonitorInput = {
  userId: string;
  companyIds?: string[];
  limit?: number;
  onlySignalKey?: SignalKey;
};

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

const SOURCE = 'patentsview';

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

function normalizeCompanyForMatching(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
    .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|gmbh|ag|sa|nv|pty)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildCompanyQueryVariants(companyName: string): string[] {
  const original = companyName.trim();
  const normalized = normalizeCompanyForMatching(companyName);
  const variants: string[] = [];
  if (original) variants.push(original);
  if (normalized && normalized !== original.toLowerCase()) variants.push(normalized);

  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length >= 2) variants.push(tokens.slice(0, 2).join(' '));
  if (tokens.length >= 3) variants.push(tokens.slice(0, 3).join(' '));

  return [...new Set(variants)].filter((v) => v.length >= 4);
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

async function fetchPatentsForCompany(companyName: string, limit = 50): Promise<PatentRow[]> {
  const url = 'https://api.patentsview.org/patents/query';
  const perPage = Math.min(Math.max(limit, 1), 200);
  const fields = [
    'patent_id',
    'patent_title',
    'patent_date',
    'patent_kind',
    'patent_type',
    'patent_abstract',
    'patent_num_claims',
    'patent_processing_time',
    'app_number',
    'app_date',
  ];

  const variants = buildCompanyQueryVariants(companyName);
  const rowsById = new Map<string, PatentRow>();

  for (const variant of variants) {
    const body = {
      q: {
        _and: [
          { _text_any: { assignee_organization: variant } },
          { _gte: { patent_date: '2019-01-01' } },
        ],
      },
      f: fields,
      o: { per_page: perPage },
    };
    const response = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) continue;
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) continue;
    try {
      const payload = (await response.json()) as { patents?: PatentRow[] };
      const patents = Array.isArray(payload.patents) ? payload.patents : [];
      for (const patent of patents) {
        const patentId = patent.patent_id || '';
        if (!patentId) continue;
        if (!rowsById.has(patentId)) rowsById.set(patentId, patent);
      }
      // Stop early if strict/early variants already gave us enough rows.
      if (rowsById.size >= perPage) break;
    } catch {
      // Ignore malformed responses per-variant.
      continue;
    }
  }
  return [...rowsById.values()];
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
  },
): Promise<'emitted' | 'duplicate'> {
  if (await sourceEventExists(admin, input.userId, input.sourceEventId)) return 'duplicate';

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

  return 'emitted';
}

export async function runPatentsMonitor(input: PatentsMonitorInput): Promise<PatentsMonitorResult> {
  const admin = createAdminClient();
  const query = admin
    .from('companies')
    .select('id, user_id, company_name')
    .eq('user_id', input.userId)
    .is('archived_at', null)
    .order('updated_at', { ascending: false });

  const companyIds = Array.isArray(input.companyIds)
    ? input.companyIds.filter((value): value is string => typeof value === 'string' && Boolean(value))
    : [];

  if (companyIds.length > 0) query.in('id', companyIds);
  else query.limit(Math.min(Math.max(input.limit ?? 25, 1), 500));

  const { data: companies, error: companiesError } = await query;
  if (companiesError) throw new Error(companiesError.message);

  let processed = 0;
  let failed = 0;
  let recordsScanned = 0;
  let candidateEventsMatched = 0;
  let eventsSkippedAsDuplicates = 0;
  const emittedSignalTypes = new Set<string>();
  const recomputedCompanyIds = new Set<string>();
  const failures: Array<{ company_id: string; error: string }> = [];

  for (const row of (companies ?? []) as CompanyRow[]) {
    const companyName = row.company_name?.trim();
    if (!companyName) continue;

    try {
      const records = await fetchPatentsForCompany(companyName, 100);
      const onlySignal = input.onlySignalKey;
      const shouldEmit = (signalKey: SignalKey) => !onlySignal || onlySignal === signalKey;
      let emittedAny = false;
      let recentPatentCount = 0;

      for (const patent of records) {
        recordsScanned += 1;
        const patentId = patent.patent_id || 'unknown_patent';
        const eventAt = toIsoDate(patent.patent_date);
        const sourceUrl = `https://api.patentsview.org/patents/query?q=${encodeURIComponent(
          JSON.stringify({ _eq: { patent_id: patentId } }),
        )}`;
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
          sourceUrl: 'https://api.patentsview.org/patents/query',
          eventAt: new Date().toISOString(),
          summary: `${companyName} shows elevated recent patent velocity (${recentPatentCount} patents in the last 90 days).`,
          metadata: { recent_patents_90d: recentPatentCount },
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
