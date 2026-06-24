/**
 * Pure scrape-window gate for the Phase 3 social-intent sync.
 *
 * The social scrape is paid Apify, so it is HARD-GATED to in-window conferences:
 * not expired AND within the pre-event lead. A show whose start is still far out is
 * never scraped (no spend on dead/early shows). Split out of sync-social-delta.ts so
 * it carries no Supabase/Apify chain and is unit-testable.
 */
import { conferencePhase, type ConferencePhase } from '../conference-phase';

/**
 * Pre-event lead: start scraping a show's hashtag this many days before it starts.
 * The signal is most actionable in the upcoming/live phases; recent/expired shows
 * are skipped entirely.
 */
export const SOCIAL_PRE_EVENT_LEAD_DAYS = 42; // ~6 weeks
const DAY_MS = 86_400_000;

/**
 * Is a conference inside the social scrape window? In-window === not expired AND
 * within the pre-event lead. Unknown dates are treated as in-window (kept alive,
 * matching conferencePhase's bias).
 */
export function inSocialScrapeWindow(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  now: Date,
): { inWindow: boolean; phase: ConferencePhase } {
  const phase = conferencePhase(startDate, endDate, now);
  if (phase === 'expired') return { inWindow: false, phase };
  if (phase === 'upcoming' && startDate) {
    const startT = Date.parse(startDate);
    if (!Number.isNaN(startT) && startT - now.getTime() > SOCIAL_PRE_EVENT_LEAD_DAYS * DAY_MS) {
      return { inWindow: false, phase }; // too far out — don't pay yet
    }
  }
  return { inWindow: true, phase };
}
