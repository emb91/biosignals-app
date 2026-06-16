/**
 * POST /api/outreach/download-csv
 *
 * Bundles one or more staged sequences into a single CSV the rep can paste
 * into any sequencer. One row per (contact, step). Columns:
 *
 *   contact_name, contact_email, company, anchor_signal, step, day_offset,
 *   channel, subject, body
 *
 * Input: { sequenceIds: string[] }
 * Output: text/csv (Content-Disposition: attachment)
 *
 * Side panel CSV export is kept for the single-contact path; this is the
 * bulk path used from /outreach's selected-row toolbar.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getOrgEntitlements } from '@/lib/billing/entitlements';
import { billingEnforcementEnabled } from '@/lib/billing/consume';

interface Msg {
  day_offset: number;
  subject: string;
  body: string;
  channel?: 'email' | 'linkedin';
}

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Exports/day gate.
  if (billingEnforcementEnabled()) {
    const admin = createAdminClient();
    const { data: member } = await admin
      .from('org_members')
      .select('org_id')
      .eq('user_id', user.id)
      .maybeSingle<{ org_id: string }>();
    if (member?.org_id) {
      const ents = await getOrgEntitlements(member.org_id);
      const { data: newCount } = await admin.rpc('increment_org_export_count', {
        p_org_id: member.org_id,
        p_user_id: user.id,
      });
      // Rollback if over limit: decrement by re-calling with -1 equivalent is not
      // straightforward, so we check BEFORE incrementing when possible. Here we
      // increment first and check after — if over limit, the count is already up
      // but we deny the download. Acceptable for MVP; tighten later if needed.
      if (typeof newCount === 'number' && newCount > ents.exportsPerDay) {
        return NextResponse.json(
          { error: `You've reached your ${ents.exportsPerDay} exports/day limit. It resets at midnight UTC.` },
          { status: 429 },
        );
      }
    }
  }

  const body = (await req.json().catch(() => ({}))) as { sequenceIds?: unknown };
  const sequenceIds = Array.isArray(body.sequenceIds)
    ? (body.sequenceIds.filter((v) => typeof v === 'string') as string[])
    : [];
  if (sequenceIds.length === 0) {
    return NextResponse.json({ error: 'sequenceIds required' }, { status: 400 });
  }

  const { data: rows } = await supabase
    .from('outreach_sequences')
    .select('id, contact_id, anchor_hook_text, anchor_signal_type, messages')
    .eq('user_id', user.id)
    .in('id', sequenceIds);

  const seqRows = (rows ?? []) as Array<{
    id: string;
    contact_id: string;
    anchor_hook_text: string;
    anchor_signal_type: string | null;
    messages: Msg[];
  }>;

  const contactIds = Array.from(new Set(seqRows.map((r) => r.contact_id)));
  const contactMap = new Map<string, { name: string; email: string; company: string }>();
  if (contactIds.length > 0) {
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, full_name, first_name, last_name, email, company_name')
      .eq('user_id', user.id)
      .in('id', contactIds);
    for (const c of (contacts ?? []) as Array<{
      id: string;
      full_name: string | null;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      company_name: string | null;
    }>) {
      const name =
        c.full_name?.trim() ||
        [c.first_name, c.last_name].filter(Boolean).join(' ') ||
        'Unknown contact';
      contactMap.set(c.id, { name, email: c.email ?? '', company: c.company_name ?? '' });
    }
  }

  const header = [
    'contact_name',
    'contact_email',
    'company',
    'anchor_signal',
    'step',
    'day_offset',
    'channel',
    'subject',
    'body',
  ].join(',');

  const lines: string[] = [header];
  for (const seq of seqRows) {
    const contact = contactMap.get(seq.contact_id);
    const messages = Array.isArray(seq.messages) ? seq.messages : [];
    messages.forEach((m, idx) => {
      lines.push(
        [
          csvEscape(contact?.name),
          csvEscape(contact?.email),
          csvEscape(contact?.company),
          csvEscape(seq.anchor_hook_text),
          csvEscape(idx + 1),
          csvEscape(m.day_offset),
          csvEscape(m.channel ?? 'email'),
          csvEscape(m.subject),
          csvEscape(m.body),
        ].join(','),
      );
    });
  }

  const csv = lines.join('\n');
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="arcova-outreach-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
