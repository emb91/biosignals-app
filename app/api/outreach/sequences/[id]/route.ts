/**
 * PATCH /api/outreach/sequences/[id]
 *
 * Update a single sequence's messages (subject/body/channel per step).
 * Used by the /outreach cell side-panel editor. Drafts can be fully edited;
 * sent rows can be edited locally but we surface a "diverged from lemlist"
 * note in the UI (v2 will push edits back via lemlist's update-lead endpoint).
 *
 * DELETE /api/outreach/sequences/[id]
 *
 * Remove a row from /outreach. Only deletes our DB row — does NOT call
 * lemlist's lead-delete (the rep can do that in lemlist if needed).
 *
 * Input (PATCH): { messages: Array<{ day_offset, subject, body, channel }> }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

type EditableMessage = {
  day_offset: number;
  subject: string;
  body: string;
  channel: 'email' | 'linkedin';
};

function sanitizeMessages(input: unknown): EditableMessage[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((m): EditableMessage | null => {
      if (!m || typeof m !== 'object') return null;
      const o = m as Record<string, unknown>;
      const dayOffset =
        typeof o.day_offset === 'number' && Number.isFinite(o.day_offset)
          ? Math.floor(o.day_offset)
          : null;
      const subject = typeof o.subject === 'string' ? o.subject.trim() : '';
      const body = typeof o.body === 'string' ? o.body.trim() : '';
      const channel = o.channel === 'linkedin' ? 'linkedin' : 'email';
      if (dayOffset === null) return null;
      // Day 7 LinkedIn invite is a pure action — empty subject/body is allowed.
      const isInvite = dayOffset === 7 && channel === 'linkedin';
      if (!isInvite && (!subject || !body)) return null;
      return { day_offset: dayOffset, subject, body, channel };
    })
    .filter((v): v is EditableMessage => v !== null);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { messages?: unknown };
  const messages = sanitizeMessages(body.messages);
  if (messages.length === 0) {
    return NextResponse.json({ error: 'messages required (sanitized empty)' }, { status: 400 });
  }

  const { error } = await supabase
    .from('outreach_sequences')
    .update({ messages, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await supabase
    .from('outreach_sequences')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
