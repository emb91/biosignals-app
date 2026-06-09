/**
 * Backfill logo_cached for all companies that have a logo_url but no cached copy.
 * LinkedIn CDN URLs are signed and expire; this fetches each logo server-side
 * and stores it as a base64 JPEG data URI in companies.logo_cached.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-logo-cache.ts
 *   npx tsx --env-file=.env.local scripts/backfill-logo-cache.ts --force  # re-cache even if logo_cached already set
 */
import { createClient } from '@supabase/supabase-js';
import { cacheCompanyLogo } from '@/lib/photo-cache';

async function main() {
  const force = process.argv.includes('--force');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('Missing Supabase env vars');

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let query = admin
    .from('companies')
    .select('id, company_name, logo_url')
    .not('logo_url', 'is', null);
  if (!force) {
    query = query.is('logo_cached', null);
  }
  const { data, error } = await query.order('company_name');
  if (error) throw new Error(`load companies: ${error.message}`);

  const rows = (data ?? []) as Array<{ id: string; company_name: string | null; logo_url: string | null }>;
  console.log(`Found ${rows.length} companies to process${force ? ' (--force: re-caching all)' : ' (missing logo_cached)'}.`);

  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.logo_url) continue;
    process.stdout.write(`  ${row.company_name ?? row.id} … `);
    const cached = await cacheCompanyLogo(row.logo_url);
    if (cached) {
      await admin
        .from('companies')
        .update({ logo_cached: cached, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      console.log('✓');
      succeeded++;
    } else {
      console.log('✗ (fetch/cache failed — URL may have already expired)');
      failed++;
    }
  }

  console.log(`\nDone. ${succeeded} cached, ${failed} failed.`);
  if (failed > 0) {
    console.log('Failed logos will be re-cached on next enrichment run.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
