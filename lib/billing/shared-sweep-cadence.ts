/**
 * Earliest `next_sweep_at` across a shared source target's active subscriber
 * sweeps, falling back to a provided cadence-derived timestamp when there are
 * no active subscribers to read from.
 *
 * After a sweep run, the shared source target must become due again when the
 * *next* subscriber is due — not simply `now + fastestCadence`. Advancing by the
 * fastest cadence can overshoot a slower subscriber whose own due date falls
 * before the fastest subscriber's next run (e.g. a monthly subscriber due in 2
 * days while the weekly subscriber was just advanced 7 days out), delaying that
 * subscriber's reveal/freshness. Recompute from the subscriber rows instead.
 */
export function pickSharedNextSweepAt(
  subscriberNextSweepAts: Array<string | null | undefined>,
  fallbackIso: string,
): string {
  let earliest: string | null = null;
  for (const value of subscriberNextSweepAts) {
    if (!value) continue;
    if (earliest === null || new Date(value).getTime() < new Date(earliest).getTime()) {
      earliest = value;
    }
  }
  return earliest ?? fallbackIso;
}
