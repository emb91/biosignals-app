import 'dotenv/config';
import { config as loadDotEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

loadDotEnv({ path: '.env.local', override: false });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MT_GROUP_ID = 'd930527d-8d1c-4d55-a073-12177e513ddf';
const VIR_ID = '67800429-9030-4e0e-a190-73b097aef3ae';
const BAD_MT_510K = 'K260715';
const BAD_VIR_PATENT_PUBLICATION = 'EP-4726602-A2';

const execute = process.argv.includes('--execute');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function assertNoError(error, label) {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

function removeId(ids, id) {
  if (!Array.isArray(ids)) return [];
  return ids.filter((value) => value !== id);
}

function priorityFrom(fitScore, readinessScore) {
  if (typeof fitScore !== 'number' || Number.isNaN(fitScore)) return null;
  return Math.min(1, Math.max(0, fitScore * (0.5 + 0.5 * readinessScore)));
}

async function selectAll(table, columns, applyFilters) {
  const pageSize = 1000;
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    let query = supabase.from(table).select(columns).range(from, from + pageSize - 1);
    query = applyFilters(query);
    const { data, error } = await query;
    assertNoError(error, `select ${table}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function countRows(table, applyFilters) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  query = applyFilters(query);
  const { count, error } = await query;
  assertNoError(error, `count ${table}`);
  return count ?? 0;
}

async function chunkedDelete(table, column, ids) {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { error } = await supabase.from(table).delete().in(column, chunk);
    assertNoError(error, `delete ${table}`);
    deleted += chunk.length;
  }
  return deleted;
}

async function main() {
  const mtClinicalTrials = await selectAll(
    'clinical_trials',
    'nct_id,brief_title,lead_sponsor,collaborators,mentioned_company_ids',
    (query) => query.contains('mentioned_company_ids', [MT_GROUP_ID])
  );

  const mtFda510k = await selectAll(
    'fda_device_510k',
    'k_number,applicant,applicant_normalized,device_name,mentioned_company_ids',
    (query) => query.eq('k_number', BAD_MT_510K).contains('mentioned_company_ids', [MT_GROUP_ID])
  );

  const virPatentAssignees = await selectAll(
    'patent_event_assignees',
    'publication_number,assignee_name,assignee_name_normalized,canonical_company_id',
    (query) =>
      query
        .eq('publication_number', BAD_VIR_PATENT_PUBLICATION)
        .eq('assignee_name_normalized', 'biotech')
        .eq('canonical_company_id', VIR_ID)
  );

  const mtSourceEvents = await selectAll(
    'signal_source_events',
    'id,user_id,source_event_type,entity_company_id,source',
    (query) => query.eq('entity_company_id', MT_GROUP_ID).eq('source', 'clinicaltrials_gov')
  );
  const mtSourceEventIds = mtSourceEvents.map((row) => row.id);
  const mtUserIds = [...new Set(mtSourceEvents.map((row) => row.user_id).filter(Boolean))];

  const mtNormalizedSignalsBefore = mtSourceEventIds.length
    ? await countRows('normalized_signals', (query) => query.in('source_event_id', mtSourceEventIds))
    : 0;

  const mtSnapshotRows = await selectAll(
    'account_readiness_snapshots',
    'id,user_id,company_id,fit_score,overall_score,priority_score,top_signal_ids',
    (query) => query.eq('company_id', MT_GROUP_ID)
  );

  const mtReasonCountBefore = await countRows('account_reason_snapshots', (query) =>
    query.eq('company_id', MT_GROUP_ID)
  );

  const mtCacheRows = await selectAll(
    'company_resolution_cache',
    'raw_name_normalized,canonical_company_id,confidence,resolved_by',
    (query) => query.eq('canonical_company_id', MT_GROUP_ID).eq('resolved_by', 'substring')
  );

  const virCacheRows = await selectAll(
    'company_resolution_cache',
    'raw_name_normalized,canonical_company_id,confidence,resolved_by',
    (query) => query.eq('canonical_company_id', VIR_ID).eq('raw_name_normalized', 'biotech')
  );

  console.log(JSON.stringify(
    {
      mode: execute ? 'execute' : 'dry-run',
      targets: {
        mtClinicalTrialRows: mtClinicalTrials.length,
        mtClinicalTrialNctIds: mtClinicalTrials.map((row) => row.nct_id).sort(),
        mtFda510kRows: mtFda510k.length,
        mtFda510kNumbers: mtFda510k.map((row) => row.k_number),
        virPatentAssigneeRows: virPatentAssignees.length,
        mtClinicalSignalSourceEvents: mtSourceEvents.length,
        mtNormalizedSignalsFromThoseEvents: mtNormalizedSignalsBefore,
        mtReadinessSnapshots: mtSnapshotRows.length,
        mtReasonSnapshots: mtReasonCountBefore,
        mtResolverCacheRows: mtCacheRows.length,
        virResolverCacheRows: virCacheRows.length,
        affectedUserIds: mtUserIds,
      },
    },
    null,
    2
  ));

  if (!execute) return;

  for (const row of mtClinicalTrials) {
    const { error } = await supabase
      .from('clinical_trials')
      .update({ mentioned_company_ids: removeId(row.mentioned_company_ids, MT_GROUP_ID) })
      .eq('nct_id', row.nct_id);
    assertNoError(error, `update clinical_trials ${row.nct_id}`);
  }

  for (const row of mtFda510k) {
    const { error } = await supabase
      .from('fda_device_510k')
      .update({ mentioned_company_ids: removeId(row.mentioned_company_ids, MT_GROUP_ID) })
      .eq('k_number', row.k_number);
    assertNoError(error, `update fda_device_510k ${row.k_number}`);
  }

  for (const row of virPatentAssignees) {
    const { error } = await supabase
      .from('patent_event_assignees')
      .update({ canonical_company_id: null })
      .eq('publication_number', row.publication_number)
      .eq('assignee_name_normalized', row.assignee_name_normalized)
      .eq('canonical_company_id', VIR_ID);
    assertNoError(error, `update patent_event_assignees ${row.publication_number}`);
  }

  const deletedSourceEvents = await chunkedDelete('signal_source_events', 'id', mtSourceEventIds);

  {
    const { error } = await supabase
      .from('company_resolution_cache')
      .delete()
      .eq('canonical_company_id', MT_GROUP_ID)
      .eq('resolved_by', 'substring');
    assertNoError(error, 'delete MT resolver cache rows');
  }

  {
    const { error } = await supabase
      .from('company_resolution_cache')
      .delete()
      .eq('canonical_company_id', VIR_ID)
      .eq('raw_name_normalized', 'biotech');
    assertNoError(error, 'delete Vir resolver cache row');
  }

  const remainingMtNormalizedSignals = await countRows('normalized_signals', (query) =>
    query.eq('company_id', MT_GROUP_ID)
  );

  let resetReadinessSnapshots = 0;
  if (remainingMtNormalizedSignals === 0) {
    for (const row of mtSnapshotRows) {
      const { error } = await supabase
        .from('account_readiness_snapshots')
        .update({
          overall_score: 0,
          overall_label: 'low',
          new_budget_score: 0,
          new_budget_label: 'low',
          new_needs_score: 0,
          new_needs_label: 'low',
          new_people_score: 0,
          new_people_label: 'low',
          new_strategy_score: 0,
          new_strategy_label: 'low',
          caution_score: 0,
          caution_label: 'low',
          top_signal_ids: [],
          freshness_score: null,
          priority_score: priorityFrom(row.fit_score, 0),
        })
        .eq('id', row.id);
      assertNoError(error, `reset account_readiness_snapshots ${row.id}`);
      resetReadinessSnapshots += 1;
    }

    for (const userId of mtUserIds) {
      const { error } = await supabase
        .from('user_companies')
        .update({ readiness_score: 0 })
        .eq('company_id', MT_GROUP_ID)
        .eq('user_id', userId);
      assertNoError(error, `reset user_companies ${userId}`);
    }

    const { error } = await supabase
      .from('account_reason_snapshots')
      .delete()
      .eq('company_id', MT_GROUP_ID);
    assertNoError(error, 'delete MT account reason snapshots');
  }

  const verification = {
    mtClinicalTrialRows: await countRows('clinical_trials', (query) =>
      query.contains('mentioned_company_ids', [MT_GROUP_ID])
    ),
    mtFda510kRows: await countRows('fda_device_510k', (query) =>
      query.contains('mentioned_company_ids', [MT_GROUP_ID])
    ),
    virPatentAssigneeRows: await countRows('patent_event_assignees', (query) =>
      query
        .eq('publication_number', BAD_VIR_PATENT_PUBLICATION)
        .eq('assignee_name_normalized', 'biotech')
        .eq('canonical_company_id', VIR_ID)
    ),
    mtClinicalSignalSourceEvents: await countRows('signal_source_events', (query) =>
      query.eq('entity_company_id', MT_GROUP_ID).eq('source', 'clinicaltrials_gov')
    ),
    mtNormalizedSignals: await countRows('normalized_signals', (query) =>
      query.eq('company_id', MT_GROUP_ID)
    ),
    mtReasonSnapshots: await countRows('account_reason_snapshots', (query) =>
      query.eq('company_id', MT_GROUP_ID)
    ),
    mtResolverCacheRows: await countRows('company_resolution_cache', (query) =>
      query.eq('canonical_company_id', MT_GROUP_ID).eq('resolved_by', 'substring')
    ),
    virResolverCacheRows: await countRows('company_resolution_cache', (query) =>
      query.eq('canonical_company_id', VIR_ID).eq('raw_name_normalized', 'biotech')
    ),
  };

  console.log(JSON.stringify(
    {
      deletedSourceEvents,
      resetReadinessSnapshots,
      verification,
    },
    null,
    2
  ));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
