/**
 * One-shot: backfill `press_release_articles.mentioned_company_ids` for every
 * classified article that already has `candidate_companies` populated.
 *
 * Safe to re-run — uses the resolver cache, so repeated names short-circuit.
 * Skips rows where mentioned_company_ids is already populated unless
 * --force is passed.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-press-release-mentions.ts
 *   npx tsx --env-file=.env.local scripts/backfill-press-release-mentions.ts --force
 */
import { createClient } from '@supabase/supabase-js';
import { buildCompanyMentionMatches, verifiedMentionCompanyIds } from '@/lib/companies/mention-provenance';

const BATCH_SIZE = 50;

async function main() {
  const force = process.argv.includes('--force');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('Missing Supabase env vars');

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // --force: null out the column first so the natural "fetch first N
  // unresolved" loop covers every row without cursor pagination.
  if (force) {
    console.log('Clearing mentioned_company_ids on classified rows…');
    const { error: clearErr } = await admin
      .from('press_release_articles')
      .update({ mentioned_company_ids: null, mentioned_company_matches: [] })
      .not('classification', 'is', null)
      .not('mentioned_company_ids', 'is', null);
    if (clearErr) throw new Error(`force-clear: ${clearErr.message}`);
  }

  const { count, error: countErr } = await admin
    .from('press_release_articles')
    .select('id', { count: 'exact', head: true })
    .not('classification', 'is', null)
    .not('candidate_companies', 'is', null)
    .is('mentioned_company_ids', null);
  if (countErr) throw new Error(`count error: ${countErr.message}`);
  console.log(`Backfilling ${count ?? 0} articles${force ? ' (--force cleared first)' : ''}.`);
  if (!count) return;

  let processed = 0;
  let totalResolved = 0;
  let totalUnresolved = 0;

  while (true) {
    const { data: page, error: pageErr } = await admin
      .from('press_release_articles')
      .select('id, candidate_companies')
      .not('classification', 'is', null)
      .not('candidate_companies', 'is', null)
      .is('mentioned_company_ids', null)
      .order('published_at', { ascending: false })
      .limit(BATCH_SIZE);
    if (pageErr) throw new Error(`page error: ${pageErr.message}`);
    if (!page || page.length === 0) break;

    for (const row of page as Array<{ id: string; candidate_companies: string[] | null }>) {
      const candidates = row.candidate_companies ?? [];
      if (candidates.length === 0) {
        processed += 1;
        continue;
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const matches = await buildCompanyMentionMatches(
          admin as any,
          candidates.map((company) => ({ sourceText: company, sourceField: 'candidate_companies' })),
        );
        const ids = verifiedMentionCompanyIds(matches);

        const { error: updateErr } = await admin
          .from('press_release_articles')
          .update({ mentioned_company_ids: ids, mentioned_company_matches: matches })
          .eq('id', row.id);
        if (updateErr) console.error(`  [${row.id}] update failed:`, updateErr.message);

        totalResolved += ids.length;
        totalUnresolved += candidates.length - ids.length;
        processed += 1;
        if (processed % 25 === 0) {
          console.log(`  …processed ${processed}/${count} (resolved=${totalResolved}, unresolved=${totalUnresolved})`);
        }
      } catch (e) {
        console.error(`  [${row.id}] resolver error:`, e instanceof Error ? e.message : e);
        processed += 1;
      }
    }
  }

  console.log(
    `Done. Processed ${processed} articles. Resolved ${totalResolved} mentions; ${totalUnresolved} unresolved (no canonical match).`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
