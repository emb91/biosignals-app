/**
 * POST /api/outreach/lemlist/stage
 *
 * Persists a freshly-generated sequence as a *draft* in outreach_sequences.
 * Called by the side-panel "Stage for outreach" button. The user then lands
 * on /outreach to review/edit/select-channels before clicking "Send to lemlist".
 *
 * Input: {
 *   contactId,
 *   anchorHookText,
 *   anchorSignalEventId?,
 *   anchorSignalType?,
 *   messages: Array<{ day_offset, subject, body, channel? }>
 * }
 * Output: { id }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  hasCompleteBestPracticeCadence,
  sanitizeOutreachMessages,
  type OutreachSequenceMessage,
} from '@/lib/outreach-sequence';

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : 'Internal server error';
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as {
      contactId?: unknown;
      anchorHookText?: unknown;
      anchorSignalEventId?: unknown;
      anchorSignalType?: unknown;
      messages?: unknown;
    };

    const contactId = typeof body.contactId === 'string' ? body.contactId.trim() : '';
    const anchorHookText = typeof body.anchorHookText === 'string' ? body.anchorHookText.trim() : '';
    const anchorSignalEventId =
      typeof body.anchorSignalEventId === 'string' && body.anchorSignalEventId
        ? body.anchorSignalEventId
        : null;
    const anchorSignalType =
      typeof body.anchorSignalType === 'string' ? body.anchorSignalType : null;
    const messages: OutreachSequenceMessage[] = sanitizeOutreachMessages(body.messages, {
      injectLinkedInInvite: true,
    });

    if (!contactId || !anchorHookText) {
      return NextResponse.json({ error: 'contactId and anchorHookText required' }, { status: 400 });
    }
    if (messages.length === 0) {
      return NextResponse.json({ error: 'messages required (sanitized empty)' }, { status: 400 });
    }
    if (!hasCompleteBestPracticeCadence(messages)) {
      return NextResponse.json(
        { error: 'Sequence is missing one or more required email or LinkedIn steps. Generate it again.' },
        { status: 400 },
      );
    }

    const { data: contactRow } = await supabase
      .from('contacts')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('id', contactId)
      .maybeSingle();
    const companyId = (contactRow as { company_id?: string | null } | null)?.company_id ?? null;

    const { data: inserted, error } = await supabase
      .from('outreach_sequences')
      .insert({
        user_id: user.id,
        contact_id: contactId,
        company_id: companyId,
        anchor_signal_event_id: anchorSignalEventId,
        anchor_signal_type: anchorSignalType,
        anchor_hook_text: anchorHookText,
        messages,
        exported_to: 'staged',           // legacy column, kept non-null
        dispatch_channel: 'lemlist',
        dispatch_status: 'draft',
      })
      .select('id')
      .single();

    if (error) {
      console.error('outreach_sequences stage insert:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ id: (inserted as { id: string }).id });
  } catch (err) {
    console.error('Error in outreach/lemlist/stage POST:', err);
    return NextResponse.json({ error: messageFromUnknown(err) }, { status: 500 });
  }
}
