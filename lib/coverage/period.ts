/**
 * Quarter-period helpers for Coverage targets. A period is the string
 * `'YYYY-Q{1-4}'` (e.g. '2026-Q2'). `gtm_targets` stores one row per
 * (user, period); history across periods drives the attainment trend.
 *
 * Pure + UTC-based so it's deterministic and unit-testable.
 */

export const PERIOD_RE = /^(\d{4})-Q([1-4])$/;

export function isValidPeriod(period: string): boolean {
  return PERIOD_RE.test(period);
}

/** Quarter string for a given date (defaults to now). */
export function quarterOf(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const q = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${y}-Q${q}`;
}

/** The quarter immediately before `period` (wraps the year at Q1). */
export function priorQuarter(period: string): string {
  const m = PERIOD_RE.exec(period);
  if (!m) return period;
  let y = Number(m[1]);
  let q = Number(m[2]) - 1;
  if (q < 1) {
    q = 4;
    y -= 1;
  }
  return `${y}-Q${q}`;
}

/** Human label, e.g. 'Q2 2026'. */
export function quarterLabel(period: string): string {
  const m = PERIOD_RE.exec(period);
  if (!m) return period;
  return `Q${m[2]} ${m[1]}`;
}

/** UTC [start, end) ISO bounds for a quarter — used for attainment queries. */
export function quarterDateRange(period: string): { startIso: string; endIso: string } | null {
  const m = PERIOD_RE.exec(period);
  if (!m) return null;
  const y = Number(m[1]);
  const q = Number(m[2]);
  const startMonth = (q - 1) * 3; // 0,3,6,9
  const start = new Date(Date.UTC(y, startMonth, 1));
  const end = new Date(Date.UTC(y, startMonth + 3, 1)); // exclusive
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}
