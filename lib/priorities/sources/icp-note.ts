/**
 * The "ICPs need attention" note bridge.
 *
 * The Claude ICP audit only runs on the /icps side (the agent inbox). When it does,
 * `writeIcpNote` persists a tiny summary (count + the top finding) to `today_icp_note`.
 * `/today` then shows its row by READING that note via `computeIcpNotePriority` — a cheap
 * DB read, no LLM call. So /today never triggers the audit itself.
 *
 * Freshness: the note reflects the last time the audit ran on /icps. Since ICP edits and
 * dismissals both change the audit's input-hash (and so re-run + re-write the note on the
 * next /icps load), it stays current in practice. It is eventually-consistent, not live.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ROUTES } from '@/lib/routes';
import type { TodayPriority, PrioritySeverity } from '@/lib/priorities/types';
import type { IcpPriority, IcpPrioritySeverity } from '@/lib/priorities/sources/icp-audit';

const SEV_RANK: Record<IcpPrioritySeverity, number> = { high: 3, medium: 2, low: 1 };

function isSeverity(v: unknown): v is PrioritySeverity {
  return v === 'low' || v === 'medium' || v === 'high';
}

/**
 * Persist the audit's outcome as a per-user note. `priorities` is the already
 * dismissal-filtered, severity-ordered finding list from computeIcpAuditPriorities
 * (empty when nothing is wrong — we still upsert so the note clears to 0).
 */
export async function writeIcpNote(
  supabase: SupabaseClient,
  userId: string,
  priorities: IcpPriority[],
): Promise<void> {
  const top = priorities.length
    ? [...priorities].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity])[0]
    : null;

  await supabase.from('today_icp_note').upsert(
    {
      user_id: userId,
      issue_count: priorities.length,
      top_headline: top?.headline?.trim() || null,
      top_detail: top?.detail?.trim() || null,
      top_severity: top?.severity ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
}

/** /today source: read the persisted note → a TodayPriority row, or null when no issues. */
export async function computeIcpNotePriority(
  supabase: SupabaseClient,
  userId: string,
): Promise<TodayPriority | null> {
  const { data } = await supabase
    .from('today_icp_note')
    .select('issue_count, top_headline, top_detail, top_severity')
    .eq('user_id', userId)
    .maybeSingle();

  const note = data as
    | { issue_count: number; top_headline: string | null; top_detail: string | null; top_severity: string | null }
    | null;

  if (!note || !note.issue_count || note.issue_count <= 0) return null;

  const others = note.issue_count - 1;
  const baseDetail = note.top_detail?.trim() || 'Arcova flagged something to look at in your ICP set.';
  const detail = others > 0 ? `${baseDetail} (+${others} more ICP issue${others === 1 ? '' : 's'})` : baseDetail;

  return {
    // Keep the 'icp-audit' source key so dismissal ids / row identity stay consistent
    // with the prior behaviour.
    source: 'icp-audit',
    groupKey: 'default',
    severity: isSeverity(note.top_severity) ? note.top_severity : 'medium',
    title: note.top_headline?.trim() || 'ICPs need attention',
    detail,
    href: ROUTES.setup.icps,
    cta: 'Open ICPs',
  };
}
