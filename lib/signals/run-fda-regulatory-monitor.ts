import { createAdminClient } from '@/lib/supabase-admin';
import { ensureCompanyAliases } from '@/lib/signals/company-aliases';
import { buildCompanyQueryVariants, normalizeCompanyForMatching } from '@/lib/signals/company-name-variants';
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
  aliases: string[] | null;
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

type Device510kResult = {
  k_number?: string;
  applicant?: string;
  device_name?: string;
  product_code?: string;
  decision_date?: string;
  decision_description?: string;
  decision_code?: string;
};

type DevicePmaResult = {
  pma_number?: string;
  supplement_number?: string;
  supplement_type?: string;
  supplement_reason?: string;
  applicant?: string;
  trade_name?: string;
  generic_name?: string;
  decision_date?: string;
  decision_code?: string;
  advisory_committee_description?: string;
};

const SOURCE = 'openfda_drugsfda';
const SOURCE_510K = 'openfda_device_510k';
const SOURCE_PMA = 'openfda_device_pma';

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

/**
 * Build an OpenFDA Lucene-style search clause that ORs across the primary
 * name + every alias. Aliases are quoted so multi-word legal names like
 * "ModernaTx, Inc." aren't tokenized into "moderna" + "inc" (which would
 * over-match unrelated sponsors).
 */
/**
 * Build an OR-clause across normalized variants of the company name + aliases.
 * Used for ILIKE matching against the *_normalized columns in our local FDA
 * mirror tables (populated by syncFdaDelta). Trigram indexes on those columns
 * make this fast.
 */
function buildNormalizedSearchTerms(companyName: string, aliases: string[]): string[] {
  return [...new Set(
    buildCompanyQueryVariants(companyName, aliases)
      .map((v) => normalizeCompanyForMatching(v))
      .filter((v) => v.length >= 4),
  )];
}

function escapePostgrestPattern(term: string): string {
  return term.replace(/[,()]/g, ' ').trim();
}

async function fetchFdaDrugRecordsForCompany(
  admin: ReturnType<typeof createAdminClient>,
  companyName: string,
  aliases: string[],
  limit = 100,
): Promise<DrugsFdaResult[]> {
  const terms = buildNormalizedSearchTerms(companyName, aliases);
  if (terms.length === 0) return [];
  const orClause = terms.map((t) => `sponsor_normalized.ilike.%${escapePostgrestPattern(t)}%`).join(',');
  const { data, error } = await admin
    .from('fda_drug_submissions')
    .select('*')
    .or(orClause)
    .order('submission_status_date', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) throw new Error(`fda_drug_submissions query failed: ${error.message}`);

  // Group flat submission rows back into DrugsFdaResult[] (one per application)
  // so the downstream emission loop works unchanged.
  const byApp = new Map<string, DrugsFdaResult>();
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const appNo = typeof r.application_number === 'string' ? r.application_number : '';
    if (!appNo) continue;
    if (!byApp.has(appNo)) {
      byApp.set(appNo, {
        application_number: appNo,
        sponsor_name: typeof r.sponsor_name === 'string' ? r.sponsor_name : undefined,
        products: typeof r.product_brand_name === 'string'
          ? [{ brand_name: r.product_brand_name }]
          : [],
        submissions: [],
      });
    }
    const app = byApp.get(appNo)!;
    app.submissions!.push({
      submission_number: typeof r.submission_number === 'string' ? r.submission_number : undefined,
      submission_status: typeof r.submission_status === 'string' ? r.submission_status : undefined,
      submission_status_date: typeof r.submission_status_date === 'string' ? r.submission_status_date : undefined,
      submission_type: typeof r.submission_type === 'string' ? r.submission_type : undefined,
      submission_class_code: typeof r.submission_class_code === 'string' ? r.submission_class_code : undefined,
      submission_class_code_description:
        typeof r.submission_class_code_description === 'string' ? r.submission_class_code_description : undefined,
      review_priority: typeof r.review_priority === 'string' ? r.review_priority : undefined,
      submission_property_type: Array.isArray(r.submission_property_type)
        ? (r.submission_property_type as Array<{ code?: string; value?: string }>)
        : undefined,
    });
  }
  return [...byApp.values()];
}

