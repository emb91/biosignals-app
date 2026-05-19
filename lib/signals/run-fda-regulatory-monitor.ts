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
  domain: string | null;
};

type FdaRegulatoryMonitorInput = {
  userId: string;
  companyIds?: string[];
  limit?: number;
  onlySignalKey?: SignalKey;
};

export type FdaRegulatoryMonitorResult = {
  processed: number;
  failed: number;
  emitted_signal_types: string[];
  recomputed_companies: string[];
  failures: Array<{ company_id: string; error: string }>;
};

type DrugsFdaSubmission = {
  submission_number?: string;
  submission_status?: string;
  submission_status_date?: string;
  submission_type?: string;
  submission_class_code?: string;
  submission_class_code_description?: string;
  review_priority?: string;
  submission_property_type?: Array<{ code?: string; value?: string }>;
};

type DrugsFdaResult = {
  application_number?: string;
  sponsor_name?: string;
  products?: Array<{ brand_name?: string; dosage_form?: string; product_number?: string }>;
  submissions?: DrugsFdaSubmission[];
};

const SOURCE = 'openfda_drugsfda';

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

function hasAny(text: string, needles: string[]): boolean {
  const v = normalizeText(text);
  return needles.some((needle) => v.includes(needle));
}

function toIsoDate(value?: string): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

function isApprovalSubmission(submission: DrugsFdaSubmission): boolean {
  return normalizeText(submission.submission_status) === 'ap';
}

function isBreakthroughOrFastTrack(submission: DrugsFdaSubmission): boolean {
  const byPriority = normalizeText(submission.review_priority);
  if (hasAny(byPriority, ['priority'])) return true;

  const classDesc = normalizeText(submission.submission_class_code_description);
  if (hasAny(classDesc, ['breakthrough', 'fast track', 'accelerated'])) return true;

  const props = Array.isArray(submission.submission_property_type) ? submission.submission_property_type : [];
  for (const prop of props) {
    const value = normalizeText(prop?.value);
    const code = normalizeText(prop?.code);
    if (hasAny(value, ['breakthrough', 'fast track', 'accelerated']) || hasAny(code, ['breakthrough', 'fast track', 'accelerated'])) {
      return true;
    }
  }
  return false;
}

function isFastTrack(submission: DrugsFdaSubmission): boolean {
  const classDesc = normalizeText(submission.submission_class_code_description);
  if (hasAny(classDesc, ['fast track'])) return true;
  const props = Array.isArray(submission.submission_property_type) ? submission.submission_property_type : [];
  for (const prop of props) {
    if (hasAny(`${prop?.code ?? ''} ${prop?.value ?? ''}`, ['fast track'])) return true;
  }
  return false;
}

function isPriorityReview(submission: DrugsFdaSubmission): boolean {
  const priority = normalizeText(submission.review_priority);
  return hasAny(priority, ['priority']);
}

function isOrphanDesignation(submission: DrugsFdaSubmission): boolean {
  const classDesc = normalizeText(submission.submission_class_code_description);
  if (hasAny(classDesc, ['orphan'])) return true;
  const props = Array.isArray(submission.submission_property_type) ? submission.submission_property_type : [];
  for (const prop of props) {
    if (hasAny(`${prop?.code ?? ''} ${prop?.value ?? ''}`, ['orphan'])) return true;
  }
  return false;
}

function isCompleteResponseLetter(submission: DrugsFdaSubmission): boolean {
  const status = normalizeText(submission.submission_status);
  const classDesc = normalizeText(submission.submission_class_code_description);
  return hasAny(status, ['cr']) || hasAny(classDesc, ['complete response', 'crl']);
}

function isLikelyIndicationExpansion(submission: DrugsFdaSubmission): boolean {
  const type = normalizeText(submission.submission_type);
  const classDesc = normalizeText(submission.submission_class_code_description);
  if (!hasAny(type, ['supplement', 's'])) return false;
  return hasAny(classDesc, [
    'new indication',
    'efficacy supplement',
    'labeling',
    'label expansion',
    'expanded indication',
  ]);
}

