/**
 * POST /api/outreach/lemlist/sync-status
 *
 * On-demand sync for the current user — called by /outreach on page mount.
 * Daily background sync lives at /api/cron/lemlist-sync (same shared helper).
 *
 * Pulls per-step activities from lemlist, folds real send timestamps into
 * messages[i].sent_at, flips dispatch_status to replied/failed when lemlist
 * reports it. Mirrors any newly-detected replied/failed to HubSpot best-effort.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getLemlistKeyForCurrentUser, syncUserOutreachStatus } from '@/lib/lemlist';
import { getHubSpotTokenForUser, pushOutreachStatusByEmail } from '@/lib/hubspot';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = await getLemlistKeyForCurrentUser();
  if (!apiKey) {
    return NextResponse.json({ ok: true, synced: 0, note: 'lemlist not connected' });
  }

  const hubspotToken = await getHubSpotTokenForUser(user.id);
  const hubspotPush = hubspotToken
    ? async (email: string, status: 'replied' | 'failed', anchor: string) => {
        await pushOutreachStatusByEmail(hubspotToken, {
          email,
          status,
          anchor,
          channel: 'lemlist',
        });
      }
    : undefined;

  const { checked, changed } = await syncUserOutreachStatus(supabase, user.id, apiKey, hubspotPush);
  return NextResponse.json({ ok: true, synced: changed, checked });
}
