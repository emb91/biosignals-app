import { createAdminClient } from '@/lib/supabase-admin';
import { getOrgEntitlements } from '@/lib/billing/entitlements';
import { creditEnforcementEnabled } from '@/lib/billing/credits';
import { SWEEP_FIT_THRESHOLD } from '@/lib/signals/sweep-fit-gate';

type ContactCandidate = {
  id: string;
  user_id: string;
  person_id: string | null;
  company_id: string | null;
  contact_fit_score: number | null;
  priority_score: number | null;
};

export async function refreshMonitoringUniverse(orgId: string): Promise<{
  activeContacts: number;
  waitlistedContacts: number;
  activeAccounts: number;
  waitlistedAccounts: number;
}> {
  const admin = createAdminClient();
  const entitlements = await getOrgEntitlements(orgId);
  if (entitlements.paymentAccessPaused && creditEnforcementEnabled('monitoring')) {
    await Promise.all([
      admin.from('org_monitored_contacts').update({ status: 'paused', updated_at: new Date().toISOString() }).eq('org_id', orgId),
      admin.from('org_monitored_accounts').update({ status: 'paused', updated_at: new Date().toISOString() }).eq('org_id', orgId),
    ]);
    return { activeContacts: 0, waitlistedContacts: 0, activeAccounts: 0, waitlistedAccounts: 0 };
  }
  const { data: members } = await admin.from('org_members').select('user_id').eq('org_id', orgId);
  const userIds = (members ?? []).map((row) => row.user_id as string);
  if (!userIds.length) return { activeContacts: 0, waitlistedContacts: 0, activeAccounts: 0, waitlistedAccounts: 0 };

  const { data: rows, error } = await admin.from('user_contacts')
    .select('id, user_id, person_id, company_id, contact_fit_score, priority_score')
    .in('user_id', userIds)
    .is('archived_at', null)
    .not('person_id', 'is', null)
    .order('priority_score', { ascending: false, nullsFirst: false });
  if (error) throw new Error(`monitoring candidates failed: ${error.message}`);
  const { data: companyLinks } = await admin.from('accounts_view')
    .select('id, company_fit_score, priority_score')
    .eq('user_id', userIds[0])
    .is('archived_at', null)
    .gte('company_fit_score', SWEEP_FIT_THRESHOLD);
  const highFitCompanyIds = new Set((companyLinks ?? []).map((row) => row.id as string));

  const byPerson = new Map<string, ContactCandidate>();
  for (const row of (rows ?? []) as ContactCandidate[]) {
    if (
      !row.person_id ||
      !row.company_id ||
      !highFitCompanyIds.has(row.company_id) ||
      (row.contact_fit_score ?? -1) < SWEEP_FIT_THRESHOLD
    ) continue;
    const current = byPerson.get(row.person_id);
    if (!current || (row.priority_score ?? 0) > (current.priority_score ?? 0)) {
      byPerson.set(row.person_id, row);
    }
  }
  const contacts = [...byPerson.values()].sort(
    (a, b) => (b.priority_score ?? b.contact_fit_score ?? 0) - (a.priority_score ?? a.contact_fit_score ?? 0),
  );
  const contactCap = entitlements.caps.activeMonitoredContacts;
  const now = new Date().toISOString();
  const contactPayload = contacts.map((row, index) => ({
    org_id: orgId,
    person_id: row.person_id,
    status: index < contactCap ? 'active' : 'waitlisted',
    cadence_days: entitlements.caps.monitoringCadenceDays,
    priority_score: row.priority_score ?? row.contact_fit_score,
    updated_at: now,
  }));
  await admin.from('org_monitored_contacts').update({ status: 'ineligible', updated_at: now }).eq('org_id', orgId);
  if (contactPayload.length) {
    const { error: upsertError } = await admin.from('org_monitored_contacts')
      .upsert(contactPayload, { onConflict: 'org_id,person_id' });
    if (upsertError) throw new Error(`contact monitoring refresh failed: ${upsertError.message}`);
  }

  const representedCompanies = new Map<string, number>();
  for (const row of contacts.slice(0, contactCap)) {
    if (!row.company_id) continue;
    representedCompanies.set(
      row.company_id,
      Math.max(representedCompanies.get(row.company_id) ?? 0, row.priority_score ?? row.contact_fit_score ?? 0),
    );
  }
  const accountOnly = new Map<string, number>();
  for (const row of companyLinks ?? []) {
    const companyId = row.id as string;
    if (representedCompanies.has(companyId)) continue;
    accountOnly.set(
      companyId,
      Math.max(
        accountOnly.get(companyId) ?? 0,
        Number(row.priority_score ?? row.company_fit_score ?? 0),
      ),
    );
  }
  const accountCandidates = [
    ...[...representedCompanies.entries()]
      .map(([companyId, priority]) => ({ companyId, priority, represented: true })),
    ...[...accountOnly.entries()]
      .map(([companyId, priority]) => ({ companyId, priority, represented: false }))
      .sort((a, b) => b.priority - a.priority),
  ];
  const accountCap = entitlements.caps.internalMonitoredAccounts;
  const accountPayload = accountCandidates.map((row, index) => ({
    org_id: orgId,
    company_id: row.companyId,
    status: index < accountCap ? 'active' : 'waitlisted',
    cadence_days: entitlements.caps.monitoringCadenceDays,
    priority_score: row.priority,
    represented_by_active_contact: row.represented,
    updated_at: now,
  }));
  await admin.from('org_monitored_accounts').update({ status: 'ineligible', updated_at: now }).eq('org_id', orgId);
  if (accountPayload.length) {
    const { error: upsertError } = await admin.from('org_monitored_accounts')
      .upsert(accountPayload, { onConflict: 'org_id,company_id' });
    if (upsertError) throw new Error(`account monitoring refresh failed: ${upsertError.message}`);
  }

  return {
    activeContacts: Math.min(contactCap, contacts.length),
    waitlistedContacts: Math.max(0, contacts.length - contactCap),
    activeAccounts: Math.min(accountCap, accountCandidates.length),
    waitlistedAccounts: Math.max(0, accountCandidates.length - accountCap),
  };
}

