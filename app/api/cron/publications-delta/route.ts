/**
 * Daily PubMed publications monitor — Vercel cron entrypoint.
 *
 * Unlike the other delta crons there's no sync step: runPublicationsMonitor
 * queries PubMed (NCBI E-utilities) live on each run for papers published in
 * the last `lookbackDays` (default 30) that either list one of the user's
 * companies as an author affiliation, or include one of the user's contacts
 * as a named author.
 *
 * Emits:
 *   `publication`         for company affiliation matches (scope: company)
 *   `new_paper_published` for contact author matches       (scope: contact)
 *
 * Walks every user with non-archived companies so signals land in their feeds
 * without them pressing the admin test button. Per-user failures are isolated —
 * one user's failure doesn't block the others.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { observeCron } from '@/lib/cron-observability';
import { persistRunHistory } from '@/lib/signals/run-history';
import { runPublicationsMonitor } from '@/lib/signals/run-publications-monitor';
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
    const subscriberCompanyIds = new Set(accountSubscribers.map((item) => item.companyId));
    const subscriberPersonIds = new Set(contactSubscribers.map((item) => item.personId));
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
        });
        monitorOk += 1;
        const contactIdToPersonId = new Map(work.contacts.map((item) => [item.contactId, item.personId]));
        for (const failure of result.failures) {
          if (failure.entity_type === 'company') failedCompanies.add(failure.entity_id);
          if (failure.entity_type === 'contact') {
            const personId = contactIdToPersonId.get(failure.entity_id);
            if (personId) failedPersons.add(personId);
          }
        }
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
      ...accountTargets.filter((target) => subscriberCompanyIds.has(target.companyId)).map((target) => markAccountSourceSweep({
        companyId: target.companyId,
        source: 'publications',
        cadenceDays: target.cadenceDays,
        status: failedCompanies.has(target.companyId) ? 'failed' : 'succeeded',
        providerCostUsd: 0,
      })),
      ...contactTargets.filter((target) => subscriberPersonIds.has(target.personId)).map((target) => markContactSourceSweep({
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
