/**
 * NIH grants monitor — V1.
 *
 * For each of a user's active companies, query the nih_grants_local mirror
 * (populated by syncNihGrantsDelta) for awards matching the company's
 * normalized name + LLM-derived aliases. Emits `grant_award` signal events,
 * which already map to the `new_budget` readiness dimension in the catalog
 * (baseImpactScore: 48, decayDays: 240).
 *
 * Why org_name-only matching (not the SEC-style CIK-first approach)?
 *  - NIH RePORTER doesn't carry a stable cross-system identifier for the
 *    recipient organization that matches anything in our companies table.
 *    The closest thing is the UEI/DUNS, which most user-entered company rows
 *    don't have either.
 *  - For biotech filers the org_name on grants is usually the legal entity
 *    name (e.g. "CORVION, INC."), which our existing alias/normalization
 *    layer already handles well — the same pattern that drives FDA sponsor
 *    matching and clinical-trial sponsor matching.
 */
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

type GrantsMonitorInput = {
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

export type GrantsMonitorResult = {
  processed: number;
  failed: number;
  records_scanned: number;
  candidate_events_matched_before_dedupe: number;
  events_skipped_as_duplicates: number;
  emitted_signal_types: string[];
  recomputed_companies: string[];
  failures: Array<{ company_id: string; error: string }>;
};

type GrantRow = {
  appl_id: number;
  project_num: string | null;
  core_project_num: string | null;
  activity_code: string | null;
  award_amount: number | string | null;
  award_notice_date: string | null;
  project_start_date: string | null;
  project_end_date: string | null;
  fiscal_year: number | null;
  org_name: string | null;
  org_name_normalized: string | null;
  org_type_code: string | null;
  org_type_name: string | null;
  org_city: string | null;
  org_state: string | null;
  org_uei: string | null;
  agency_ic_code: string | null;
  agency_ic_abbr: string | null;
  agency_ic_name: string | null;
  project_title: string | null;
  contact_pi_name: string | null;
  mechanism_code_dc: string | null;
};

const SOURCE = 'nih_reporter';

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (typeof obj.details === 'string' && obj.details) return obj.details;
  }
  return 'Internal server error';
}

function toIsoTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T12:00:00Z`;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

function formatUsd(amount: number | string | null): string | null {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

async function fetchGrantsForCompany(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  cutoffIso: string,
  limit = 100,
): Promise<GrantRow[]> {
  // mentioned_company_ids is populated at ingest by the resolver.
  // Time cutoff: an award from 6 months ago is no longer "new budget".
  const { data, error } = await admin
    .from('nih_grants_local')
    .select(
      'appl_id, project_num, core_project_num, activity_code, award_amount, award_notice_date, project_start_date, project_end_date, fiscal_year, org_name, org_name_normalized, org_type_code, org_type_name, org_city, org_state, org_uei, agency_ic_code, agency_ic_abbr, agency_ic_name, project_title, contact_pi_name, mechanism_code_dc',
    )
    .contains('mentioned_company_ids', [companyId])
    .gte('award_notice_date', cutoffIso)
    .order('award_notice_date', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`nih_grants_local query: ${error.message}`);
  return (data ?? []) as GrantRow[];
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

  const title = `${input.signalKey} detected from NIH RePORTER`;
  const ingest = await ingestSignalSourceEvent(admin, {
    userId: input.userId,
    entityScope: 'company',
    companyId: input.companyId,
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
      entityId: input.companyId,
      entityScope: 'company',
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
  });

  input.existingSourceEventIds.add(input.sourceEventId);
  return 'emitted';
}

export async function runGrantsMonitor(input: GrantsMonitorInput): Promise<GrantsMonitorResult> {
  const admin = createAdminClient();
  const lookbackDays = clampLookback(input.lookbackDays);
  const cutoffIso = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

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

  const onlySignal = input.onlySignalKey;
  const shouldEmit = (signalKey: SignalKey): boolean => !onlySignal || onlySignal === signalKey;

  for (const row of (companies ?? []) as CompanyRow[]) {
    const companyName = row.company_name?.trim();
    if (!companyName) continue;
    try {
      const grants = await fetchGrantsForCompany(admin, row.id, cutoffIso, 100);

      // Bulk-dedupe via signal_source_events. We use a single source key
      // (nih_reporter) for all NIH grant events so the dedupe set is small
      // and one DB round-trip covers a company's whole award set.
      const candidateSourceEventIds = grants
        .filter(() => shouldEmit('grant_award'))
        .map((g) => `${SOURCE}:${row.id}:${g.appl_id}:grant_award`);
      const existingSourceEventIds = await fetchExistingSourceEventIds(
        admin,
        input.userId,
        candidateSourceEventIds,
      );

      let emittedAny = false;

      for (const grant of grants) {
        recordsScanned += 1;
        if (!shouldEmit('grant_award')) continue;
        candidateEventsMatched += 1;

        const eventAt = toIsoTimestamp(grant.award_notice_date);
        const amount = formatUsd(grant.award_amount);
        const sourceEventId = `${SOURCE}:${row.id}:${grant.appl_id}:grant_award`;
        const projectNum = grant.project_num ?? grant.core_project_num ?? `appl_id ${grant.appl_id}`;
        const mechanism = grant.mechanism_code_dc === 'SB'
          ? 'SBIR/STTR'
          : grant.org_type_name === 'Domestic For-Profits'
            ? 'NIH for-profit'
            : 'NIH grant';
        const ic = grant.agency_ic_abbr ?? grant.agency_ic_code ?? 'NIH';
        const dateText = grant.award_notice_date ?? 'unknown date';
        const summary =
          `${mechanism} award to ${grant.org_name ?? companyName}: ${amount ?? 'undisclosed amount'} from ${ic} (${projectNum}, notice ${dateText}).`;

        const emitted = await emitCompanySignal(admin, {
          userId: input.userId,
          companyId: row.id,
          signalKey: 'grant_award',
          sourceEventType: 'nih_grant_awarded',
          sourceEventId,
          sourceUrl: `https://reporter.nih.gov/project-details/${grant.appl_id}`,
          eventAt,
          summary,
          metadata: {
            appl_id: grant.appl_id,
            project_num: grant.project_num,
            core_project_num: grant.core_project_num,
            activity_code: grant.activity_code,
            award_amount: grant.award_amount,
            award_notice_date: grant.award_notice_date,
            project_start_date: grant.project_start_date,
            project_end_date: grant.project_end_date,
            fiscal_year: grant.fiscal_year,
            org_name: grant.org_name,
            org_type_code: grant.org_type_code,
            org_type_name: grant.org_type_name,
            agency_ic_code: grant.agency_ic_code,
            agency_ic_abbr: grant.agency_ic_abbr,
            agency_ic_name: grant.agency_ic_name,
            project_title: grant.project_title,
            contact_pi_name: grant.contact_pi_name,
            mechanism_code_dc: grant.mechanism_code_dc,
          },
          existingSourceEventIds,
        });
        if (emitted === 'emitted') {
          emittedAny = true;
          emittedSignalTypes.add('grant_award');
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
