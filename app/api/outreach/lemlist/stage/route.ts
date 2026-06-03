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

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : 'Internal server error';
}

type StagedMessage = {
  day_offset: number;
  subject: string;
  body: string;
  channel: 'email' | 'linkedin';
};

/**
 * Channel mix copied directly from lemlist's default multichannel template
 * (help.lemlist.com — "How to build a multichannel outreach sequence").
 *
 *   Day 1  → Email      (#1 opener)
 *   Day 4  → Email      (#2 follow-up — back-to-back email is lemlist's pattern)
 *   Day 7  → LinkedIn   (connect request)
 *   Day 8  → LinkedIn   (message — assumes invite accepted)
 *   Day 11 → Email      (lemlist's slot is voice; we don't do voice, so email)
 *   Day 14 → LinkedIn   (final LI touch)
 *   Day 21 → Email      (breakup)
 *
 * Reps override per-step in /outreach's cell side-panel.
 */
function defaultChannelForDay(dayOffset: number): 'email' | 'linkedin' {
  const map: Record<number, 'email' | 'linkedin'> = {
    1: 'email',
    4: 'email',
    7: 'linkedin',
    8: 'linkedin',
    11: 'email',
    14: 'linkedin',
    21: 'email',
  };
  if (dayOffset in map) return map[dayOffset];
  // Fallback for unexpected day offsets — default to email (safer cold channel).
  return 'email';
}

function sanitizeMessages(input: unknown): StagedMessage[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((m): StagedMessage | null => {
      if (!m || typeof m !== 'object') return null;
      const o = m as Record<string, unknown>;
      const dayOffset =
        typeof o.day_offset === 'number' && Number.isFinite(o.day_offset)
          ? Math.floor(o.day_offset)
          : null;
      const subject = typeof o.subject === 'string' ? o.subject.trim() : '';
      const body = typeof o.body === 'string' ? o.body.trim() : '';
      // If the caller specified a channel explicitly, respect it; otherwise
      // apply the best-practice default for that day_offset.
      const explicitChannel =
        o.channel === 'linkedin' || o.channel === 'email' ? (o.channel as 'email' | 'linkedin') : null;
      if (dayOffset === null) return null;
      // Day 7 LI invite is a pure action — empty subject/body is allowed.
      const isInvite = dayOffset === 7 && (explicitChannel ?? defaultChannelForDay(dayOffset)) === 'linkedin';
      if (!isInvite && (!subject || !body)) return null;
      return {
        day_offset: dayOffset,
        subject,
        body,
        channel: explicitChannel ?? defaultChannelForDay(dayOffset),
      };
    })
    .filter((v): v is StagedMessage => v !== null);
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
    const messages = sanitizeMessages(body.messages);

    if (!contactId || !anchorHookText) {
      return NextResponse.json({ error: 'contactId and anchorHookText required' }, { status: 400 });
    }
    if (messages.length === 0) {
      return NextResponse.json({ error: 'messages required (sanitized empty)' }, { status: 400 });
    }

    // Inject the Day 7 LinkedIn invite action step if it isn't already present.
    // The generator emits 6 message-copy entries (Days 1, 4, 8, 11, 14, 21);
    // Day 7 is a pure connect-request action with no body to write. Putting
    // it in the messages array here keeps the /outreach table view + the
    // lemlist dispatch path symmetrical (every step is one row in messages).
    if (!messages.some((m) => m.day_offset === 7)) {
      const insertIdx = messages.findIndex((m) => m.day_offset > 7);
      const inviteStep: StagedMessage = {
        day_offset: 7,
        subject: '',
        body: '',
        channel: 'linkedin',
      };
      const at = insertIdx === -1 ? messages.length : insertIdx;
      messages.splice(at, 0, inviteStep);
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
