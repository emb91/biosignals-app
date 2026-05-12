import { buildAccountReason } from '@/lib/signals/readiness-reason';
import { scoreAccountReadiness, type AccountReadinessScoreResult } from '@/lib/signals/readiness-score';
import type {
  AccountReadinessContext,
  BuyerFunction,
  ConfidenceLabel,
  NormalizedSignal,
  ReadinessLabel,
  RecommendedRouteContact,
  SignalEvidence,
} from '@/lib/signals/readiness-types';

export type BuildReadinessContextInput = {
  accountId: string;
  companyName: string;
  fitScore: number;
  fitLabel?: ReadinessLabel;
  signals: NormalizedSignal[];
  topSignalEvidence?: SignalEvidence[];
  affectedFunctions?: BuyerFunction[];
  recommendedContacts?: RecommendedRouteContact[];
  targetBuyerFunctions?: BuyerFunction[];
  limitTopSignals?: number;
  precomputedScore?: AccountReadinessScoreResult;
};

function clamp01(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function scoreToLabel(score: number): ReadinessLabel {
  if (score >= 0.7) return 'high';
  if (score >= 0.35) return 'medium';
  return 'low';
}

function confidenceFromSignals(signals: NormalizedSignal[]): ConfidenceLabel {
  if (!signals.length) return 'low';

  const order = { low: 0, medium: 1, high: 2 } as const;
  const avg =
    signals.reduce((sum, signal) => sum + order[signal.defaultConfidence], 0) / signals.length;

  if (avg >= 1.5) return 'high';
  if (avg >= 0.75) return 'medium';
  return 'low';
}

function toSignalEvidence(signal: NormalizedSignal): SignalEvidence {
  return {
    id: signal.id,
    signalKey: signal.signalKey,
    scope: signal.scope,
    source: 'normalized_signal',
    sourceUrl: null,
    eventAt: signal.eventAt,
    excerpt: signal.evidenceExcerpt,
    confidenceLabel: signal.defaultConfidence,
  };
}

function deriveAffectedFunctions(
  explicitFunctions: BuyerFunction[] | undefined,
  signals: NormalizedSignal[]
): BuyerFunction[] {
  if (explicitFunctions?.length) return [...new Set(explicitFunctions)].slice(0, 5);

  return [...new Set(signals.flatMap((signal) => signal.buyerFunctions))].slice(0, 5);
}

export function buildAccountReadinessContext(
  input: BuildReadinessContextInput
): AccountReadinessContext {
  const fitScore = clamp01(input.fitScore);
  const score =
    input.precomputedScore ??
    scoreAccountReadiness(input.signals, {
      targetBuyerFunctions: input.targetBuyerFunctions,
    });

  const affectedFunctions = deriveAffectedFunctions(input.affectedFunctions, input.signals);
  const reason = buildAccountReason({
    score,
    companyName: input.companyName,
    affectedFunctions,
  });

  const topSignals =
    input.topSignalEvidence?.slice(0, input.limitTopSignals ?? 5) ??
    input.signals
      .filter((signal) => score.topSignalIds.includes(signal.id))
      .map(toSignalEvidence)
      .slice(0, input.limitTopSignals ?? 5);

  return {
    accountId: input.accountId,
    companyName: input.companyName,
    fit: {
      score: fitScore,
      label: input.fitLabel ?? scoreToLabel(fitScore),
    },
    readiness: {
      overallScore: score.overallScore,
      overallLabel: score.overallLabel,
      newBudget: score.dimensions.new_budget,
      newNeeds: score.dimensions.new_needs,
      newPeople: score.dimensions.new_people,
      newStrategy: score.dimensions.new_strategy,
      caution: score.dimensions.caution,
    },
    reason: {
      ...reason,
      confidenceLabel: reason.confidenceLabel || confidenceFromSignals(input.signals),
    },
    route: {
      recommendedContacts: input.recommendedContacts ?? [],
    },
    topSignals,
  };
}

