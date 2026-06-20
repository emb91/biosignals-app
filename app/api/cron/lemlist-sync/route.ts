/**
 * Daily lemlist sync — runs on the Vercel cron schedule defined in vercel.json.
 *
 * For every user with a stored lemlist API key:
 *   1. Pull per-step activity history from lemlist for each 'sent' / 'queued'
 *      sequence and fold real send timestamps into messages[i].sent_at
 *      (so /outreach can show "Sent {realDate}" instead of estimates).
 *   2. Flip dispatch_status to 'replied' / 'failed' when lemlist reports it.
 *   3. Mirror status changes to HubSpot when the user has it connected.
 *
 * Auth via CRON_SECRET — Vercel passes `Authorization: Bearer <CRON_SECRET>`.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { observeCron } from '@/lib/cron-observability';
import { syncUserOutreachStatus } from '@/lib/lemlist';
import { pushOutreachStatusByEmail, resolveOrgNangoConnectionId } from '@/lib/hubspot';
import { getNangoAccessToken, HUBSPOT_INTEGRATION_ID } from '@/lib/nango';

function authorize(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // dev convenience
  return req.headers.get('authorization') === `Bearer ${expected}`;
}

async function runCron(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  // Pull every user with a lemlist credential. Service-role bypass of RLS.
  const { data: credRows, error: credErr } = await admin
    .from('user_outreach_credentials')
    .select('user_id, api_key')
    .eq('provider', 'lemlist');
  if (credErr) {
    return NextResponse.json({ error: credErr.message }, { status: 500 });
  }
  const creds = (credRows ?? []) as Array<{ user_id: string; api_key: string }>;

  const results: Array<{ userId: string; checked: number; changed: number; error?: string }> = [];

  for (const cred of creds) {
    try {
      // HubSpot token — best-effort; null if user hasn't connected.
      let hubspotPush: ((email: string, status: 'replied' | 'failed', anchor: string) => Promise<void>) | undefined;
      try {
        // Org-scoped: use the org's HubSpot connection (one per org).
        const connectionId = await resolveOrgNangoConnectionId(admin, cred.user_id, HUBSPOT_INTEGRATION_ID);
        if (connectionId) {
          const token = await getNangoAccessToken(HUBSPOT_INTEGRATION_ID, connectionId);
          hubspotPush = async (email, status, anchor) => {
            await pushOutreachStatusByEmail(token, { email, status, anchor, channel: 'lemlist' });
          };
        }
      } catch {
        // no HubSpot for this user — fine
      }

      const { checked, changed } = await syncUserOutreachStatus(
        admin,
        cred.user_id,
        cred.api_key,
        hubspotPush,
      );
      results.push({ userId: cred.user_id, checked, changed });
    } catch (err) {
      results.push({
        userId: cred.user_id,
        checked: 0,
        changed: 0,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  return NextResponse.json({
    ok: true,
    users: results.length,
    totalChecked: results.reduce((s, r) => s + r.checked, 0),
    totalChanged: results.reduce((s, r) => s + r.changed, 0),
    results,
  });
}

export const GET = observeCron('lemlist-sync', runCron);
