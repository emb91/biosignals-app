/**
 * Conference registry-refresh monitor — Vercel cron.
 *
 * Keeps the `conferences` registry current by detecting new editions of recurring
 * shows and refreshing each row's source-key + URLs + dates, so the existing
 * exhibitor/presenter pollers always point at the live edition (rows otherwise go
 * stale when next year's event publishes, since the registry is only ever seeded
 * manually). Runs a bounded, rotating batch per invocation; the monthly schedule
 * walks the whole registry over runs.
 *
 * Mirrors app/api/cron/conference-delta/route.ts: same CRON_SECRET bearer auth,
 * observeCron wrapper, try/catch, and env-tunable per-run limit.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { observeCron } from '@/lib/cron-observability';
import { refreshConferenceRegistry } from '@/lib/signals/conference/refresh-registry';

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
    const admin = createAdminClient();
    const limit = Math.max(1, Number(process.env.CONFERENCE_REGISTRY_REFRESH_LIMIT ?? '8'));
    const result = await refreshConferenceRegistry({ admin, limit });
    return NextResponse.json({
      success: true,
      rows_checked: result.rows_checked,
      rows_refreshed: result.rows_refreshed,
      rows_unresolved: result.rows_unresolved,
      failures: result.failures,
    });
  } catch (error) {
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}

export const GET = observeCron('conference-registry-refresh', runCron);
