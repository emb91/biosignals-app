/**
 * "Priority score changed" priority sources — one for contacts, one for accounts.
 *
 * These flag when the `priority_score` METRIC (the 0–100 number that ranks a contact
 * on /contacts or an account on /accounts) has MOVED recently — in EITHER direction.
 * A move means their fit/readiness shifted (usually new buying signals or a CRM change),
 * so they're worth a re-check. This is NOT about re-ordering the /today to-do list.
 *
 * Grounded by `prev_priority_score` / `priority_changed_at` columns on
 * {contact,account}_readiness_snapshots, captured by BEFORE UPDATE triggers. The score
 * tables still overwrite; the triggers just remember the value from before the last move.
 *
 * Honesty: starts EMPTY (rows appear only once a score actually moves after the triggers
 * shipped — nothing back-filled), and reflects "the latest scoring run within WINDOW_DAYS",
 * not "since you last looked" (no per-user baseline).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isEligibleForPriorityNudge } from '@/lib/effective-priority';
import { ROUTES } from '@/lib/routes';
import type { TodayPriority } from '@/lib/priorities/types';

const WINDOW_DAYS = 7;
// Minimum |move| on the 0–1 scale to count — filters out recompute jitter. 0.05 = 5 pts.
const CHANGE_THRESHOLD = 0.05;

function pct(score: number): number {
  return Math.round(score <= 1 ? score * 100 : score);
}

/** "Jane Doe (41→72)" — before→after as 0–100, arrow implied by the numbers. */
function moveLabel(name: string, prev: number, next: number): string {
  return `${name} (${pct(prev)}→${pct(next)})`;
}

function preview(labels: string[], max = 2): string {
  const shown = labels.slice(0, max);
  const overflow = labels.length - shown.length;
  return shown.join(', ') + (overflow > 0 ? ` +${overflow}` : '');
}

function compactChangeDetail(kind: 'contact' | 'account', labels: string[], count: number): string {
  const noun = kind === 'contact' ? 'contact' : 'account';
  const names = labels.map((label) => label.replace(/\s+\([^)]*\)$/, ''));
  const namesPreview = preview(names);
  return namesPreview
    ? `${namesPreview} changed priority.`
    : `${count} ${noun}${count === 1 ? '' : 's'} changed priority.`;
}

type ChangedSnap = {
  entityId: string;
  priority_score: number;
  prev_priority_score: number;
  delta: number;
};

