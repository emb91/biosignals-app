/**
 * One-off: recompute contact readiness + priority for all of a user's contacts
 * so the new company-readiness fold-in (effectiveReadiness) lands in
 * contacts.priority_score. No LLM, no re-scrape — just re-derives from existing
 * normalized signals + current company readiness. Run AFTER company readiness is
 * current (it already is from apply-scoring-recalibration).
 *
 *   npx tsx --env-file=.env.local scripts/recompute-contact-priority.ts
 */
import { createAdminClient } from '@/lib/supabase-admin';
import { recomputeContactReadiness } from '@/lib/signals/readiness-service';

const USER_ID = '3f166004-174b-4fc6-88f0-7cd47332f6ee';

async function main() {
  const admin = createAdminClient();
  const { data: contacts } = await admin
    .from('contacts')
    .select('id, full_name')
    .eq('user_id', USER_ID)
    .is('archived_at', null);

  const rows = (contacts ?? []) as Array<{ id: string; full_name: string | null }>;
  console.log(`Recomputing priority for ${rows.length} contacts…`);
  let ok = 0;
  let fail = 0;
  for (const c of rows) {
    try {
      await recomputeContactReadiness(admin, { userId: USER_ID, contactId: c.id });
      ok += 1;
    } catch (e) {
      fail += 1;
      console.warn(`  ${c.full_name ?? c.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`Done: ${ok} ok / ${fail} fail`);

  // Snapshot the result so we can eyeball the company-readiness lift.
  const { data: snap } = await admin
    .from('contacts')
    .select('full_name, contact_fit_score, readiness_score, priority_score, companies(company_name)')
    .eq('user_id', USER_ID)
    .is('archived_at', null)
    .order('priority_score', { ascending: false, nullsFirst: false })
    .limit(20);
  for (const r of (snap ?? []) as Array<{
    full_name: string | null;
    contact_fit_score: number | null;
    readiness_score: number | null;
    priority_score: number | null;
    companies: { company_name?: string | null } | { company_name?: string | null }[] | null;
  }>) {
    const co = Array.isArray(r.companies) ? r.companies[0] : r.companies;
    const f = (v: number | null) => (typeof v === 'number' ? v.toFixed(2) : '—');
    console.log(
      `  ${(r.full_name ?? '?').padEnd(26)} @ ${(co?.company_name ?? '?').padEnd(24)} fit=${f(r.contact_fit_score)} readiness=${f(r.readiness_score)} priority=${f(r.priority_score)}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
