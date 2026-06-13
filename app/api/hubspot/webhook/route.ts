/**
 * POST /api/hubspot/webhook — real-time inbound sync from HubSpot.
 *
 * HubSpot fires contact/deal change events here. We verify the v3 signature,
 * dedupe by eventId, resolve which org/connection the portal belongs to (via the
 * portal id stored at connect time), then trigger the existing CHECKPOINTED
 * readiness syncs — which only process the delta since the last run — debounced
 * to at most once per connection per 2 min. The daily cron stays as the safety net.
 *
 * Responds fast (HubSpot expects a quick 200); the actual sync runs in after().
 *
 * Setup (Emma): register this URL in the HubSpot app → Webhooks with
 * contact.creation / contact.propertyChange / deal.propertyChange subscriptions.
 * Signature uses HUBSPOT_CLIENT_SECRET (the app's client secret). Existing
 * connections need their portal id backfilled (reconnect, or a one-off script) —
 * new connections capture it automatically.
 */
import { NextResponse, after } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase-admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { syncHubSpotContactsIntoReadiness } from '@/lib/signals/readiness-hubspot-contacts';
import { syncHubSpotDealsIntoReadiness } from '@/lib/signals/readiness-hubspot-deals';

export const runtime = 'nodejs';

type HubSpotEvent = { eventId?: number | string; subscriptionType?: string; portalId?: number };

/**
 * HubSpot v3 signature: base64( HMAC-SHA256( clientSecret, method + uri + body + timestamp ) ).
 * The URI is reconstructed from forwarded headers so it matches the public URL
 * HubSpot signed against (Vercel rewrites request.url to an internal host).
 */
function verifySignature(req: Request, body: string): boolean {
  const secret = process.env.HUBSPOT_CLIENT_SECRET;
  if (!secret) return false;
  const sig = req.headers.get('x-hubspot-signature-v3');
  const ts = req.headers.get('x-hubspot-request-timestamp');
  if (!sig || !ts) return false;
  if (!Number.isFinite(Number(ts)) || Math.abs(Date.now() - Number(ts)) > 5 * 60 * 1000) return false; // replay guard

  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const { pathname, search } = new URL(req.url);
  const uri = `${proto}://${host}${pathname}${search}`;

  const expected = createHmac('sha256', secret).update(`POST${uri}${body}${ts}`).digest('base64');
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!process.env.HUBSPOT_CLIENT_SECRET) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }

  const body = await req.text();
  if (!verifySignature(req, body)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let events: HubSpotEvent[] = [];
  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) events = parsed;
  } catch {
    return NextResponse.json({ received: true }); // unparseable → ack, no retry
  }

  const admin = createAdminClient();

  // Dedupe per eventId (at-least-once delivery); collect the distinct portals
  // that have a fresh (non-duplicate) change.
  const portals = new Set<number>();
  for (const ev of events) {
    const id = ev.eventId != null ? String(ev.eventId) : null;
    if (id) {
      const { error } = await admin
        .from('hubspot_webhook_events')
        .insert({ id, subscription_type: ev.subscriptionType ?? null });
      if (error?.code === '23505') continue; // already processed
    }
    if (typeof ev.portalId === 'number') portals.add(ev.portalId);
  }

  if (portals.size > 0) {
    after(async () => {
      const { nango, HUBSPOT_INTEGRATION_ID } = await import('@/lib/nango');
      for (const portalId of portals) {
        try {
          const { data: conn } = await admin
            .from('nango_connections')
            .select('user_id, nango_connection_id')
            .eq('hubspot_portal_id', portalId)
            .maybeSingle<{ user_id: string; nango_connection_id: string }>();
          if (!conn?.user_id) {
            console.warn('[hubspot/webhook] no connection for portal', portalId);
            continue;
          }
          // Debounce: at most one readiness resync per connection per 2 min.
          const { allowed } = await checkRateLimit(`hubspot-webhook-sync:${portalId}`, 1, 120);
          if (!allowed) continue;

          const token = (await nango.getToken(HUBSPOT_INTEGRATION_ID, conn.nango_connection_id)) as string;
          if (!token) continue;
          await Promise.allSettled([
            syncHubSpotContactsIntoReadiness(admin, { userId: conn.user_id, accessToken: token }),
            syncHubSpotDealsIntoReadiness(admin, { userId: conn.user_id, accessToken: token }),
          ]);
        } catch (error) {
          console.error('[hubspot/webhook] sync failed for portal', portalId, error);
        }
      }
    });
  }

  return NextResponse.json({ received: true });
}
