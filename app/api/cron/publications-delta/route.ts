/**
 * PubMed publications shared-target monitor — Vercel cron entrypoint.
 *
 * Unlike the mirror-backed delta crons, there is no persistent sync table:
 * due account/contact targets are dispatched through the shared sweep-target
 * cadence tables, and runPublicationsMonitor queries PubMed (NCBI E-utilities)
 * live for the subscriber's cadence-sized lookback window. A per-request cache
 * dedupes identical PubMed queries across due subscribers in the same Arcova run.
 *
 * Emits:
 *   `publication`         for company affiliation matches (scope: company)
 *   `new_paper_published` for contact author matches       (scope: contact)
 *
 * Subscriber reveal is org-cadence gated; team size does not multiply targets.
 * Per-user failures are isolated so one representative's failure does not block
 * the rest of the due subscribers.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { observeCron } from '@/lib/cron-observability';
import { persistRunHistory } from '@/lib/signals/run-history';
import {
  createPublicationsPubMedCache,
  runPublicationsMonitor,
} from '@/lib/signals/run-publications-monitor';
import { markAccountSubscriberSweeps, markContactSubscriberSweeps } from '@/lib/signals/cron-sweep-marking';
import {
  accountSweepSubscribersForTargets,
  contactSweepSubscribersForTargets,
  listDueAccountSweepTargets,
  listDueContactSweepTargets,
  markAccountSourceSweep,
  markContactSourceSweep,
} from '@/lib/billing/monitoring';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function runCron(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const lookbackRaw = searchParams.get('lookbackDays');
    const admin = createAdminClient();
    const dispatcherLimit = Math.max(1, Number(process.env.PUBLICATIONS_MONITOR_DISPATCH_LIMIT ?? '2500'));

    const [accountTargets, contactTargets] = await Promise.all([
      listDueAccountSweepTargets({ source: 'publications', limit: dispatcherLimit }),
      listDueContactSweepTargets({ source: 'publications', limit: dispatcherLimit }),
    ]);
    const [accountSubscribers, contactSubscribers] = await Promise.all([
      accountSweepSubscribersForTargets({
        companyIds: accountTargets.map((target) => target.companyId),
        runner: 'publications',
      }),
      contactSweepSubscribersForTargets({
        personIds: contactTargets.map((target) => target.personId),
        runner: 'publications',
      }),
    ]);
    let monitorOk = 0;
    let monitorFailed = 0;
    let monitorSkipped = 0;
    const failures: Array<{ user_id: string; error: string }> = [];
    const byUser = new Map<string, { accounts: typeof accountSubscribers; contacts: typeof contactSubscribers }>();
    for (const item of accountSubscribers) {
      const work = byUser.get(item.userId) ?? { accounts: [], contacts: [] };
      work.accounts.push(item);
      byUser.set(item.userId, work);
    }
    for (const item of contactSubscribers) {
      const work = byUser.get(item.userId) ?? { accounts: [], contacts: [] };
      work.contacts.push(item);
      byUser.set(item.userId, work);
    }

    const failedCompanies = new Set<string>();
    const failedPersons = new Set<string>();
    const unmarkedCompanies = new Set<string>();
    const unmarkedPersons = new Set<string>();
    const subscriberCompanyIds = new Set(accountSubscribers.map((item) => item.companyId));
    const subscriberPersonIds = new Set(contactSubscribers.map((item) => item.personId));
    const pubmedCache = createPublicationsPubMedCache();
    for (const [userId, work] of byUser) {
      try {
        const cadenceLookback = Math.max(
          1,
          ...work.accounts.map((item) => item.lookbackDays),
          ...work.contacts.map((item) => item.lookbackDays),
        );
        // Manual override via ?lookbackDays wins; otherwise size to the customer's cadence.
        const lookbackDays = lookbackRaw
          ? Math.max(1, Math.trunc(Number(lookbackRaw) || cadenceLookback))
          : cadenceLookback;
        const result = await runPublicationsMonitor({
          userId,
          companyIds: [...new Set(work.accounts.map((item) => item.companyId))],
          contactIds: [...new Set(work.contacts.map((item) => item.contactId))],
          lookbackDays,
          pubmedCache,
        });
        monitorOk += 1;
        const contactIdToPersonId = new Map(work.contacts.map((item) => [item.contactId, item.personId]));
        const failedCompaniesForUser = new Set<string>();
        const failedPersonsForUser = new Set<string>();
        for (const failure of result.failures) {
          if (failure.entity_type === 'company') {
            failedCompanies.add(failure.entity_id);
            failedCompaniesForUser.add(failure.entity_id);
          }
          if (failure.entity_type === 'contact') {
            const personId = contactIdToPersonId.get(failure.entity_id);
            if (personId) {
              failedPersons.add(personId);
              failedPersonsForUser.add(personId);
            }
          }
        }
        const unmarkedAccountSweeps = await markAccountSubscriberSweeps({
          items: work.accounts,
          statusForItem: (item) => failedCompaniesForUser.has(item.companyId) ? 'failed' : 'succeeded',
          onFailure: (failure) => {
            failures.push({ user_id: failure.user_id, error: failure.error });
            console.error('[cron/publications-delta] account subscriber source mark failed:', failure);
          },
        });
        const unmarkedContactSweeps = await markContactSubscriberSweeps({
          items: work.contacts,
          statusForItem: (item) => failedPersonsForUser.has(item.personId) ? 'failed' : 'succeeded',
          onFailure: (failure) => {
            failures.push({ user_id: failure.user_id, error: failure.error });
            console.error('[cron/publications-delta] contact subscriber source mark failed:', failure);
          },
        });
        for (const companyId of unmarkedAccountSweeps) unmarkedCompanies.add(companyId);
        for (const personId of unmarkedContactSweeps) unmarkedPersons.add(personId);
        await persistRunHistory(admin, {
          userId,
          signalKey: 'publications_all',
          runner: 'publications',
          scope: 'company',
          status: result.companies_failed + result.contacts_failed > 0 ? 'failed' : 'success',
          processed: result.companies_processed + result.contacts_processed,
          failed: result.companies_failed + result.contacts_failed,
          emittedSignalTypes: result.emitted_signal_types,
          recomputedCompanies: result.recomputed_companies,
          failures: result.failures.map((f) => ({
            entity_type: f.entity_type,
            entity_id: f.entity_id,
            error: f.error,
          })),
          trigger: 'cron',
        });
      } catch (error) {
        monitorFailed += 1;
        failures.push({ user_id: userId, error: messageFromUnknown(error) });
        console.error(`[cron/publications-delta] monitor failed for user ${userId}:`, error);
        for (const item of work.accounts) failedCompanies.add(item.companyId);
        for (const item of work.contacts) failedPersons.add(item.personId);
        const unmarkedAccountSweeps = await markAccountSubscriberSweeps({
          items: work.accounts,
          statusForItem: () => 'failed',
          onFailure: (failure) => {
            failures.push({ user_id: failure.user_id, error: failure.error });
            console.error('[cron/publications-delta] account subscriber source mark failed:', failure);
          },
        });
        const unmarkedContactSweeps = await markContactSubscriberSweeps({
          items: work.contacts,
          statusForItem: () => 'failed',
          onFailure: (failure) => {
            failures.push({ user_id: failure.user_id, error: failure.error });
            console.error('[cron/publications-delta] contact subscriber source mark failed:', failure);
          },
        });
        for (const companyId of unmarkedAccountSweeps) unmarkedCompanies.add(companyId);
        for (const personId of unmarkedContactSweeps) unmarkedPersons.add(personId);
        await persistRunHistory(admin, {
          userId,
          signalKey: 'publications_all',
          runner: 'publications',
          scope: 'company',
          status: 'failed',
          failures: [{ error: messageFromUnknown(error) }],
          trigger: 'cron',
        });
      }
    }
    if (byUser.size === 0) monitorSkipped = accountTargets.length + contactTargets.length;

    await Promise.all([
      ...accountTargets.filter((target) => (
        subscriberCompanyIds.has(target.companyId) && !unmarkedCompanies.has(target.companyId)
      )).map((target) => markAccountSourceSweep({
        companyId: target.companyId,
        source: 'publications',
        cadenceDays: target.cadenceDays,
        status: failedCompanies.has(target.companyId) ? 'failed' : 'succeeded',
        providerCostUsd: 0,
      })),
      ...contactTargets.filter((target) => (
        subscriberPersonIds.has(target.personId) && !unmarkedPersons.has(target.personId)
      )).map((target) => markContactSourceSweep({
        personId: target.personId,
        source: 'publications',
        cadenceDays: target.cadenceDays,
        status: failedPersons.has(target.personId) ? 'failed' : 'succeeded',
        providerCostUsd: 0,
      })),
    ]);
    const [{ count: overdueAccounts }, { count: overdueContacts }] = await Promise.all([
      admin.from('account_source_sweep_targets')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'publications').eq('status', 'active').lte('next_sweep_at', new Date().toISOString()),
      admin.from('contact_source_sweep_targets')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'publications').eq('status', 'active').lte('next_sweep_at', new Date().toISOString()),
    ]);

    return NextResponse.json({
      success: true,
      targets_due: {
        accounts: accountTargets.length,
        contacts: contactTargets.length,
      },
      subscribers_due: {
        accounts: accountSubscribers.length,
        contacts: contactSubscribers.length,
      },
      unmarked_targets: {
        accounts: unmarkedCompanies.size,
        contacts: unmarkedPersons.size,
      },
      overdue: {
        accounts: overdueAccounts ?? 0,
        contacts: overdueContacts ?? 0,
      },
      monitor: {
        users_total: byUser.size,
        users_succeeded: monitorOk,
        users_failed: monitorFailed,
        users_skipped: monitorSkipped,
        failures,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}

export const GET = observeCron('publications-delta', runCron);
