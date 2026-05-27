/**
 * Manual trigger for the press-release signal pipeline.
 *
 * Step 1 (sync_first=true, default): fetch GNW + PRN RSS feeds, upsert new
 *   articles, and classify up to maxClassify articles with Haiku/Gemini Flash.
 * Step 2: run the per-user press-release monitor to match classified articles
 *   against the user's companies and emit signal events.
 *
 * Mirrors the pattern of /api/signals/run/grants — same body shape, same
 * run-history recording, trigger='button'.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { persistRunHistory } from '@/lib/signals/run-history';
import { syncPressReleaseDelta, type SyncPressReleaseDeltaResult } from '@/lib/signals/sync-press-release-delta';
import { runPressReleaseMonitor } from '@/lib/signals/run-press-release-monitor';

type RunPressReleasesBody = {
  company_ids?: string[];
  sync_first?: boolean;
  cutoff_days?: number;
  lookback_days?: number;
  max_classify?: number;
};

type SyncSummary = {
  ran: boolean;
  ok: boolean;
  result: SyncPressReleaseDeltaResult | null;
  error: string | null;
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
  }
  return 'Internal server error';
}

export async function POST(request: Request) {
  try {
    const authClient = await createClient();
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as RunPressReleasesBody;
    const syncFirst = body.sync_first !== false; // default true
    const cutoffDays = typeof body.cutoff_days === 'number' ? Math.max(1, body.cutoff_days) : 3;
    const lookbackDays = typeof body.lookback_days === 'number' ? Math.max(1, body.lookback_days) : 7;
    const maxClassify = typeof body.max_classify === 'number' ? Math.max(1, Math.min(100, body.max_classify)) : 60;
    const requestedCompanyIds = Array.isArray(body.company_ids)
      ? body.company_ids.filter((v): v is string => typeof v === 'string' && Boolean(v))
      : [];

    const admin = createAdminClient();

    // ── Step 1: sync RSS feeds + classify ────────────────────────────────────
    const syncSummary: SyncSummary = { ran: false, ok: false, result: null, error: null };
    if (syncFirst) {
      syncSummary.ran = true;
      try {
        syncSummary.result = await syncPressReleaseDelta({ admin, cutoffDays, maxClassify });
        syncSummary.ok = true;
      } catch (error) {
        syncSummary.ok = false;
        syncSummary.error = messageFromUnknown(error);
        console.error('[signals/run/press-releases] sync failed (continuing with existing data):', error);
      }
    }

    // ── Step 2: per-user monitor ──────────────────────────────────────────────
    const result = await runPressReleaseMonitor({
      userId: user.id,
      companyIds: requestedCompanyIds.length > 0 ? requestedCompanyIds : undefined,
      lookbackDays,
    });

    await persistRunHistory(admin, {
      userId: user.id,
      signalKey: 'press_release_all',
      runner: 'press_releases',
      scope: 'company',
      status: result.failed > 0 ? 'failed' : 'success',
      processed: result.processed,
      failed: result.failed,
      emittedSignalTypes: result.emitted_signal_types,
      recomputedCompanies: result.recomputed_companies,
      failures: result.failures.map((f) => ({
        entity_type: 'company',
        entity_id: f.company_id,
        error: f.error,
      })),
      companyIds: requestedCompanyIds,
      trigger: 'button',
    });

    return NextResponse.json({
      success: true,
      sync: syncSummary,
      result: {
        processed: result.processed,
        failed: result.failed,
        records_scanned: result.records_scanned,
        candidate_events_matched_before_dedupe: result.candidate_events_matched_before_dedupe,
        events_skipped_as_duplicates: result.events_skipped_as_duplicates,
        emitted_signal_types: result.emitted_signal_types,
        recomputed_companies: result.recomputed_companies,
        failures: result.failures.map((f) => ({
          entity_type: 'company',
          entity_id: f.company_id,
          error: f.error,
        })),
      },
    });
  } catch (error) {
    console.error('[signals/run/press-releases] error:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
