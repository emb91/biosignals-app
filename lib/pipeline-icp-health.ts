/**
 * Thresholds and helpers for Pipeline ICP health cards (coverage, contact fit, depth).
 */

export type HealthDim = 'red' | 'amber' | 'green';

/** Companies below this count show the thin-data banner. */
export const PIPELINE_MIN_COMPANIES_FOR_ASSESSMENT = 5;

/** Company coverage: red <= this, amber up to AMBER_MAX, else green. */
export const COVERAGE_RED_MAX = 2;
export const COVERAGE_AMBER_MAX = 9;

/** Contact fit uses mean contact_fit_score in 0–1 (or 0–100 normalized to 0–1). */
export const FIT_RED_BELOW = 0.4;
export const FIT_GREEN_ABOVE = 0.7;

/** Average company fit below this is a coverage gap regardless of company count. */
export const COMPANY_FIT_GAP_BELOW = 0.6;

/** Average contacts per company. */
export const DEPTH_RED_BELOW = 1.5;
export const DEPTH_GREEN_ABOVE = 3;

export type PipelineDataRequestType =
  | 'expand_companies'
  | 'better_contacts'
  | 'more_contacts_at_accounts'
  | 'contacts_at_company';

export function normalizeFitScore01(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value > 1 && value <= 100) return value / 100;
  if (value >= 0 && value <= 1) return value;
  return null;
}

export function coverageHealth(companyCount: number): HealthDim {
  if (companyCount <= COVERAGE_RED_MAX) return 'red';
  if (companyCount <= COVERAGE_AMBER_MAX) return 'amber';
  return 'green';
}

export function contactFitHealth(avgFit01: number | null): HealthDim {
  if (avgFit01 == null) return 'red';
  if (avgFit01 < FIT_RED_BELOW) return 'red';
  if (avgFit01 <= FIT_GREEN_ABOVE) return 'amber';
  return 'green';
}

export function depthHealth(avgDepth: number | null): HealthDim {
  if (avgDepth == null || !Number.isFinite(avgDepth)) return 'red';
  if (avgDepth < DEPTH_RED_BELOW) return 'red';
  if (avgDepth < DEPTH_GREEN_ABOVE) return 'amber';
  return 'green';
}

export function overallHealth(coverage: HealthDim, fit: HealthDim, depth: HealthDim): HealthDim {
  const rank = (d: HealthDim) => (d === 'red' ? 0 : d === 'amber' ? 1 : 2);
  const r = Math.min(rank(coverage), rank(fit), rank(depth));
  return r === 0 ? 'red' : r === 1 ? 'amber' : 'green';
}

const DIM_RANK = (d: HealthDim) => (d === 'red' ? 0 : d === 'amber' ? 1 : 2);

/**
 * Sort ascending "health score": most broken first (reds before ambers before greens).
 * Tie-break: more dimension reds first, then fewer companies.
 */
export function comparePipelineCards(
  a: {
    overall: HealthDim;
    coverage: HealthDim;
    contact_fit: HealthDim;
    depth: HealthDim;
    company_count: number;
  },
  b: {
    overall: HealthDim;
    coverage: HealthDim;
    contact_fit: HealthDim;
    depth: HealthDim;
    company_count: number;
  },
): number {
  const oa = DIM_RANK(a.overall);
  const ob = DIM_RANK(b.overall);
  if (oa !== ob) return oa - ob;

  const badness = (x: typeof a) =>
    (x.coverage === 'red' ? 4 : x.coverage === 'amber' ? 2 : 0) +
    (x.contact_fit === 'red' ? 4 : x.contact_fit === 'amber' ? 2 : 0) +
    (x.depth === 'red' ? 4 : x.depth === 'amber' ? 2 : 0);

  const ba = badness(a);
  const bb = badness(b);
  if (ba !== bb) return bb - ba;

  return a.company_count - b.company_count;
}

export function isWeakDim(d: HealthDim): boolean {
  return d === 'red' || d === 'amber';
}

export function healthDotClass(d: HealthDim): string {
  switch (d) {
    case 'red':
      return 'bg-red-500';
    case 'amber':
      return 'bg-amber-400';
    case 'green':
      return 'bg-emerald-500';
  }
}

export function healthLabel(d: HealthDim): string {
  switch (d) {
    case 'red':
      return 'Needs attention';
    case 'amber':
      return 'Could improve';
    case 'green':
      return 'Healthy';
  }
}