async function fetchFdaRecordsForCompany(companyName: string, limit = 25): Promise<DrugsFdaResult[]> {
  const query = encodeURIComponent(`sponsor_name:"${companyName}"`);
  const url = `https://api.fda.gov/drug/drugsfda.json?search=${query}&limit=${Math.min(Math.max(limit, 1), 100)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`openFDA request failed (${response.status})`);
  }
  const payload = (await response.json()) as { results?: DrugsFdaResult[] };
  return Array.isArray(payload.results) ? payload.results : [];
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
    companyName: string;
    signalKey: SignalKey;
    sourceEventType: string;
    sourceEventId: string;
    sourceUrl: string;
    summary: string;
    eventAt: string | null;
    metadata: Record<string, unknown>;
  },
): Promise<boolean> {
  if (await sourceEventExists(admin, input.userId, input.sourceEventId)) return false;

  const ingest = await ingestSignalSourceEvent(admin, {
    userId: input.userId,
    entityScope: 'company',
    companyId: input.companyId,
    source: SOURCE,
    sourceEventType: input.sourceEventType,
    sourceEventId: input.sourceEventId,
    sourceUrl: input.sourceUrl,
    title: `${input.signalKey} detected from openFDA`,
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
      title: `${input.signalKey} detected from openFDA`,
      summary: input.summary,
      excerpt: input.summary,
      eventAt: input.eventAt ?? null,
      observedAt: new Date().toISOString(),
      metadata: input.metadata,
    },
    signalKeys: [input.signalKey],
    companyId: input.companyId,
  });

  return true;
}

export async function runFdaRegulatoryMonitor(
  input: FdaRegulatoryMonitorInput,
): Promise<FdaRegulatoryMonitorResult> {
  const admin = createAdminClient();
  const query = admin
    .from('companies')
    .select('id, user_id, company_name, domain')
    .eq('user_id', input.userId)
    .is('archived_at', null)
    .order('updated_at', { ascending: false });

  const companyIds = Array.isArray(input.companyIds)
    ? input.companyIds.filter((value): value is string => typeof value === 'string' && Boolean(value))
    : [];

  if (companyIds.length > 0) query.in('id', companyIds);
  else query.limit(Math.min(Math.max(input.limit ?? 25, 1), 100));

  const { data: companies, error: companiesError } = await query;
  if (companiesError) throw new Error(companiesError.message);

  let processed = 0;
  let failed = 0;
  const emittedSignalTypes = new Set<string>();
  const recomputedCompanyIds = new Set<string>();
  const failures: Array<{ company_id: string; error: string }> = [];

  for (const row of (companies ?? []) as CompanyRow[]) {
    const companyName = row.company_name?.trim();
    if (!companyName) continue;

    try {
      const records = await fetchFdaRecordsForCompany(companyName, 25);
      let emittedAny = false;
      const onlySignal = input.onlySignalKey;
      const shouldEmit = (signalKey: SignalKey) => !onlySignal || onlySignal === signalKey;

      for (const record of records) {
        const appNo = record.application_number || 'unknown_application';
        const sponsor = record.sponsor_name || companyName;
        const productName = record.products?.[0]?.brand_name || 'unknown_product';
        const sourceUrl = `https://api.fda.gov/drug/drugsfda.json?search=${encodeURIComponent(`application_number:${appNo}`)}&limit=1`;
        const submissions = Array.isArray(record.submissions) ? record.submissions : [];

        for (const submission of submissions) {
          const subNo = submission.submission_number || 'unknown_submission';
          const subType = submission.submission_type || 'unknown_type';
          const subStatus = submission.submission_status || 'unknown_status';
          const eventAt = toIsoDate(submission.submission_status_date);
          const baseMetadata = {
            application_number: appNo,
            submission_number: subNo,
            submission_type: subType,
            submission_status: subStatus,
            submission_status_date: submission.submission_status_date ?? null,
            submission_class_code: submission.submission_class_code ?? null,
            submission_class_code_description: submission.submission_class_code_description ?? null,
            review_priority: submission.review_priority ?? null,
            sponsor_name: sponsor,
            product_name: productName,
          };

          if (shouldEmit('fda_approval') && isApprovalSubmission(submission)) {
            const sourceEventId = `${SOURCE}:${row.id}:${appNo}:${subNo}:fda_approval`;
            const emitted = await emitCompanySignal(admin, {
              userId: input.userId,
              companyId: row.id,
              companyName,
              signalKey: 'fda_approval',
              sourceEventType: 'fda_approval',
              sourceEventId,
              sourceUrl,
              eventAt,
              summary: `FDA approval submission observed for ${productName} (${appNo}/${subNo}).`,
              metadata: baseMetadata,
            });
            if (emitted) {
              emittedAny = true;
              emittedSignalTypes.add('fda_approval');
            }
          }

          if (shouldEmit('breakthrough_designation') && isBreakthroughOrFastTrack(submission)) {
            const sourceEventId = `${SOURCE}:${row.id}:${appNo}:${subNo}:breakthrough_designation`;
            const emitted = await emitCompanySignal(admin, {
              userId: input.userId,
              companyId: row.id,
              companyName,
              signalKey: 'breakthrough_designation',
              sourceEventType: 'breakthrough_designation',
              sourceEventId,
              sourceUrl,
              eventAt,
              summary: `Priority/breakthrough-like regulatory status observed for ${productName} (${appNo}/${subNo}).`,
              metadata: baseMetadata,
            });
            if (emitted) {
              emittedAny = true;
              emittedSignalTypes.add('breakthrough_designation');
            }
          }

          if (shouldEmit('fast_track_designation') && isFastTrack(submission)) {
            const sourceEventId = `${SOURCE}:${row.id}:${appNo}:${subNo}:fast_track_designation`;
            const emitted = await emitCompanySignal(admin, {
              userId: input.userId,
              companyId: row.id,
              companyName,
              signalKey: 'fast_track_designation',
              sourceEventType: 'fast_track_designation',
              sourceEventId,
              sourceUrl,
              eventAt,
              summary: `Fast track designation observed for ${productName} (${appNo}/${subNo}).`,
              metadata: baseMetadata,
            });
            if (emitted) {
              emittedAny = true;
              emittedSignalTypes.add('fast_track_designation');
            }
          }

          if (shouldEmit('priority_review') && isPriorityReview(submission)) {
            const sourceEventId = `${SOURCE}:${row.id}:${appNo}:${subNo}:priority_review`;
            const emitted = await emitCompanySignal(admin, {
              userId: input.userId,
              companyId: row.id,
              companyName,
              signalKey: 'priority_review',
              sourceEventType: 'priority_review',
              sourceEventId,
              sourceUrl,
              eventAt,
              summary: `Priority review observed for ${productName} (${appNo}/${subNo}).`,
              metadata: baseMetadata,
            });
            if (emitted) {
              emittedAny = true;
              emittedSignalTypes.add('priority_review');
            }
          }

          if (shouldEmit('orphan_designation') && isOrphanDesignation(submission)) {
            const sourceEventId = `${SOURCE}:${row.id}:${appNo}:${subNo}:orphan_designation`;
            const emitted = await emitCompanySignal(admin, {
              userId: input.userId,
              companyId: row.id,
              companyName,
              signalKey: 'orphan_designation',
              sourceEventType: 'orphan_designation',
              sourceEventId,
              sourceUrl,
              eventAt,
              summary: `Orphan designation observed for ${productName} (${appNo}/${subNo}).`,
              metadata: baseMetadata,
            });
            if (emitted) {
              emittedAny = true;
              emittedSignalTypes.add('orphan_designation');
            }
          }

          if (shouldEmit('indication_expansion') && isLikelyIndicationExpansion(submission)) {
            const sourceEventId = `${SOURCE}:${row.id}:${appNo}:${subNo}:indication_expansion`;
            const emitted = await emitCompanySignal(admin, {
              userId: input.userId,
              companyId: row.id,
              companyName,
              signalKey: 'indication_expansion',
              sourceEventType: 'indication_expansion',
              sourceEventId,
              sourceUrl,
              eventAt,
              summary: `Potential indication/label expansion supplement observed for ${productName} (${appNo}/${subNo}).`,
              metadata: baseMetadata,
            });
            if (emitted) {
              emittedAny = true;
              emittedSignalTypes.add('indication_expansion');
            }
          }

          if (shouldEmit('complete_response_letter') && isCompleteResponseLetter(submission)) {
            const sourceEventId = `${SOURCE}:${row.id}:${appNo}:${subNo}:complete_response_letter`;
            const emitted = await emitCompanySignal(admin, {
              userId: input.userId,
              companyId: row.id,
              companyName,
              signalKey: 'complete_response_letter',
              sourceEventType: 'complete_response_letter',
              sourceEventId,
              sourceUrl,
              eventAt,
              summary: `Complete response letter (or equivalent) observed for ${productName} (${appNo}/${subNo}).`,
              metadata: baseMetadata,
            });
            if (emitted) {
              emittedAny = true;
              emittedSignalTypes.add('complete_response_letter');
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
    emitted_signal_types: [...emittedSignalTypes],
    recomputed_companies: [...recomputedCompanyIds],
    failures,
  };
}
