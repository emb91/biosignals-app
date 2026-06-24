/**
 * Headcount-expansion readiness signal.
 *
 * Apollo's organization enrich returns 6/12/24-month headcount growth ratios at
 * NO extra cost (they ride on org-enrich calls we already make during company
 * enrichment). When a company's 12-month headcount growth clears a threshold we
 * emit a `headcount_expansion` signal (readiness dimension: new_people) — a soft,
 * free proxy for "this team is scaling" that complements the active job-postings
 * `hiring_expansion` signal.
 *
 * Dedup: one signal per (user, company, signal_key) per CALENDAR MONTH, keyed on
 * source_event_id, so re-enriching the same company doesn't re-emit.
 *
 * Threshold (MIN_GROWTH_PCT) and catalog impact (readiness-catalog.ts:
 * headcount_expansion = 42) are deliberately conservative — tune after review.
 *
 * Best-effort: callers must not let a failure here block enrichment.
 */
import type { createAdminClient } from '@/lib/supabase-admin';
import { insertSignalSourceEvent } from '@/lib/signals/readiness-store';
import { normalizeSignalSourceEvent } from '@/lib/signals/readiness-service';

type Admin = ReturnType<typeof createAdminClient>;

const SOURCE = 'apollo_org_enrich';
const SIGNAL_KEY = 'headcount_expansion' as const;
/** Minimum 12-month headcount growth (as a percentage) required to emit. */
const MIN_GROWTH_PCT = 20;

export type HeadcountGrowth = {
  growth6mo?: number | null;
  growth12mo?: number | null;
  growth24mo?: number | null;
};

/** Apollo returns growth as a ratio (0.25) — but be defensive if it's already a
 *  percent (25). Values with magnitude ≤ 5 are treated as ratios. */
function toPercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.abs(value) <= 5 ? value * 100 : value;
}

function monthKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Pull the three growth ratios off a raw Apollo organization object. */
export function extractHeadcountGrowth(rawOrg: unknown): HeadcountGrowth {
  const org = (rawOrg ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    growth6mo: num(org.organization_headcount_six_month_growth),
    growth12mo: num(org.organization_headcount_twelve_month_growth),
    growth24mo: num(org.organization_headcount_twenty_four_month_growth),
  };
}

/**
 * Emit a headcount-expansion signal for one (user, company) when 12-month growth
 * clears the threshold and we haven't already emitted it this calendar month.
 * Returns whether it emitted; the caller is responsible for recomputing readiness
 * when something was emitted.
 */
export async function runHeadcountSignalForCompany(
  admin: Admin,
  input: {
    userId: string;
    companyId: string;
    companyName: string | null;
    growth: HeadcountGrowth;
  },
): Promise<'emitted' | 'below_threshold' | 'duplicate'> {
  const growth12 = toPercent(input.growth.growth12mo);
  if (growth12 == null || growth12 < MIN_GROWTH_PCT) return 'below_threshold';

  const sourceEventId = `${SOURCE}:${input.companyId}:${SIGNAL_KEY}:${monthKey()}`;

  const { data: existing } = await admin
    .from('signal_source_events')
    .select('id')
    .eq('user_id', input.userId)
    .eq('source', SOURCE)
    .eq('source_event_id', sourceEventId)
    .limit(1)
    .maybeSingle();
  if (existing) return 'duplicate';

  const label = input.companyName?.trim() || 'This company';
  const growthRounded = Math.round(growth12);
  const summary =
    `${label} grew headcount roughly ${growthRounded}% over the past year. ` +
    'A scaling team often signals new needs and budget.';

  const rawEvent = await insertSignalSourceEvent(admin, {
    userId: input.userId,
    entityScope: 'company',
    companyId: input.companyId,
    source: SOURCE,
    sourceEventType: 'headcount_growth',
    sourceEventId,
    title: `Headcount expansion at ${label}`,
    summary,
    excerpt: summary,
    eventAt: new Date().toISOString(),
    metadata: {
      growth_6mo_pct: toPercent(input.growth.growth6mo),
      growth_12mo_pct: growth12,
      growth_24mo_pct: toPercent(input.growth.growth24mo),
      provider: 'apollo',
    },
  });

  await normalizeSignalSourceEvent(admin, {
    userId: input.userId,
    rawEvent,
    signalKeys: [SIGNAL_KEY],
    companyId: input.companyId,
  });

  return 'emitted';
}
