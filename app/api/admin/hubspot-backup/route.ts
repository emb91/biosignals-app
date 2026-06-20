/**
 * Operator tool for the HubSpot backup vault. Protected by CRON_SECRET (Bearer) — this is a
 * deliberate, out-of-band admin endpoint, not a user-facing route.
 *
 *   GET  ?scopeKey=org:<uuid>           → list snapshots (newest first)
 *   POST { userId, snapshotId,          → restore from a snapshot
 *          scope?='arcova', dryRun?=true, objectTypes? }
 *
 * Restore is dry-run by default: it reports how many objects/properties WOULD change. Pass
 * dryRun:false only when you're sure. Scopes: 'arcova' (undo Arcova's writes), 'native' (undo
 * just jobtitle/linkedin/lifecyclestage), 'full' (everything writable, conservative).
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getNangoAccessToken, HUBSPOT_INTEGRATION_ID } from '@/lib/nango';
import { resolveOrgNangoConnectionId } from '@/lib/hubspot';
import { restoreFromSnapshot, type RestoreScope } from '@/lib/backup/hubspot-restore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return (request.headers.get('authorization') ?? '') === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = createAdminClient();
  const scopeKey = new URL(request.url).searchParams.get('scopeKey');
  let q = admin
    .from('hubspot_backups')
    .select('id,snapshot_id,scope_key,kind,status,date_key,contacts_count,companies_count,bytes,created_at,completed_at,error')
    .order('created_at', { ascending: false })
    .limit(100);
  if (scopeKey) q = q.eq('scope_key', scopeKey);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, snapshots: data ?? [] });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    userId?: string;
    snapshotId?: string;
    scope?: RestoreScope;
    dryRun?: boolean;
    objectTypes?: Array<'contacts' | 'companies'>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { userId, snapshotId } = body;
  if (!userId || !snapshotId) {
    return NextResponse.json({ error: 'userId and snapshotId are required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const connectionId = await resolveOrgNangoConnectionId(admin, userId, HUBSPOT_INTEGRATION_ID);
  if (!connectionId) {
    return NextResponse.json({ error: 'No HubSpot connection for this user/org' }, { status: 404 });
  }

  let accessToken: string;
  try {
    accessToken = await getNangoAccessToken(HUBSPOT_INTEGRATION_ID, connectionId);
  } catch (err) {
    return NextResponse.json({ error: `Token fetch failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }

  try {
    const result = await restoreFromSnapshot(admin, {
      accessToken,
      snapshotId,
      scope: body.scope,
      dryRun: body.dryRun ?? true,
      objectTypes: body.objectTypes,
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
