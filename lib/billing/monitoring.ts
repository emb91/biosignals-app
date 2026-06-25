import { createAdminClient } from '@/lib/supabase-admin';
import { getOrgEntitlements } from '@/lib/billing/entitlements';
import { creditEnforcementEnabled } from '@/lib/billing/credits';
import { FREE_TIER } from '@/lib/billing/config';
import { SWEEP_FIT_THRESHOLD } from '@/lib/signals/sweep-fit-gate';
import { lookbackDaysForCadence } from '@/lib/signals/monitor-cadence-rules';
import {
  ACCOUNT_SWEEP_SOURCES,
  CONTACT_SWEEP_SOURCES,
  type AccountSweepSource,
  type ContactSweepSource,
} from '@/lib/billing/monitoring-sources';

export {
  ACCOUNT_SWEEP_SOURCES,
  CONTACT_SWEEP_SOURCES,
  type AccountSweepSource,
  type ContactSweepSource,
} from '@/lib/billing/monitoring-sources';

type AdminClient = ReturnType<typeof createAdminClient>;

type MonitorStatus = 'active' | 'waitlisted' | 'paused' | 'ineligible';

type ContactCandidate = {
  id: string;
  user_id: string;
  person_id: string | null;
  company_id: string | null;
  contact_fit_score: number | null;
  priority_score: number | null;
};

type AccountMonitorRow = {
  org_id: string;
  company_id: string;
  status: MonitorStatus;
  cadence_days: number;
  priority_score: number | null;
  represented_by_active_contact: boolean;
};

type ContactMonitorRow = {
  org_id: string;
  person_id: string;
  status: MonitorStatus;
  cadence_days: number;
  priority_score: number | null;
};

type SweepTargetRow = {
  effective_cadence_days: number;
  last_sweep_at: string | null;
  next_sweep_at: string;
};

type SharedAccountSweepTargetRow = {
  company_id: string;
  source: AccountSweepSource;
  effective_cadence_days: number;
  active_subscriber_count: number;
  fastest_org_id: string | null;
};

type SharedContactSweepTargetRow = {
  person_id: string;
  source: ContactSweepSource;
  effective_cadence_days: number;
  active_subscriber_count: number;
  fastest_org_id: string | null;
};

type AccountSubscriberSweepRow = {
  org_id: string;
  company_id: string;
  source: AccountSweepSource;
  status: MonitorStatus;
  cadence_days: number;
  last_sweep_at: string | null;
  next_sweep_at: string;
};

type ContactSubscriberSweepRow = {
  org_id: string;
  person_id: string;
  source: ContactSweepSource;
  status: MonitorStatus;
  cadence_days: number;
  last_sweep_at: string | null;
  next_sweep_at: string;
};

type LegacyAccountSweepRow = {
  org_id: string;
  company_id: string;
  cadence_days: number;
  last_sweep_at: string | null;
  next_sweep_at: string;
};

type LegacyContactSweepRow = {
  org_id: string;
  person_id: string;
  cadence_days: number;
  last_sweep_at: string | null;
  next_sweep_at: string;
};

type ContactSweepRunner = ContactSweepSource | 'conference-presenters' | 'conference-social';

function contactSweepSourceForRunner(runner: ContactSweepRunner): ContactSweepSource {
  if (runner === 'conference-presenters') return 'conference_presenters';
  if (runner === 'conference-social') return 'conference_social';
  return runner;
}

export type DueAccountSweepTarget = {
  companyId: string;
  source: AccountSweepSource;
  cadenceDays: number;
  lookbackDays: number;
  activeSubscriberCount: number;
  fastestOrgId: string | null;
};

export type DueContactSweepTarget = {
  personId: string;
  source: ContactSweepSource;
  cadenceDays: number;
  lookbackDays: number;
  activeSubscriberCount: number;
  fastestOrgId: string | null;
};

export type AccountSweepSubscriber = {
  orgId: string;
  userId: string;
  companyId: string;
  source: AccountSweepSource;
  monitorId: string | null;
  cadenceDays: number;
  lookbackDays: number;
};

export type ContactSweepSubscriber = {
  orgId: string;
  userId: string;
  contactId: string;
  personId: string;
  companyId: string | null;
  source: ContactSweepSource;
  monitorId: string | null;
  cadenceDays: number;
  lookbackDays: number;
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
    await reconcileSharedMonitoringCadenceForOrg(admin, orgId).catch((error) => {
      console.warn('[monitoring] shared cadence reconciliation skipped after pause:', error);
    });
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

  await reconcileSharedMonitoringCadenceForOrg(admin, orgId).catch((error) => {
    console.warn('[monitoring] shared cadence reconciliation skipped:', error);
  });

  return {
    activeContacts: Math.min(contactCap, contacts.length),
    waitlistedContacts: Math.max(0, contacts.length - contactCap),
    activeAccounts: Math.min(accountCap, accountCandidates.length),
    waitlistedAccounts: Math.max(0, accountCandidates.length - accountCap),
  };
}