async function fetchFda510kRecordsForCompany(
  admin: ReturnType<typeof createAdminClient>,
  companyName: string,
  aliases: string[],
  limit = 100,
): Promise<Device510kResult[]> {
  const terms = buildNormalizedSearchTerms(companyName, aliases);
  if (terms.length === 0) return [];
  const orClause = terms.map((t) => `applicant_normalized.ilike.%${escapePostgrestPattern(t)}%`).join(',');
  const { data, error } = await admin
    .from('fda_device_510k')
    .select('k_number, applicant, device_name, product_code, decision_code, decision_description, decision_date')
    .or(orClause)
    .order('decision_date', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) throw new Error(`fda_device_510k query failed: ${error.message}`);
  return (data ?? []) as Device510kResult[];
}

async function fetchFdaPmaRecordsForCompany(
  admin: ReturnType<typeof createAdminClient>,
  companyName: string,
  aliases: string[],
  limit = 100,
): Promise<DevicePmaResult[]> {
  const terms = buildNormalizedSearchTerms(companyName, aliases);
  if (terms.length === 0) return [];
  const orClause = terms.map((t) => `applicant_normalized.ilike.%${escapePostgrestPattern(t)}%`).join(',');
  const { data, error } = await admin
    .from('fda_device_pma')
    .select('pma_number, supplement_number, applicant, trade_name, generic_name, supplement_type, supplement_reason, decision_code, decision_date, advisory_committee_description')
    .or(orClause)
    .order('decision_date', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) throw new Error(`fda_device_pma query failed: ${error.message}`);
  return (data ?? []) as DevicePmaResult[];
}

