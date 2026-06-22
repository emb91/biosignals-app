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

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function loadActiveUserIds(admin: ReturnType<typeof createAdminClient>): Promise<string[]> {
  const { data, error } = await admin
    .from('user_companies')
    .select('user_id')
    .is('archived_at', null);
  if (error) throw new Error(`load active users: ${error.message}`);
  const ids = new Set<string>();
  for (const row of (data ?? []) as Array<{ user_id?: unknown }>) {
    if (typeof row.user_id === 'string' && row.user_id) ids.add(row.user_id);
  }
  return [...ids];
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
    const lookbackDays = lookbackRaw ? Math.max(1, Math.trunc(Number(lookbackRaw) || 30)) : 30;
    const admin = createAdminClient();

    const userIds = await loadActiveUserIds(admin);
    let monitorOk = 0;
    let monitorFailed = 0;
    const failures: Array<{ user_id: string; error: string }> = [];
    for (const userId of userIds) {
      try {
        const result = await runPublicationsMonitor({ userId, lookbackDays });
        monitorOk += 1;
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

    return NextResponse.json({
      success: true,
      lookback_days: lookbackDays,
      monitor: {
        users_total: userIds.length,
        users_succeeded: monitorOk,
        users_failed: monitorFailed,
        failures,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}

export const GET = observeCron('publications-delta', runCron);