export async function reconcileMonitoringAfterBillingChange(
  orgId: string,
  reason: string,
): Promise<void> {
  try {
    await refreshMonitoringUniverse(orgId);
  } catch (error) {
    console.warn(`[billing] monitoring reconciliation skipped after ${reason}:`, error);
  }
}

export async function refreshAllMonitoringUniverses(): Promise<Array<{ org_id: string; error: string }>> {
  const admin = createAdminClient();
  const { data: orgRows, error } = await admin.from('organizations').select('id');
  if (error) throw new Error(`organization read failed: ${error.message}`);
  const failures: Array<{ org_id: string; error: string }> = [];
  for (const org of orgRows ?? []) {
    const orgId = org.id as string;
    try {
      await refreshMonitoringUniverse(orgId);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      failures.push({ org_id: orgId, error: message });
      console.error(`[monitoring] org ${orgId} refresh failed:`, caught);
    }
  }
  return failures;
}

async function reconcileSharedMonitoringCadenceForOrg(
  admin: AdminClient,
  orgId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const [accountsResult, contactsResult] = await Promise.all([
    admin.from('org_monitored_accounts')
      .select('org_id, company_id, status, cadence_days, priority_score, represented_by_active_contact')
      .eq('org_id', orgId),
    admin.from('org_monitored_contacts')
      .select('org_id, person_id, status, cadence_days, priority_score')
      .eq('org_id', orgId),
  ]);
  if (accountsResult.error) throw new Error(`account subscribers read failed: ${accountsResult.error.message}`);
  if (contactsResult.error) throw new Error(`contact subscribers read failed: ${contactsResult.error.message}`);

  const accountRows = ((accountsResult.data ?? []) as AccountMonitorRow[])
    .filter((row) => row.company_id)
    .map((row) => ({
      org_id: row.org_id,
      company_id: row.company_id,
      status: row.status,
      cadence_days: row.cadence_days,
      priority_score: row.priority_score,
      represented_by_active_contact: row.represented_by_active_contact,
      updated_at: now,
    }));
  if (accountRows.length) {
    const { error } = await admin.from('monitored_account_subscribers')
      .upsert(accountRows, { onConflict: 'org_id,company_id' });
    if (error) throw new Error(`account subscriber sync failed: ${error.message}`);
    await reconcileAccountSweepTargets(admin, [...new Set(accountRows.map((row) => row.company_id))]);
  }

  const contactRows = ((contactsResult.data ?? []) as ContactMonitorRow[])
    .filter((row) => row.person_id)
    .map((row) => ({
      org_id: row.org_id,
      person_id: row.person_id,
      status: row.status,
      cadence_days: row.cadence_days,
      priority_score: row.priority_score,
      updated_at: now,
    }));
  if (contactRows.length) {
    const { error } = await admin.from('monitored_contact_subscribers')
      .upsert(contactRows, { onConflict: 'org_id,person_id' });
    if (error) throw new Error(`contact subscriber sync failed: ${error.message}`);
    await reconcileContactSweepTargets(admin, [...new Set(contactRows.map((row) => row.person_id))]);
  }
}

