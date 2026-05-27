import { READINESS_SIGNAL_CATALOG_BY_KEY, getSignalBaseImpactScore } from '@/lib/signals/readiness-catalog';
import type {
  BuyerFunction,
  DimensionContribution,
  DimensionState,
  NormalizedSignal,
  ReadinessDimension,
  ReadinessLabel,
} from '@/lib/signals/readiness-types';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const DIMENSIONS: ReadinessDimension[] = [
  'new_budget',
  'new_needs',
  'new_people',
  'new_strategy',
  'caution',
];

export type ReadinessScoringOptions = {
  asOf?: Date;
  targetBuyerFunctions?: BuyerFunction[];
  compoundWindowDays?: number;
};

export type DimensionScoreResult = DimensionState & {
  dimension: ReadinessDimension;
  contributionCount: number;
};

export type AccountReadinessScoreResult = {
  overallScore: number;
  overallLabel: ReadinessLabel;
  dimensions: Record<ReadinessDimension, DimensionScoreResult>;
  topSignalIds: string[];
  freshnessScore: number | null;
  contributions: DimensionContribution[];
};

function clamp01(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function daysSince(iso: string | null, asOf: Date): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (asOf.getTime() - t) / MS_PER_DAY);
}

function scoreToLabel(score: number): ReadinessLabel {
  if (score >= 0.7) return 'high';
  if (score >= 0.35) return 'medium';
  return 'low';
}

function recencyMultiplier(signal: NormalizedSignal, asOf: Date): number {
  const catalog = READINESS_SIGNAL_CATALOG_BY_KEY[signal.signalKey];
  const decayDays = catalog.decayDays;
  const ageDays = daysSince(signal.eventAt ?? signal.observedAt, asOf);
  return clamp01(1 - ageDays / decayDays);
}

function relevanceMultiplier(
  signal: NormalizedSignal,
  targetBuyerFunctions?: BuyerFunction[]
): number {
  if (!targetBuyerFunctions?.length) return 1;
  if (!signal.buyerFunctions.length) return 0.8;

  const intersection = signal.buyerFunctions.filter((fn) => targetBuyerFunctions.includes(fn));
  if (intersection.length > 0) return 1;

  const adjacent = signal.buyerFunctions.some(
    (fn) =>
      fn === 'executive_leadership' ||
      fn === 'strategy_and_corporate_development' ||
      fn === 'procurement'
  );

  return adjacent ? 0.8 : 0.6;
}

function compoundBonus(
  signals: NormalizedSignal[],
  dimension: ReadinessDimension,
  asOf: Date,
  compoundWindowDays: number
): number {
  const recentDistinct = new Set(
    signals
      .filter((signal) => signal.dimensions.includes(dimension))
      .filter((signal) => daysSince(signal.eventAt ?? signal.observedAt, asOf) <= compoundWindowDays)
      .map((signal) => signal.signalKey)
  );

  return recentDistinct.size >= 2 ? 0.1 : 0;
}

function buildDimensionState(
  dimension: ReadinessDimension,
  signals: NormalizedSignal[],
  contributions: DimensionContribution[],
  asOf: Date,
  compoundWindowDays: number
): DimensionScoreResult {
  const dimensionContributions = contributions.filter((item) => item.dimension === dimension);
  const rawScore = dimensionContributions.reduce((sum, item) => sum + item.contribution, 0);
  const withCompound = clamp01(rawScore + compoundBonus(signals, dimension, asOf, compoundWindowDays));
  const sortedEvidenceIds = [...dimensionContributions]
    .sort((a, b) => b.contribution - a.contribution)
    .map((item) => item.signalId);

  return {
    dimension,
    score: withCompound,
    label: scoreToLabel(withCompound),
    evidenceIds: sortedEvidenceIds,
    contributionCount: dimensionContributions.length,
  };
}

function overallScoreFromDimensions(
  dimensions: Record<ReadinessDimension, DimensionScoreResult>
): number {
  const positive = [
    dimensions.new_budget.score,
    dimensions.new_needs.score,
    dimensions.new_people.score,
    dimensions.new_strategy.score,
  ];

  const highCount = positive.filter((score) => score >= 0.7).length;
  const maxPositive = Math.max(...positive, 0);
  const meanPositive = positive.reduce((sum, score) => sum + score, 0) / positive.length;

  let overall = Math.max(maxPositive, meanPositive);

  if (highCount >= 2) overall = Math.max(overall, 0.75);
  if (highCount >= 3) overall = Math.max(overall, 0.9);
  if (highCount === 1 && overall > 0.69) overall = 0.69;

  if (dimensions.caution.score >= 0.85) {
    overall = Math.max(0, overall - 0.2);
  } else if (dimensions.caution.score >= 0.7) {
    overall = Math.min(overall, 0.69);
  }

  return clamp01(overall);
}

function freshnessScore(signals: NormalizedSignal[], asOf: Date): number | null {
  if (!signals.length) return null;
  const recencies = signals.map((signal) => recencyMultiplier(signal, asOf));
  return clamp01(recencies.reduce((sum, value) => sum + value, 0) / recencies.length);
}

export function scoreAccountReadiness(
  signals: NormalizedSignal[],
  options: ReadinessScoringOptions = {}
): AccountReadinessScoreResult {
  const asOf = options.asOf ?? new Date();
  const compoundWindowDays = options.compoundWindowDays ?? 90;

  const contributions: DimensionContribution[] = signals.flatMap((signal) => {
    const strengthWeight = getSignalBaseImpactScore(signal.signalKey) / 100;
    const recency = recencyMultiplier(signal, asOf);
    const relevance = relevanceMultiplier(signal, options.targetBuyerFunctions);
    const contribution = clamp01(strengthWeight * recency * relevance);

    return signal.dimensions.map((dimension) => ({
      signalId: signal.id,
      dimension,
      contribution,
      inputs: {
        strengthWeight,
        recencyMultiplier: recency,
        relevanceMultiplier: relevance,
      },
    }));
  });

  const dimensions = Object.fromEntries(
    DIMENSIONS.map((dimension) => [
      dimension,
      buildDimensionState(dimension, signals, contributions, asOf, compoundWindowDays),
    ])
  ) as Record<ReadinessDimension, DimensionScoreResult>;

  const overallScore = overallScoreFromDimensions(dimensions);
  const topSignalIds = [...contributions]
    .sort((a, b) => b.contribution - a.contribution)
    .map((item) => item.signalId)
    .filter((signalId, index, arr) => arr.indexOf(signalId) === index)
    .slice(0, 5);

  return {
    overallScore,
    overallLabel: scoreToLabel(overallScore),
    dimensions,
    topSignalIds,
    freshnessScore: freshnessScore(signals, asOf),
    contributions,
  };
}
