'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { AgentPanel, type AgentPendingMessage } from '@/components/AgentPanel';
import { PageHeader } from '@/components/PageHeader';
import { Activity, AlertTriangle, Kanban, Loader2, Plus, Trophy } from 'lucide-react';
import {
  healthLabel,
  isWeakDim,
  COMPANY_FIT_GAP_BELOW,
  type HealthDim,
  type PipelineDataRequestType,
} from '@/lib/pipeline-icp-health';
import type { IcpPerformance } from '@/lib/coverage/icp-performance';
import { cn } from '@/lib/utils';
import { ROUTES, withQuery } from '@/lib/routes';

interface IcpPipelineCard {
  icp_id: string;
  icp_index: number;
  label: string;
  company_count: number;
  avg_company_fit: number | null;
  contact_count: number;
  avg_contact_fit: number | null;
  avg_contacts_per_company: number | null;
  thin_data: boolean;
  coverage: HealthDim;
  contact_fit: HealthDim;
  depth: HealthDim;
  overall: HealthDim;
  /** Bottom-up CRM deal performance (null when no deals map to this ICP). */
  performance: IcpPerformance | null;
}

/**
 * An ICP has a critical coverage gap if:
 * - it has no companies, or
 * - coverage is red (≤ 2 companies), or
 * - avg company fit is below 60% (the matched companies are mostly poor fits)
 */
function getCoverageGapIcps(cards: IcpPipelineCard[]): IcpPipelineCard[] {
  return cards.filter(
    (c) =>
      c.company_count === 0 ||
      c.coverage === 'red' ||
      (c.avg_company_fit != null && c.avg_company_fit < COMPANY_FIT_GAP_BELOW),
  );
}

function healthAccentClass(d: HealthDim): string {
  switch (d) {
    case 'red':   return 'border-l-red-400';
    case 'amber': return 'border-l-amber-400';
    case 'green': return 'border-l-emerald-400';
  }
}

function HealthBadge({
  dim,
  onClick,
}: {
  dim: HealthDim;
  onClick?: () => void;
}) {
  const cls =
    dim === 'red'
      ? 'bg-red-50 text-red-700 border-red-200'
      : dim === 'amber'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-emerald-50 text-emerald-700 border-emerald-200';

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-75',
          cls,
        )}
      >
        {healthLabel(dim)}
      </button>
    );
  }

  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium', cls)}>
      {healthLabel(dim)}
    </span>
  );
}

function buildCtas(card: IcpPipelineCard): { type: PipelineDataRequestType; label: string }[] {
  const out: { type: PipelineDataRequestType; label: string }[] = [];
  if (isWeakDim(card.coverage)) {
    out.push({ type: 'expand_companies', label: 'Find more companies for this ICP' });
  }
  if (card.company_count > 0 && isWeakDim(card.contact_fit)) {
    out.push({ type: 'more_contacts_at_accounts', label: 'Find contacts at these companies' });
  }
  if (card.company_count > 0 && isWeakDim(card.depth)) {
    out.push({
      type: 'more_contacts_at_accounts',
      label:
        card.icp_index > 0
          ? `Find more contacts at your ICP ${card.icp_index} accounts`
          : 'Find more contacts at accounts for this ICP',
    });
  }
  return out;
}

function formatFitValue(avg: number | null): string {
  if (avg == null || !Number.isFinite(avg)) return '—';
  return `${Math.round(avg * 100)}%`;
}

function formatDepthValue(avg: number | null): string {
  if (avg == null || !Number.isFinite(avg)) return '—';
  return `${avg.toFixed(1)}`;
}

/** Compact USD, e.g. $1.2M / $45k / $900. */
function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function formatCycle(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return '—';
  if (days >= 60) return `${(days / 30).toFixed(1)}mo`;
  return `${Math.round(days)}d`;
}

/** Active deals + won, for the "deals" column. */
function formatDealCount(p: IcpPerformance | null): string {
  if (!p) return '—';
  const total = p.active_deal_count + p.won_count + p.lost_count;
  return total > 0 ? total.toLocaleString() : '—';
}

