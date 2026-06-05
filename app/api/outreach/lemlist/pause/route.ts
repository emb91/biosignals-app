/**
 * POST /api/outreach/lemlist/pause
 *
 * Pauses a dispatched sequence's lead in lemlist so no further steps fire.
 * lemlist keeps the lead pausable/resumable on their side; we mark the row
 * 'paused' in-app and mirror the state to HubSpot. Reversible later (un-pause
 * is a separate lemlist action we don't wrap yet).
 *
 * Input:  { sequenceId: string }
 * Output: { ok: true, status: 'paused' }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getLemlistKeyForCurrentUser, pauseLead, LemlistError } from '@/lib/lemlist';
import { getHubSpotTokenForUser, pushOutreachStatusByEmail } from '@/lib/hubspot';

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : 'Internal server error';
}

interface SequenceRow {
  id: string;
  anchor_hook_text: string;
  dispatch_status: string | null;
  external_ref: {
    lemlist_campaign_id?: string | null;
    lemlist_lead_email?: string | null;
  } | null;
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { sequenceId?: unknown };
    const sequenceId = typeof body.sequenceId === 'string' ? body.sequenceId.trim() : '';
    if (!sequenceId) {
      return NextResponse.json({ error: 'sequenceId required' }, { status: 400 });
    }

    const { data: rowRaw, error: rowErr } = await supabase
      .from('outreach_sequences')
      .select('id, anchor_hook_text, dispatch_status, external_ref')
      .eq('user_id', user.id)
      .eq('id', sequenceId)
      .maybeSingle();
    if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 });
    const row = rowRaw as SequenceRow | null;
    if (!row) return NextResponse.json({ error: 'Sequence not found' }, { status: 404 });

    // Only a live (dispatched) sequence can be paused. Drafts/failed have
    // nothing running in lemlist; replied is already terminal.
    if (row.dispatch_status !== 'sent') {
      return NextResponse.json(
        { error: `Cannot pause a sequence in '${row.dispatch_status ?? 'draft'}' state` },
        { status: 409 },
      );
    }

    const campaignId = row.external_ref?.lemlist_campaign_id ?? null;
    const email = row.external_ref?.lemlist_lead_email ?? null;
    if (!campaignId || !email) {
      return NextResponse.json(
        { error: 'Sequence is missing its lemlist linkage (campaign/email)' },
        { status: 422 },
      );
    }

    const apiKey = await getLemlistKeyForCurrentUser();
    if (!apiKey) return NextResponse.json({ error: 'lemlist not connected' }, { status: 400 });

    try {
      await pauseLead(apiKey, campaignId, email);
    } catch (err) {
      const msg =
        err instanceof LemlistError
          ? `lemlist ${err.status}: ${err.body.slice(0, 200)}`
          : messageFromUnknown(err);
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    await supabase
      .from('outreach_sequences')
      .update({ dispatch_status: 'paused', last_status_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('user_id', user.id);

    // Best-effort HubSpot mirror — never block the pause on it.
    try {
      const hubspotToken = await getHubSpotTokenForUser(user.id);
      if (hubspotToken) {
        await pushOutreachStatusByEmail(hubspotToken, {
          email,
          status: 'paused',
          anchor: row.anchor_hook_text,
          channel: 'lemlist',
        });
      }
    } catch (hubErr) {
      console.warn('[pause] hubspot mirror failed for', email, hubErr);
    }

    return NextResponse.json({ ok: true, status: 'paused' });
  } catch (err) {
    console.error('Error in outreach/lemlist/pause POST:', err);
    return NextResponse.json({ error: messageFromUnknown(err) }, { status: 500 });
  }
}