async function reconcileAccountSweepTargets(
  admin: AdminClient,
  companyIds: string[],
): Promise<void> {
  if (!companyIds.length) return;
  const now = new Date().toISOString();
  const [
    { data: subscriberRows, error: subscriberRowsError },
    { data: activeSubscribers, error: activeSubscribersError },
    { data: targets, error: targetsError },
    { data: subscriberSweeps, error: subscriberSweepsError },
    { data: legacySweeps, error: legacySweepsError },
  ] = await Promise.all([
    admin.from('monitored_account_subscribers')
      .select('org_id, company_id, status, cadence_days')
      .in('company_id', companyIds),
    admin.from('monitored_account_subscribers')
      .select('org_id, company_id, cadence_days')
      .in('company_id', companyIds)
      .eq('status', 'active'),
    admin.from('account_source_sweep_targets')
      .select('company_id, source, effective_cadence_days, last_sweep_at, next_sweep_at')
      .in('company_id', companyIds)
      .in('source', [...ACCOUNT_SWEEP_SOURCES]),
    admin.from('account_source_subscriber_sweeps')
      .select('org_id, company_id, source, status, cadence_days, last_sweep_at, next_sweep_at')
      .in('company_id', companyIds)
      .in('source', [...ACCOUNT_SWEEP_SOURCES]),
    admin.from('org_monitored_accounts')
      .select('org_id, company_id, cadence_days, last_sweep_at, next_sweep_at')
      .in('company_id', companyIds),
  ]);
  if (subscriberRowsError) throw new Error(`account subscriber read failed: ${subscriberRowsError.message}`);
  if (activeSubscribersError) throw new Error(`account active subscriber read failed: ${activeSubscribersError.message}`);
  if (targetsError) throw new Error(`account target read failed: ${targetsError.message}`);
  if (subscriberSweepsError) throw new Error(`account subscriber sweep read failed: ${subscriberSweepsError.message}`);
  if (legacySweepsError) throw new Error(`legacy account sweep read failed: ${legacySweepsError.message}`);

  const subscriberSweepByKey = new Map<string, SweepTargetRow>();
  for (const row of subscriberSweeps ?? []) {
    subscriberSweepByKey.set(`${row.org_id}:${row.company_id}:${row.source}`, {
      effective_cadence_days: Number(row.cadence_days),
      last_sweep_at: (row.last_sweep_at as string | null | undefined) ?? null,
      next_sweep_at: row.next_sweep_at as string,
    });
  }
  const legacySweepByKey = new Map<string, SweepTargetRow>();
  for (const row of (legacySweeps ?? []) as LegacyAccountSweepRow[]) {
    legacySweepByKey.set(`${row.org_id}:${row.company_id}`, {
      effective_cadence_days: Number(row.cadence_days),
      last_sweep_at: row.last_sweep_at,
      next_sweep_at: row.next_sweep_at,
    });
  }
  const subscriberSweepPayload = ((subscriberRows ?? []) as Array<{
    org_id: string;
    company_id: string;
    status: MonitorStatus;
    cadence_days: number;
  }>).flatMap((row) => ACCOUNT_SWEEP_SOURCES.map((source) => {
    const existing = subscriberSweepByKey.get(`${row.org_id}:${row.company_id}:${source}`);
    const fallback = existing ?? legacySweepByKey.get(`${row.org_id}:${row.company_id}`);
    return {
      org_id: row.org_id,
      company_id: row.company_id,
      source,
      status: row.status,
      cadence_days: Number(row.cadence_days),
      next_sweep_at: row.status === 'active'
        ? nextSweepAtForCadence(fallback, Number(row.cadence_days), now)
        : now,
      updated_at: now,
    };
  }));
  if (subscriberSweepPayload.length) {
    const { error } = await admin.from('account_source_subscriber_sweeps')
      .upsert(subscriberSweepPayload, { onConflict: 'org_id,company_id,source' });
    if (error) throw new Error(`account subscriber sweep sync failed: ${error.message}`);
  }

  const activeByCompany = new Map<string, Array<{ orgId: string; cadenceDays: number; nextSweepAt: string }>>();
  for (const row of activeSubscribers ?? []) {
    const companyId = row.company_id as string;
    const orgId = row.org_id as string;
    const cadenceDays = Number(row.cadence_days);
    const legacy = legacySweepByKey.get(`${orgId}:${companyId}`);
    const list = activeByCompany.get(companyId) ?? [];
    list.push({
      orgId,
      cadenceDays,
      nextSweepAt: nextSweepAtForCadence(legacy, cadenceDays, now),
    });
    activeByCompany.set(companyId, list);
  }
  const targetByKey = new Map<string, SweepTargetRow>();
  for (const row of targets ?? []) {
    targetByKey.set(`${row.company_id}:${row.source}`, row as SweepTargetRow);
  }

  const payload = companyIds.flatMap((companyId) => {
    const active = activeByCompany.get(companyId) ?? [];
    if (!active.length) {
      return ACCOUNT_SWEEP_SOURCES.map((source) => ({
        company_id: companyId,
        source,
        status: 'no_subscribers',
        effective_cadence_days: FREE_TIER.caps.monitoringCadenceDays,
        active_subscriber_count: 0,
        fastest_org_id: null as string | null,
        next_sweep_at: now,
        updated_at: now,
      }));
    }
    const fastest = active.reduce((winner, row) => (
      row.cadenceDays < winner.cadenceDays ? row : winner
    ), active[0]);
    return ACCOUNT_SWEEP_SOURCES.map((source) => {
      const existing = targetByKey.get(`${companyId}:${source}`);
      const earliestSubscriberNext = active.reduce((earliest, row) => (
        row.nextSweepAt < earliest ? row.nextSweepAt : earliest
      ), active[0].nextSweepAt);
      const fallback = existing ?? {
        effective_cadence_days: fastest.cadenceDays,
        last_sweep_at: null,
        next_sweep_at: earliestSubscriberNext,
      };
      return {
        company_id: companyId,
        source,
        status: 'active',
        effective_cadence_days: fastest.cadenceDays,
        active_subscriber_count: active.length,
        fastest_org_id: fastest.orgId as string | null,
        next_sweep_at: nextSweepAtForCadence(fallback, fastest.cadenceDays, now),
        updated_at: now,
      };
    });
  });

  const { error } = await admin.from('account_source_sweep_targets')
    .upsert(payload, { onConflict: 'company_id,source' });
  if (error) throw new Error(`account target sync failed: ${error.message}`);
}

