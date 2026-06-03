/**
 * One-off: apply the recalibrated fit weights (company_fit_v2) + the new
 * readiness base-impact weights to all existing data for a user.
 *
 *   1. Re-score company + contact fit (rescoreAllContactsForUser).
 *   2. Recompute readiness for every active company + contact (which also
 *      refreshes the readiness_score + priority_score mirrors).
 *
 * Fit first, then readiness — priority = fit × readiness, so readiness must
 * read the new fit.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/apply-scoring-recalibration.ts
 */
import { createAdminClient } from '@/lib/supabase-admin';
import { rescoreAllContactsForUser } from '@/lib/rescore';
import {
  recomputeAccountReadiness,
  recomputeContactReadiness,
} from '@/lib/signals/readiness-service';

const USER_ID = '3f166004-174b-4fc6-88f0-7cd47332f6ee';

async function main() {
  const admin = createAdminClient();

  console.log('1) Re-scoring fit (company + contact) with company_fit_v2 weights…');
  const fit = await rescoreAllContactsForUser(USER_ID);
  console.log('   fit result:', JSON.stringify(fit));

  console.log('2) Recomputing readiness (new base-impact weights + mirror refresh)…');
  const { data: companies } = await admin
    .from('user_companies')
    .select('company_id')
    .eq('user_id', USER_ID)
    .is('archived_at', null);
  let coOk = 0;
  let coFail = 0;
  for (const row of (companies ?? []) as Array<{ company_id: string }>) {
    try {
      await recomputeAccountReadiness(admin, { userId: USER_ID, companyId: row.company_id });
      coOk += 1;
    } catch (e) {
      coFail += 1;
      console.warn('   company fail', row.company_id, e instanceof Error ? e.message : e);
    }
  }
  const { data: contacts } = await admin
    .from('contacts')
    .select('id')
    .eq('user_id', USER_ID)
    .is('archived_at', null);
  let ctOk = 0;
  let ctFail = 0;
  for (const row of (contacts ?? []) as Array<{ id: string }>) {
    try {
      await recomputeContactReadiness(admin, { userId: USER_ID, contactId: row.id });
      ctOk += 1;
    } catch (e) {
      ctFail += 1;
      console.warn('   contact fail', row.id, e instanceof Error ? e.message : e);
    }
  }
  console.log(`   readiness: companies ${coOk} ok / ${coFail} fail · contacts ${ctOk} ok / ${ctFail} fail`);

  console.log('3) Result snapshot (top accounts by fit):');
  const { data: snap } = await admin
    .from('user_companies')
    .select('company_fit_score, readiness_score, priority_score, companies(company_name)')
    .eq('user_id', USER_ID)
    .is('archived_at', null)
    .order('company_fit_score', { ascending: false, nullsFirst: false })
    .limit(25);
  for (const r of (snap ?? []) as Array<{
    company_fit_score: number | null;
    readiness_score: number | null;
    priority_score: number | null;
    companies: { company_name?: string | null } | { company_name?: string | null }[] | null;
  }>) {
    const co = Array.isArray(r.companies) ? r.companies[0] : r.companies;
    const f = (v: number | null) => (typeof v === 'number' ? v.toFixed(2) : '—');
    console.log(
      `   ${(co?.company_name ?? '?').padEnd(38)} fit=${f(r.company_fit_score)}  readiness=${f(r.readiness_score)}  priority=${f(r.priority_score)}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
