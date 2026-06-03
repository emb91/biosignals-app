/**
 * GET /api/outreach/sequences
 *
 * Returns the user's outreach_sequences rows with joined contact + company
 * display info — used by the /outreach editor table.
 *
 * Optional query params:
 *   ?status=draft|sent|replied|failed (comma-separated)
 *   ?channel=lemlist|csv|clipboard|staged
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

interface SequenceRowOut {
  id: string;
  contact_id: string;
  company_id: string | null;
  anchor_hook_text: string;
  anchor_signal_type: string | null;
  anchor_signal_event_id: string | null;
  messages: unknown;
  dispatch_channel: string | null;
  dispatch_status: string | null;
  dispatch_error: string | null;
  external_ref: unknown;
  last_status_at: string | null;
  created_at: string;
  contact: {
    id: string;
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    job_title: string | null;
    company_name: string | null;
    linkedin_url: string | null;
  } | null;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const statusFilter = (url.searchParams.get('status') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const channelFilter = (url.searchParams.get('channel') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  let q = supabase
    .from('outreach_sequences')
    .select(
      `id, contact_id, company_id, anchor_hook_text, anchor_signal_type,
       anchor_signal_event_id, messages, dispatch_channel, dispatch_status,
       dispatch_error, external_ref, last_status_at, created_at`,
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (statusFilter.length > 0) q = q.in('dispatch_status', statusFilter);
  if (channelFilter.length > 0) q = q.in('dispatch_channel', channelFilter);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const contactIds = Array.from(
    new Set((rows ?? []).map((r) => (r as { contact_id: string }).contact_id)),
  );
  let contactMap = new Map<string, SequenceRowOut['contact']>();
  if (contactIds.length > 0) {
    const { data: contactRows } = await supabase
      .from('contacts')
      .select('id, full_name, first_name, last_name, email, job_title, company_name, linkedin_url')
      .eq('user_id', user.id)
      .in('id', contactIds);
    contactMap = new Map(
      (contactRows ?? []).map((c) => [
        (c as { id: string }).id,
        c as SequenceRowOut['contact'],
      ]),
    );
  }

  const out: SequenceRowOut[] = (rows ?? []).map((r) => {
    const row = r as SequenceRowOut;
    return { ...row, contact: contactMap.get(row.contact_id) ?? null };
  });

  return NextResponse.json({ sequences: out });
}
