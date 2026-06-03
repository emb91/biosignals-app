/**
 * GET /api/outreach/stats
 *
 * Aggregate outreach activity for the current user — sequences dispatched
 * (sent or replied), total opens, clicks, replies across all message steps.
 *
 * Used by /gtm-base to surface a small "Outreach activity" tile alongside
 * the Foundation / Journey sections. No full analytics — just the four
 * topline numbers a rep wants at a glance.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: rows } = await supabase
    .from('outreach_sequences')
    .select('dispatch_status, messages')
    .eq('user_id', user.id)
    .in('dispatch_status', ['sent', 'replied', 'failed']);

  type Row = {
    dispatch_status: string | null;
    messages: Array<{ opens?: number | null; clicks?: number | null; replies?: number | null }>;
  };
  const seqRows = (rows ?? []) as Row[];

  let sent = 0;
  let replied = 0;
  let totalOpens = 0;
  let totalClicks = 0;
  let totalReplies = 0;

  for (const row of seqRows) {
    if (row.dispatch_status === 'sent') sent++;
    else if (row.dispatch_status === 'replied') {
      sent++;
      replied++;
    }
    const msgs = Array.isArray(row.messages) ? row.messages : [];
    for (const m of msgs) {
      totalOpens += m.opens ?? 0;
      totalClicks += m.clicks ?? 0;
      totalReplies += m.replies ?? 0;
    }
  }

  return NextResponse.json({
    sequencesDispatched: sent,
    sequencesReplied: replied,
    totalOpens,
    totalClicks,
    totalReplies,
  });
}
