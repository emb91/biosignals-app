/**
 * Phase 4 — backfill recent mentions for a newly-added canonical company.
 *
 * When a user adds a company (Foobar Biosciences), they want to see recent
 * news/trials/filings about that company NOW — not have to wait until the
 * next sync cycle picks up something new. But historical source rows already
 * have their `mentioned_company_ids` baked in from when they were classified
 * (when Foobar wasn't canonical yet). This module fills that gap.
 *
 * For each source table:
 *   1. SQL trigram pre-filter on the table's normalized name column against
 *      the new company's name + aliases (similarity > 0.4)
 *   2. Window is the same 14-day cutoff our monitors apply — older rows
 *      wouldn't surface anyway
 *   3. Run the resolver on the extracted names
 *   4. For names that resolve to this company, update
 *      `mentioned_company_ids` (array) or `canonical_company_id` (scalar)
 *
 * Triggered from `lib/enrichment-pipeline.ts` after a new canonical row is
 * inserted. Fire-and-forget — best-effort; the next sync cycle would still
 * pick up new events even if this fails.
 */
import { resolveCompanyMentions } from './resolve-mentions';
import { normalizeCompanyForMatching } from '@/lib/signals/company-name-variants';
import type { createAdminClient } from '@/lib/supabase-admin';

type AdminClient = ReturnType<typeof createAdminClient>;

const DEFAULT_LOOKBACK_DAYS = 14;
const MAX_LOOKBACK_DAYS = 30;
const TRGM_PREFILTER_SIMILARITY = 0.4;
const PREFILTER_LIMIT = 500; // cap per source table to keep cost bounded

export type BackfillResult = {
  companyId: string;
  lookbackDays: number;
  updated_by_table: Record<string, number>;
  total_updated: number;
  errors: Array<{ table: string; error: string }>;
};

/**
 * Per-source-table config. Two flavours of destination column:
 *   * `mentioned_company_ids` (uuid[]) — array, append the id to existing
 *   * `canonical_company_id` (uuid) — scalar, set the id directly
 */
type TableSpec = {
  table: string;
  pkCols: string[];
  /** Date column used for the lookback cutoff. */
  dateCol: string;
  /** Singular column with the raw extracted name(s). */
  nameCol: string;
  /** Optional: array column with multiple names per row (e.g. press releases). */
  namesArrayCol?: string;
  /** Singular normalized column for trgm prefilter. */
  normalizedCol: string;
  /** Optional: array normalized column (e.g. candidate_companies_normalized). */
  normalizedArrayCol?: string;
  /** Destination column kind. */
  destKind: 'array' | 'scalar';
  destCol: 'mentioned_company_ids' | 'canonical_company_id';
};

const TABLES: TableSpec[] = [
  {
    table: 'press_release_articles',
    pkCols: ['id'],
    dateCol: 'published_at',
    nameCol: 'candidate_companies',
    namesArrayCol: 'candidate_companies',
    normalizedCol: 'candidate_companies_normalized', // array column, but unnest handled in SQL
    normalizedArrayCol: 'candidate_companies_normalized',
    destKind: 'array',
    destCol: 'mentioned_company_ids',
  },
  {
    table: 'clinical_trials',
    pkCols: ['nct_id'],
    dateCol: 'last_update_post_date',
    nameCol: 'lead_sponsor',
    namesArrayCol: 'collaborators',
    normalizedCol: 'lead_sponsor_normalized',
    normalizedArrayCol: 'collaborators_normalized',
    destKind: 'array',
    destCol: 'mentioned_company_ids',
  },
  {
    table: 'nih_grants_local',
    pkCols: ['appl_id'],
    dateCol: 'award_notice_date',
    nameCol: 'org_name',
    normalizedCol: 'org_name_normalized',
    destKind: 'array',
    destCol: 'mentioned_company_ids',
  },
  {
    table: 'fda_drug_submissions',
    pkCols: ['application_number', 'submission_number'],
    dateCol: 'submission_status_date',
    nameCol: 'sponsor_name',
    normalizedCol: 'sponsor_normalized',
    destKind: 'array',
    destCol: 'mentioned_company_ids',
  },
  {
    table: 'fda_device_510k',
    pkCols: ['k_number'],
    dateCol: 'decision_date',
    nameCol: 'applicant',
    normalizedCol: 'applicant_normalized',
    destKind: 'array',
    destCol: 'mentioned_company_ids',
  },
  {
    table: 'fda_device_pma',
    pkCols: ['pma_number', 'supplement_number'],
    dateCol: 'decision_date',
    nameCol: 'applicant',
    normalizedCol: 'applicant_normalized',
    destKind: 'array',
    destCol: 'mentioned_company_ids',
  },
  {
    table: 'patent_event_assignees',
    pkCols: ['publication_number', 'assignee_name'],
    // Assignees has no date column directly; join to patent_events.publication_date
    // via the patent_events FK. For Phase 4 we accept all assignee rows (the
    // monitor's lookback applies on patent_events anyway).
    dateCol: '',
    nameCol: 'assignee_name',
    normalizedCol: 'assignee_name_normalized',
    destKind: 'scalar',
    destCol: 'canonical_company_id',
  },
  {
    table: 'sec_filings_local',
    pkCols: ['accession_number'],
    dateCol: 'filing_date',
    nameCol: 'entity_name',
    normalizedCol: 'entity_name_normalized',
    destKind: 'scalar',
    destCol: 'canonical_company_id',
  },
];

export type BackfillOptions = {
  /** Default 14, clamped to [1, 30]. Ignored for patent_event_assignees (no date col). */
  lookbackDays?: number;
};

