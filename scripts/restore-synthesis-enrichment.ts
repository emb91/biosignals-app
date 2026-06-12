/**
 * One-off: full re-enrichment for SYNthesis BioVentures after a monitor-only
 * re-run (2026-06-12) clobbered its customer taxonomy with an empty result.
 * The sticky-array guard in lib/company-monitor/index.ts now prevents this
 * class of wipe; this restores the data with full Apify/Apollo context.
 *
 *   npx tsx --env-file=.env.local scripts/restore-synthesis-enrichment.ts
 */
import { createClient } from '@supabase/supabase-js';
import { runCompanyEnrichmentById } from '@/lib/company-enrichment';

const SYNTHESIS_DOMAIN = 'synthesisbioventures.com';
const USER = '3f166004-174b-4fc6-88f0-7cd47332f6ee';

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: company, error } = await admin
    .from('companies')
    .select('id, company_name, user_companies!inner(user_id)')
    .eq('domain', SYNTHESIS_DOMAIN)
    .eq('user_companies.user_id', USER)
    .single();
  if (error || !company) throw error ?? new Error('SYNthesis not found');

  console.log(`Re-enriching ${company.company_name} (${company.id}) …`);
  const result = await runCompanyEnrichmentById(
    admin as unknown as Parameters<typeof runCompanyEnrichmentById>[0],
    company.id as string,
  );
  console.log(`status: ${result.status}; fields updated: ${result.fields_updated.join(', ') || 'none'}`);
  if (result.error) console.log(`error: ${result.error}`);

  const { data: after } = await admin
    .from('companies')
    .select('therapeutic_areas, customer_therapeutic_areas, modalities, customer_modalities, funding_stage, company_type')
    .eq('id', company.id as string)
    .single();
  console.log('after:', JSON.stringify(after, null, 1));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
