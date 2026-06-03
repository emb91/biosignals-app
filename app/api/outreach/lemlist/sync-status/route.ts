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
  getLeadActivities,
  getLeadState,
  getLemlistKeyForCurrentUser,
  reduceActivitiesToSentSteps,
} from '@/lib/lemlist';
import { getHubSpotTokenForUser, pushOutreachStatusByEmail } from '@/lib/hubspot';

const MAX_ROWS_PER_SYNC = 50;

interface SentRow {
  id: string;
  anchor_hook_text: string;
  messages: Array<{
    day_offset: number;
    subject: string;
    body: string;
    channel?: 'email' | 'linkedin';
    sent_at?: string | null;
  }>;
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
    .select('id, anchor_hook_text, messages, external_ref')
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
    const leadId = row.external_ref?.lemlist_lead_id;
    if (!campaignId || !email) continue;

    // ── Per-step send confirmations ────────────────────────────────────
    // Pull this lead's activity log and fold the "sent" events into
    // messages[i].sent_at. Cells in /outreach will show "Sent {realDate}"
    // for any step we have a real timestamp for, falling back to the
    // computed date for unmatched ones.
    let messagesUpdate: SentRow['messages'] | null = null;
    if (leadId) {
      const activities = await getLeadActivities(apiKey, leadId);
      const sentAtBySeqStep = reduceActivitiesToSentSteps(activities);
      // Map sequenceStep (zero-indexed in lemlist) → our messages[] index
      // (also zero-indexed; same ordering after our stage endpoint injects
      // the Day 7 invite at the right slot).
      let anyChange = false;
      const updatedMessages = row.messages.map((m, i) => {
        const sentAt = sentAtBySeqStep[i];
        if (sentAt && m.sent_at !== sentAt) {
          anyChange = true;
          return { ...m, sent_at: sentAt };
        }
        return m;
      });
      if (anyChange) messagesUpdate = updatedMessages;
    }

    // ── Sequence-level status flip (replied / failed) ─────────────────
    const state = await getLeadState(apiKey, campaignId, email);
    const newStatus = state ? dispatchStatusFromLemlistState(state.state) : null;

    if (messagesUpdate || newStatus) {
      const patch: Record<string, unknown> = {};
      if (messagesUpdate) patch.messages = messagesUpdate;
      if (newStatus) {
        patch.dispatch_status = newStatus;
        patch.last_status_at = new Date().toISOString();
      }
      await supabase.from('outreach_sequences').update(patch).eq('id', row.id).eq('user_id', user.id);
      changed++;
    }

    // Best-effort HubSpot mirror for newly-replied/failed rows only.
    if (hubspotToken && newStatus) {
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
