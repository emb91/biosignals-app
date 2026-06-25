/**
 * Headcount-change readiness signals (both directions).
 *
 * Apollo's organization enrich returns 6/12/24-month headcount growth ratios at
 * NO extra cost (they ride on org-enrich calls we already make during company
 * enrichment). From the 12-month figure we emit one of two soft, free signals:
 *
 *   - `headcount_expansion` (dimension new_people) when growth ≥ +15% — a
 *     scaling team, a softer proxy than the active-job-postings `hiring_expansion`.
 *   - `headcount_contraction` (dimension caution) when growth ≤ −25% — a sharp
 *     workforce cut, a soft restructuring/distress proxy that suppresses
 *     readiness. Softer than a confirmed `restructuring` signal (press/SEC).
 *
 * Dedup: one signal per (user, company, signal_key) per CALENDAR MONTH, keyed on
 * source_event_id, so re-enriching the same company doesn't re-emit.
 *
 * Thresholds + catalog impacts (headcount_expansion = 42, headcount_contraction
 * = 45) are deliberately conservative — tune after review.
 *
 * Best-effort: callers must not let a failure here block enrichment.
 */
import type { createAdminClient } from '@/lib/supabase-admin';
import type { SignalKey } from '@/lib/signals/readiness-types';
import { insertSignalSourceEvent } from '@/lib/signals/readiness-store';
import { normalizeSignalSourceEvent } from '@/lib/signals/readiness-service';

type Admin = ReturnType<typeof createAdminClient>;

const SOURCE = 'apollo_org_enrich';
/** Emit `headcount_expansion` at or above this 12-month growth (percent). */
const EXPANSION_MIN_PCT = 15;
/** Emit `headcount_contraction` (caution) at or below this 12-month change (percent). */
const CONTRACTION_MAX_PCT = -25;

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

/** Decide which (if any) headcount signal a 12-month change warrants. */
function classifyHeadcountChange(
  growth12: number,
  label: string,
): { signalKey: SignalKey; sourceEventType: string; title: string; summary: string } | null {
  if (growth12 >= EXPANSION_MIN_PCT) {
    return {
      signalKey: 'headcount_expansion',
      sourceEventType: 'headcount_growth',
      title: `Headcount expansion at ${label}`,
      summary:
        `${label} grew headcount roughly ${Math.round(growth12)}% over the past year. ` +
        'A scaling team often signals new needs and budget.',
    };
  }
  if (growth12 <= CONTRACTION_MAX_PCT) {
    return {
      signalKey: 'headcount_contraction',
      sourceEventType: 'headcount_decline',
      title: `Headcount contraction at ${label}`,
      summary:
        `${label} cut headcount roughly ${Math.abs(Math.round(growth12))}% over the past year — ` +
        'possible restructuring or distress. Treat with caution.',
    };
  }
  return null;
}

/**
 * Emit a headcount expansion/contraction signal for one (user, company) when the
 * 12-month change clears a threshold and we haven't already emitted that signal
 * this calendar month. Returns whether it emitted; the caller recomputes
 * readiness when something was emitted.
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
  if (growth12 == null) return 'below_threshold';

  const label = input.companyName?.trim() || 'This company';
  const classified = classifyHeadcountChange(growth12, label);
  if (!classified) return 'below_threshold';

  const sourceEventId = `${SOURCE}:${input.companyId}:${classified.signalKey}:${monthKey()}`;

  const { data: existing } = await admin
    .from('signal_source_events')
    .select('id')
    .eq('user_id', input.userId)
    .eq('source', SOURCE)
    .eq('source_event_id', sourceEventId)
    .limit(1)
    .maybeSingle();
  if (existing) return 'duplicate';

  const rawEvent = await insertSignalSourceEvent(admin, {
    userId: input.userId,
    entityScope: 'company',
    companyId: input.companyId,
    source: SOURCE,
    sourceEventType: classified.sourceEventType,
    sourceEventId,
    title: classified.title,
    summary: classified.summary,
    excerpt: classified.summary,
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
    signalKeys: [classified.signalKey],
    companyId: input.companyId,
  });

  return 'emitted';
}
