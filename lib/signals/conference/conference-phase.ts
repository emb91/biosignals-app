/**
 * Conference signal lifecycle — phase from the conference date (NOT a decay curve).
 *
 * The actionable datum is the conference date. A row carries start/end dates; the
 * phase is a pure function of those + "now" and drives the outreach angle:
 *
 *   upcoming  — before start            → "in case you're planning on going to CPHI…" (registration / intent)
 *   live      — during the event        → "know you're at CPHI today — grab a coffee?"
 *   recent    — 0..21d after end         → "did you enjoy CPHI last week?"
 *   expired   — >21d after end           → dead; suppress
 *
 * Implementation is a HARD EXPIRY at end + 21d, not a smooth decay. Phase is
 * computed on read (store nowhere). Unknown dates → 'upcoming' (kept alive rather
 * than wrongly expired). A single-day event (no end) uses start as the end-day.
 */
export type ConferencePhase = 'upcoming' | 'live' | 'recent' | 'expired';

export const CONFERENCE_RECENT_WINDOW_DAYS = 21;
const DAY_MS = 86_400_000;

export function conferencePhase(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  now: Date,
): ConferencePhase {
  const startT = startDate ? Date.parse(startDate) : NaN;
  const baseEnd = endDate ? Date.parse(endDate) : startT;
  // Treat the end date as the end of that calendar day so same-day "now" reads as live.
  const endT = Number.isNaN(baseEnd) ? NaN : baseEnd + DAY_MS - 1;
  const t = now.getTime();

  if (!Number.isNaN(endT) && t > endT + CONFERENCE_RECENT_WINDOW_DAYS * DAY_MS) return 'expired';
  if (!Number.isNaN(startT) && t < startT) return 'upcoming';
  if (!Number.isNaN(startT) && !Number.isNaN(endT) && t >= startT && t <= endT) return 'live';
  if (!Number.isNaN(endT) && t > endT) return 'recent';
  return 'upcoming';
}

/** A conference signal is suppressed once it expires (>21d after the event ends). */
export function isConferenceSignalAlive(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  now: Date,
): boolean {
  return conferencePhase(startDate, endDate, now) !== 'expired';
}
