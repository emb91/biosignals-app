import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { isAdminEmail } from '@/lib/admin-access';

export async function GET() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createAdminClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const now = new Date().toISOString();
  const [
    organizations,
    apifyRuns,
    transactions,
    monitoredContacts,
    monitoredAccounts,
  ] = await Promise.all([
    admin.from('organizations').select('id, name'),
    admin.from('apify_run_usage')
      .select('org_id, actor_id, action_type, input_count, output_count, attempted_count, successful_count, failed_count, actual_cost_usd, included_monitoring, created_at')
      .gte('created_at', since),
    admin.from('org_credit_transactions')
      .select('org_id, action_type, status, credits_reserved, credits_settled, created_at')
      .gte('created_at', since),
    admin.from('org_monitored_contacts')
      .select('org_id, status, next_sweep_at, last_sweep_status'),
    admin.from('org_monitored_accounts')
      .select('org_id, status, next_sweep_at, last_sweep_status, last_result_count'),
  ]);

  const orgNames = new Map((organizations.data ?? []).map((row) => [row.id as string, row.name as string]));
  const orgIds = new Set<string>();
  for (const collection of [apifyRuns.data, transactions.data, monitoredContacts.data, monitoredAccounts.data]) {
    for (const row of collection ?? []) if (row.org_id) orgIds.add(row.org_id as string);
  }

  const workspaces = [...orgIds].map((orgId) => {
    const runs = (apifyRuns.data ?? []).filter((row) => row.org_id === orgId);
    const txs = (transactions.data ?? []).filter((row) => row.org_id === orgId);
    const contacts = (monitoredContacts.data ?? []).filter((row) => row.org_id === orgId);
    const accounts = (monitoredAccounts.data ?? []).filter((row) => row.org_id === orgId);
    const activeContacts = contacts.filter((row) => row.status === 'active');
    const activeAccounts = accounts.filter((row) => row.status === 'active');
    const dueContacts = activeContacts.filter((row) => row.next_sweep_at && row.next_sweep_at <= now);
    const dueAccounts = activeAccounts.filter((row) => row.next_sweep_at && row.next_sweep_at <= now);
    const attemptedContacts = runs
      .filter((row) => row.action_type === 'contact_job_change_monitoring')
      .reduce((sum, row) => sum + Number(row.attempted_count ?? 0), 0);
    const attemptedAccounts = runs
      .filter((row) => row.action_type === 'company_hiring_monitoring')
      .reduce((sum, row) => sum + Number(row.attempted_count ?? 0), 0);
    return {
      orgId,
      name: orgNames.get(orgId) ?? null,
      last30Days: {
        customerCreditsSettled: txs.reduce((sum, row) => sum + Number(row.credits_settled ?? 0), 0),
        providerCostUsd: runs.reduce((sum, row) => sum + Number(row.actual_cost_usd ?? 0), 0),
        profilesAttempted: attemptedContacts,
        companiesAttempted: attemptedAccounts,
        jobsReturned: runs
          .filter((row) => row.action_type === 'company_hiring_monitoring')
          .reduce((sum, row) => sum + Number(row.output_count ?? 0), 0),
      },
      monitoring: {
        activeContacts: activeContacts.length,
        waitlistedContacts: contacts.filter((row) => row.status === 'waitlisted').length,
        dueContacts: dueContacts.length,
        activeAccounts: activeAccounts.length,
        waitlistedAccounts: accounts.filter((row) => row.status === 'waitlisted').length,
        dueAccounts: dueAccounts.length,
        contactCoverageSlaPct: activeContacts.length
          ? Math.round(((activeContacts.length - dueContacts.length) / activeContacts.length) * 10_000) / 100
          : 100,
        accountCoverageSlaPct: activeAccounts.length
          ? Math.round(((activeAccounts.length - dueAccounts.length) / activeAccounts.length) * 10_000) / 100
          : 100,
      },
    };
  });

  return NextResponse.json({ since, generatedAt: now, workspaces });
}
