/**
 * One-shot: backfill `patent_event_assignees.canonical_company_id` for every
 * (patent, assignee) row.
 *
 * ~41K rows, ~16K distinct assignees. Cache absorbs the repetition.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-patents-mentions.ts
 *   npx tsx --env-file=.env.local scripts/backfill-patents-mentions.ts --force
 */
import { createClient } from '@supabase/supabase-js';
import { resolveCompanyMentions } from '@/lib/companies/resolve-mentions';

const BATCH_SIZE = 500;

async function main() {
  const force = process.argv.includes('--force');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('Missing Supabase env vars');

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  if (force) {
    console.log('Clearing canonical_company_id on all rows…');
    const { error: clearErr } = await admin
      .from('patent_event_assignees')
      .update({ canonical_company_id: null })
      .not('canonical_company_id', 'is', null);
    if (clearErr) throw new Error(`force-clear: ${clearErr.message}`);
  }

  const { count, error: countErr } = await admin
    .from('patent_event_assignees')
    .select('publication_number', { count: 'exact', head: true })
    .is('canonical_company_id', null);
  if (countErr) throw new Error(`count: ${countErr.message}`);
  console.log(`Backfilling ${count ?? 0} assignee rows${force ? ' (--force cleared first)' : ''}.`);
  if (!count) return;

  let processed = 0;
  let totalResolved = 0;

  while (true) {
    const { data: page, error: pageErr } = await admin
      .from('patent_event_assignees')
      .select('publication_number, assignee_name')
      .is('canonical_company_id', null)
      .order('publication_number', { ascending: true })
      .order('assignee_name', { ascending: true })
      .limit(BATCH_SIZE);
    if (pageErr) throw new Error(`page: ${pageErr.message}`);
    if (!page || page.length === 0) break;

    const rows = page as Array<{ publication_number: string; assignee_name: string }>;
    const uniqueNames = [...new Set(rows.map((r) => r.assignee_name).filter(Boolean))];

    let resolved: Map<string, { canonicalId: string | null }>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolved = await resolveCompanyMentions(admin as any, uniqueNames);
    } catch (e) {
      console.error('  resolver failed for page:', e instanceof Error ? e.message : e);
      resolved = new Map();
    }

    for (const row of rows) {
      const id = resolved.get(row.assignee_name)?.canonicalId ?? null;
      const { error: updateErr } = await admin
        .from('patent_event_assignees')
        .update({ canonical_company_id: id })
        .eq('publication_number', row.publication_number)
        .eq('assignee_name', row.assignee_name);
      if (updateErr) console.error(`  update failed:`, updateErr.message);
      if (id) totalResolved += 1;
      processed += 1;
    }

    console.log(`  …processed ${processed}/${count} (resolved=${totalResolved})`);
  }

  console.log(`\nDone. Processed ${processed} rows, ${totalResolved} matches.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
