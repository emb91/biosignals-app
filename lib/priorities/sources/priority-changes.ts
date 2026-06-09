/**
 * "Priority rose" priority source.
 *
 * Surfaces contacts whose priority_score has RECENTLY MOVED UP — a real to-do, since a
 * rising priority means their fit/readiness improved (usually new buying signals or a
 * CRM change) and they're now more worth acting on.
 *
 * Grounded by the `prev_priority_score` / `priority_changed_at` columns on
 * contact_readiness_snapshots, captured by a BEFORE UPDATE trigger
 * (capture_contact_priority_change). The score table itself still overwrites; the trigger
 * just remembers the value from before the most recent change.
 *
 * IMPORTANT semantics / honesty:
 * - This is "changed in the latest scoring run, within WINDOW_DAYS" — NOT "since you last
 *   looked" (no per-user baseline). If a score moved twice between visits, only the last
 *   hop is captured.
 * - It starts EMPTY: rows only appear once a contact's score actually moves after the
 *   trigger shipped. Nothing is back-filled or invented.
 * - Rises only. A falling priority isn't a task, so it's excluded by design.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ROUTES } from '@/lib/routes';
import type { TodayPriority } from '@/lib/priorities/types';

const WINDOW_DAYS = 7;
// Minimum upward move (0–1 scale) to count — filters out recompute jitter. 0.05 = +5pts.
const RISE_THRESHOLD = 0.05;

function pct(score: number | null): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return Math.round(score <= 1 ? score * 100 : score);
}

type ContactRow = {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
};

function contactName(c: ContactRow | undefined): string | null {
  if (!c) return null;
  return (
    (c.full_name && c.full_name.trim()) ||
    [c.first_name, c.last_name].filter(Boolean).join(' ').trim() ||
    null
  );
}

export async function computePriorityChangesPriority(
  supabase: SupabaseClient,
  userId: string,
  nowMs: number = Date.now(),
): Promise<TodayPriority | null> {
  const cutoffIso = new Date(nowMs - WINDOW_DAYS * 86_400_000).toISOString();

  const { data: snaps } = await supabase
    .from('contact_readiness_snapshots')
    .select('contact_id, priority_score, prev_priority_score, priority_changed_at')
    .eq('user_id', userId)
    .gte('priority_changed_at', cutoffIso)
    .not('prev_priority_score', 'is', null)
    .not('priority_score', 'is', null);

  type Snap = {
    contact_id: string;
    priority_score: number;
    prev_priority_score: number;
    priority_changed_at: string | null;
  };
  const rows = (snaps ?? []) as Snap[];

  // Keep only meaningful UPWARD moves; sort biggest jump first.
  const risen = rows
    .map((r) => ({ ...r, delta: r.priority_score - r.prev_priority_score }))
    .filter((r) => r.delta >= RISE_THRESHOLD)
    .sort((a, b) => b.delta - a.delta);

  if (risen.length === 0) return null;

  const contactIds = [...new Set(risen.map((r) => r.contact_id).filter(Boolean))];
  let contactsById = new Map<string, ContactRow>();
  if (contactIds.length > 0) {
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, full_name, first_name, last_name')
      .eq('user_id', userId)
      .in('id', contactIds);
    contactsById = new Map(((contacts ?? []) as ContactRow[]).map((c) => [c.id, c]));
  }

  // "Jane Doe (41→72), Bob Lee (38→61) +2" — biggest movers first, max 2 named.
  const named = risen
    .map((r) => {
      const name = contactName(contactsById.get(r.contact_id));
      if (!name) return null;
      const from = pct(r.prev_priority_score);
      const to = pct(r.priority_score);
      return from != null && to != null ? `${name} (${from}→${to})` : name;
    })
    .filter((v): v is string => Boolean(v));

  const count = risen.length;
  const shown = named.slice(0, 2);
  const overflow = named.length - shown.length;
  const preview = shown.join(', ') + (overflow > 0 ? ` +${overflow}` : '');

  // Deep-link to the biggest mover's panel so it's never a bare list landing.
  const topContactId = risen[0]?.contact_id ?? null;
  const href = topContactId
    ? `${ROUTES.leads.contacts}?lead=${encodeURIComponent(topContactId)}`
    : ROUTES.leads.contacts;

  return {
    source: 'priority-changes',
    groupKey: 'default',
    severity: 'medium',
    title: count === 1 ? 'A contact rose in priority' : `${count} contacts rose in priority`,
    detail: preview
      ? `${preview} — their priority moved up, so they're worth a fresh look.`
      : `${count} contacts moved up in priority recently.`,
    href,
    cta: 'Review',
    count,
  };
}