const CONFIDENCE_LABEL: Record<IcpPerformance['confidence'], string> = {
  high: 'Strong sample',
  medium: 'Some signal',
  low: 'Thin sample',
};

/**
 * The "non-obvious winner": when ≥2 ICPs have throughput, surface the top
 * converter — and flag it when it ISN'T the ICP with the most companies (the
 * "rep thinks ICP 1; the data says ICP 2" moment).
 */
function bestThroughputInsight(cards: IcpPipelineCard[]): { best: IcpPipelineCard; surprise: boolean } | null {
  const ranked = cards
    .filter((c) => c.performance?.throughput != null && (c.performance.throughput ?? 0) > 0)
    .sort((a, b) => (b.performance!.throughput ?? 0) - (a.performance!.throughput ?? 0));
  if (ranked.length < 2) return null;
  const best = ranked[0];
  const mostCompanies = [...cards].sort((a, b) => b.company_count - a.company_count)[0];
  return { best, surprise: mostCompanies != null && mostCompanies.icp_id !== best.icp_id };
}

/** Rank (1 = best) by throughput among ICPs that have it; null otherwise. */
function throughputRankMap(cards: IcpPipelineCard[]): Map<string, number> {
  const ranked = cards
    .filter((c) => c.performance?.throughput != null && (c.performance.throughput ?? 0) > 0)
    .sort((a, b) => (b.performance!.throughput ?? 0) - (a.performance!.throughput ?? 0));
  return new Map(ranked.map((c, i) => [c.icp_id, i + 1]));
}

function buildHealthHandoffPrompt(card: IcpPipelineCard, task: string): string {
  const weakDims = [
    card.coverage !== 'green' ? `coverage is ${healthLabel(card.coverage)}` : null,
    card.contact_fit !== 'green' ? `contact fit is ${healthLabel(card.contact_fit)}` : null,
    card.depth !== 'green' ? `account depth is ${healthLabel(card.depth)}` : null,
  ].filter(Boolean).join(', ');

  const commonContext =
    `"${card.label}" has ${card.company_count} matched ${card.company_count === 1 ? 'company' : 'companies'}, ` +
    `${card.contact_count} contacts, avg company fit ${formatFitValue(card.avg_company_fit)}, ` +
    `avg contact fit ${formatFitValue(card.avg_contact_fit)}, and avg contacts per company ${formatDepthValue(card.avg_contacts_per_company)}. ` +
    `Health details: ${weakDims || 'all visible health dimensions are healthy'}, overall ${healthLabel(card.overall)}.`;
  const companiesHref = withQuery(
    ROUTES.data,
    new URLSearchParams({
      mode: 'companies',
      icpId: card.icp_id,
      requestType: 'expand_companies',
      source: 'health',
    }),
  );

  if (task === 'coverage_gap') {
    return `The user clicked a Today priority to improve coverage for this ICP. Context: ${commonContext} Open by picking up that thread and spotlighting the actionable issue. Explain that the next move is to add more companies for this ICP before thinking about contacts, because contacts are nested inside companies. Then call suggest_navigation with href "${companiesHref}" and a label like "Find companies for ${card.label}". Keep it warm, direct, and short.`;
  }

  return `The user clicked a Today priority to review pipeline health. Context: ${commonContext} Open by picking up that thread and showcasing the actionable issue for this ICP. If company coverage is weak, guide toward finding companies first and call suggest_navigation with href "${companiesHref}". If company coverage is OK but contact fit or depth is weak, explain that we should identify the specific companies with thin buyer coverage, then source contacts at those companies. Offer one sensible next step. Keep it warm, direct, and short.`;
}

function isHealthIssue(card: IcpPipelineCard): boolean {
  return (
    card.overall === 'red' ||
    card.overall === 'amber' ||
    card.coverage === 'red' ||
    card.contact_fit === 'red' ||
    card.depth === 'red'
  );
}

