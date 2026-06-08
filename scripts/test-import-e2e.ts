/**
 * End-to-end import test for one contact (Avanzado). Wipes any existing copy,
 * creates a fresh batch + raw_upload, runs the REAL import worker, and prints the
 * resulting people/contact/company state so we can find + fix bugs and iterate.
 *   npx tsx --env-file=.env.local scripts/test-import-e2e.ts
 */
import { createClient } from '@supabase/supabase-js';
import { processQueuedRowsInBackground } from '@/lib/import-queue';

const USER = '3f166004-174b-4fc6-88f0-7cd47332f6ee';
const LINKEDIN = 'https://www.linkedin.com/in/a-avanzado/';

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // 1. Clean slate
  const { data: existing } = await admin.from('people').select('id').ilike('linkedin_url', '%a-avanzado%');
  for (const p of existing ?? []) {
    await admin.from('user_contacts').delete().eq('person_id', (p as { id: string }).id);
    await admin.from('people').delete().eq('id', (p as { id: string }).id);
  }
  console.log(`cleaned ${(existing ?? []).length} existing avanzado person(s)`);

  // 2. Fresh batch + raw_upload (mirrors what the import-contacts route inserts)
  const raw_data = {
    full_name: 'Alexander Avanzado',
    first_name: 'Alexander',
    last_name: 'Avanzado',
    company_name: 'The MT Group',
    company_domain: 'mtgroupbio.com',
    job_title: 'Biospecimen Sourcing & Business Development',
    email: '',
    linkedin_url: LINKEDIN,
    location: '',
    company_linkedin_url: '',
  };
  const { data: batch, error: be } = await admin
    .from('upload_batches')
    .insert({ user_id: USER, filename: 'e2e-test.csv', total_rows: 1, status: 'processing' })
    .select('id').single();
  if (be) throw be;
  const batchId = (batch as { id: string }).id;
  const { data: ru, error: re } = await admin
    .from('raw_uploads')
    .insert({
      user_id: USER, batch_id: batchId, status: 'enriching',
      full_name: 'Alexander Avanzado', email: null, linkedin_url: LINKEDIN,
      company_name: 'The MT Group', raw_data,
    })
    .select('id').single();
  if (re) throw re;
  const rawId = (ru as { id: string }).id;
  console.log(`created raw_upload ${rawId} in batch ${batchId}`);

  // 3. Run the real worker
  console.log('>> running processQueuedRowsInBackground (Apollo → LinkedIn resolve → Apify → bio)...');
  const t0 = Date.now();
  await processQueuedRowsInBackground({
    queuedRows: [{ id: rawId, full_name: 'Alexander Avanzado', email: null, linkedin_url: LINKEDIN, company_name: 'The MT Group', raw_data }],
    batchId,
    userId: USER,
  });
  console.log(`>> worker done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // 4. Read result
  const { data: people } = await admin
    .from('people')
    .select('id, full_name, job_title, company_name, company_id, headline, linkedin_url, linkedin_resolution_status, linkedin_resolution_source, profile_enrichment_status, profile_enrichment_last_error, enrichment_refresh_status, enrichment_refresh_last_error')
    .ilike('linkedin_url', '%a-avanzado%');
  console.log('PEOPLE:', JSON.stringify(people, null, 2));
  const { data: ruFinal } = await admin.from('raw_uploads').select('status, failure_reason').eq('id', rawId).maybeSingle();
  console.log('RAW_UPLOAD:', JSON.stringify(ruFinal));
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e); process.exit(1); });
