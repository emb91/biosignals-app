/**
 * POST /api/outreach/lemlist/webhook
 *
 * Receives lemlist's outbound webhooks (lead replied, opened, clicked, etc.)
 * and updates the matching outreach_sequences row's dispatch_status.
 *
 * Setup (one-time, in lemlist UI):
 *   Settings → Integrations → Webhooks → Add
 *     URL: https://<your-app>/api/outreach/lemlist/webhook?token=<secret>
 *     Events: emailsReplied (at minimum) + linkedinReplied, leadFailed
 *
 * Auth model:
 *   We require a shared-secret token in the query string (LEMLIST_WEBHOOK_TOKEN
 *   env var). lemlist doesn't sign webhook bodies, so this is the standard
 *   approach. If the env var is unset we accept all calls (dev convenience) +
 *   log a warning.
 *
 * Matching: lemlist payloads include leadId + campaignId. We match against
 * outreach_sequences.external_ref->>lemlist_lead_id. If no match, we log
 * + 200 OK (lemlist retries on non-2xx; we don't want infinite retries on
 * stale leads).
 *
 * Status mapping (v1, conservative):
 *   emailsReplied / linkedinReplied → dispatch_status='replied'
 *   leadFailed                       → dispatch_status='failed' + error
 *   (other events ignored for now)
 */
import { NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { nango, HUBSPOT_INTEGRATION_ID } from '@/lib/nango';
import { pushOutreachStatusByEmail, applyReplyEffectsToHubSpot } from '@/lib/hubspot';

interface LemlistWebhookPayload {
  type?: string;
  campaignId?: string;
  leadId?: string;
  email?: string;
  message?: string;
  // lemlist sometimes nests these under `lead` / `campaign`
  lead?: { _id?: string; email?: string };
  campaign?: { _id?: string };
}

function statusFromEvent(type: string | undefined): 'replied' | 'failed' | null {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t.includes('replied')) return 'replied';
  if (t.includes('failed') || t === 'leadfailed') return 'failed';
  return null;
}

export async function POST(req: Request) {
  // ── Token check ──────────────────────────────────────────────────────
  const expectedToken = process.env.LEMLIST_WEBHOOK_TOKEN;
  if (expectedToken) {
    const provided = new URL(req.url).searchParams.get('token');
    if (provided !== expectedToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else {
    // Dev-mode fallthrough — log so we don't ship to prod without a token.
    console.warn(
      '[lemlist webhook] LEMLIST_WEBHOOK_TOKEN not set; accepting unauthenticated calls. Set the env var before going live.',
    );
  }

  // ── Parse payload ────────────────────────────────────────────────────
  const payload = (await req.json().catch(() => null)) as LemlistWebhookPayload | null;
  if (!payload) {
    return NextResponse.json({ ok: true, ignored: 'unparseable body' });
  }
  const status = statusFromEvent(payload.type);
  if (!status) {
    return NextResponse.json({ ok: true, ignored: `event '${payload.type}' not tracked` });
  }
  const leadId = payload.leadId ?? payload.lead?._id ?? null;
  const leadEmail = payload.email ?? payload.lead?.email ?? null;
  if (!leadId && !leadEmail) {
    return NextResponse.json({ ok: true, ignored: 'no leadId or email' });
  }

  // ── Update matching row ──────────────────────────────────────────────
  // We need to read across all users (webhook is unauthenticated wrt our auth),
  // so use the service role key. RLS is bypassed here — the leadId/email match
  // is the access control.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error('[lemlist webhook] SUPABASE_SERVICE_ROLE_KEY not set');
    return NextResponse.json({ ok: true, ignored: 'service key missing' });
  }
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Try by lead id first, fall back to email — lemlist's payload schema
  // is inconsistent across event types. We select user_id + external_ref too
  // so we can mirror the status change into HubSpot per-user.
  let query = supabase
    .from('outreach_sequences')
    .select('id, user_id, contact_id, anchor_hook_text, external_ref');
  if (leadId) {
    query = query.eq('external_ref->>lemlist_lead_id', leadId);
  } else if (leadEmail) {
    query = query.eq('external_ref->>lemlist_lead_email', leadEmail);
  }
  const { data: matchRows } = await query.limit(5);
  const matches = (matchRows ?? []) as Array<{
    id: string;
    user_id: string;
    contact_id: string | null;
    anchor_hook_text: string;
    external_ref: { lemlist_lead_email?: string } | null;
  }>;

  if (matches.length === 0) {
    return NextResponse.json({ ok: true, ignored: 'no matching sequence' });
  }

  // Names for the HubSpot reply task ("Reply to {name}"). Best-effort batch.
  const contactNameById = new Map<string, string>();
  if (status === 'replied') {
    const ids = matches.map((m) => m.contact_id).filter((v): v is string => Boolean(v));
    if (ids.length > 0) {
      const { data: contactRows } = await supabase
        .from('contacts')
        .select('id, full_name, first_name, last_name')
        .in('id', ids);
      for (const c of (contactRows ?? []) as Array<{
        id: string;
        full_name: string | null;
        first_name: string | null;
        last_name: string | null;
      }>) {
        const name =
          c.full_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '';
        if (name) contactNameById.set(c.id, name);
      }
    }
  }

  const matchIds = matches.map((r) => r.id);
  const update: Record<string, unknown> = {
    dispatch_status: status,
    last_status_at: new Date().toISOString(),
  };
  if (status === 'failed') {
    update.dispatch_error = payload.message ?? 'lemlist reported failure';
  }

  await supabase.from('outreach_sequences').update(update).in('id', matchIds);

  // ── HubSpot mirror — best-effort, per-row (different users could match
  // the same lead id in theory). Skip cleanly if user hasn't connected HubSpot.
  await Promise.allSettled(
    matches.map(async (row) => {
      const email = row.external_ref?.lemlist_lead_email ?? leadEmail;
      if (!email) return;
      try {
        const { data: conn } = await supabase
          .from('nango_connections')
          .select('nango_connection_id')
          .eq('user_id', row.user_id)
          .eq('integration_id', HUBSPOT_INTEGRATION_ID)
          .maybeSingle();
        const connRow = conn as { nango_connection_id?: string } | null;
        if (!connRow?.nango_connection_id) return;
        const token = (await nango.getToken(
          HUBSPOT_INTEGRATION_ID,
          connRow.nango_connection_id,
        )) as string;
        await pushOutreachStatusByEmail(token, {
          email,
          status,
          anchor: row.anchor_hook_text,
          channel: 'lemlist',
        });
        // On a reply, also advance the contact's lifecycle stage and drop a
        // follow-up task in the rep's HubSpot queue. Best-effort.
        if (status === 'replied') {
          await applyReplyEffectsToHubSpot(token, {
            email,
            contactName: row.contact_id ? contactNameById.get(row.contact_id) ?? null : null,
            anchor: row.anchor_hook_text,
          });
        }
      } catch (err) {
        console.warn('[lemlist webhook] hubspot push failed for', email, err);
      }
    }),
  );

  return NextResponse.json({ ok: true, updated: matchIds.length, status });
}
