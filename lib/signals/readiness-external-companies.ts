import {
  generateAccountReason,
  ingestSignalSourceEvent,
  normalizeSignalSourceEvent,
  recomputeAccountReadiness,
} from '@/lib/signals/readiness-service';
import type { SignalKey } from '@/lib/signals/readiness-types';
import type { CompanyMonitorResult } from '@/lib/company-monitor';
import type { SupabaseClient } from '@supabase/supabase-js';

type DatabaseClient = SupabaseClient<any, 'public', any>;

const EXTERNAL_COMPANY_SIGNAL_SOURCE = 'external_company_monitor';

type ExternalCompanyBaseline = {
  userId: string;
  companyId: string;
  companyName: string;
  domain: string | null;
};

type ExternalCompanySignalDecision = {
  sourceEventType: string;
  signalKeys: SignalKey[];
  title: string;
  summary: string;
  eventAt: string;
  metadata: Record<string, unknown>;
} | null;

const DEVELOPMENT_STAGE_RANK: Record<string, number> = {
  Preclinical: 1,
  'Phase I': 2,
  'Phase II': 3,
  'Phase III': 4,
  Commercial: 5,
  'All stages': 0,
};

function normalizeText(value?: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || null;
}

function normalizeStatusText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function isRecentDate(value?: string | null, withinDays = 270): boolean {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return false;
  const ageMs = Date.now() - timestamp;
  return ageMs >= 0 && ageMs <= withinDays * 24 * 60 * 60 * 1000;
}

function isDistressed(summary?: string | null, statusLabel?: string | null): boolean {
  const haystack = `${summary || ''} ${statusLabel || ''}`.toLowerCase();
  return /(down round|bridge financing|distressed|rescue financing|emergency financing|insolv|administration|bankrupt)/i.test(
    haystack,
  );
}