async function sourceEventExists(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  source: string,
  sourceEventId: string,
): Promise<boolean> {
  const { data, error } = await admin
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

async function emitCompanySignal(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    userId: string;
    companyId: string;
    companyName: string;
    source?: string;
    signalKey: SignalKey;
    sourceEventType: string;
    sourceEventId: string;
    sourceUrl: string;
    summary: string;
    eventAt: string | null;
    metadata: Record<string, unknown>;
  },
): Promise<boolean> {
  const source = input.source ?? SOURCE;
  if (await sourceEventExists(admin, input.userId, source, input.sourceEventId)) return false;

  const ingest = await ingestSignalSourceEvent(admin, {
    userId: input.userId,
    entityScope: 'company',
    companyId: input.companyId,
    source,
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
      source,
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
    .select('id, user_id, company_name, domain, aliases')
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

  // Lazy-populate aliases for any company missing them. ensureCompanyAliases
  // is a no-op when aliases are already populated and fresh (<180 days).
  const companyAliasMap = new Map<string, string[]>();
  for (const row of (companies ?? []) as CompanyRow[]) {
    const name = row.company_name?.trim();
    if (!name) continue;
    let aliases = row.aliases ?? [];
    if (aliases.length === 0) {
      try {
        const result = await ensureCompanyAliases(admin, row.id);
        aliases = result.aliases;
      } catch (error) {
        console.error(`[fda-regulatory] ensureCompanyAliases failed for ${row.id}:`, error);
      }
    }
    companyAliasMap.set(row.id, aliases);
  }

  let processed = 0;
  let failed = 0;
  const emittedSignalTypes = new Set<string>();
  const recomputedCompanyIds = new Set<string>();
  const failures: Array<{ company_id: string; error: string }> = [];

  for (const row of (companies ?? []) as CompanyRow[]) {
    const companyName = row.company_name?.trim();
    if (!companyName) continue;

    try {
      const aliases = companyAliasMap.get(row.id) ?? [];
      const [records, device510k, devicePma] = await Promise.all([
        fetchFdaDrugRecordsForCompany(admin, companyName, aliases, 100),
        fetchFda510kRecordsForCompany(admin, companyName, aliases, 100),
        fetchFdaPmaRecordsForCompany(admin, companyName, aliases, 100),
      ]);
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

      // ── 510(k) device clearances ──────────────────────────────────────
      for (const device of device510k) {
        const kNumber = device.k_number || 'unknown_k';
        const decision = normalizeText(device.decision_description);
        const isCleared = decision.includes('substantially equivalent') || /^se/.test(normalizeText(device.decision_code));
        const eventAt = toIsoDate(device.decision_date);
        const sourceUrl = `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=${encodeURIComponent(kNumber)}`;
        const metadata = {
          fda_dataset: '510k',
          k_number: kNumber,
          applicant: device.applicant ?? null,
          device_name: device.device_name ?? null,
          product_code: device.product_code ?? null,
          decision_code: device.decision_code ?? null,
          decision_description: device.decision_description ?? null,
          decision_date: device.decision_date ?? null,
        };
        if (shouldEmit('fda_approval') && isCleared) {
          const id = `${SOURCE_510K}:${row.id}:${kNumber}:fda_510k_cleared`;
          const emitted = await emitCompanySignal(admin, {
            userId: input.userId,
            companyId: row.id,
            companyName,
            source: SOURCE_510K,
            signalKey: 'fda_approval',
            sourceEventType: 'fda_510k_cleared',
            sourceEventId: id,
            sourceUrl,
            eventAt,
            summary: `FDA 510(k) clearance for ${device.device_name ?? kNumber} (${device.applicant ?? companyName}).`,
            metadata,
          });
          if (emitted) {
            emittedAny = true;
            emittedSignalTypes.add('fda_approval');
          }
        }
      }

      // ── PMA device approvals + supplements ────────────────────────────
      for (const device of devicePma) {
        const pmaNo = device.pma_number || 'unknown_pma';
        const supNo = device.supplement_number || '';
        const decision = normalizeText(device.decision_code);
        const isApproved = decision === 'appr' || decision.startsWith('appr');
        const eventAt = toIsoDate(device.decision_date);
        const idBase = supNo ? `${pmaNo}/${supNo}` : pmaNo;
        const sourceUrl = `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpma/pma.cfm?id=${encodeURIComponent(pmaNo)}`;
        const metadata = {
          fda_dataset: 'pma',
          pma_number: pmaNo,
          supplement_number: supNo || null,
          supplement_type: device.supplement_type ?? null,
          supplement_reason: device.supplement_reason ?? null,
          applicant: device.applicant ?? null,
          trade_name: device.trade_name ?? null,
          generic_name: device.generic_name ?? null,
          decision_code: device.decision_code ?? null,
          decision_date: device.decision_date ?? null,
        };
        if (shouldEmit('fda_approval') && isApproved) {
          const id = `${SOURCE_PMA}:${row.id}:${idBase}:fda_pma_approved`;
          const emitted = await emitCompanySignal(admin, {
            userId: input.userId,
            companyId: row.id,
            companyName,
            source: SOURCE_PMA,
            signalKey: 'fda_approval',
            sourceEventType: 'fda_pma_approved',
            sourceEventId: id,
            sourceUrl,
            eventAt,
            summary: `FDA PMA ${supNo ? 'supplement ' : ''}approval for ${device.trade_name ?? pmaNo} (${device.applicant ?? companyName}).`,
            metadata,
          });
          if (emitted) {
            emittedAny = true;
            emittedSignalTypes.add('fda_approval');
          }
        }
        // PMA supplements with reasons containing "new indication" / "label" = indication expansion
        const supReason = normalizeText(device.supplement_reason);
        if (
          shouldEmit('indication_expansion') &&
          isApproved &&
          supNo &&
          hasAny(supReason, ['new indication', 'label', 'expanded indication'])
        ) {
          const id = `${SOURCE_PMA}:${row.id}:${idBase}:indication_expansion`;
          const emitted = await emitCompanySignal(admin, {
            userId: input.userId,
            companyId: row.id,
            companyName,
            source: SOURCE_PMA,
            signalKey: 'indication_expansion',
            sourceEventType: 'fda_pma_indication_expansion',
            sourceEventId: id,
            sourceUrl,
            eventAt,
            summary: `PMA supplement (${device.supplement_reason}) for ${device.trade_name ?? pmaNo}.`,
            metadata,
          });
          if (emitted) {
            emittedAny = true;
            emittedSignalTypes.add('indication_expansion');
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
