/**
 * Pure CIK-cache staleness logic, split out from company-cik.ts so it can be
 * unit-tested without pulling in the SEC/LLM/Supabase dependency graph.
 */

/** How long a resolved (or confirmed-absent) CIK stays fresh before re-checking. */
export const CIK_REFRESH_DAYS = 90;

/**
 * A company needs CIK (re)resolution when it has never been checked or was last
 * checked more than `refreshDays` ago. A null/blank/invalid timestamp counts as
 * stale. The "confirmed no match" terminal state is represented by a recent
 * `cik_checked_at` with a null cik — which this treats as fresh (not stale), so
 * we don't re-resolve known-absent companies until the window elapses.
 */
export function isCikResolutionStale(
  cikCheckedAt: string | null | undefined,
  nowMs: number,
  refreshDays: number = CIK_REFRESH_DAYS,
): boolean {
  if (!cikCheckedAt) return true;
  const checked = new Date(cikCheckedAt).getTime();
  if (!Number.isFinite(checked) || checked <= 0) return true;
  return nowMs - checked >= refreshDays * 24 * 60 * 60 * 1000;
}
