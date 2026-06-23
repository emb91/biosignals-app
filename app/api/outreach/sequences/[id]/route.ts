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
import {
  hasCompleteBestPracticeCadence,
  sanitizeOutreachMessages,
} from '@/lib/outreach-sequence';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { messages?: unknown };
  const messages = sanitizeOutreachMessages(body.messages);
  if (messages.length === 0) {
    return NextResponse.json({ error: 'messages required (sanitized empty)' }, { status: 400 });
  }
  if (!hasCompleteBestPracticeCadence(messages)) {
    return NextResponse.json(
      { error: 'Sequence must retain all seven email and LinkedIn steps.' },
      { status: 400 },
    );
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

  const { data: deleted, error } = await supabase
    .from('outreach_sequences')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
    .select('contact_id, company_id')
    .maybeSingle<{ contact_id: string | null; company_id: string | null }>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    ok: true,
    contactId: deleted?.contact_id ?? null,
    companyId: deleted?.company_id ?? null,
  });
}
