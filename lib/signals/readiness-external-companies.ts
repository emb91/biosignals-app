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

function normalizeText(value?: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
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

function buildDecision(
  baseline: ExternalCompanyBaseline,
  result: CompanyMonitorResult,
): ExternalCompanySignalDecision {
  const funding = result.funding;
  if (!funding?.current) return null;

  const previous = normalizeText(funding.previous);
  const current = normalizeText(funding.current);
  const statusLabel = funding.status_label || funding.current;
  const summary = funding.summary || 'Arcova detected a material external funding change for this account.';
  const eventAt = funding.latest_funding_date || new Date().toISOString();

  const changedStage = previous !== current;
  const firstObservedRecent = !previous && isRecentDate(funding.latest_funding_date);

  if (!changedStage && !firstObservedRecent) {
    return null;
  }

  if (isDistressed(summary, statusLabel)) {
    return {
      sourceEventType: 'distressed_financing',
      signalKeys: ['distressed_financing'],
      title: 'External distressed financing detected',
      summary: 'Arcova detected a distressed or rescue-style financing event for this account.',
      eventAt,
      metadata: {
        previous_funding_stage: funding.previous,
        current_funding_stage: funding.current,
        previous_funding_status_label: null,
        current_funding_status_label: funding.status_label,
        funding_summary: funding.summary,
        total_funding_usd: funding.total_funding_usd,
        latest_funding_date: funding.latest_funding_date,
      },
    };
  }

  if (current === 'public') {
    return {
      sourceEventType: 'ipo_or_follow_on',
      signalKeys: ['ipo_or_follow_on'],
      title: 'External public financing event detected',
      summary: 'Arcova detected a public-market financing or IPO-related funding event for this account.',
      eventAt,
      metadata: {
        previous_funding_stage: funding.previous,
        current_funding_stage: funding.current,
        previous_funding_status_label: null,
        current_funding_status_label: funding.status_label,
        funding_summary: funding.summary,
        total_funding_usd: funding.total_funding_usd,
        latest_funding_date: funding.latest_funding_date,
      },
    };
  }

  if (current === 'grant-funded') {
    return {
      sourceEventType: 'grant_award',
      signalKeys: ['grant_award'],
      title: 'External grant funding detected',
      summary: 'Arcova detected a meaningful grant-backed funding event for this account.',
      eventAt,
      metadata: {
        previous_funding_stage: funding.previous,
        current_funding_stage: funding.current,
        previous_funding_status_label: null,
        current_funding_status_label: funding.status_label,
        funding_summary: funding.summary,
        total_funding_usd: funding.total_funding_usd,
        latest_funding_date: funding.latest_funding_date,
      },
    };
  }

  return {
    sourceEventType: 'funding_round',
    signalKeys: ['funding_round'],
    title: 'External funding round detected',
    summary: 'Arcova detected a funding event that can increase budget readiness for this account.',
    eventAt,
    metadata: {
      previous_funding_stage: funding.previous,
      current_funding_stage: funding.current,
      previous_funding_status_label: null,
      current_funding_status_label: funding.status_label,
      funding_summary: funding.summary,
      total_funding_usd: funding.total_funding_usd,
      latest_funding_date: funding.latest_funding_date,
    },
  };
}

export async function emitExternalCompanySignalsFromMonitor(
  supabase: DatabaseClient,
  input: {
    baseline: ExternalCompanyBaseline;
    monitorResult: CompanyMonitorResult;
  },
): Promise<{ emittedSignalTypes: string[]; recomputedCompanies: string[] }> {
  const decision = buildDecision(input.baseline, input.monitorResult);
  if (!decision) {
    return { emittedSignalTypes: [], recomputedCompanies: [] };
  }

  const sourceEventId = `${EXTERNAL_COMPANY_SIGNAL_SOURCE}:${input.baseline.companyId}:${decision.sourceEventType}:${decision.eventAt}`;

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
    excerpt: input.monitorResult.funding?.summary || decision.summary,
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
    excerpt: input.monitorResult.funding?.summary || decision.summary,
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

  await recomputeAccountReadiness(supabase, {
    userId: input.baseline.userId,
    companyId: input.baseline.companyId,
  });

  await generateAccountReason(supabase, {
    userId: input.baseline.userId,
    companyId: input.baseline.companyId,
  });

  return {
    emittedSignalTypes: decision.signalKeys,
    recomputedCompanies: [input.baseline.companyId],
  };
}
