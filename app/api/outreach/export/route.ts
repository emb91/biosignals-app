/**
 * POST /api/outreach/export
 *
 * Persists a generated (and possibly edited) outreach sequence to
 * outreach_sequences, then returns either CSV (for download) or the same
 * messages plus a copyable plain-text bundle.
 *
 * The user-facing "Save & download CSV" and "Save & copy clipboard" buttons
 * both POST here; only the exportFormat field differs.
 *
 * Input: {
 *   contactId,
 *   anchorHookText,
 *   anchorSignalEventId?,
 *   anchorSignalType?,        // e.g. 'funding_round', 'role_change' — for analytics
 *   messages: Array<{ day_offset, subject, body }>,
 *   exportFormat: 'csv' | 'clipboard'
 * }
 * Output: { id, csv?, clipboardText? }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Internal server error';
}

type Message = { day_offset: number; subject: string; body: string };

function sanitizeMessages(input: unknown): Message[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((m): Message | null => {
      if (!m || typeof m !== 'object') return null;
      const o = m as Record<string, unknown>;
      const dayOffset = typeof o.day_offset === 'number' && Number.isFinite(o.day_offset)
        ? Math.floor(o.day_offset)
        : null;
      const subject = typeof o.subject === 'string' ? o.subject.trim() : '';
      const body = typeof o.body === 'string' ? o.body.trim() : '';
      if (dayOffset === null || !subject || !body) return null;
      return { day_offset: dayOffset, subject, body };
    })
    .filter((v): v is Message => v !== null);
}

/**
 * CSV format that imports cleanly into both Apollo and HeyReach sequence
 * importers. Columns: step, day_offset, subject, body. Body is wrapped in
 * quotes and double-quoted to escape internal quotes.
 */
function buildCsv(messages: Message[]): string {
  const header = 'step,day_offset,subject,body';
  const rows = messages.map((m, i) => {
    const subject = `"${m.subject.replace(/"/g, '""')}"`;
    const body = `"${m.body.replace(/"/g, '""').replace(/\r?\n/g, '\\n')}"`;
    return `${i + 1},${m.day_offset},${subject},${body}`;
  });
  return [header, ...rows].join('\n');
}

/**
 * Plain-text bundle for clipboard. One message per block, separated by a
 * horizontal rule. Reps paste this into their email tool one-at-a-time.
 */
function buildClipboardText(messages: Message[]): string {
  return messages
    .map((m, i) => {
      const dayLabel = m.day_offset === 0 ? 'Day 0 (initial)' : `Day ${m.day_offset} (follow-up)`;
      return `── Message ${i + 1} · ${dayLabel} ──
Subject: ${m.subject}

${m.body}`;
    })
    .join('\n\n');
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      contactId?: unknown;
      anchorHookText?: unknown;
      anchorSignalEventId?: unknown;
      anchorSignalType?: unknown;
      messages?: unknown;
      exportFormat?: unknown;
    };

    const contactId = typeof body.contactId === 'string' ? body.contactId.trim() : '';
    const anchorHookText = typeof body.anchorHookText === 'string' ? body.anchorHookText.trim() : '';
    const anchorSignalEventId = typeof body.anchorSignalEventId === 'string' && body.anchorSignalEventId
      ? body.anchorSignalEventId
      : null;
    const anchorSignalType = typeof body.anchorSignalType === 'string' ? body.anchorSignalType : null;
    const exportFormat = body.exportFormat === 'clipboard' ? 'clipboard' : 'csv';
    const messages = sanitizeMessages(body.messages);

    if (!contactId || !anchorHookText) {
      return NextResponse.json({ error: 'contactId and anchorHookText required' }, { status: 400 });
    }
    if (messages.length === 0) {
      return NextResponse.json({ error: 'messages required (sanitized to empty)' }, { status: 400 });
    }

    // Look up the contact's company_id for storage convenience.
    const { data: contactRow } = await supabase
      .from('contacts')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('id', contactId)
      .maybeSingle();
    const companyId = (contactRow as { company_id?: string | null } | null)?.company_id ?? null;

    // Persist.
    const { data: inserted, error: insertErr } = await supabase
      .from('outreach_sequences')
      .insert({
        user_id: user.id,
        contact_id: contactId,
        company_id: companyId,
        anchor_signal_event_id: anchorSignalEventId,
        anchor_signal_type: anchorSignalType,
        anchor_hook_text: anchorHookText,
        messages,
        exported_to: exportFormat,
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('outreach_sequences insert:', insertErr);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    const id = (inserted as { id: string }).id;

    if (exportFormat === 'csv') {
      return NextResponse.json({ id, csv: buildCsv(messages) });
    }
    return NextResponse.json({ id, clipboardText: buildClipboardText(messages) });
  } catch (error) {
    console.error('Error in outreach/export POST:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
