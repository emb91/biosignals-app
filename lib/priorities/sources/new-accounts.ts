/**
 * "New accounts" priority source.
 *
 * Surfaces accounts recently added to the user's workspace — `org_companies.added_at`
 * within a rolling window, excluding archived ones. This covers both ways a new account
 * appears: a contact import that brought a new company, and a contact job-change that
 * re-resolved to (and imported) a different company. Either can arrive with fresh signals.
 *
 * Cheap (no LLM): a count + name query. Names the specific accounts and deep-links to
 * the accounts table sorted newest-first (?sort=newest), since just-added accounts have
 * low/no fit score yet and would otherwise sit at the bottom of the priority sort.
 *
 * NOTE: this is a rolling time window, NOT a "since you last looked" diff — we don't yet
 * store a per-user baseline. So it answers "what's new lately," not "what's new since
 * your last visit." A baseline could tighten this later.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ROUTES } from '@/lib/routes';
import type { TodayPriority } from '@/lib/priorities/types';

const WINDOW_DAYS = 7;

/** "Acme Bio, NovaGen +2" — at most `max` names, then an overflow count. */
function namePreview(labels: string[], max = 3): string {
  const shown = labels.slice(0, max);
  const overflow = labels.length - shown.length;
  const base = shown.join(', ');
  return overflow > 0 ? `${base} +${overflow}` : base;
}

export async function computeNewAccountsPriority(
  supabase: SupabaseClient,
  userId: string,
  nowMs: number = Date.now(),
): Promise<TodayPriority | null> {
  const cutoffIso = new Date(nowMs - WINDOW_DAYS * 86_400_000).toISOString();

  const { data: links } = await supabase
    .from('accounts_view')
    .select('id, company_name, added_at')
    .eq('user_id', userId)
    .is('archived_at', null)
    .gte('added_at', cutoffIso)
    .order('added_at', { ascending: false });

  const linkRows = (links ?? []) as Array<{ id: string; company_name: string | null; added_at: string | null }>;
  const count = linkRows.length;
  if (count === 0) return null;

  // Preserve added_at-desc order (newest first) when listing names.
  const labels = linkRows
    .map((r) => r.company_name?.trim() || null)
    .filter((v): v is string => Boolean(v));

  const preview = namePreview(labels);

  return {
    source: 'new-accounts',
    groupKey: 'default',
    // Medium: worth a look (may carry fresh signals) but less time-critical than a
    // staged draft that's ready to send.
    severity: 'medium',
    title: count === 1 ? 'Review a new account' : `Review ${count} new accounts`,
    detail: preview
      ? `Recently added: ${preview}. New accounts can arrive from imports or contact job changes, and may carry fresh signals.`
      : `${count} accounts were recently added to your workspace and are worth a look.`,
    href: `${ROUTES.accounts}?sort=newest`,
    cta: 'Review accounts',
    count,
  };
}
