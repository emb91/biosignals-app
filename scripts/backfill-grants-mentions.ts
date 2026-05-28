/**
 * One-shot: backfill `nih_grants_local.mentioned_company_ids` for every grant.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-grants-mentions.ts
 *   npx tsx --env-file=.env.local scripts/backfill-grants-mentions.ts --force
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

  let countQ = admin.from('nih_grants_local').select('appl_id', { count: 'exact', head: true });
  if (!force) countQ = countQ.is('mentioned_company_ids', null);
  const { count, error: countErr } = await countQ;
  if (countErr) throw new Error(`count error: ${countErr.message}`);
  console.log(`Backfilling ${count ?? 0} grants${force ? ' (--force)' : ''}.`);
  if (!count) return;

  let processed = 0;
  let totalResolved = 0;
  const seenIds = new Set<number>();

  while (true) {
    let pageQ = admin
      .from('nih_grants_local')
      .select('appl_id, org_name')
      .order('appl_id', { ascending: true })
      .limit(BATCH_SIZE);
    if (!force) pageQ = pageQ.is('mentioned_company_ids', null);
    if (force && seenIds.size > 0) {
      const seenList = [...seenIds].slice(-5000);
      pageQ = pageQ.not('appl_id', 'in', `(${seenList.join(',')})`);
    }
    const { data: page, error: pageErr } = await pageQ;
    if (pageErr) throw new Error(`page error: ${pageErr.message}`);
    if (!page || page.length === 0) break;

    const uniqueOrgs = [
      ...new Set(
        (page as Array<{ org_name: string | null }>)
          .map((r) => r.org_name)
          .filter((n): n is string => Boolean(n)),
      ),
    ];

    let resolved: Map<string, { canonicalId: string | null }>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolved = await resolveCompanyMentions(admin as any, uniqueOrgs);
    } catch (e) {
      console.error('  resolver failed for page:', e instanceof Error ? e.message : e);
      resolved = new Map();
    }

    for (const row of page as Array<{ appl_id: number; org_name: string | null }>) {
      if (force) seenIds.add(row.appl_id);
      const id = row.org_name ? resolved.get(row.org_name)?.canonicalId : null;
      const ids = id ? [id] : [];
      const { error: updateErr } = await admin
        .from('nih_grants_local')
        .update({ mentioned_company_ids: ids })
        .eq('appl_id', row.appl_id);
      if (updateErr) console.error(`  [${row.appl_id}] update failed:`, updateErr.message);
      totalResolved += ids.length;
      processed += 1;
    }

    console.log(`  …processed ${processed}/${count} (resolved=${totalResolved})`);
  }

  console.log(`Done. Processed ${processed} grants. Resolved ${totalResolved}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
