/**
 * GET /api/outreach/replied
 *
 * Returns the user's outreach_sequences rows currently in dispatch_status='replied'
 * — i.e. contacts who responded to a lemlist sequence and need a human to take
 * over. Used by /today's "Needs your reply" agenda item.
 *
 * Output: { count, sequences: [{ id, contact_id, contact_name, anchor_hook_text, last_status_at, lemlist_lead_id, lemlist_lead_email }] }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: rows } = await supabase
    .from('outreach_sequences')
    .select('id, contact_id, anchor_hook_text, last_status_at, external_ref')
    .eq('user_id', user.id)
    .eq('dispatch_status', 'replied')
    .order('last_status_at', { ascending: false })
    .limit(20);

  const seqRows = (rows ?? []) as Array<{
    id: string;
    contact_id: string;
    anchor_hook_text: string;
    last_status_at: string | null;
    external_ref: { lemlist_lead_id?: string | null; lemlist_lead_email?: string | null } | null;
  }>;

  const contactIds = Array.from(new Set(seqRows.map((r) => r.contact_id)));
  let contactMap = new Map<string, { full_name: string | null; first_name: string | null; last_name: string | null }>();
  if (contactIds.length > 0) {
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, full_name, first_name, last_name')
      .eq('user_id', user.id)
      .in('id', contactIds);
    contactMap = new Map(
      (contacts ?? []).map((c) => [
        (c as { id: string }).id,
        c as { full_name: string | null; first_name: string | null; last_name: string | null },
      ]),
    );
  }

  return NextResponse.json({
    count: seqRows.length,
    sequences: seqRows.map((r) => {
      const c = contactMap.get(r.contact_id);
      const name =
        c?.full_name?.trim() ||
        [c?.first_name, c?.last_name].filter(Boolean).join(' ') ||
        'Unknown contact';
      return {
        id: r.id,
        contact_id: r.contact_id,
        contact_name: name,
        anchor_hook_text: r.anchor_hook_text,
        last_status_at: r.last_status_at,
        lemlist_lead_id: r.external_ref?.lemlist_lead_id ?? null,
        lemlist_lead_email: r.external_ref?.lemlist_lead_email ?? null,
      };
    }),
  });
}