export async function monitoringRepresentativeContacts(orgId: string, limit: number): Promise<Array<{
  userId: string;
  contactId: string;
  personId: string;
  monitorId: string;
  cadenceDays: number;
}>> {
  const admin = createAdminClient();
  const { data: due } = await admin.from('org_monitored_contacts')
    .select('id, person_id, cadence_days')
    .eq('org_id', orgId).eq('status', 'active')
    .lte('next_sweep_at', new Date().toISOString())
    .order('next_sweep_at', { ascending: true }).limit(limit);
  if (!due?.length) return [];
  const { data: members } = await admin.from('org_members').select('user_id').eq('org_id', orgId);
  const userIds = (members ?? []).map((row) => row.user_id as string);
  const personIds = due.map((row) => row.person_id as string);
  const { data: contacts } = await admin.from('user_contacts').select('id, user_id, person_id')
    .in('user_id', userIds).in('person_id', personIds).is('archived_at', null);
  const representative = new Map<string, { id: string; user_id: string }>();
  for (const row of contacts ?? []) {
    if (!representative.has(row.person_id as string)) {
      representative.set(row.person_id as string, { id: row.id as string, user_id: row.user_id as string });
    }
  }
  return due.flatMap((row) => {
    const contact = representative.get(row.person_id as string);
    return contact ? [{
      userId: contact.user_id,
      contactId: contact.id,
      personId: row.person_id as string,
      monitorId: row.id as string,
      cadenceDays: Number(row.cadence_days),
    }] : [];
  });
}

export async function markContactSweep(params: {
  monitorId: string;
  cadenceDays: number;
  status: 'succeeded' | 'failed';
  providerCostUsd?: number;
}): Promise<void> {
  const now = new Date();
  const next = new Date(now.getTime() + params.cadenceDays * 86_400_000);
  const admin = createAdminClient();
  await admin.from('org_monitored_contacts').update({
    last_sweep_at: now.toISOString(),
    next_sweep_at: next.toISOString(),
    last_sweep_status: params.status,
    last_provider_cost_usd: params.providerCostUsd ?? null,
    updated_at: now.toISOString(),
  }).eq('id', params.monitorId);
}

export async function monitoringRepresentativeAccounts(orgId: string, limit: number): Promise<Array<{
  userId: string;
  companyId: string;
  monitorId: string;
  cadenceDays: number;
}>> {
  const admin = createAdminClient();
  const { data: due } = await admin.from('org_monitored_accounts')
    .select('id, company_id, cadence_days')
    .eq('org_id', orgId).eq('status', 'active')
    .lte('next_sweep_at', new Date().toISOString())
    .order('next_sweep_at', { ascending: true }).limit(limit);
  if (!due?.length) return [];
  const { data: members } = await admin.from('org_members').select('user_id').eq('org_id', orgId);
  const userIds = (members ?? []).map((row) => row.user_id as string);
  const companyIds = due.map((row) => row.company_id as string);
  const representativeUserId = userIds[0] ?? null;
  return due.flatMap((row) => {
    return representativeUserId && companyIds.includes(row.company_id as string) ? [{
      userId: representativeUserId,
      companyId: row.company_id as string,
      monitorId: row.id as string,
      cadenceDays: Number(row.cadence_days),
    }] : [];
  });
}

export async function markAccountSweep(params: {
  monitorId: string;
  cadenceDays: number;
  status: 'succeeded' | 'failed';
  resultCount?: number;
  providerCostUsd?: number;
}): Promise<void> {
  const now = new Date();
  const next = new Date(now.getTime() + params.cadenceDays * 86_400_000);
  const admin = createAdminClient();
  await admin.from('org_monitored_accounts').update({
    last_sweep_at: now.toISOString(),
    next_sweep_at: next.toISOString(),
    last_sweep_status: params.status,
    last_result_count: params.resultCount ?? null,
    last_provider_cost_usd: params.providerCostUsd ?? null,
    updated_at: now.toISOString(),
  }).eq('id', params.monitorId);
}