function buildAllHealthHandoffPrompt(cards: IcpPipelineCard[]): string {
  const issueCards = cards.filter(isHealthIssue);
  const cardsToDiscuss = issueCards.length > 0 ? issueCards : cards;
  const summary = cardsToDiscuss
    .map((card) => {
      const weakDims = [
        card.coverage !== 'green' ? `coverage ${healthLabel(card.coverage)}` : null,
        card.contact_fit !== 'green' ? `contact fit ${healthLabel(card.contact_fit)}` : null,
        card.depth !== 'green' ? `depth ${healthLabel(card.depth)}` : null,
      ].filter(Boolean).join(', ');
      return `${card.label}: ${card.company_count} companies, ${card.contact_count} contacts, avg company fit ${formatFitValue(card.avg_company_fit)}, avg contact fit ${formatFitValue(card.avg_contact_fit)}, overall ${healthLabel(card.overall)}${weakDims ? ` (${weakDims})` : ''}`;
    })
    .join('; ');
  const firstCoverageGap = cardsToDiscuss.find(
    (card) => card.company_count === 0 || card.coverage === 'red' || (card.avg_company_fit != null && card.avg_company_fit < COMPANY_FIT_GAP_BELOW),
  );
  const suggestedHref = firstCoverageGap
    ? withQuery(
        ROUTES.data,
        new URLSearchParams({
          mode: 'companies',
          icpId: firstCoverageGap.icp_id,
          requestType: 'expand_companies',
          source: 'health',
        }),
      )
    : null;

  return `The user clicked Today to review pipeline health, and the page shows the full ICP health table. Do not focus on only one ICP as if it is the whole story. Open by saying there are ${issueCards.length || cards.length} ICPs worth reviewing here, then summarise the visible pattern across them. Context: ${summary}. If one ICP is the sensible starting point, say "I'd start with..." and explain why. If the first issue is company coverage, remind them that the fix is companies first, then contacts because contacts are nested inside companies.${suggestedHref && firstCoverageGap ? ` If you suggest taking action, call suggest_navigation with href "${suggestedHref}" and label "Find companies for ${firstCoverageGap.label}".` : ''} Keep it warm, direct, and short.`;
}

const TH_HEAD = 'text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 px-3 py-3';
const TD = 'px-3 py-3 text-sm text-gray-900 align-top';
const TD_NUM = 'px-3 py-3 text-sm text-gray-900 tabular-nums text-right align-top';