async function reconcileContactSweepTargets(
  admin: AdminClient,
  personIds: string[],
): Promise<void> {
  if (!personIds.length) return;
  const now = new Date().toISOString();
  const [
    { data: subscriberRows, error: subscriberRowsError },
    { data: activeSubscribers, error: activeSubscribersError },
    { data: targets, error: targetsError },
    { data: subscriberSweeps, error: subscriberSweepsError },
    { data: legacySweeps, error: legacySweepsError },
  ] = await Promise.all([
    admin.from('monitored_contact_subscribers')
      .select('org_id, person_id, status, cadence_days')
      .in('person_id', personIds),
    admin.from('monitored_contact_subscribers')
      .select('org_id, person_id, cadence_days')
      .in('person_id', personIds)
      .eq('status', 'active'),
    admin.from('contact_source_sweep_targets')
      .select('person_id, source, effective_cadence_days, last_sweep_at, next_sweep_at')
      .in('person_id', personIds)
      .in('source', [...CONTACT_SWEEP_SOURCES]),
    admin.from('contact_source_subscriber_sweeps')
      .select('org_id, person_id, source, status, cadence_days, last_sweep_at, next_sweep_at')
      .in('person_id', personIds)
      .in('source', [...CONTACT_SWEEP_SOURCES]),
    admin.from('org_monitored_contacts')
      .select('org_id, person_id, cadence_days, last_sweep_at, next_sweep_at')
      .in('person_id', personIds),
  ]);
  if (subscriberRowsError) throw new Error(`contact subscriber read failed: ${subscriberRowsError.message}`);
  if (activeSubscribersError) throw new Error(`contact active subscriber read failed: ${activeSubscribersError.message}`);
  if (targetsError) throw new Error(`contact target read failed: ${targetsError.message}`);
  if (subscriberSweepsError) throw new Error(`contact subscriber sweep read failed: ${subscriberSweepsError.message}`);
  if (legacySweepsError) throw new Error(`legacy contact sweep read failed: ${legacySweepsError.message}`);

  const subscriberSweepByKey = new Map<string, SweepTargetRow>();
  for (const row of subscriberSweeps ?? []) {
    subscriberSweepByKey.set(`${row.org_id}:${row.person_id}:${row.source}`, {
      effective_cadence_days: Number(row.cadence_days),
      last_sweep_at: (row.last_sweep_at as string | null | undefined) ?? null,
      next_sweep_at: row.next_sweep_at as string,
    });
  }
  const legacySweepByKey = new Map<string, SweepTargetRow>();
  for (const row of (legacySweeps ?? []) as LegacyContactSweepRow[]) {
    legacySweepByKey.set(`${row.org_id}:${row.person_id}`, {
      effective_cadence_days: Number(row.cadence_days),
      last_sweep_at: row.last_sweep_at,
      next_sweep_at: row.next_sweep_at,
    });
  }
  const subscriberSweepPayload = ((subscriberRows ?? []) as Array<{
    org_id: string;
    person_id: string;
    status: MonitorStatus;
    cadence_days: number;
  }>).flatMap((row) => CONTACT_SWEEP_SOURCES.map((source) => {
    const existing = subscriberSweepByKey.get(`${row.org_id}:${row.person_id}:${source}`);
    const fallback = existing ?? legacySweepByKey.get(`${row.org_id}:${row.person_id}`);
    return {
      org_id: row.org_id,
      person_id: row.person_id,
      source,
      status: row.status,
      cadence_days: Number(row.cadence_days),
      next_sweep_at: row.status === 'active'
        ? nextSweepAtForCadence(fallback, Number(row.cadence_days), now)
        : now,
      updated_at: now,
    };
  }));
  if (subscriberSweepPayload.length) {
    const { error } = await admin.from('contact_source_subscriber_sweeps')
      .upsert(subscriberSweepPayload, { onConflict: 'org_id,person_id,source' });
    if (error) throw new Error(`contact subscriber sweep sync failed: ${error.message}`);
  }

  const activeByPerson = new Map<string, Array<{ orgId: string; cadenceDays: number; nextSweepAt: string }>>();
  for (const row of activeSubscribers ?? []) {
    const personId = row.person_id as string;
    const orgId = row.org_id as string;
    const cadenceDays = Number(row.cadence_days);
    const legacy = legacySweepByKey.get(`${orgId}:${personId}`);
    const list = activeByPerson.get(personId) ?? [];
    list.push({
      orgId,
      cadenceDays,
      nextSweepAt: nextSweepAtForCadence(legacy, cadenceDays, now),
    });
    activeByPerson.set(personId, list);
  }
  const targetByKey = new Map<string, SweepTargetRow>();
  for (const row of targets ?? []) {
    targetByKey.set(`${row.person_id}:${row.source}`, row as SweepTargetRow);
  }

  const payload = personIds.flatMap((personId) => {
    const active = activeByPerson.get(personId) ?? [];
    if (!active.length) {
      return CONTACT_SWEEP_SOURCES.map((source) => ({
        person_id: personId,
        source,
        status: 'no_subscribers',
        effective_cadence_days: FREE_TIER.caps.monitoringCadenceDays,
        active_subscriber_count: 0,
        fastest_org_id: null as string | null,
        next_sweep_at: now,
        updated_at: now,
      }));
    }
    const fastest = active.reduce((winner, row) => (
      row.cadenceDays < winner.cadenceDays ? row : winner
    ), active[0]);
    return CONTACT_SWEEP_SOURCES.map((source) => {
      const existing = targetByKey.get(`${personId}:${source}`);
      const earliestSubscriberNext = active.reduce((earliest, row) => (
        row.nextSweepAt < earliest ? row.nextSweepAt : earliest
      ), active[0].nextSweepAt);
      const fallback = existing ?? {
        effective_cadence_days: fastest.cadenceDays,
        last_sweep_at: null,
        next_sweep_at: earliestSubscriberNext,
      };
      return {
        person_id: personId,
        source,
        status: 'active',
        effective_cadence_days: fastest.cadenceDays,
        active_subscriber_count: active.length,
        fastest_org_id: fastest.orgId as string | null,
        next_sweep_at: nextSweepAtForCadence(fallback, fastest.cadenceDays, now),
        updated_at: now,
      };
    });
  });

  const { error } = await admin.from('contact_source_sweep_targets')
    .upsert(payload, { onConflict: 'person_id,source' });
  if (error) throw new Error(`contact target sync failed: ${error.message}`);
}

