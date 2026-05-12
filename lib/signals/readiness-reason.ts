import type {
  AccountReason,
  BuyerFunction,
  ReadinessDimension,
} from '@/lib/signals/readiness-types';
import type { AccountReadinessScoreResult, DimensionScoreResult } from '@/lib/signals/readiness-score';

type BuildReasonInput = {
  score: AccountReadinessScoreResult;
  companyName?: string | null;
  affectedFunctions?: BuyerFunction[];
};

const DIMENSION_LABEL: Record<ReadinessDimension, string> = {
  new_budget: 'fresh budget',
  new_needs: 'increased operational complexity',
  new_people: 'new owners or champions',
  new_strategy: 'strategic change',
  caution: 'timing risk',
};

function titleCaseFunctionName(value: BuyerFunction): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function topDimensions(score: AccountReadinessScoreResult): DimensionScoreResult[] {
  return Object.values(score.dimensions)
    .filter((dimension) => dimension.dimension !== 'caution')
    .filter((dimension) => dimension.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function formatDimensionList(dimensions: DimensionScoreResult[]): string {
  const labels = dimensions.map((dimension) => DIMENSION_LABEL[dimension.dimension]);
  if (!labels.length) return 'limited new buying-readiness evidence';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

function suggestedAngle(dimensions: DimensionScoreResult[]): string {
  const keys = new Set(dimensions.map((dimension) => dimension.dimension));

  if (keys.has('new_budget') && keys.has('new_needs')) {
    return 'Lead with a concrete hypothesis about newly funded work meeting increased execution complexity.';
  }
  if (keys.has('new_needs') && keys.has('new_people')) {
    return 'Lead with support for a team that is scaling into new operational burden.';
  }
  if (keys.has('new_strategy')) {
    return 'Lead with a point of view on changing priorities, scope, or vendor needs.';
  }
  if (keys.has('new_budget')) {
    return 'Lead with a clear use case tied to fresh budget and near-term spend justification.';
  }
  if (keys.has('new_people')) {
    return 'Lead with the needs of a new owner or champion who may be resetting tools or partners.';
  }
  return 'Lead with a specific, evidence-backed hypothesis rather than a generic fit-based pitch.';
}

function confidenceLabel(score: AccountReadinessScoreResult): AccountReason['confidenceLabel'] {
  const confidenceOrder = { low: 0, medium: 1, high: 2 } as const;
  const top = topDimensions(score);
  if (!top.length) return 'low';

  const lowest = top.reduce(
    (min, dimension) =>
      confidenceOrder[dimension.confidenceLabel] < confidenceOrder[min]
        ? dimension.confidenceLabel
        : min,
    top[0].confidenceLabel
  );

  return lowest;
}

export function buildAccountReason(input: BuildReasonInput): AccountReason {
  const active = topDimensions(input.score);
  const caution = input.score.dimensions.caution;
  const functionList = (input.affectedFunctions ?? []).slice(0, 3);
  const functionSummary =
    functionList.length > 0
      ? functionList.map(titleCaseFunctionName).join(', ')
      : 'the likely owning team';
  const companyPrefix = input.companyName ? `${input.companyName} ` : 'This account ';
  const dimensionSummary = formatDimensionList(active);

  let summaryShort = 'No strong timing signal yet.';
  let summaryLong = `${companyPrefix}currently shows limited new buying-readiness evidence beyond fit.`;
  let whyNow = 'This looks more like a fit-based account to monitor than an account to prioritize immediately.';

  if (active.length > 0) {
    summaryShort = `${companyPrefix}shows ${dimensionSummary}.`.replace(/\s+/g, ' ').trim();
    summaryLong = `${companyPrefix}appears timely because it is showing ${dimensionSummary}, which may indicate a real change in budget, urgency, or operating conditions.`;
    whyNow = `The strongest near-term hypothesis is that ${functionSummary} may be dealing with change now rather than operating in a steady state.`;
  }

  if (caution.score >= 0.7) {
    summaryLong += ' Caution signals suggest the timing should be qualified rather than treated as clean positive intent.';
    whyNow = 'There is meaningful change activity, but caution signals mean outreach timing should be handled carefully.';
  }

  return {
    summaryShort,
    summaryLong,
    whyNow,
    affectedFunctions: functionList,
    suggestedAngle: suggestedAngle(active),
    confidenceLabel: confidenceLabel(input.score),
  };
}

