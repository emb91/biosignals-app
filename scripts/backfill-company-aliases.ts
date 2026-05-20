/**
 * One-shot: populate the aliases column for all existing companies via Haiku.
 *
 * Run once after migrating in the aliases column. After this, the
 * ensureCompanyAliases() service can be wired into the company-create flow
 * so new companies get aliases automatically.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-company-aliases.ts
 *   npx tsx --env-file=.env.local scripts/backfill-company-aliases.ts --force  # ignore staleness check
 */
import { createClient } from '@supabase/supabase-js';
import { ensureCompanyAliases } from '@/lib/signals/company-aliases';

async function main() {
  const force = process.argv.includes('--force');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('Missing Supabase env vars');

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin
    .from('companies')
    .select('id, company_name')
    .is('archived_at', null)
    .order('company_name', { ascending: true });
  if (error) throw new Error(`load companies: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; company_name: string | null }>;
  console.log(`Found ${rows.length} active companies to process.`);

  for (const row of rows) {
    if (!row.company_name) {
      console.log(`- ${row.id}  [SKIP: no name]`);
      continue;
    }
    try {
      const result = await ensureCompanyAliases(
        admin as unknown as Parameters<typeof ensureCompanyAliases>[0],
        row.id,
        { refreshIfOlderThanDays: force ? 0 : undefined },
      );
      const tag = result.source === 'cached' ? 'cached' : result.source === 'llm' ? 'LLM' : 'skipped';
      console.log(
        `- ${row.company_name}  [${tag}] -> ${result.aliases.length} aliases${
          result.aliases.length > 0 ? ': ' + result.aliases.slice(0, 5).join(' | ') + (result.aliases.length > 5 ? ' …' : '') : ''
        }`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`- ${row.company_name}  FAILED: ${msg}`);
    }
  }
}

main().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