function nextSweepAtForCadence(
  existing: SweepTargetRow | undefined,
  cadenceDays: number,
  nowIso: string,
): string {
  if (!existing) return nowIso;
  if (existing.last_sweep_at) {
    const next = new Date(new Date(existing.last_sweep_at).getTime() + cadenceDays * 86_400_000);
    return next <= new Date(nowIso) ? nowIso : next.toISOString();
  }
  if (cadenceDays < existing.effective_cadence_days) return nowIso;
  return existing.next_sweep_at;
}

export async function listDueAccountSweepTargets(params: {
  source: AccountSweepSource;
  limit: number;
  now?: Date;
}): Promise<DueAccountSweepTarget[]> {
  const admin = createAdminClient();
  const now = params.now ?? new Date();
  const { data, error } = await admin.from('account_source_sweep_targets')
    .select('company_id, source, effective_cadence_days, active_subscriber_count, fastest_org_id')
    .eq('source', params.source)
    .eq('status', 'active')
    .lte('next_sweep_at', now.toISOString())
    .order('next_sweep_at', { ascending: true })
    .limit(Math.max(1, params.limit));
  if (error) throw new Error(`account sweep target read failed: ${error.message}`);
  return ((data ?? []) as SharedAccountSweepTargetRow[]).map((row) => ({
    companyId: row.company_id,
    source: row.source,
    cadenceDays: Number(row.effective_cadence_days),
    lookbackDays: lookbackDaysForCadence(Number(row.effective_cadence_days)),
    activeSubscriberCount: Number(row.active_subscriber_count ?? 0),
    fastestOrgId: row.fastest_org_id,
  }));
}

export async function listDueContactSweepTargets(params: {
  source: ContactSweepSource;
  limit: number;
  now?: Date;
}): Promise<DueContactSweepTarget[]> {
  const admin = createAdminClient();
  const now = params.now ?? new Date();
  const { data, error } = await admin.from('contact_source_sweep_targets')
    .select('person_id, source, effective_cadence_days, active_subscriber_count, fastest_org_id')
    .eq('source', params.source)
    .eq('status', 'active')
    .lte('next_sweep_at', now.toISOString())
    .order('next_sweep_at', { ascending: true })
    .limit(Math.max(1, params.limit));
  if (error) throw new Error(`contact sweep target read failed: ${error.message}`);
  return ((data ?? []) as SharedContactSweepTargetRow[]).map((row) => ({
    personId: row.person_id,
    source: row.source,
    cadenceDays: Number(row.effective_cadence_days),
    lookbackDays: lookbackDaysForCadence(Number(row.effective_cadence_days)),
    activeSubscriberCount: Number(row.active_subscriber_count ?? 0),
    fastestOrgId: row.fastest_org_id,
  }));
}

async function orgMembersByOrg(
  admin: AdminClient,
  orgIds: string[],
): Promise<Map<string, string[]>> {
  const byOrg = new Map<string, string[]>();
  const uniqueOrgIds = [...new Set(orgIds)].filter(Boolean);
  if (!uniqueOrgIds.length) return byOrg;
  const { data, error } = await admin.from('org_members')
    .select('org_id, user_id')
    .in('org_id', uniqueOrgIds);
  if (error) throw new Error(`org members read failed: ${error.message}`);
  for (const row of data ?? []) {
    const orgId = row.org_id as string;
    const userId = row.user_id as string;
    if (!orgId || !userId) continue;
    const list = byOrg.get(orgId) ?? [];
    list.push(userId);
    byOrg.set(orgId, list);
  }
  return byOrg;
}

