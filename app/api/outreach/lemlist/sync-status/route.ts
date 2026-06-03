/**
 * POST /api/outreach/lemlist/sync-status
 *
 * Polls lemlist for the current state of every 'sent' sequence and updates
 * dispatch_status if anything has flipped to 'replied' or 'failed'. Acts as
 * a fallback for users who haven't wired the lemlist reply webhook.
 *
 * Called by /outreach on page load. Cheap-ish: one HTTP call per sent row,
 * scoped to the current user only. We cap at 50 rows per call to keep latency
 * bounded — most active queues are well under that.
 *
 * Also mirrors any newly-detected replied/failed status to HubSpot (best-effort).
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  dispatchStatusFromLemlistState,
  getLeadState,
  getLemlistKeyForCurrentUser,
} from '@/lib/lemlist';
import { getHubSpotTokenForUser, pushOutreachStatusByEmail } from '@/lib/hubspot';

const MAX_ROWS_PER_SYNC = 50;

interface SentRow {
  id: string;
  anchor_hook_text: string;
  external_ref: {
    lemlist_lead_id?: string | null;
    lemlist_campaign_id?: string | null;
    lemlist_lead_email?: string | null;
  } | null;
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = await getLemlistKeyForCurrentUser();
  if (!apiKey) {
    return NextResponse.json({ ok: true, synced: 0, note: 'lemlist not connected' });
  }

  // Only poll rows still in 'sent' / 'queued' — replied/failed/draft don't need refresh.
  const { data: rows } = await supabase
    .from('outreach_sequences')
    .select('id, anchor_hook_text, external_ref')
    .eq('user_id', user.id)
    .in('dispatch_status', ['sent', 'queued'])
    .order('last_status_at', { ascending: true, nullsFirst: true })
    .limit(MAX_ROWS_PER_SYNC);

  const sentRows = (rows ?? []) as SentRow[];
  if (sentRows.length === 0) {
    return NextResponse.json({ ok: true, synced: 0 });
  }

  const hubspotToken = await getHubSpotTokenForUser(user.id);
  let changed = 0;

  for (const row of sentRows) {
    const campaignId = row.external_ref?.lemlist_campaign_id;
    const email = row.external_ref?.lemlist_lead_email;
    if (!campaignId || !email) continue;

    const state = await getLeadState(apiKey, campaignId, email);
    if (!state) continue;
    const newStatus = dispatchStatusFromLemlistState(state.state);
    if (!newStatus) continue; // still sent — no change

    await supabase
      .from('outreach_sequences')
      .update({
        dispatch_status: newStatus,
        last_status_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('user_id', user.id);
    changed++;

    // Best-effort HubSpot mirror for newly-replied/failed rows.
    if (hubspotToken) {
      try {
        await pushOutreachStatusByEmail(hubspotToken, {
          email,
          status: newStatus,
          anchor: row.anchor_hook_text,
          channel: 'lemlist',
        });
      } catch {
        // swallow — local update succeeded, HubSpot mirror is best-effort
      }
    }
  }

  return NextResponse.json({ ok: true, synced: changed, checked: sentRows.length });
}
