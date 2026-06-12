/**
 * One-off repair after the Anthropic credit outage (May 4 – Jun 8 2026).
 *
 * Companies enriched during the outage got empty/partial taxonomy + funding
 * because the company monitor's LLM calls were Anthropic-direct with no
 * fallback (OpenRouter web-search fallback landed Jun 9, commit 3abfccb).
 * Re-runs runCompanyMonitor for every company of this user that still carries
 * a funding_resolution_last_error, then recomputes Alexander Avanzado's
 * contact readiness so his priority_score populates now that his company_id
 * is linked to Sanguine.
 *
 *   npx tsx --env-file=.env.local scripts/rerun-monitor-credit-outage.ts
 */
import { createClient } from '@supabase/supabase-js';
import { runCompanyMonitor } from '@/lib/company-monitor';
import { recomputeContactReadiness } from '@/lib/signals/readiness-service';

const USER = '3f166004-174b-4fc6-88f0-7cd47332f6ee';
const AVANZADO_CONTACT_ID = 'caacf125-fa15-4111-a937-edd12df872d5';

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: companies, error } = await admin
    .from('companies')
    .select('id, company_name, domain, funding_resolution_last_error, user_companies!inner(user_id)')
    .eq('user_companies.user_id', USER)
    .not('funding_resolution_last_error', 'is', null);
  if (error) throw error;

  console.log(`${companies?.length ?? 0} companies with stale monitor errors\n`);

  for (const row of companies ?? []) {
    const c = row as { id: string; company_name: string; domain: string | null };
    process.stdout.write(`→ ${c.company_name} (${c.domain ?? 'no domain'}) … `);
    try {
      const result = await runCompanyMonitor(
        admin as unknown as Parameters<typeof runCompanyMonitor>[0],
        { company_id: c.id, company_name: c.company_name, domain: c.domain },
      );
      const tax = result.taxonomy;
      const fund = result.funding;
      console.log(
        `taxonomy: ${tax ? `${tax.therapeutic_areas.length} TA / ${tax.modalities.length} mod (${tax.confidence})` : 'skipped'}; ` +
        `funding: ${fund ? `${fund.current ?? 'null'} (${fund.confidence})` : 'skipped'}; ` +
        `errors: ${result.errors.length ? result.errors.join(' | ').slice(0, 120) : 'none'}`,
      );
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message.slice(0, 160) : err}`);
    }
  }

  process.stdout.write('\n→ recompute Avanzado readiness/priority … ');
  const readiness = await recomputeContactReadiness(
    admin as unknown as Parameters<typeof recomputeContactReadiness>[0],
    { userId: USER, contactId: AVANZADO_CONTACT_ID },
  );
  console.log(`done (readiness ${readiness.overallScore})`);

  const { data: alex } = await admin
    .from('contacts')
    .select('priority_score, readiness_score')
    .eq('id', AVANZADO_CONTACT_ID)
    .single();
  console.log(`Avanzado now: priority=${alex?.priority_score}, readiness=${alex?.readiness_score}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