export async function accountSweepSubscribersForTargets(params: {
  companyIds: string[];
  runner: AccountSweepSource;
  now?: Date;
}): Promise<AccountSweepSubscriber[]> {
  const companyIds = [...new Set(params.companyIds)].filter(Boolean);
  if (!companyIds.length) return [];
  const admin = createAdminClient();
  const now = params.now ?? new Date();
  const [
    { data: subscribers, error: subscribersError },
    { data: monitors, error: monitorsError },
    { data: dueSweeps, error: dueSweepsError },
  ] = await Promise.all([
    admin.from('monitored_account_subscribers')
      .select('org_id, company_id, cadence_days')
      .in('company_id', companyIds)
      .eq('status', 'active'),
    admin.from('org_monitored_accounts')
      .select('id, org_id, company_id')
      .in('company_id', companyIds)
      .eq('status', 'active'),
    admin.from('account_source_subscriber_sweeps')
      .select('org_id, company_id, source, status, cadence_days, last_sweep_at, next_sweep_at')
      .in('company_id', companyIds)
      .eq('source', params.runner)
      .eq('status', 'active')
      .lte('next_sweep_at', now.toISOString()),
  ]);
  if (subscribersError) throw new Error(`account subscribers read failed: ${subscribersError.message}`);
  if (monitorsError) throw new Error(`account monitors read failed: ${monitorsError.message}`);
  if (dueSweepsError) throw new Error(`account subscriber sweep read failed: ${dueSweepsError.message}`);

  const subscriberRows = (subscribers ?? []) as Array<{ org_id: string; company_id: string; cadence_days: number }>;
  const dueSweepByKey = new Map<string, AccountSubscriberSweepRow>();
  for (const row of (dueSweeps ?? []) as AccountSubscriberSweepRow[]) {
    dueSweepByKey.set(`${row.org_id}:${row.company_id}`, row);
  }
  const members = await orgMembersByOrg(admin, subscriberRows.map((row) => row.org_id));
  const monitorByKey = new Map<string, string>();
  for (const row of monitors ?? []) {
    monitorByKey.set(`${row.org_id}:${row.company_id}`, row.id as string);
  }
  const candidates = subscriberRows.flatMap((row) => {
    const sweep = dueSweepByKey.get(`${row.org_id}:${row.company_id}`);
    if (!sweep) return [];
    const userIds = members.get(row.org_id) ?? [];
    return userIds.map((userId) => ({ row, userId, cadenceDays: Number(sweep.cadence_days) }));
  });
  return candidates
    .map(({ row, userId, cadenceDays }) => ({
      orgId: row.org_id,
      userId,
      companyId: row.company_id,
      source: params.runner,
      monitorId: monitorByKey.get(`${row.org_id}:${row.company_id}`) ?? null,
      cadenceDays,
      lookbackDays: lookbackDaysForCadence(cadenceDays),
    }));
}

export async function contactSweepSubscribersForTargets(params: {
  personIds: string[];
  runner: ContactSweepRunner;
  now?: Date;
}): Promise<ContactSweepSubscriber[]> {
  const personIds = [...new Set(params.personIds)].filter(Boolean);
  if (!personIds.length) return [];
  const admin = createAdminClient();
  const now = params.now ?? new Date();
  const source = contactSweepSourceForRunner(params.runner);
  const [
    { data: subscribers, error: subscribersError },
    { data: monitors, error: monitorsError },
    { data: dueSweeps, error: dueSweepsError },
  ] = await Promise.all([
    admin.from('monitored_contact_subscribers')
      .select('org_id, person_id, cadence_days')
      .in('person_id', personIds)
      .eq('status', 'active'),
    admin.from('org_monitored_contacts')
      .select('id, org_id, person_id')
      .in('person_id', personIds)
      .eq('status', 'active'),
    admin.from('contact_source_subscriber_sweeps')
      .select('org_id, person_id, source, status, cadence_days, last_sweep_at, next_sweep_at')
      .in('person_id', personIds)
      .eq('source', source)
      .eq('status', 'active')
      .lte('next_sweep_at', now.toISOString()),
  ]);
  if (subscribersError) throw new Error(`contact subscribers read failed: ${subscribersError.message}`);
  if (monitorsError) throw new Error(`contact monitors read failed: ${monitorsError.message}`);
  if (dueSweepsError) throw new Error(`contact subscriber sweep read failed: ${dueSweepsError.message}`);

  const subscriberRows = (subscribers ?? []) as Array<{ org_id: string; person_id: string; cadence_days: number }>;
  const dueSweepByKey = new Map<string, ContactSubscriberSweepRow>();
  for (const row of (dueSweeps ?? []) as ContactSubscriberSweepRow[]) {
    dueSweepByKey.set(`${row.org_id}:${row.person_id}`, row);
  }
  const members = await orgMembersByOrg(admin, subscriberRows.map((row) => row.org_id));
  const userIds = [...new Set([...members.values()].flat())];
  const { data: contacts, error: contactsError } = userIds.length
    ? await admin.from('user_contacts')
      .select('id, user_id, person_id, company_id')
      .in('user_id', userIds)
      .in('person_id', personIds)
      .is('archived_at', null)
    : { data: [], error: null };
  if (contactsError) throw new Error(`representative contact read failed: ${contactsError.message}`);

  const contactByOrgPerson = new Map<string, { id: string; userId: string; companyId: string | null }>();
  for (const row of subscriberRows) {
    const orgUserIds = new Set(members.get(row.org_id) ?? []);
    const contact = (contacts ?? []).find((candidate) => (
      candidate.person_id === row.person_id && orgUserIds.has(candidate.user_id as string)
    ));
    if (contact) {
      contactByOrgPerson.set(`${row.org_id}:${row.person_id}`, {
        id: contact.id as string,
        userId: contact.user_id as string,
        companyId: (contact.company_id as string | null | undefined) ?? null,
      });
    }
  }
  const monitorByKey = new Map<string, string>();
  for (const row of monitors ?? []) {
    monitorByKey.set(`${row.org_id}:${row.person_id}`, row.id as string);
  }
  const candidates = subscriberRows.flatMap((row) => {
    const sweep = dueSweepByKey.get(`${row.org_id}:${row.person_id}`);
    if (!sweep) return [];
    const contact = contactByOrgPerson.get(`${row.org_id}:${row.person_id}`);
    return contact ? [{ row, contact, cadenceDays: Number(sweep.cadence_days) }] : [];
  });
  return candidates
    .map(({ row, contact, cadenceDays }) => ({
      orgId: row.org_id,
      userId: contact.userId,
      contactId: contact.id,
      personId: row.person_id,
      companyId: contact.companyId,
      source,
      monitorId: monitorByKey.get(`${row.org_id}:${row.person_id}`) ?? null,
      cadenceDays,
      lookbackDays: lookbackDaysForCadence(cadenceDays),
    }));
}

