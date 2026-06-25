/**
 * Shared conference-signal display helpers.
 *
 * Conference signals (exhibiting / presenting / attending) are forward-looking:
 * their `event_at` is the conference START date, not the detection date. So the
 * generic "Xd ago" relative-time framing is wrong for them — a show three months
 * out would read as "-90d ago". Both the /today briefing and the side-panel
 * Signals tab must render these the same way, so the formatting lives here.
 */

/** Signal keys in the conferences family. */
export const CONFERENCE_SIGNAL_KEYS = new Set([
  'exhibiting_at_conference',
  'presenting_at_conference',
  'attending_conference',
]);

export function isConferenceSignal(signalKey: string): boolean {
  return CONFERENCE_SIGNAL_KEYS.has(signalKey);
}

const CONF_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parse a YYYY-MM-DD string into parts without a timezone shift. */
function ymd(d: string | null | undefined): { y: number; m: number; day: number } | null {
  const mm = d?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return mm ? { y: +mm[1], m: +mm[2] - 1, day: +mm[3] } : null;
}

/**
 * Compact conference-date pill with a past/upcoming cue, built from the event
 * start/end dates at render time (not the stored phase, which can be stale).
 * Upcoming → bare future date ("Dec 12–15, 2026"); ongoing → "Live · …";
 * recently ended → "Ended · …" (the monitor suppresses anything >21d past).
 */
export function conferenceDatePill(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): string | null {
  const s = ymd(startDate);
  if (!s) return null;
  const e = ymd(endDate) ?? s;
  let range: string;
  if (e.y === s.y && e.m === s.m && e.day === s.day) range = `${CONF_MONTHS[s.m]} ${s.day}, ${s.y}`;
  else if (e.y === s.y && e.m === s.m) range = `${CONF_MONTHS[s.m]} ${s.day}–${e.day}, ${s.y}`;
  else if (e.y === s.y) range = `${CONF_MONTHS[s.m]} ${s.day} – ${CONF_MONTHS[e.m]} ${e.day}, ${s.y}`;
  else range = `${CONF_MONTHS[s.m]} ${s.day}, ${s.y} – ${CONF_MONTHS[e.m]} ${e.day}, ${e.y}`;
  const startMs = Date.UTC(s.y, s.m, s.day);
  const endMs = Date.UTC(e.y, e.m, e.day) + 86_400_000;
  const now = Date.now();
  if (now < startMs) return range;
  if (now <= endMs) return `Live · ${range}`;
  return `Ended · ${range}`;
}

function metaStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export type ConferenceDisplay = {
  /** Conference name to show as the card title, if present in metadata. */
  title: string | null;
  /** Booth pill text ("Booth 115"), if a booth is recorded. */
  boothPill: string | null;
  /** Date pill text ("Oct 13, 2026" / "Live · …" / "Ended · …"). */
  datePill: string | null;
  /** Convenience: boothPill + datePill, in order, with empties dropped. */
  pills: string[];
};

/**
 * Derive the side-panel/briefing display fields for a conference signal from its
 * source metadata. Reads the same keys the monitor writes (`conference_name`,
 * `booth`, `event_start_date`, `event_end_date`).
 */
export function conferenceDisplay(metadata: Record<string, unknown> | null | undefined): ConferenceDisplay {
  const meta = metadata ?? {};
  const title = metaStr(meta.conference_name);
  const booth = metaStr(meta.booth);
  const boothPill = booth ? `Booth ${booth}` : null;
  const datePill = conferenceDatePill(metaStr(meta.event_start_date), metaStr(meta.event_end_date));
  const pills = [boothPill, datePill].filter((p): p is string => Boolean(p));
  return { title, boothPill, datePill, pills };
}