/**
 * Main entry. Scans all configured source tables for recent rows whose
 * extracted company name matches the given canonical company, and updates
 * `mentioned_company_ids` / `canonical_company_id` accordingly.
 */
export async function backfillRecentMentionsForCompany(
  admin: AdminClient,
  companyId: string,
  opts: BackfillOptions = {},
): Promise<BackfillResult> {
  const lookbackDays = Math.min(
    MAX_LOOKBACK_DAYS,
    Math.max(1, Math.floor(opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS)),
  );
  const cutoffIso = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  const result: BackfillResult = {
    companyId,
    lookbackDays,
    updated_by_table: {},
    total_updated: 0,
    errors: [],
  };

  // Load the canonical company so we know what name+aliases to match against.
  const { data: companyRow, error: companyErr } = await admin
    .from('companies')
    .select('id, company_name, aliases')
    .eq('id', companyId)
    .maybeSingle();
  if (companyErr) {
    throw new Error(`backfill: load company ${companyId}: ${companyErr.message}`);
  }
  if (!companyRow) {
    throw new Error(`backfill: company ${companyId} not found`);
  }

  const canonicalName = (companyRow as { company_name?: string | null }).company_name ?? '';
  const aliases = ((companyRow as { aliases?: string[] | null }).aliases ?? []) as string[];
  const matchNames = [canonicalName, ...aliases].filter(Boolean);
  if (matchNames.length === 0) {
    return result; // nothing to match against
  }
  // Normalized forms used in the trgm prefilter.
  const normalizedTargets = [
    ...new Set(matchNames.map(normalizeCompanyForMatching).filter((s) => s.length >= 3)),
  ];
  if (normalizedTargets.length === 0) return result;

  for (const spec of TABLES) {
    try {
      const updated = await backfillTable(admin, spec, companyId, normalizedTargets, cutoffIso);
      result.updated_by_table[spec.table] = updated;
      result.total_updated += updated;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[backfill-mentions] ${spec.table} failed for company ${companyId}:`, msg);
      result.errors.push({ table: spec.table, error: msg });
    }
  }

  return result;
}

async function backfillTable(
  admin: AdminClient,
  spec: TableSpec,
  companyId: string,
  normalizedTargets: string[],
  cutoffIso: string,
): Promise<number> {
  // Build a single SQL pre-filter call. We do this as an RPC so trigram
  // similarity is computed in the database, not pulled to the client.
  const { data, error } = await admin.rpc('backfill_candidate_rows', {
    p_table: spec.table,
    p_pk_cols: spec.pkCols,
    p_date_col: spec.dateCol || null,
    p_cutoff: cutoffIso,
    p_name_col: spec.nameCol,
    p_names_array_col: spec.namesArrayCol ?? null,
    p_normalized_col: spec.normalizedCol,
    p_normalized_array_col: spec.normalizedArrayCol ?? null,
    p_dest_col: spec.destCol,
    p_targets: normalizedTargets,
    p_min_similarity: TRGM_PREFILTER_SIMILARITY,
    p_limit: PREFILTER_LIMIT,
  });
  if (error) throw new Error(`prefilter: ${error.message}`);

  type CandidateRow = {
    pk: Record<string, unknown>;
    names: string[]; // extracted raw names from nameCol and/or namesArrayCol
  };
  const candidates = ((data ?? []) as unknown[]) as CandidateRow[];
  if (candidates.length === 0) return 0;

  // Collect all unique extracted names for one resolver pass.
  const allNames = new Set<string>();
  for (const c of candidates) for (const n of c.names) if (n) allNames.add(n);
  if (allNames.size === 0) return 0;

  const resolved = await resolveCompanyMentions(admin, [...allNames]);

  // For each row, decide if any of its names resolved to OUR companyId.
  let updated = 0;
  for (const cand of candidates) {
    const hit = cand.names.some((n) => {
      const r = resolved.get(n);
      return r && r.canonicalId === companyId;
    });
    if (!hit) continue;

    // Build the update PK filter
    let q = admin.from(spec.table).update(
      spec.destKind === 'scalar'
        ? { [spec.destCol]: companyId }
        : // For array dest: append companyId, avoiding duplicates.
          // We use the simplest safe approach: read current, append if missing.
          {} as Record<string, unknown>,
    );

    if (spec.destKind === 'array') {
      // Two-step for array: read existing, write new array if needed.
      // Postgres array_append + on-conflict is cleaner but Postgrest doesn't
      // expose array_append, so do it client-side. Cheap for one row at a time.
      const selQ = admin.from(spec.table).select(spec.destCol);
      const filtered = applyPkFilter(selQ, spec.pkCols, cand.pk);
      const { data: existing } = await filtered.maybeSingle();
      const existingArr = (existing && (existing as Record<string, unknown>)[spec.destCol]) as
        | string[]
        | null;
      const next = Array.isArray(existingArr) ? existingArr : [];
      if (next.includes(companyId)) continue; // already set, skip
      next.push(companyId);
      q = admin.from(spec.table).update({ [spec.destCol]: next });
    }

    q = applyPkFilter(q, spec.pkCols, cand.pk);
    const { error: updateErr } = await q;
    if (updateErr) {
      console.error(`[backfill-mentions] ${spec.table} update failed:`, updateErr.message);
      continue;
    }
    updated += 1;
  }

  return updated;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyPkFilter(query: any, pkCols: string[], pk: Record<string, unknown>): any {
  let q = query;
  for (const col of pkCols) {
    q = q.eq(col, pk[col]);
  }
  return q;
}
