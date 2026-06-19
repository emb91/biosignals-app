/**
 * Routine-sweep fit gate — guardrail #2 of the enrichment cost model.
 *
 * Full enrichment (Apollo person+company + Apify profile+company) happens
 * ONCE per contact, at import. From then on the only cost we're allowed to
 * incur on a schedule is the cheap Apify scrape — and only on the slice
 * worth watching:
 *
 *   - Company hiring monitor      → companies whose fit clears the bar.
 *   - Contact job-change monitor  → contacts whose OWN fit clears the bar
 *                                    AND who sit at a good-fit company.
 *
 * The contact sweep is doubly-gated on purpose: we only spend the recurring
 * profile-scrape on a good person at an account that actually matters. A
 * high-fit contact stranded at a low-fit company isn't worth watching, and
 * neither is a low-fit contact at a great account.
 *
 * Sweeping the whole base on a schedule is the #1 way to blow ongoing data
 * cost, so these gates exist to make that structurally impossible. Apollo is
 * never on a schedule — it only fires when a sweep detects an actual change
 * (handled downstream by the enrichment queue), so it does not need a gate
 * here.
 *
 * Scores are stored 0–1 (a "70" in the UI is 0.70 here). Records with no fit
 * score yet are EXCLUDED (null = not yet worth spending on). The threshold is
 * env-tunable.
 *
 * Explicit single-record / targeted runs (a user picking specific contacts
 * or companies) bypass this gate — it only governs the rolling sweep.
 */

function envThreshold(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Minimum fit (0–1) for a record to be swept. Applies to both the company
 * hiring monitor and the contact job-change monitor. Default 0.70 — i.e. a
 * displayed fit of 70.
 */
export const SWEEP_FIT_THRESHOLD = envThreshold('SWEEP_FIT_MIN', 0.7);

/**
 * A company is sweep-eligible when its fit clears the bar. Null/unscored →
 * not eligible.
 */
export function isCompanySweepEligible(companyFitScore: number | null | undefined): boolean {
  return typeof companyFitScore === 'number' && companyFitScore >= SWEEP_FIT_THRESHOLD;
}

/**
 * A contact is sweep-eligible only when BOTH the contact and its company
 * clear the bar. Either score missing/unscored → not eligible.
 */
export function isContactSweepEligible(
  contactFitScore: number | null | undefined,
  companyFitScore: number | null | undefined,
): boolean {
  return (
    typeof contactFitScore === 'number' &&
    contactFitScore >= SWEEP_FIT_THRESHOLD &&
    isCompanySweepEligible(companyFitScore)
  );
}
