/**
 * Coverage verdict — the single top-line answer the page opens with.
 *
 * Resolves everything the page knows (coverage gaps, CRM actuals, target,
 * plan + supply) into ONE status, ONE reason, and ONE recommended next action,
 * so a rep never has to synthesize a red banner + a green insight + a table.
 *
 * Resolution order (first match wins):
 *   no-icps    → nothing to assess (page shows its onboarding empty state)
 *   no-target  → coverage/performance exist but no number to pace against
 *   blocked    → target set but beyond the ICPs' addressable supply
 *   behind     → measurably behind quarter pace (attainment < elapsed − grace)
 *   plan-only  → target + plan, but no CRM actuals to pace with
 *   on-track   → at/ahead of pace (or target already hit)
 *
 * Pure and deterministic (clock passed in via elapsedFraction) — unit-tested
 * alongside the allocation engine.
 */
import type { CoverageTargetType } from './allocation';

export type CoverageVerdictStatus =
  | 'no-icps'
  | 'no-target'
  | 'blocked'
  | 'behind'
  | 'plan-only'
  | 'on-track';

export type CoverageVerdictAction = {
  kind: 'add-icp' | 'set-target' | 'review-supply' | 'source' | 'connect-crm' | 'add-companies';
  /** When kind === 'source' / 'add-companies': which ICP to act on. */
  icpId?: string;
  icpLabel?: string;
  /** Suggested contacts to source (from the plan), when kind === 'source'. */
  count?: number;
  label: string;
};

export type CoverageVerdict = {
  status: CoverageVerdictStatus;
  /** One sentence: the answer. */
  headline: string;
  /** The one reason behind the status (null when the headline says it all). */
  detail: string | null;
  action: CoverageVerdictAction | null;
  /** 0..1 attainment when a target + actuals exist (revenue or deals basis). */
  attainment: number | null;
};

export type CoverageVerdictInput = {
  icpCount: number;
  /** Labels of ICPs with critical coverage gaps (no/too-few/poor-fit companies). */
  gapIcpLabels: string[];
  /** Any CRM deals synced at all (attributed or not). */
  hasCrm: boolean;
  target: { type: CoverageTargetType; value: number } | null;
  /** Whole-book period actuals (null when no CRM). */
  actuals: { wonUsd: number; wonCount: number; openPipelineUsd: number } | null;
  /** Fraction of the quarter elapsed, 0..1. */
  elapsedFraction: number;
  weeksLeft: number;
  /** Plan shortfall in target units (0 when supply is unknown or sufficient). */
  shortfall: number;
  /** Highest-priority plan row (largest sub-target with something to buy). */
  topPriority: { icpId: string; label: string; toBuy: number } | null;
  /** e.g. 'Q2 2026' */
  periodLabel: string;
};

/** Attainment may lag pace by this much before we call it "behind". */
export const PACE_GRACE = 0.1;

function fmtUsd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
}

function fmtTarget(type: CoverageTargetType, value: number): string {
  return type === 'revenue' ? fmtUsd(value) : `${Math.round(value).toLocaleString()} deals`;
}

function fmtPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function sourceAction(top: CoverageVerdictInput['topPriority']): CoverageVerdictAction | null {
  if (!top || top.toBuy <= 0) return null;
  return {
    kind: 'source',
    icpId: top.icpId,
    icpLabel: top.label,
    count: top.toBuy,
    label: `Source ${top.toBuy.toLocaleString()} contacts for ${top.label}`,
  };
}

export function computeCoverageVerdict(input: CoverageVerdictInput): CoverageVerdict {
  const { icpCount, gapIcpLabels, hasCrm, target, actuals, elapsedFraction, weeksLeft, shortfall, topPriority, periodLabel } = input;

  if (icpCount === 0) {
    return {
      status: 'no-icps',
      headline: 'Define an ICP to start measuring coverage.',
      detail: null,
      action: { kind: 'add-icp', label: 'Add an ICP' },
      attainment: null,
    };
  }

  if (!target) {
    const gapDetail =
      gapIcpLabels.length > 0
        ? `${gapIcpLabels.length === 1 ? `${gapIcpLabels[0]} has` : `${gapIcpLabels.length} ICPs have`} a coverage gap, so fix that alongside setting the number.`
        : hasCrm
          ? 'Your deal data is connected, so the plan will use your real win rates.'
          : null;
    return {
      status: 'no-target',
      headline: `Set a ${periodLabel} target to turn coverage into a sourcing plan.`,
      detail: gapDetail,
      action: { kind: 'set-target', label: 'Set target' },
      attainment: null,
    };
  }

  // Attainment basis matches the target unit.
  const attainment =
    actuals == null
      ? null
      : target.type === 'revenue'
        ? actuals.wonUsd / target.value
        : actuals.wonCount / target.value;

  if (shortfall > 0) {
    return {
      status: 'blocked',
      headline: `Your ${periodLabel} target is beyond what your ICPs can supply.`,
      detail: `${fmtTarget(target.type, shortfall)} of the target has no addressable contacts behind it. Broaden an ICP, extend the timeline, or trim the number.`,
      action: { kind: 'review-supply', label: 'Review with the agent' },
      attainment,
    };
  }

  if (attainment == null) {
    // Plan exists but no CRM actuals to pace against.
    return {
      status: 'plan-only',
      headline: `Plan ready for your ${fmtTarget(target.type, target.value)} target.`,
      detail: 'Connect your CRM to track attainment against this number with real closed-won data.',
      action: sourceAction(topPriority) ?? { kind: 'connect-crm', label: 'Connect CRM' },
      attainment: null,
    };
  }

  if (attainment >= 1) {
    return {
      status: 'on-track',
      headline: `Target hit: ${fmtPct(attainment)} of ${fmtTarget(target.type, target.value)} closed.`,
      detail: weeksLeft > 0 ? `${weeksLeft} week${weeksLeft === 1 ? '' : 's'} still left in the quarter.` : null,
      action: sourceAction(topPriority),
      attainment,
    };
  }

  const behind = attainment < elapsedFraction - PACE_GRACE;
  const paceLine = `${fmtPct(attainment)} of target closed with ${weeksLeft} week${weeksLeft === 1 ? '' : 's'} left (pace says ${fmtPct(elapsedFraction)}).`;

  if (behind) {
    return {
      status: 'behind',
      headline: `Behind pace on your ${fmtTarget(target.type, target.value)} target.`,
      detail: paceLine,
      action: sourceAction(topPriority) ?? (gapIcpLabels.length > 0
        ? { kind: 'add-companies', label: 'Fix coverage gaps' }
        : null),
      attainment,
    };
  }

  return {
    status: 'on-track',
    headline: `On track for ${fmtTarget(target.type, target.value)}.`,
    detail: paceLine,
    action: sourceAction(topPriority),
    attainment,
  };
}
