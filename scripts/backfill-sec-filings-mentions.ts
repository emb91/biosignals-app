/**
 * One-shot: backfill `sec_filings_local.canonical_company_id` for every row.
 *
 * ~51K rows, ~17K distinct entity names.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-sec-filings-mentions.ts
 *   npx tsx --env-file=.env.local scripts/backfill-sec-filings-mentions.ts --force
 */
import { createClient } from '@supabase/supabase-js';
import { buildCompanyMentionMatches, type CompanyMentionMatch } from '@/lib/companies/mention-provenance';

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
      .from('sec_filings_local')
      .update({ canonical_company_id: null, canonical_company_match: null })
      .not('canonical_company_id', 'is', null);
    if (clearErr) throw new Error(`force-clear: ${clearErr.message}`);
  }

  const { count, error: countErr } = await admin
    .from('sec_filings_local')
    .select('accession_number', { count: 'exact', head: true })
    .is('canonical_company_id', null);
  if (countErr) throw new Error(`count: ${countErr.message}`);
  console.log(`Backfilling ${count ?? 0} filings${force ? ' (--force cleared first)' : ''}.`);
  if (!count) return;

  let processed = 0;
  let totalResolved = 0;

  while (true) {
    const { data: page, error: pageErr } = await admin
      .from('sec_filings_local')
      .select('accession_number, entity_name')
      .is('canonical_company_id', null)
      .order('accession_number', { ascending: true })
      .limit(BATCH_SIZE);
    if (pageErr) throw new Error(`page: ${pageErr.message}`);
    if (!page || page.length === 0) break;

    const rows = page as Array<{ accession_number: string; entity_name: string | null }>;

    for (const row of rows) {
      let match: CompanyMentionMatch | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const matches = await buildCompanyMentionMatches(admin as any, [
          { sourceText: row.entity_name, sourceField: 'entity_name' },
        ]);
        match = matches[0] ?? null;
      } catch (e) {
        console.error('  resolver failed:', e instanceof Error ? e.message : e);
      }
      const id = match?.verified ? match.company_id : null;
      const { error: updateErr } = await admin
        .from('sec_filings_local')
        .update({ canonical_company_id: id, canonical_company_match: match })
        .eq('accession_number', row.accession_number);
      if (updateErr) console.error(`  update failed:`, updateErr.message);
      if (id) totalResolved += 1;
      processed += 1;
    }

    console.log(`  …processed ${processed}/${count} (resolved=${totalResolved})`);
  }

  console.log(`\nDone. Processed ${processed} filings, ${totalResolved} matches.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