export default function HealthPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [cards, setCards] = useState<IcpPipelineCard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const agentTaskFiredRef = useRef<string | null>(null);

  // Agent trigger: nonce increments to re-fire even with the same message text
  const [agentTrigger, setAgentTrigger] = useState<AgentPendingMessage | undefined>();

  const loadCards = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/pipeline/icp-cards');
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Failed to load health');
      }
      setCards((payload.cards ?? []) as IcpPipelineCard[]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load');
      setCards([]);
    }
  }, []);

  useEffect(() => {
    if (user) void loadCards();
  }, [user, loadCards]);

  const healthAgentTask = searchParams.get('agentTask') ?? '';
  const healthAgentIcpId = searchParams.get('icpId') ?? '';
  useEffect(() => {
    if (!user || !cards || !healthAgentTask) return;

    const taskKey = `${healthAgentTask}:${healthAgentIcpId || 'all'}`;
    if (agentTaskFiredRef.current === taskKey) return;

    let prompt: string | null = null;
    let threadPreview = '';
    if (healthAgentTask === 'health_review') {
      prompt = buildAllHealthHandoffPrompt(cards);
      threadPreview = 'Review my pipeline health';
    } else if (healthAgentIcpId) {
      const card = cards.find((candidate) => candidate.icp_id === healthAgentIcpId);
      if (!card) return;
      prompt = buildHealthHandoffPrompt(card, healthAgentTask);
      threadPreview =
        healthAgentTask === 'coverage_gap'
          ? `Improve coverage for ${card.label}`
          : `Explain health for ${card.label}`;
    }

    if (!prompt) return;

    agentTaskFiredRef.current = taskKey;
    setAgentTrigger((prev) => ({
      text: prompt,
      nonce: (prev?.nonce ?? 0) + 1,
      threadPreview,
    }));
  }, [cards, healthAgentIcpId, healthAgentTask, user]);

  const openDataRequest = (card: IcpPipelineCard, requestType: PipelineDataRequestType) => {
    const mode = requestType === 'expand_companies' ? 'companies' : 'contacts_for_icp';
    const params = new URLSearchParams({
      mode,
      icpId: card.icp_id,
      requestType,
      source: 'health',
    });
    router.push(withQuery(ROUTES.data, params));
  };

  const fireAgent = (text: string, threadPreview?: string) => {
    setAgentTrigger((prev) => ({
      text,
      nonce: (prev?.nonce ?? 0) + 1,
      ...(threadPreview ? { threadPreview } : {}),
    }));
  };

  const gapIcps = cards ? getCoverageGapIcps(cards) : [];
  const insight = cards ? bestThroughputInsight(cards) : null;
  const rankMap = cards ? throughputRankMap(cards) : new Map<string, number>();
  const hasAnyPerformance = !!cards?.some((c) => c.performance);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen bg-transparent">
      <AppSidebar />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <div className="bg-transparent flex-1 overflow-auto px-6 py-8 lg:px-10">
          <div className="mx-auto w-full max-w-[1180px]">
            <PageHeader
              eyebrow="Coverage"
              eyebrowIcon={<Activity className="h-3 w-3" />}
              title="Coverage"
              subtitle="How each ICP converts — sourced coverage, real deal performance, and what to buy to hit your number."
            />

            {/* Coverage gap banner */}
            {gapIcps.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const names = gapIcps.map((c) => `${c.label} (${c.company_count} companies)`).join(', ');
                  fireAgent(
                    `${gapIcps.length === 1 ? 'One ICP is' : `${gapIcps.length} ICPs are`} missing strong contact coverage: ${names}. Explain what is going on and what I should do next.`,
                    gapIcps.length === 1
                      ? 'Why is my contact coverage weak for this ICP?'
                      : 'Why is my contact coverage weak across these ICPs?',
                  );
                }}
                className="w-full mb-5 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left transition-colors hover:bg-red-100"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
                <p className="text-sm font-medium text-red-800">
                  {gapIcps.length === 1
                    ? '1 ICP is missing strong contact coverage.'
                    : `${gapIcps.length} ICPs are missing strong contact coverage.`}{' '}
                  <span className="font-normal text-red-600">Click to learn more.</span>
                </p>
                <Activity className="ml-auto h-4 w-4 shrink-0 text-red-400" />
              </button>
            )}

            {/* Best-converting ICP — the non-obvious winner the deal data reveals */}
            {insight && (
              <button
                type="button"
                onClick={() => {
                  const p = insight.best.performance!;
                  fireAgent(
                    `"${insight.best.label}" is my strongest-converting ICP by throughput (win rate ${formatPct(p.win_rate)}, avg ACV ${formatUsd(p.avg_acv)}, avg cycle ${formatCycle(p.avg_cycle_days)}). ${insight.surprise ? 'It is NOT the ICP with the most companies. ' : ''}Explain what makes it my best ICP and whether I should lean into it.`,
                    `Why is ${insight.best.label} my best ICP?`,
                  );
                }}
                className="w-full mb-5 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-left transition-colors hover:bg-emerald-100"
              >
                <Trophy className="h-4 w-4 shrink-0 text-emerald-500" />
                <p className="text-sm font-medium text-emerald-900">
                  {insight.surprise
                    ? `${insight.best.label} converts best — not the ICP with the most companies.`
                    : `${insight.best.label} is your strongest-converting ICP.`}{' '}
                  <span className="font-normal text-emerald-700">
                    Win rate {formatPct(insight.best.performance!.win_rate)}, cycle{' '}
                    {formatCycle(insight.best.performance!.avg_cycle_days)}. Click to explore.
                  </span>
                </p>
                <Activity className="ml-auto h-4 w-4 shrink-0 text-emerald-400" />
              </button>
            )}

            {cards === null ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-arcova-teal" />
              </div>
            ) : loadError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {loadError}
              </div>
            ) : cards.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Kanban className="w-6 h-6 text-gray-400" />
                </div>
                <h2 className="text-base font-semibold text-gray-900 mb-1">No ICPs yet</h2>
                <p className="text-gray-400 text-sm mb-5 max-w-xs mx-auto">
                  Define at least one ICP to see pipeline health here.
                </p>
                <button
                  type="button"
                  onClick={() => router.push(ROUTES.setup.newIcp)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-arcova-teal text-white text-sm font-semibold rounded-lg hover:bg-arcova-teal/90 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add an ICP
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden overflow-x-auto">
                <table className="w-full min-w-[1080px] border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className={TH_HEAD}>ICP name</th>
                      <th className={`${TH_HEAD} text-right`}>Companies</th>
                      <th className={`${TH_HEAD} text-right`}>Contacts</th>
                      {/* Bottom-up deal performance (from connected CRM) */}
                      <th className={`${TH_HEAD} text-right`}>Deals</th>
                      <th className={`${TH_HEAD} text-right`}>Pipeline</th>
                      <th className={`${TH_HEAD} text-right`}>Win rate</th>
                      <th className={`${TH_HEAD} text-right`}>Avg ACV</th>
                      <th className={`${TH_HEAD} text-right`}>Cycle</th>
                      <th className={`${TH_HEAD} text-right`}>Throughput</th>
                      <th className={TH_HEAD}>Health</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cards.map((card) => {
                      const ctas = buildCtas(card);
                      const isGap = gapIcps.some((g) => g.icp_id === card.icp_id);
                      return (
                        <tr
                          key={card.icp_id}
                          className={cn(
                            'border-b border-gray-100 border-l-4 hover:bg-gray-50/80',
                            healthAccentClass(card.overall),
                            'last:border-b-0',
                          )}
                        >
                          <td className={TD}>
                            <div className="min-w-0 max-w-[20rem]">
                              <p className="font-medium text-gray-900 leading-snug">{card.label}</p>
                            </div>
                          </td>
                          <td className={TD_NUM}>{card.company_count.toLocaleString()}</td>
                          <td className={TD_NUM}>{card.contact_count.toLocaleString()}</td>
                          <td className={TD_NUM}>{formatDealCount(card.performance)}</td>
                          <td className={TD_NUM}>{formatUsd(card.performance?.pipeline_usd)}</td>
                          <td className={TD_NUM}>{formatPct(card.performance?.win_rate)}</td>
                          <td className={TD_NUM}>{formatUsd(card.performance?.avg_acv)}</td>
                          <td className={TD_NUM}>{formatCycle(card.performance?.avg_cycle_days)}</td>
                          <td className={TD_NUM}>
                            {rankMap.has(card.icp_id) ? (
                              <span
                                title={
                                  card.performance
                                    ? `${CONFIDENCE_LABEL[card.performance.confidence]} · throughput rank`
                                    : 'throughput rank'
                                }
                                className={cn(
                                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                                  rankMap.get(card.icp_id) === 1
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : 'border-gray-200 bg-gray-50 text-gray-600',
                                )}
                              >
                                #{rankMap.get(card.icp_id)}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className={`${TD} whitespace-nowrap`}>
                            <HealthBadge
                              dim={card.overall}
                              onClick={() =>
                                fireAgent(
                                  `Explain the health status for "${card.label}": it has ${card.company_count} companies, ${card.contact_count} contacts, avg company fit ${formatFitValue(card.avg_company_fit)}, avg contact fit ${formatFitValue(card.avg_contact_fit)}. Coverage is ${healthLabel(card.coverage)}, contact fit is ${healthLabel(card.contact_fit)}, depth is ${healthLabel(card.depth)}, overall ${healthLabel(card.overall)}. What's the issue and what should I do?`,
                                  `Explain health for ${card.label}`,
                                )
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {cards && cards.length > 0 && (
              <p className="mt-3 text-xs text-gray-400">
                {hasAnyPerformance
                  ? 'Deal performance is from your connected CRM. Throughput ranks ICPs by win-rate-weighted won revenue per day — your fastest, surest path to revenue.'
                  : 'Connect your CRM (Settings → Integrations) to unlock deal performance — win rate, ACV, sales cycle and throughput per ICP.'}
              </p>
            )}
          </div>
        </div>

        <AgentPanel
          page="health"
          pageContext={{
            healthCards: cards ?? [],
            healthTask: healthAgentTask || null,
            healthTaskIcpId: healthAgentIcpId || null,
          }}
          pendingMessage={agentTrigger}
        />
      </div>
    </div>
  );
}
