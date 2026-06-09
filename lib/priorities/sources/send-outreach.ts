/**
 * "Send outreach" priority source.
 *
 * Surfaces sequences that are STAGED but not yet dispatched (dispatch_status='draft')
 * — the same state the contacts table's `send_outreach` action represents. This is
 * committed work the rep has already generated and just needs to send, so it's a
 * high-leverage to-do: the row names the specific contacts and deep-links straight
 * to the Drafts tab of the outreach editor.
 *
 * Cheap (no LLM): a plain count + name query. `getSendOutreachHash` lets the
 * aggregator detect changes without recomputing anything heavy.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ROUTES } from '@/lib/routes';
import type { TodayPriority } from '@/lib/priorities/types';

// 'draft' mirrors applyOutreachOverride() in lib/lead-action.ts: a draft sequence
// is what promotes a contact's action to "Send outreach". Sent/replied/failed are
// other states with their own surfaces, so they're deliberately excluded here.
const STAGED_STATUS = 'draft';

function djb2(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

/** Cheap inputs-hash — staged sequence ids + their last-status timestamps. */
export async function getSendOutreachHash(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from('outreach_sequences')
    .select('id, last_status_at, updated_at')
    .eq('user_id', userId)
    .eq('dispatch_status', STAGED_STATUS);
  const rows = (data ?? []) as Array<{ id: string; last_status_at: string | null; updated_at: string | null }>;
  const key = rows
    .map((r) => `${r.id}:${r.last_status_at ?? r.updated_at ?? ''}`)
    .sort()
    .join('|');
  return `draft_${djb2(key)}`;
}

type ContactRow = {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
};

function contactLabel(c: ContactRow | undefined): string | null {
  if (!c) return null;
  const name =
    (c.full_name && c.full_name.trim()) ||
    [c.first_name, c.last_name].filter(Boolean).join(' ').trim() ||
    '';
  if (!name) return null;
  return c.company_name?.trim() ? `${name} (${c.company_name.trim()})` : name;
}

/** "Jane (Acme), Bob (BioCorp) +2" — at most `max` names, then an overflow count. */
function namePreview(labels: string[], max = 2): string {
  const shown = labels.slice(0, max);
  const overflow = labels.length - shown.length;
  const base = shown.join(', ');
  return overflow > 0 ? `${base} +${overflow}` : base;
}

export async function computeSendOutreachPriority(
  supabase: SupabaseClient,
  userId: string,
): Promise<TodayPriority | null> {
  const { data: drafts } = await supabase
    .from('outreach_sequences')
    .select('id, contact_id, updated_at')
    .eq('user_id', userId)
    .eq('dispatch_status', STAGED_STATUS)
    .order('updated_at', { ascending: false });

  const draftRows = (drafts ?? []) as Array<{ id: string; contact_id: string | null; updated_at: string | null }>;
  const count = draftRows.length;
  if (count === 0) return null;

  // Resolve contact names in a second query (avoids relying on PostgREST FK embedding).
  const contactIds = [...new Set(draftRows.map((r) => r.contact_id).filter((v): v is string => Boolean(v)))];
  let contactsById = new Map<string, ContactRow>();
  if (contactIds.length > 0) {
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, full_name, first_name, last_name, company_name')
      .eq('user_id', userId)
      .in('id', contactIds);
    contactsById = new Map(((contacts ?? []) as ContactRow[]).map((c) => [c.id, c]));
  }

  // Preserve draft order (most-recently-updated first) when building the name list.
  const labels = draftRows
    .map((r) => (r.contact_id ? contactLabel(contactsById.get(r.contact_id)) : null))
    .filter((v): v is string => Boolean(v));

  const noun = count === 1 ? 'sequence' : 'sequences';
  const preview = namePreview(labels);

  return {
    source: 'send-outreach',
    groupKey: 'default',
    // High: the work is already done; it just needs to go out, and a staged draft
    // ages (signals/timing it was built on go stale). Surface it near the top.
    severity: 'high',
    title: count === 1 ? 'Send a staged outreach sequence' : `Send ${count} staged outreach ${noun}`,
    detail: preview
      ? `Drafted and ready to dispatch: ${preview}.`
      : `${count} outreach ${noun} are drafted and waiting to send.`,
    href: `${ROUTES.outreach}?status=draft`,
    cta: 'Open drafts',
    count,
  };
}
