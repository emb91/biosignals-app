/**
 * One-shot: backfill `clinical_trials.mentioned_company_ids` for every trial.
 *
 * For each trial, resolves [lead_sponsor, ...collaborators] to canonical
 * company ids via the resolver. The resolver caches every unique name so
 * repeats short-circuit — important here because ~3 trials per distinct
 * sponsor on average.
 *
 * Skips rows where mentioned_company_ids is already set unless --force.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-clinical-trials-mentions.ts
 *   npx tsx --env-file=.env.local scripts/backfill-clinical-trials-mentions.ts --force
 */
import { createClient } from '@supabase/supabase-js';
import { resolveCompanyMentions } from '@/lib/companies/resolve-mentions';

const BATCH_SIZE = 200;

async function main() {
  const force = process.argv.includes('--force');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('Missing Supabase env vars');

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // --force: null out the column first so the natural "fetch first N unresolved"
  // loop covers every row without cursor pagination.
  if (force) {
    console.log('Clearing mentioned_company_ids on all rows…');
    const { error: clearErr } = await admin
      .from('clinical_trials')
      .update({ mentioned_company_ids: null })
      .not('mentioned_company_ids', 'is', null);
    if (clearErr) throw new Error(`force-clear: ${clearErr.message}`);
  }

  const { count, error: countErr } = await admin
    .from('clinical_trials')
    .select('nct_id', { count: 'exact', head: true })
    .is('mentioned_company_ids', null);
  if (countErr) throw new Error(`count error: ${countErr.message}`);
  console.log(`Backfilling ${count ?? 0} trials${force ? ' (--force cleared first)' : ''}.`);
  if (!count) return;

  let processed = 0;
  let totalResolved = 0;
  let totalUnresolved = 0;

  while (true) {
    const { data: page, error: pageErr } = await admin
      .from('clinical_trials')
      .select('nct_id, lead_sponsor, collaborators')
      .is('mentioned_company_ids', null)
      .order('nct_id', { ascending: true })
      .limit(BATCH_SIZE);
    if (pageErr) throw new Error(`page error: ${pageErr.message}`);
    if (!page || page.length === 0) break;

    // Collect unique sponsor names across the whole page.
    const allNames = new Set<string>();
    for (const r of page as Array<{ lead_sponsor: string | null; collaborators: string[] | null }>) {
      if (r.lead_sponsor) allNames.add(r.lead_sponsor);
      for (const c of r.collaborators ?? []) if (c) allNames.add(c);
    }

    let resolved: Map<string, { canonicalId: string | null }>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolved = await resolveCompanyMentions(admin as any, [...allNames]);
    } catch (e) {
      console.error('  resolver failed for page, retrying row-by-row:', e instanceof Error ? e.message : e);
      resolved = new Map();
    }

    for (const row of page as Array<{ nct_id: string; lead_sponsor: string | null; collaborators: string[] | null }>) {
      const names: string[] = [];
      if (row.lead_sponsor) names.push(row.lead_sponsor);
      for (const c of row.collaborators ?? []) if (c) names.push(c);

      const ids = new Set<string>();
      for (const n of names) {
        const id = resolved.get(n)?.canonicalId;
        if (id) ids.add(id);
      }

      const idArr = [...ids];
      const { error: updateErr } = await admin
        .from('clinical_trials')
        .update({ mentioned_company_ids: idArr })
        .eq('nct_id', row.nct_id);
      if (updateErr) console.error(`  [${row.nct_id}] update failed:`, updateErr.message);

      totalResolved += idArr.length;
      totalUnresolved += names.length - idArr.length;
      processed += 1;
    }

    console.log(`  …processed ${processed}/${count} (resolved=${totalResolved}, unresolved=${totalUnresolved})`);
  }

  console.log(
    `Done. Processed ${processed} trials. Resolved ${totalResolved} mentions; ${totalUnresolved} unresolved.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