export async function markAccountSourceSweep(params: {
  companyId: string;
  source: AccountSweepSource;
  cadenceDays: number;
  status: 'succeeded' | 'failed';
  resultCount?: number;
  providerCostUsd?: number;
}): Promise<void> {
  const now = new Date();
  const next = new Date(now.getTime() + params.cadenceDays * 86_400_000);
  const admin = createAdminClient();
  const { error } = await admin.from('account_source_sweep_targets').update({
    last_sweep_at: now.toISOString(),
    next_sweep_at: next.toISOString(),
    last_sweep_status: params.status,
    last_result_count: params.resultCount ?? null,
    last_provider_cost_usd: params.providerCostUsd ?? null,
    updated_at: now.toISOString(),
  }).eq('company_id', params.companyId).eq('source', params.source);
  if (error) throw new Error(`account source sweep mark failed: ${error.message}`);
}

export async function markAccountSubscriberSourceSweep(params: {
  orgId: string;
  companyId: string;
  source: AccountSweepSource;
  cadenceDays: number;
  status: 'succeeded' | 'failed';
  resultCount?: number;
  providerCostUsd?: number;
}): Promise<void> {
  const now = new Date();
  const next = new Date(now.getTime() + params.cadenceDays * 86_400_000);
  const admin = createAdminClient();
  const { data, error } = await admin.from('account_source_subscriber_sweeps').update({
    last_sweep_at: now.toISOString(),
    next_sweep_at: next.toISOString(),
    last_sweep_status: params.status,
    last_result_count: params.resultCount ?? null,
    last_provider_cost_usd: params.providerCostUsd ?? null,
    updated_at: now.toISOString(),
  })
    .eq('org_id', params.orgId)
    .eq('company_id', params.companyId)
    .eq('source', params.source)
    .select('org_id')
    .maybeSingle<{ org_id: string }>();
  if (error) throw new Error(`account subscriber source sweep mark failed: ${error.message}`);
  if (!data) throw new Error('account subscriber source sweep mark failed: no matching row');
}

export async function markContactSourceSweep(params: {
  personId: string;
  source: ContactSweepSource;
  cadenceDays: number;
  status: 'succeeded' | 'failed';
  providerCostUsd?: number;
}): Promise<void> {
  const now = new Date();
  const next = new Date(now.getTime() + params.cadenceDays * 86_400_000);
  const admin = createAdminClient();
  const { error } = await admin.from('contact_source_sweep_targets').update({
    last_sweep_at: now.toISOString(),
    next_sweep_at: next.toISOString(),
    last_sweep_status: params.status,
    last_provider_cost_usd: params.providerCostUsd ?? null,
    updated_at: now.toISOString(),
  }).eq('person_id', params.personId).eq('source', params.source);
  if (error) throw new Error(`contact source sweep mark failed: ${error.message}`);
}

