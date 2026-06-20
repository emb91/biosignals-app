/**
 * Daily HubSpot backup — snapshots every connected customer's contacts + companies to the
 * Cloudflare R2 vault.
 *
 * For each connected account it:
 *   1. ensureBaselineSnapshot — backfills the immutable baseline if one doesn't exist yet
 *      (new accounts get theirs lazily on first write; this catches any that connected before
 *      this system existed).
 *   2. captureRollingSnapshot — writes today's dated snapshot (R2 lifecycle expires it after 30d).
 *
 * Protected by CRON_SECRET (Vercel passes it as `Authorization: Bearer <CRON_SECRET>`).
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { observeCron } from '@/lib/cron-observability';
import { getNangoAccessToken, HUBSPOT_INTEGRATION_ID } from '@/lib/nango';
import { isR2Configured } from '@/lib/backup/r2';
import { ensureBaselineSnapshot, captureRollingSnapshot } from '@/lib/backup/hubspot-snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return (request.headers.get('authorization') ?? '') === `Bearer ${cronSecret}`;
}

async function runCron(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isR2Configured()) {
    return NextResponse.json({ ok: false, error: 'R2 backup vault not configured' }, { status: 503 });
  }

  const admin = createAdminClient();
  const { data: connections, error } = await admin
    .from('nango_connections')
    .select('user_id, nango_connection_id')
    .eq('integration_id', HUBSPOT_INTEGRATION_ID);

  if (error || !connections?.length) {
    return NextResponse.json({ ok: true, message: 'No HubSpot connections found', processed: 0 });
  }

  const results: Array<Record<string, unknown>> = [];

  for (const conn of connections) {
    try {
      const accessToken = await getNangoAccessToken(
        HUBSPOT_INTEGRATION_ID,
        conn.nango_connection_id,
      );

      const baseline = await ensureBaselineSnapshot(admin, { userId: conn.user_id, accessToken });
      if (!baseline.ok) {
        results.push({ userId: conn.user_id, error: baseline.reason });
        continue;
      }
      const rolling = await captureRollingSnapshot(admin, { userId: conn.user_id, accessToken });

      results.push({
        userId: conn.user_id,
        baseline: baseline.created ? 'created' : (baseline.skipped ?? 'exists'),
        rolling: 'skipped' in rolling ? rolling.skipped : { contacts: rolling.contactsCount, companies: rolling.companiesCount, bytes: rolling.bytes },
      });
    } catch (err) {
      results.push({ userId: conn.user_id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const failed = results.filter((result) => 'error' in result).length;
  return NextResponse.json(
    { ok: failed === 0, processed: results.length, failed, results },
    { status: failed > 0 ? 502 : 200 },
  );
}

export const GET = observeCron('hubspot-backup', runCron);
