/**
 * POST /api/outreach/lemlist/dispatch
 *
 * Takes one or more staged outreach_sequences rows (status='draft') and
 * pushes each into a chosen lemlist campaign as a lead with personalized
 * customVars. On success, flips the row's dispatch_status='sent' and stores
 * the returned lemlist lead id in external_ref. On failure, marks 'failed'
 * with dispatch_error so the row is visible + retriable in /outreach.
 *
 * Input: { sequenceIds: string[] }
 * Output: { results: Array<{ id, ok, error? }> }
 *
 * The destination is ALWAYS the auto-ensured "Arcova Multichannel" template —
 * there is no campaign choice. ensureArcovaTemplate is idempotent, so the first
 * dispatch silently creates it; subsequent ones reuse it. (No "Set up template"
 * step, no campaign picker — the Arcova template is the one and only path.)
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  AppSequenceStep,
  dispatchSequence,
  ensureArcovaTemplate,
  getLemlistKeyForCurrentUser,
  LemlistError,
} from '@/lib/lemlist';
import { getHubSpotTokenForUser, pushOutreachStatusByEmail } from '@/lib/hubspot';

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : 'Internal server error';
}

interface ContactRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  linkedin_url: string | null;
  company_name: string | null;
}

interface SequenceRow {
  id: string;
  contact_id: string;
  anchor_hook_text: string;
  anchor_signal_type: string | null;
  messages: AppSequenceStep[];
  dispatch_status: string | null;
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as {
      sequenceIds?: unknown;
    };
    const sequenceIds = Array.isArray(body.sequenceIds)
      ? (body.sequenceIds.filter((v) => typeof v === 'string') as string[])
      : [];

    if (sequenceIds.length === 0) {
      return NextResponse.json(
        { error: 'sequenceIds (non-empty) required' },
        { status: 400 },
      );
    }

    const apiKey = await getLemlistKeyForCurrentUser();
    if (!apiKey) {
      return NextResponse.json({ error: 'lemlist not connected' }, { status: 400 });
    }

    // Always dispatch into the Arcova template — auto-created on first send.
    let campaignId: string;
    try {
      ({ campaignId } = await ensureArcovaTemplate(apiKey));
    } catch (err) {
      if (err instanceof LemlistError) {
        return NextResponse.json(
          { error: 'lemlist API error', detail: err.body },
          { status: err.status === 401 ? 401 : 500 },
        );
      }
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Could not prepare the Arcova template' },
        { status: 500 },
      );
    }

    // HubSpot token is best-effort — null is fine, we just skip the CRM push.
    // Fetched once per dispatch batch rather than per row.
    const hubspotToken = await getHubSpotTokenForUser(user.id);

    // Load the staged rows + their contacts.
    const { data: seqRowsRaw, error: seqErr } = await supabase
      .from('outreach_sequences')
      .select('id, contact_id, anchor_hook_text, anchor_signal_type, messages, dispatch_status')
      .eq('user_id', user.id)
      .in('id', sequenceIds);

    if (seqErr) {
      return NextResponse.json({ error: seqErr.message }, { status: 500 });
    }
    const seqRows = (seqRowsRaw ?? []) as SequenceRow[];
    if (seqRows.length === 0) {
      return NextResponse.json({ error: 'No matching sequences' }, { status: 404 });
    }

    const contactIds = Array.from(new Set(seqRows.map((r) => r.contact_id)));
    const { data: contactRowsRaw } = await supabase
      .from('contacts')
      .select('id, email, first_name, last_name, full_name, linkedin_url, company_name')
      .eq('user_id', user.id)
      .in('id', contactIds);
    const contactById = new Map<string, ContactRow>(
      ((contactRowsRaw ?? []) as ContactRow[]).map((c) => [c.id, c]),
    );

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];

    // Dispatch sequentially — lemlist API doesn't love bursty per-account
    // traffic, and per-lead errors should be surfaced row-by-row.
    for (const row of seqRows) {
      const contact = contactById.get(row.contact_id);
      if (!contact || !contact.email) {
        await markFailed(supabase, row.id, user.id, 'Contact has no email');
        results.push({ id: row.id, ok: false, error: 'Contact has no email' });
        continue;
      }

      const messages = Array.isArray(row.messages) ? row.messages : [];
      if (messages.length === 0) {
        await markFailed(supabase, row.id, user.id, 'Sequence has no messages');
        results.push({ id: row.id, ok: false, error: 'Sequence has no messages' });
        continue;
      }

      try {
        const lemlistResult = await dispatchSequence(apiKey, {
          campaignId,
          contact: {
            email: contact.email,
            firstName: contact.first_name ?? undefined,
            lastName: contact.last_name ?? undefined,
            companyName: contact.company_name ?? undefined,
            linkedinUrl: contact.linkedin_url ?? undefined,
          },
          messages,
          anchor: {
            hookText: row.anchor_hook_text,
            signalType: row.anchor_signal_type,
          },
        });

        await supabase
          .from('outreach_sequences')
          .update({
            dispatch_status: 'sent',
            dispatch_channel: 'lemlist',
            external_ref: {
              lemlist_lead_id: lemlistResult._id ?? null,
              lemlist_campaign_id: campaignId,
              lemlist_lead_email: contact.email,
            },
            dispatch_error: null,
            last_status_at: new Date().toISOString(),
          })
          .eq('id', row.id)
          .eq('user_id', user.id);

        // Best-effort HubSpot mirror — never block dispatch on this. Customers
        // who haven't connected HubSpot or whose contact isn't in HubSpot
        // simply see a silent no-op (404 from HubSpot maps to 'not_found').
        if (hubspotToken) {
          try {
            await pushOutreachStatusByEmail(hubspotToken, {
              email: contact.email,
              status: 'sent',
              anchor: row.anchor_hook_text,
              channel: 'lemlist',
            });
          } catch (hubErr) {
            console.warn('[dispatch] hubspot push failed for', contact.email, hubErr);
          }
        }

        results.push({ id: row.id, ok: true });
      } catch (err) {
        const msg =
          err instanceof LemlistError
            ? `lemlist ${err.status}: ${err.body.slice(0, 200)}`
            : messageFromUnknown(err);
        await markFailed(supabase, row.id, user.id, msg);
        results.push({ id: row.id, ok: false, error: msg });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error('Error in outreach/lemlist/dispatch POST:', err);
    return NextResponse.json({ error: messageFromUnknown(err) }, { status: 500 });
  }
}

async function markFailed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  userId: string,
  error: string,
): Promise<void> {
  await supabase
    .from('outreach_sequences')
    .update({
      dispatch_status: 'failed',
      dispatch_channel: 'lemlist',
      dispatch_error: error,
      last_status_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId);
}