export async function markContactSubscriberSourceSweep(params: {
  orgId: string;
  personId: string;
  source: ContactSweepSource;
  cadenceDays: number;
  status: 'succeeded' | 'failed';
  providerCostUsd?: number;
}): Promise<void> {
  const now = new Date();
  const next = new Date(now.getTime() + params.cadenceDays * 86_400_000);
  const admin = createAdminClient();
  const { data, error } = await admin.from('contact_source_subscriber_sweeps').update({
    last_sweep_at: now.toISOString(),
    next_sweep_at: next.toISOString(),
    last_sweep_status: params.status,
    last_provider_cost_usd: params.providerCostUsd ?? null,
    updated_at: now.toISOString(),
  })
    .eq('org_id', params.orgId)
    .eq('person_id', params.personId)
    .eq('source', params.source)
    .select('org_id')
    .maybeSingle<{ org_id: string }>();
  if (error) throw new Error(`contact subscriber source sweep mark failed: ${error.message}`);
  if (!data) throw new Error('contact subscriber source sweep mark failed: no matching row');
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
  source?: ContactSweepSource;
  cadenceDays: number;
  status: 'succeeded' | 'failed';
  providerCostUsd?: number;
  markSharedTarget?: boolean;
}): Promise<void> {
  const now = new Date();
  const next = new Date(now.getTime() + params.cadenceDays * 86_400_000);
  const admin = createAdminClient();
  const { data, error } = await admin.from('org_monitored_contacts').update({
    last_sweep_at: now.toISOString(),
    next_sweep_at: next.toISOString(),
    last_sweep_status: params.status,
    last_provider_cost_usd: params.providerCostUsd ?? null,
    updated_at: now.toISOString(),
  }).eq('id', params.monitorId).select('org_id, person_id').maybeSingle<{ org_id: string; person_id: string }>();
  if (error) throw new Error(`contact sweep mark failed: ${error.message}`);
  if (data?.person_id && params.source) {
    const { data: sweepData, error: sweepError } = await admin.from('contact_source_subscriber_sweeps').update({
      last_sweep_at: now.toISOString(),
      next_sweep_at: next.toISOString(),
      last_sweep_status: params.status,
      last_provider_cost_usd: params.providerCostUsd ?? null,
      updated_at: now.toISOString(),
    }).eq('org_id', data.org_id).eq('person_id', data.person_id).eq('source', params.source)
      .select('org_id')
      .maybeSingle<{ org_id: string }>();
    if (sweepError) throw new Error(`contact subscriber source sweep mark failed: ${sweepError.message}`);
    if (!sweepData) throw new Error('contact subscriber source sweep mark failed: no matching row');
  }
  if (data?.person_id && params.markSharedTarget !== false) {
    await admin.from('contact_source_sweep_targets').update({
      last_sweep_at: now.toISOString(),
      next_sweep_at: next.toISOString(),
      last_sweep_status: params.status,
      last_provider_cost_usd: params.providerCostUsd ?? null,
      updated_at: now.toISOString(),
    }).eq('person_id', data.person_id).eq('source', 'job_change').then(({ error: targetError }) => {
      if (targetError) console.warn('[monitoring] contact shared sweep target mark skipped:', targetError);
    });
  }
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
  source?: AccountSweepSource;
  cadenceDays: number;
  status: 'succeeded' | 'failed';
  resultCount?: number;
  providerCostUsd?: number;
  markSharedTarget?: boolean;
}): Promise<void> {
  const now = new Date();
  const next = new Date(now.getTime() + params.cadenceDays * 86_400_000);
  const admin = createAdminClient();
  const { data, error } = await admin.from('org_monitored_accounts').update({
    last_sweep_at: now.toISOString(),
    next_sweep_at: next.toISOString(),
    last_sweep_status: params.status,
    last_result_count: params.resultCount ?? null,
    last_provider_cost_usd: params.providerCostUsd ?? null,
    updated_at: now.toISOString(),
  }).eq('id', params.monitorId).select('org_id, company_id').maybeSingle<{ org_id: string; company_id: string }>();
  if (error) throw new Error(`account sweep mark failed: ${error.message}`);
  if (data?.company_id && params.source) {
    const { data: sweepData, error: sweepError } = await admin.from('account_source_subscriber_sweeps').update({
      last_sweep_at: now.toISOString(),
      next_sweep_at: next.toISOString(),
      last_sweep_status: params.status,
      last_result_count: params.resultCount ?? null,
      last_provider_cost_usd: params.providerCostUsd ?? null,
      updated_at: now.toISOString(),
    }).eq('org_id', data.org_id).eq('company_id', data.company_id).eq('source', params.source)
      .select('org_id')
      .maybeSingle<{ org_id: string }>();
    if (sweepError) throw new Error(`account subscriber source sweep mark failed: ${sweepError.message}`);
    if (!sweepData) throw new Error('account subscriber source sweep mark failed: no matching row');
  }
  if (data?.company_id && params.markSharedTarget !== false) {
    await admin.from('account_source_sweep_targets').update({
      last_sweep_at: now.toISOString(),
      next_sweep_at: next.toISOString(),
      last_sweep_status: params.status,
      last_result_count: params.resultCount ?? null,
      last_provider_cost_usd: params.providerCostUsd ?? null,
      updated_at: now.toISOString(),
    }).eq('company_id', data.company_id).eq('source', 'hiring').then(({ error: targetError }) => {
      if (targetError) console.warn('[monitoring] account shared sweep target mark skipped:', targetError);
    });
  }
}
