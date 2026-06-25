/**
 * GET /api/outreach/failures
 *
 * Returns outreach_sequences rows currently in dispatch_status='failed' — used
 * by /log's "Outreach errors" section so reps can see what dispatches blew up
 * and why, with a retry path.
 *
 * Output: { count, failures: [{ id, contact_id, contact_name, anchor_hook_text, dispatch_channel, dispatch_error, last_status_at }] }
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: rows } = await supabase
    .from('outreach_sequences')
    .select('id, contact_id, anchor_hook_text, dispatch_channel, dispatch_error, last_status_at, created_at')
    .eq('user_id', user.id)
    .eq('dispatch_status', 'failed')
    .order('last_status_at', { ascending: false, nullsFirst: false })
    .limit(50);

  const seqRows = (rows ?? []) as Array<{
    id: string;
    contact_id: string;
    anchor_hook_text: string;
    dispatch_channel: string | null;
    dispatch_error: string | null;
    last_status_at: string | null;
    created_at: string;
  }>;

  const contactIds = Array.from(new Set(seqRows.map((r) => r.contact_id)));
  let contactMap = new Map<string, string>();
  if (contactIds.length > 0) {
    const admin = createAdminClient();
    const { data: contacts } = await admin
      .from('contacts')
      .select('id, full_name, first_name, last_name, company_name')
      .in('id', contactIds);
    contactMap = new Map(
      (contacts ?? []).map((c) => {
        const row = c as { id: string; full_name?: string | null; first_name?: string | null; last_name?: string | null; company_name?: string | null };
        const name =
          row.full_name?.trim() ||
          [row.first_name, row.last_name].filter(Boolean).join(' ') ||
          'Unknown contact';
        const full = row.company_name ? `${name} · ${row.company_name}` : name;
        return [row.id, full];
      }),
    );
  }

  return NextResponse.json({
    count: seqRows.length,
    failures: seqRows.map((r) => ({
      id: r.id,
      contact_id: r.contact_id,
      contact_name: contactMap.get(r.contact_id) ?? 'Unknown contact',
      anchor_hook_text: r.anchor_hook_text,
      dispatch_channel: r.dispatch_channel,
      dispatch_error: r.dispatch_error,
      last_status_at: r.last_status_at ?? r.created_at,
    })),
  });
}
