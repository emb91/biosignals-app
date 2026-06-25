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
import {
  hasCompleteBestPracticeCadence,
  sanitizeOutreachMessages,
  type OutreachSequenceMessage,
} from '@/lib/outreach-sequence';
import { getOrgContext } from '@/lib/org-context';
import { createAdminClient } from '@/lib/supabase-admin';
import { resolveOrgContactAccess } from '@/lib/org-contact-access';
import {
  findFreshOrgOutreachBlocker,
  findFreshOwnLegacyContactOutreachBlocker,
  orgOutreachBlockerPayload,
} from '@/lib/org-outreach';

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : 'Internal server error';
}

export async function POST(req: Request) {
  try {
    const ctx = await getOrgContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

    const admin = createAdminClient();
    const access = await resolveOrgContactAccess({
      id: contactId,
      orgId: ctx.orgId,
      userId: ctx.user.id,
      admin,
    });
    if (!access) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    const blocker = await findFreshOrgOutreachBlocker(admin, {
      userId: ctx.user.id,
      orgId: ctx.orgId,
      personId: access.personId,
    });
    if (blocker) {
      return NextResponse.json(orgOutreachBlockerPayload(blocker), { status: 409 });
    }
    const legacyBlocker = await findFreshOwnLegacyContactOutreachBlocker(admin, {
      userId: ctx.user.id,
      personId: access.personId,
      contactIds: [contactId, access.contactId],
    });
    if (legacyBlocker) {
      return NextResponse.json(orgOutreachBlockerPayload(legacyBlocker), { status: 409 });
    }

    const { data: contactRow } = await admin
      .from('contacts')
      .select('company_id')
      .eq('user_id', access.ownerUserId)
      .eq('id', access.contactId)
      .maybeSingle();
    if (!contactRow) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    const companyId = (contactRow as { company_id?: string | null } | null)?.company_id ?? null;

    const { data: inserted, error } = await ctx.supabase
      .from('outreach_sequences')
      .insert({
        user_id: ctx.user.id,
        org_id: ctx.orgId,
        person_id: access.personId,
        contact_id: access.contactId,
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