function formatFundingAmount(value?: number | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${Math.round(value)}`;
}

function humanFundingStage(stage?: string | null): string | null {
  if (!stage) return null;
  return stage
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function fundingEventLabel(stage?: string | null, statusLabel?: string | null): string {
  const status = `${statusLabel || ''} ${stage || ''}`.toLowerCase();
  const explicitSeries = status.match(/\bseries\s+[a-z]\+?\b/i);
  if (explicitSeries) return explicitSeries[0].replace(/\bseries\b/i, 'Series').trim();
  if (/\bpre[-\s]?seed\b/i.test(status)) return 'Pre-seed';
  if (/\bseed\b/i.test(status)) return 'Seed';
  if (/\bgrant\b/i.test(status)) return 'Grant';
  if (/\bpublic\b|\bipo\b|\bnasdaq\b|\bnyse\b/i.test(status)) return 'Public financing';
  return humanFundingStage(stage) || normalizeStatusText(statusLabel) || 'Funding';
}

function buildFundingSummary(
  label: string,
  companyName: string,
  totalFundingUsd?: number | null,
  latestFundingDate?: string | null,
  fallback?: string | null,
): string {
  const parts: string[] = [`Arcova detected an external ${label.toLowerCase()} event for ${companyName}`];
  const amount = formatFundingAmount(totalFundingUsd);
  if (amount) parts.push(`with total funding now at ${amount}`);
  if (latestFundingDate) parts.push(`and the latest funding date recorded as ${latestFundingDate}`);
  const sentence = parts.join(' ') + '.';
  if (fallback && fallback.trim()) return `${sentence} ${fallback.trim()}`;
  return sentence;
}

function highestDevelopmentStage(stages: string[]): string | null {
  return [...stages]
    .sort((left, right) => (DEVELOPMENT_STAGE_RANK[right] ?? -1) - (DEVELOPMENT_STAGE_RANK[left] ?? -1))[0] ?? null;
}

function isClinicalTrialStage(stage?: string | null): boolean {
  return stage === 'Phase I' || stage === 'Phase II' || stage === 'Phase III';
}

function hasClinicalSetbackEvidence(text?: string | null): boolean {
  const haystack = `${text || ''}`.toLowerCase();
  return /(trial failure|halted|terminated|stopped early|clinical hold|program discontinuation|failed endpoint)/i.test(
    haystack,
  );
}

function hasProgramDiscontinuationEvidence(text?: string | null): boolean {
  const haystack = `${text || ''}`.toLowerCase();
  return /(program discontinuation|discontinued program|program terminated|asset terminated|pipeline cut)/i.test(
    haystack,
  );
}

function hasTrialSiteExpansionEvidence(text?: string | null): boolean {
  const haystack = `${text || ''}`.toLowerCase();
  return /(trial site expansion|expanded trial sites|additional trial sites|multi-site expansion|site activation)/i.test(
    haystack,
  );
}

function hasIndicationExpansionEvidence(text?: string | null): boolean {
  const haystack = `${text || ''}`.toLowerCase();
  return /(indication expansion|expanded indication|new indication|additional indication)/i.test(
    haystack,
  );
}

function buildTrialSummary(
  companyName: string,
  nextStage: string | null,
  previousStage: string | null,
  fallback?: string | null,
): string {
  const core =
    previousStage && nextStage
      ? `Arcova detected that ${companyName} appears to have moved from ${previousStage} to ${nextStage}.`
      : nextStage
        ? `Arcova detected that ${companyName} now appears to be operating at ${nextStage}.`
        : `Arcova detected a meaningful clinical development change for ${companyName}.`;
  if (fallback && fallback.trim()) return `${core} ${fallback.trim()}`;
  return core;
}

function buildFundingDecision(
  baseline: ExternalCompanyBaseline,
  result: CompanyMonitorResult,
): ExternalCompanySignalDecision {
  const funding = result.funding;
  if (!funding?.current) return null;

  const previous = normalizeText(funding.previous);
  const current = normalizeText(funding.current);
  const previousStatus = normalizeText(funding.previous_status_label);
  const currentStatus = normalizeText(funding.status_label || funding.current);
  const statusLabel = funding.status_label || funding.current;
  const eventLabel = fundingEventLabel(funding.current, funding.status_label);
  const summary =
    buildFundingSummary(
      eventLabel,
      baseline.companyName,
      funding.total_funding_usd,
      funding.latest_funding_date,
      funding.summary,
    );
  const eventAt = funding.latest_funding_date || new Date().toISOString();

  const changedStage = previous !== current;
  const changedStatus = previousStatus !== currentStatus;
  const changedAmount =
    typeof funding.total_funding_usd === 'number' &&
    typeof funding.previous_total_funding_usd === 'number'
      ? funding.total_funding_usd > funding.previous_total_funding_usd
      : false;
  const changedFundingDate =
    normalizeText(funding.previous_latest_funding_date) !== normalizeText(funding.latest_funding_date);
  const firstObservedRecent = !previous && isRecentDate(funding.latest_funding_date);

  if (!changedStage && !changedStatus && !changedAmount && !changedFundingDate && !firstObservedRecent) {
    return null;
  }

  const metadata = {
    previous_funding_stage: funding.previous,
    current_funding_stage: funding.current,
    previous_funding_status_label: funding.previous_status_label,
    current_funding_status_label: funding.status_label,
    funding_summary: funding.summary,
    previous_total_funding_usd: funding.previous_total_funding_usd,
    total_funding_usd: funding.total_funding_usd,
    previous_latest_funding_date: funding.previous_latest_funding_date,
    latest_funding_date: funding.latest_funding_date,
  };

  if (isDistressed(summary, statusLabel)) {
    return {
      sourceEventType: 'distressed_financing',
      signalKeys: ['distressed_financing'],
      title: `${eventLabel} signal detected`,
      summary,
      eventAt,
      metadata,
    };
  }

  if (current === 'public') {
    return {
      sourceEventType: 'ipo_or_follow_on',
      signalKeys: ['ipo_or_follow_on'],
      title: `${eventLabel} signal detected`,
      summary,
      eventAt,
      metadata,
    };
  }

  if (current === 'grant-funded') {
    return {
      sourceEventType: 'grant_award',
      signalKeys: ['grant_award'],
      title: `${eventLabel} signal detected`,
      summary,
      eventAt,
      metadata,
    };
  }

  return {
    sourceEventType: 'funding_round',
    signalKeys: ['funding_round'],
    title: `${eventLabel} signal detected`,
    summary,
    eventAt,
    metadata,
  };
}

function buildTrialDecisions(
  baseline: ExternalCompanyBaseline,
  result: CompanyMonitorResult,
): Array<NonNullable<ExternalCompanySignalDecision>> {
  const taxonomy = result.taxonomy;
  if (!taxonomy) return [];

  const previousStages = taxonomy.previous_development_stages ?? [];
  const currentStages = taxonomy.development_stages ?? [];
  const previousHighest = highestDevelopmentStage(previousStages);
  const currentHighest = highestDevelopmentStage(currentStages);
  const evidenceSummary = taxonomy.summary;

  const decisions: Array<NonNullable<ExternalCompanySignalDecision>> = [];

  const eventAt = new Date().toISOString();
  const summary = buildTrialSummary(
    baseline.companyName,
    currentHighest,
    previousHighest,
    evidenceSummary,
  );
  const metadata = {
    previous_development_stages: previousStages,
    current_development_stages: currentStages,
    previous_clinical_stage: previousHighest,
    current_clinical_stage: currentHighest,
    taxonomy_summary: evidenceSummary,
  };

  if (hasProgramDiscontinuationEvidence(evidenceSummary)) {
    decisions.push({
      sourceEventType: 'program_discontinuation',
      signalKeys: ['program_discontinuation'],
      title: 'Program discontinuation signal detected',
      summary,
      eventAt,
      metadata,
    });
  }

  if (hasTrialSiteExpansionEvidence(evidenceSummary)) {
    decisions.push({
      sourceEventType: 'trial_site_expansion',
      signalKeys: ['trial_site_expansion'],
      title: 'Trial site expansion signal detected',
      summary,
      eventAt,
      metadata,
    });
  }

  if (hasIndicationExpansionEvidence(evidenceSummary)) {
    decisions.push({
      sourceEventType: 'indication_expansion',
      signalKeys: ['indication_expansion'],
      title: 'Indication expansion signal detected',
      summary,
      eventAt,
      metadata,
    });
  }

  if (currentHighest && previousHighest !== currentHighest) {
    const previousRank = previousHighest ? DEVELOPMENT_STAGE_RANK[previousHighest] ?? -1 : -1;
    const currentRank = DEVELOPMENT_STAGE_RANK[currentHighest] ?? -1;

    // Guardrail: do not infer clinical failure purely from taxonomy stage regression.
    // Require explicit setback evidence to avoid false negative timing signals.
    if (
      previousRank > currentRank &&
      previousRank > 0 &&
      hasClinicalSetbackEvidence(evidenceSummary)
    ) {
      decisions.push({
        sourceEventType: 'trial_failure_or_halt',
        signalKeys: ['trial_failure_or_halt'],
        title: 'Clinical setback signal detected',
        summary,
        eventAt,
        metadata,
      });
    }

    if (!previousHighest && isClinicalTrialStage(currentHighest)) {
      decisions.push({
        sourceEventType: 'clinical_trial_registered',
        signalKeys: ['clinical_trial_registered'],
        title: 'Clinical trial signal detected',
        summary,
        eventAt,
        metadata,
      });
    }

    if (previousRank >= 0 && currentRank > previousRank && isClinicalTrialStage(currentHighest)) {
      decisions.push({
        sourceEventType: 'phase_transition',
        signalKeys: ['phase_transition'],
        title: 'Phase transition signal detected',
        summary,
        eventAt,
        metadata,
      });
    }
  }

  return decisions;
}

function buildDecisions(
  baseline: ExternalCompanyBaseline,
  result: CompanyMonitorResult,
) {
  const fundingDecision = buildFundingDecision(baseline, result);
  const trialDecisions = buildTrialDecisions(baseline, result);
  return [fundingDecision, ...trialDecisions].filter(
    Boolean,
  ) as Array<NonNullable<ExternalCompanySignalDecision>>;
}

export async function emitExternalCompanySignalsFromMonitor(
  supabase: DatabaseClient,
  input: {
    baseline: ExternalCompanyBaseline;
    monitorResult: CompanyMonitorResult;
  },
): Promise<{ emittedSignalTypes: string[]; recomputedCompanies: string[] }> {
  const decisions = buildDecisions(input.baseline, input.monitorResult);
  if (!decisions.length) {
    return { emittedSignalTypes: [], recomputedCompanies: [] };
  }

  const emittedSignalTypes = new Set<string>();

  for (const decision of decisions) {
    const sourceEventId = `${EXTERNAL_COMPANY_SIGNAL_SOURCE}:${input.baseline.companyId}:${decision.sourceEventType}:${decision.eventAt}`;

    const excerpt =
      typeof decision.metadata.funding_summary === 'string' && decision.metadata.funding_summary.trim()
        ? decision.metadata.funding_summary
        : typeof decision.metadata.taxonomy_summary === 'string' && decision.metadata.taxonomy_summary.trim()
          ? decision.metadata.taxonomy_summary
          : decision.summary;

    const ingestResult = await ingestSignalSourceEvent(supabase, {
      userId: input.baseline.userId,
      entityScope: 'company',
      companyId: input.baseline.companyId,
      source: EXTERNAL_COMPANY_SIGNAL_SOURCE,
      sourceEventType: decision.sourceEventType,
      sourceEventId,
      sourceUrl: input.baseline.domain ? `https://${input.baseline.domain}` : null,
      title: decision.title,
      summary: decision.summary,
      excerpt,
      eventAt: decision.eventAt,
      metadata: {
        company_name: input.baseline.companyName,
        domain: input.baseline.domain,
        ...decision.metadata,
      },
    });

    const rawEvent = {
      id: ingestResult.sourceEventId,
      userId: input.baseline.userId,
      entityId: input.baseline.companyId,
      entityScope: 'company' as const,
      source: EXTERNAL_COMPANY_SIGNAL_SOURCE,
      sourceUrl: input.baseline.domain ? `https://${input.baseline.domain}` : null,
      sourceEventType: decision.sourceEventType,
      sourceEventId,
      title: decision.title,
      summary: decision.summary,
      excerpt,
      eventAt: decision.eventAt,
      observedAt: new Date().toISOString(),
      metadata: {
        company_name: input.baseline.companyName,
        domain: input.baseline.domain,
        ...decision.metadata,
      },
    };

    await normalizeSignalSourceEvent(supabase, {
      userId: input.baseline.userId,
      rawEvent,
      signalKeys: decision.signalKeys,
      companyId: input.baseline.companyId,
    });

    for (const signalKey of decision.signalKeys) emittedSignalTypes.add(signalKey);
  }

  await recomputeAccountReadiness(supabase, {
    userId: input.baseline.userId,
    companyId: input.baseline.companyId,
  });

  await generateAccountReason(supabase, {
    userId: input.baseline.userId,
    companyId: input.baseline.companyId,
  });

  return {
    emittedSignalTypes: [...emittedSignalTypes],
    recomputedCompanies: [input.baseline.companyId],
  };
}