/** Shared: pull snapshots whose priority moved >= threshold in the window, biggest move first. */
async function fetchChanged(
  supabase: SupabaseClient,
  userId: string,
  table: 'contact_readiness_snapshots' | 'account_readiness_snapshots',
  idColumn: 'contact_id' | 'company_id',
  cutoffIso: string,
): Promise<ChangedSnap[]> {
  const { data } = await supabase
    .from(table)
    .select(`${idColumn}, priority_score, prev_priority_score, priority_changed_at`)
    .eq('user_id', userId)
    .gte('priority_changed_at', cutoffIso)
    .not('prev_priority_score', 'is', null)
    .not('priority_score', 'is', null);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows
    .map((r) => {
      const priority_score = r.priority_score as number;
      const prev_priority_score = r.prev_priority_score as number;
      return {
        entityId: String(r[idColumn] ?? ''),
        priority_score,
        prev_priority_score,
        delta: priority_score - prev_priority_score,
      };
    })
    .filter((r) => r.entityId && Math.abs(r.delta) >= CHANGE_THRESHOLD)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export async function computeContactPriorityChanges(
  supabase: SupabaseClient,
  userId: string,
  nowMs: number = Date.now(),
): Promise<TodayPriority | null> {
  const cutoffIso = new Date(nowMs - WINDOW_DAYS * 86_400_000).toISOString();
  const changed = await fetchChanged(supabase, userId, 'contact_readiness_snapshots', 'contact_id', cutoffIso);
  if (changed.length === 0) return null;

  const ids = [...new Set(changed.map((c) => c.entityId))];
  const { data: contacts, error: contactsError } = await supabase
    .from('contacts')
    .select('id, full_name, first_name, last_name, crm_is_suppressed')
    .eq('user_id', userId)
    .in('id', ids);
  // Suppression is a safety/eligibility gate. If we cannot verify it, do not
  // fail open and surface a potentially closed-won/lost contact.
  if (contactsError) return null;

  const contactRows = (contacts ?? []) as Array<{
    id: string;
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    crm_is_suppressed: boolean | null;
  }>;
  // Drop CRM-suppressed contacts (closed-won/lost in cooldown). Their DISPLAYED
  // priority is pinned low by read-time suppression, so the raw snapshot score
  // moving is invisible to the user — nudging "re-check them" is just confusing.
  const contactById = new Map(contactRows.map((c) => [c.id, c] as const));
  const visible = changed.filter((c) =>
    isEligibleForPriorityNudge(contactById.get(c.entityId)?.crm_is_suppressed),
  );
  if (visible.length === 0) return null;

  const nameById = new Map(
    contactRows
      .map((c) => [
        c.id,
        (c.full_name && c.full_name.trim()) || [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || '',
      ] as const)
      .filter(([, name]) => Boolean(name)),
  );

  const labels = visible
    .map((c) => {
      const name = nameById.get(c.entityId);
      return name ? moveLabel(name, c.prev_priority_score, c.priority_score) : null;
    })
    .filter((v): v is string => Boolean(v));

  const count = visible.length;
  const topId = visible[0]?.entityId ?? null;
  return {
    source: 'contact-priority-changes',
    groupKey: 'default',
    severity: 'medium',
    title: count === 1 ? 'Review priority change' : `Review ${count} priority changes`,
    detail: compactChangeDetail('contact', labels, count),
    href: topId ? `${ROUTES.contacts}?lead=${encodeURIComponent(topId)}` : ROUTES.contacts,
    cta: 'Review',
    count,
    meta: { contactIds: visible.map((c) => c.entityId) },
  };
}

export async function computeAccountPriorityChanges(
  supabase: SupabaseClient,
  userId: string,
  nowMs: number = Date.now(),
): Promise<TodayPriority | null> {
  const cutoffIso = new Date(nowMs - WINDOW_DAYS * 86_400_000).toISOString();
  const changed = await fetchChanged(supabase, userId, 'account_readiness_snapshots', 'company_id', cutoffIso);
  if (changed.length === 0) return null;

  const ids = [...new Set(changed.map((c) => c.entityId))];
  const { data: companies, error: companiesError } = await supabase
    .from('accounts_view')
    .select('id, company_name, crm_is_suppressed')
    .eq('user_id', userId)
    .in('id', ids);
  // As above, fail closed if either identity or org-scoped suppression state
  // cannot be verified. A transient lookup error must not resurrect bad nudges.
  if (companiesError) return null;

  // Drop CRM-suppressed accounts (closed-won/lost in cooldown) — same reason as
  // contacts: their displayed priority is pinned low, so a raw-score move is a
  // confusing nudge.
  const companyIds = new Set(
    ((companies ?? []) as Array<{ id: string; company_name: string | null }>).map((c) => c.id),
  );
  const suppressionByCompanyId = new Map(
    ((companies ?? []) as Array<{ id: string; crm_is_suppressed: boolean | null }>).map(
      (c) => [c.id, c.crm_is_suppressed] as const,
    ),
  );
  const visible = changed.filter(
    (c) =>
      companyIds.has(c.entityId) &&
      isEligibleForPriorityNudge(suppressionByCompanyId.get(c.entityId)),
  );
  if (visible.length === 0) return null;

  const nameById = new Map(
    ((companies ?? []) as Array<{ id: string; company_name: string | null }>)
      .filter((c) => c.company_name?.trim())
      .map((c) => [c.id, c.company_name!.trim()] as const),
  );

  const labels = visible
    .map((c) => {
      const name = nameById.get(c.entityId);
      return name ? moveLabel(name, c.prev_priority_score, c.priority_score) : null;
    })
    .filter((v): v is string => Boolean(v));

  const count = visible.length;
  const topId = visible[0]?.entityId ?? null;
  const accountIds = visible.map((c) => c.entityId);
  const href = (() => {
    if (accountIds.length > 1) {
      const params = new URLSearchParams({
        accountIds: accountIds.join(','),
        focus: 'priority_changes',
      });
      return `${ROUTES.accounts}?${params.toString()}`;
    }
    return topId ? `${ROUTES.accounts}?companyId=${encodeURIComponent(topId)}` : ROUTES.accounts;
  })();

  return {
    source: 'account-priority-changes',
    groupKey: 'default',
    severity: 'medium',
    title: count === 1 ? 'Review priority change' : `Review ${count} priority changes`,
    detail: compactChangeDetail('account', labels, count),
    href,
    cta: 'Review',
    count,
    meta: { accountIds },
  };
}
