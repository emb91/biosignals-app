/**
 * One-shot: backfill `mentioned_company_ids` for the 3 FDA tables.
 *   fda_drug_submissions (sponsor_name)
 *   fda_device_510k (applicant)
 *   fda_device_pma (applicant)
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-fda-mentions.ts
 *   npx tsx --env-file=.env.local scripts/backfill-fda-mentions.ts --force
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { resolveCompanyMentions } from '@/lib/companies/resolve-mentions';

const BATCH_SIZE = 200;

type TableSpec = {
  table: string;
  pkCols: string[];
  nameField: string;
};

const TABLES: TableSpec[] = [
  { table: 'fda_drug_submissions', pkCols: ['application_number', 'submission_number'], nameField: 'sponsor_name' },
  { table: 'fda_device_510k', pkCols: ['k_number'], nameField: 'applicant' },
  { table: 'fda_device_pma', pkCols: ['pma_number', 'supplement_number'], nameField: 'applicant' },
];

async function backfillTable(admin: SupabaseClient, spec: TableSpec, force: boolean) {
  // --force: null out the column first so the natural "fetch first N unresolved"
  // loop covers every row. Avoids cursor pagination across composite PKs.
  if (force) {
    const { error: clearErr } = await admin
      .from(spec.table)
      .update({ mentioned_company_ids: null })
      .not('mentioned_company_ids', 'is', null);
    if (clearErr) throw new Error(`${spec.table} force-clear: ${clearErr.message}`);
  }

  const { count, error: countErr } = await admin
    .from(spec.table)
    .select(spec.pkCols[0], { count: 'exact', head: true })
    .is('mentioned_company_ids', null);
  if (countErr) throw new Error(`${spec.table} count: ${countErr.message}`);
  console.log(`\n[${spec.table}] backfilling ${count ?? 0} rows${force ? ' (--force cleared first)' : ''}.`);
  if (!count) return;

  let processed = 0;
  let totalResolved = 0;
  const selectCols = [...spec.pkCols, spec.nameField].join(', ');

  while (true) {
    let pageQ = admin
      .from(spec.table)
      .select(selectCols)
      .is('mentioned_company_ids', null)
      .limit(BATCH_SIZE);
    spec.pkCols.forEach((c) => {
      pageQ = pageQ.order(c, { ascending: true });
    });

    const { data: page, error: pageErr } = await pageQ;
    if (pageErr) throw new Error(`${spec.table} page: ${pageErr.message}`);
    if (!page || page.length === 0) break;
    const newRows = page as unknown as Record<string, unknown>[];

    const uniqueNames = [
      ...new Set(
        newRows
          .map((r) => r[spec.nameField])
          .filter((n): n is string => typeof n === 'string' && Boolean(n)),
      ),
    ];

    let resolved: Map<string, { canonicalId: string | null }>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolved = await resolveCompanyMentions(admin as any, uniqueNames);
    } catch (e) {
      console.error(`  [${spec.table}] resolver failed:`, e instanceof Error ? e.message : e);
      resolved = new Map();
    }

    for (const row of newRows) {
      const name = row[spec.nameField] as string | null;
      const id = name ? resolved.get(name)?.canonicalId : null;
      const ids = id ? [id] : [];
      let updateQ = admin.from(spec.table).update({ mentioned_company_ids: ids });
      spec.pkCols.forEach((c) => {
        updateQ = updateQ.eq(c, row[c]);
      });
      const { error: updateErr } = await updateQ;
      if (updateErr) console.error(`  update failed:`, updateErr.message);
      totalResolved += ids.length;
      processed += 1;
    }

    console.log(`  …processed ${processed}/${count} (resolved=${totalResolved})`);
  }

  console.log(`[${spec.table}] done. ${processed} rows, ${totalResolved} matches.`);
}

async function main() {
  const force = process.argv.includes('--force');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('Missing Supabase env vars');
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  for (const spec of TABLES) {
    await backfillTable(admin, spec, force);
  }
  console.log('\nAll FDA tables backfilled.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
