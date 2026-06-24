/**
 * Pure cadence rules for the signal delta crons — no DB / module dependencies,
 * so they're trivially unit-testable. DB-bound sweep-target dispatch lives in
 * lib/billing/monitoring.ts.
 *
 * Each delta cron fires once a week on its own weekday (see vercel.json). Two
 * gates ride that weekly heartbeat:
 *   - growth  → every weekly tick (the cron schedule IS the cadence)
 *   - starter → first weekly tick of the month
 *   - free    → first weekly tick of the month
 *
 * Because each cron runs on a single weekday, "first occurrence of that weekday
 * this month" is simply day-of-month ≤ 7. All date math is UTC to match
 * Vercel's cron scheduler.
 */

export const WEEKLY_CADENCE_DAYS = 7;

/** True on the first occurrence of the current weekday within its month (UTC). */
export function isFirstWeekdayOccurrenceOfMonth(now: number = Date.now()): boolean {
  return new Date(now).getUTCDate() <= 7;
}

/**
 * Core predicate shared by both gates: given a cadence, is work due on this
 * weekly tick? Weekly cadences are due every tick; monthly cadences are due only
 * on the month's first occurrence of the cron's weekday.
 */
export function dueForCadence(cadenceDays: number, now: number = Date.now()): boolean {
  if (cadenceDays <= WEEKLY_CADENCE_DAYS) return true;
  return isFirstWeekdayOccurrenceOfMonth(now);
}

/**
 * Subscriber attribution gate for shared sweep targets. The shared target may
 * run at a faster cadence because another customer pays for it; this predicate
 * decides whether a given subscriber is due to receive writes from that run.
 */
export function dueForRollingCadence(
  cadenceDays: number,
  lastSuccessfulAt: number | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!lastSuccessfulAt) return true;
  return now - lastSuccessfulAt >= cadenceDays * 86_400_000;
}

/** Monitor lookback window (days) sized to comfortably cover one cadence gap. */
export function lookbackDaysForCadence(cadenceDays: number): number {
  // Weekly: 7-day gap + buffer. Monthly: first-weekday spacing runs up to ~35
  // days, so 37 covers it. source_event_id dedup makes the wider window safe.
  return cadenceDays <= WEEKLY_CADENCE_DAYS ? 10 : 37;
}
