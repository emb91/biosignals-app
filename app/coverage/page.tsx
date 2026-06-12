'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { AgentPanel, type AgentPendingMessage } from '@/components/AgentPanel';
import { PageHeader } from '@/components/PageHeader';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Kanban,
  Loader2,
  Plus,
  Trophy,
  Target,
  Pencil,
  TrendingDown,
  Sparkles,
  Database,
  BarChart3,
} from 'lucide-react';
import './coverage.css';
import {
  healthLabel,
  COMPANY_FIT_GAP_BELOW,
  type HealthDim,
  type PipelineDataRequestType,
} from '@/lib/pipeline-icp-health';
import type { CoverageActuals, IcpPerformance } from '@/lib/coverage/icp-performance';
import { buildCoveragePlan, type CoveragePlan } from '@/lib/coverage/coverage-plan';
import { quarterOf, quarterLabel, quarterProgress } from '@/lib/coverage/period';
import type { CoverageTargetType } from '@/lib/coverage/allocation';
import { computeCoverageVerdict, type CoverageVerdict } from '@/lib/coverage/verdict';
import { cn } from '@/lib/utils';
import { ROUTES, withQuery } from '@/lib/routes';
import { useViewportHeight } from '@/lib/use-viewport-height';
import TargetHistoryTrend from './TargetHistoryTrend';

// ─── Types ───────────────────────────────────────────────────────────────────

type CoverageTargetResponse = {
  period: string;
  target: { type: CoverageTargetType; value: number } | null;
  updatedAt: string | null;
  history: { period: string; type: CoverageTargetType; value: number }[];
};

type CardsMeta = {
  period: string;
  hasCrm: boolean;
  totalDeals: number;
  attributedDeals: number;
  unattributed: { dealCount: number; openUsd: number; wonUsd: number };
  actuals: CoverageActuals;
};

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
  recent_acquisition: {
    imported_company_count: number;
    imported_contact_count: number;
    skipped_count: number;
    last_completed_at: string | null;
  } | null;
  /** Bottom-up CRM deal performance (null when no deals map to this ICP). */
  performance: IcpPerformance | null;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

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

/** Like formatUsd but renders 0 as $0 (for actuals, where zero is a fact). */
function formatUsdZero(value: number): string {
  return value === 0 ? '$0' : formatUsd(value);
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

/** A target value rendered in its unit ($ revenue or deal count). */
function formatTargetValue(type: CoverageTargetType, value: number): string {
  return type === 'revenue' ? formatUsd(value) : `${Math.round(value).toLocaleString()} deals`;
}

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
      source: 'coverage',
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
          source: 'coverage',
        }),
      )
    : null;

  return `The user clicked Today to review pipeline health, and the page shows the full ICP health table. Do not focus on only one ICP as if it is the whole story. Open by saying there are ${issueCards.length || cards.length} ICPs worth reviewing here, then summarise the visible pattern across them. Context: ${summary}. If one ICP is the sensible starting point, say "I'd start with..." and explain why. If the first issue is company coverage, remind them that the fix is companies first, then contacts because contacts are nested inside companies.${suggestedHref && firstCoverageGap ? ` If you suggest taking action, call suggest_navigation with href "${suggestedHref}" and label "Find companies for ${firstCoverageGap.label}".` : ''} Keep it warm, direct, and short.`;
}

// ─── Small presentational pieces ─────────────────────────────────────────────

/** Grid column templates for the redesigned data surfaces (sections 2 & 3). */
const DEAL_COLS = 'minmax(230px,1.7fr) 64px 96px 104px 96px 96px 72px 80px';
const SRC_COLS = 'minmax(230px,1.7fr) 96px 128px 96px 128px 110px';

/** Design-language ICP identity cell: "ICP N" tag pill + truncating name, with
 *  an optional trailing slot (e.g. a data-sufficiency warning icon). */
function IcpCell({ label, index, trailing }: { label: string; index: number; trailing?: React.ReactNode }) {
  const name = label.replace(/^ICP \d+:\s*/, '');
  return (
    <span className="icp-cell">
      {index > 0 && <span className="icp-tag">ICP {index}</span>}
      <span className="icp-name" title={name}>
        {name}
      </span>
      {trailing}
    </span>
  );
}

/** Numbered tier header: gives the page its coverage → performance → plan legibility. */
function SectionHeader({
  step,
  title,
  source,
  children,
}: {
  step: string;
  title: string;
  source: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="sec-head">
      <div className="sec-head-left">
        <div>
          <p className="sec-title">
            <span className="sec-step">{step} ·</span>
            {title}
          </p>
          <p className="sec-source">{source}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

/** Fit cell: fit score as a plain percentage (ICP coverage table). */
function FitCell({ v }: { v: number | null }) {
  if (v == null || !Number.isFinite(v)) return <span className="dt-num empty">—</span>;
  return <span className="dt-num">{Math.round(v * 100)}%</span>;
}

/** Grid-table column header with an optional definition tooltip. */
function DtTh({ tip, center, children }: { tip?: string; center?: boolean; children: React.ReactNode }) {
  const cls = cn('dt-th', center && 'c', tip && 'help');
  if (!tip) return <span className={cls}>{children}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cls}>{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-xs font-normal normal-case tracking-normal">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

/** Depth cell: avg contacts-per-company, shown as a plain number. */
function DepthCell({ v }: { v: number | null }) {
  if (v == null || !Number.isFinite(v)) return <span className="dt-num empty">—</span>;
  return <span className="dt-num">{v.toFixed(1)}</span>;
}

/** Verdict banner styling, mapped to the design's glass-gradient variants. */
const VERDICT_KIND: Record<
  CoverageVerdict['status'],
  { cls: string; icon: React.ReactNode; chipLabel: string }
> = {
  'on-track': { cls: 'ontrack', icon: <CheckCircle2 className="h-5 w-5" />, chipLabel: 'On track' },
  behind: { cls: 'behind', icon: <TrendingDown className="h-5 w-5" />, chipLabel: 'Behind pace' },
  blocked: { cls: 'blocked', icon: <AlertTriangle className="h-5 w-5" />, chipLabel: 'Blocked' },
  'no-target': { cls: 'neutral', icon: <Target className="h-5 w-5" />, chipLabel: 'No target set' },
  'plan-only': { cls: 'plan', icon: <Sparkles className="h-5 w-5" />, chipLabel: 'Plan ready' },
  'no-icps': { cls: 'neutral', icon: <Kanban className="h-5 w-5" />, chipLabel: 'Not set up' },
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CoveragePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewportH = useViewportHeight();
  const [cards, setCards] = useState<IcpPipelineCard[] | null>(null);
  const [meta, setMeta] = useState<CardsMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const agentTaskFiredRef = useRef<string | null>(null);

  // Coverage target (prescriptive tier)
  const [targetData, setTargetData] = useState<CoverageTargetResponse | null>(null);
  const [editingTarget, setEditingTarget] = useState(false);
  const [draftValue, setDraftValue] = useState('');
  const [savingTarget, setSavingTarget] = useState(false);

  // Agent trigger: nonce increments to re-fire even with the same message text
  const [agentTrigger, setAgentTrigger] = useState<AgentPendingMessage | undefined>();

  const loadCards = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/pipeline/icp-cards');
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Failed to load coverage');
      }
      setCards((payload.cards ?? []) as IcpPipelineCard[]);
      setMeta((payload.meta ?? null) as CardsMeta | null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load');
      setCards([]);
      setMeta(null);
    }
  }, []);

  const loadTarget = useCallback(async () => {
    try {
      const res = await fetch('/api/coverage/target');
      const payload = (await res.json().catch(() => ({}))) as CoverageTargetResponse;
      if (res.ok) setTargetData(payload);
    } catch {
      /* non-blocking — Coverage still works without a target */
    }
  }, []);

  useEffect(() => {
    if (user) {
      void loadCards();
      void loadTarget();
    }
  }, [user, loadCards, loadTarget]);

  const saveTarget = useCallback(async () => {
    const value = Number(draftValue.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(value) || value <= 0) return;
    setSavingTarget(true);
    try {
      const res = await fetch('/api/coverage/target', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'revenue', value }),
      });
      if (res.ok) {
        setEditingTarget(false);
        await loadTarget();
      }
    } finally {
      setSavingTarget(false);
    }
  }, [draftValue, loadTarget]);

  // Agent deep-links (?agentTask=...) from Today priorities.
  const healthAgentTask = searchParams.get('agentTask') ?? '';
  const healthAgentIcpId = searchParams.get('icpId') ?? '';
  useEffect(() => {
    if (!user || !cards || !healthAgentTask) return;

    const taskKey = `${healthAgentTask}:${healthAgentIcpId || 'all'}`;
    if (agentTaskFiredRef.current === taskKey) return;

    let prompt: string | null = null;
    let threadPreview = '';
    if (healthAgentTask === 'coverage_review' || healthAgentTask === 'health_review') {
      // 'health_review' kept as a legacy alias for older deep-links.
      prompt = buildAllHealthHandoffPrompt(cards);
      threadPreview = 'Review my coverage';
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

  /**
   * Route to a pre-scoped data request. `contactCount` carries the plan's
   * "source N contacts"; we also pass a company estimate (contacts ÷ observed
   * contacts-per-company) since the companies flow asks in company units.
   */
  const openDataRequest = (
    icpId: string,
    requestType: PipelineDataRequestType,
    contactCount?: number,
  ) => {
    const mode = requestType === 'expand_companies' ? 'companies' : 'contacts_for_icp';
    const params = new URLSearchParams({
      mode,
      icpId,
      requestType,
      source: 'coverage',
    });
    if (contactCount != null && contactCount > 0) {
      params.set('count', String(contactCount));
      const card = cards?.find((c) => c.icp_id === icpId);
      const perCompany =
        card?.avg_contacts_per_company != null && card.avg_contacts_per_company > 0
          ? card.avg_contacts_per_company
          : 4; // matches DEFAULT_CONTACTS_PER_COMPANY in lib/coverage/supply
      params.set('companyCount', String(Math.max(1, Math.ceil(contactCount / perCompany))));
    }
    router.push(withQuery(ROUTES.data, params));
  };

  const fireAgent = (text: string, threadPreview?: string) => {
    setAgentTrigger((prev) => ({
      text,
      nonce: (prev?.nonce ?? 0) + 1,
      ...(threadPreview ? { threadPreview } : {}),
    }));
  };

  // ── Derived state ──────────────────────────────────────────────────────────

  const gapIcps = cards ? getCoverageGapIcps(cards) : [];
  const insight = cards ? bestThroughputInsight(cards) : null;
  const rankMap = cards ? throughputRankMap(cards) : new Map<string, number>();
  const hasAnyPerformance = !!cards?.some((c) => c.performance);
  const hasCrm = meta?.hasCrm ?? false;
  const actuals = meta?.actuals ?? null;

  const period = targetData?.period ?? meta?.period ?? quarterOf();
  const target = targetData?.target ?? null;
  const progress = quarterProgress(period);

  // The plan covers the REMAINING gap, not the full target: what's already
  // closed-won this quarter doesn't need to be sourced again.
  const closedTowardTarget =
    target && hasCrm && actuals ? (target.type === 'revenue' ? actuals.wonUsd : actuals.wonCount) : 0;
  const remainingTargetValue = target ? Math.max(0, target.value - closedTowardTarget) : 0;

  const plan: CoveragePlan | null =
    cards && cards.length > 0 && target && remainingTargetValue > 0
      ? buildCoveragePlan({
          cards,
          target: { type: target.type, value: remainingTargetValue },
        })
      : null;

  // Plan rows ranked into a "do this first" order: biggest sub-target first,
  // then biggest sourcing gap among equals.
  const rankedPlanRows =
    plan && plan.canPlan && cards
      ? [...plan.result.allocations]
          .filter((a) => a.subTarget > 0 || a.toBuy > 0)
          .sort((x, y) => y.subTarget - x.subTarget || y.toBuy - x.toBuy)
      : [];
  const topPriorityRow = rankedPlanRows.find((a) => a.toBuy > 0) ?? null;
  /** ICPs with no won-deal evidence get no slice once throughput ranking kicks in. */
  const unallocatedIcpCount = plan && plan.canPlan && cards ? cards.length - rankedPlanRows.length : 0;
  const cardByIcpId = new Map((cards ?? []).map((c) => [c.icp_id, c]));

  const verdict: CoverageVerdict | null =
    cards == null
      ? null
      : computeCoverageVerdict({
          icpCount: cards.length,
          gapIcpLabels: gapIcps.map((c) => c.label),
          hasCrm,
          target,
          actuals: hasCrm && actuals
            ? { wonUsd: actuals.wonUsd, wonCount: actuals.wonCount, openPipelineUsd: actuals.openPipelineUsd }
            : null,
          elapsedFraction: progress?.elapsedFraction ?? 0,
          weeksLeft: progress?.weeksLeft ?? 0,
          shortfall: plan?.canPlan ? plan.result.shortfall : 0,
          topPriority: topPriorityRow
            ? {
                icpId: topPriorityRow.icpId,
                label: topPriorityRow.label,
                // Without supply ceilings (now a /data concern) rows are never capped.
                toBuy: topPriorityRow.toBuy,
              }
            : null,
          periodLabel: quarterLabel(period),
        });

  const runVerdictAction = () => {
    const action = verdict?.action;
    if (!action) return;
    switch (action.kind) {
      case 'add-icp':
        router.push(ROUTES.setup.newIcp);
        break;
      case 'set-target':
        setDraftValue(target?.type === 'revenue' ? String(target.value) : '');
        setEditingTarget(true);
        break;
      case 'source': {
        // The revenue play: source for the single best-converting ICP.
        const icpId = action.icpId ?? gapIcps[0]?.icp_id;
        if (icpId) openDataRequest(icpId, 'expand_companies', action.count);
        break;
      }
      case 'add-companies':
        // The coverage play: stage every blind-spot ICP at once.
        stageBlindSpots();
        break;
      case 'review-supply':
        fireAgent(
          `My ${quarterLabel(period)} target of ${target ? formatTargetValue(target.type, target.value) : ''} exceeds the addressable supply across my ICPs. Walk me through my options: broaden an ICP definition, extend the timeline, or trim the number. Use my actual ICPs and their supply ceilings.`,
          'My target exceeds my ICP supply',
        );
        break;
      case 'connect-crm':
        router.push(ROUTES.settings);
        break;
    }
  };

  /**
   * "Fix coverage blind spots" — synthesise every gap ICP into one prompt and
   * hand the whole batch to the Data agent to stage (jobs run one at a time).
   * Passed via sessionStorage so the long prompt stays out of the URL.
   */
  const stageBlindSpots = () => {
    if (gapIcps.length === 0) return;
    const lines = gapIcps
      .map((c) => {
        const ref = c.label.match(/^ICP \d+/)?.[0] ?? c.label;
        const name = c.label.replace(/^ICP \d+:\s*/, '');
        const fit = c.avg_company_fit != null ? `, avg company fit ${Math.round(c.avg_company_fit * 100)}%` : '';
        return `${ref} (${name}): ${c.company_count} ${c.company_count === 1 ? 'company' : 'companies'}${fit}`;
      })
      .join('; ');
    const text =
      `I want to close my coverage blind spots. These ICPs have thin or no sourced companies, worst first: ${lines}. ` +
      `For each, source companies that fit the ICP definition, and queue the jobs so I can review and run them one at a time — ` +
      `start with the ICPs that have zero coverage. Use my saved targeting for each ICP.`;
    const threadPreview = `Fill coverage for ${gapIcps.length} ICP${gapIcps.length === 1 ? '' : 's'}`;
    try {
      sessionStorage.setItem('arcova_coverage_stage_gaps', JSON.stringify({ text, threadPreview }));
    } catch {
      /* ignore — the agent falls back to its own opener if the handoff is missing */
    }
    router.push(
      withQuery(ROUTES.data, new URLSearchParams({ mode: 'stage_gaps', source: 'coverage', icpId: gapIcps[0].icp_id })),
    );
  };

  // Attainment bar geometry (only meaningful with target + CRM).
  const attainPct = verdict?.attainment != null ? Math.min(1, Math.max(0, verdict.attainment)) : null;
  const openPipelinePct =
    target && actuals && attainPct != null
      ? Math.min(
          1 - attainPct,
          Math.max(
            0,
            target.type === 'revenue'
              ? actuals.openPipelineUsd / target.value
              : actuals.openDealCount / target.value,
          ),
        )
      : null;

  const icpsClosedThisPeriod = (cards ?? []).filter((c) => (c.performance?.won_count_in_period ?? 0) > 0);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  const verdictKind = verdict ? VERDICT_KIND[verdict.status] : null;

  return (
    <TooltipProvider delayDuration={150}>
    {/* Height is pinned to the MEASURED viewport (window.innerHeight px), not a CSS
        100vh/100dvh unit. In this app's forwarded-browser context those units
        resolve taller than the visible area (e.g. 1088 vs 915), so the page
        overflowed and the whole body scrolled. innerHeight is the true visible
        height; overflow-hidden then guarantees no body scroll — inner regions
        scroll on their own. Falls back to 100dvh for the first paint pre-mount. */}
    <div className="flex min-h-0 overflow-hidden bg-transparent" style={{ height: viewportH ?? '100dvh' }}>
      <AppSidebar />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex-row">
        {/* Scroll column: wrapper clips, inner div scrolls. The min-h-0 chain is
            what keeps the content from inflating the row past 100vh (which would
            body-scroll the whole page and clip everything below the fold). */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto bg-transparent px-6 py-8 lg:px-10">
            <div className="cov-root mx-auto w-full max-w-[1180px]">
            <PageHeader
              eyebrow={
                <>
                  {quarterLabel(period)}
                  {progress ? ` · ${progress.weeksLeft} ${progress.weeksLeft === 1 ? 'week' : 'weeks'} left` : ''}
                </>
              }
              eyebrowIcon={<Activity className="h-3 w-3" />}
              title="Coverage"
              subtitle="Where your number comes from: which ICPs actually convert, how completely your data covers them, and exactly what to source to close the gap."
            />

            {cards === null ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-arcova-teal" />
              </div>
            ) : loadError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {loadError}
              </div>
            ) : cards.length === 0 ? (
              /* First-run state: teach the three tiers, then point at step one. */
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Kanban className="w-6 h-6 text-gray-400" />
                </div>
                <h2 className="text-base font-semibold text-gray-900 mb-1">Coverage starts with an ICP</h2>
                <p className="text-gray-400 text-sm mb-6 max-w-md mx-auto">
                  This page answers three questions, each unlocked by more data. Define an ICP to unlock the first.
                </p>
                <div className="mx-auto mb-7 grid max-w-2xl grid-cols-1 gap-3 text-left sm:grid-cols-3">
                  {[
                    { icon: <Database className="h-4 w-4 text-arcova-teal" />, title: '1 · Coverage', body: 'Do I have enough of the right companies and contacts? Works with no CRM.' },
                    { icon: <BarChart3 className="h-4 w-4 text-arcova-teal" />, title: '2 · Performance', body: 'Which ICPs actually convert? Unlocked by connecting your CRM.' },
                    { icon: <Target className="h-4 w-4 text-arcova-teal" />, title: '3 · Plan', body: 'What do I source to hit my number? Unlocked by setting a quarterly target.' },
                  ].map((s) => (
                    <div key={s.title} className="rounded-lg border border-gray-100 bg-gray-50/50 p-3.5">
                      <div className="mb-1.5 flex items-center gap-1.5">
                        {s.icon}
                        <p className="text-xs font-semibold text-gray-900">{s.title}</p>
                      </div>
                      <p className="text-xs leading-relaxed text-gray-500">{s.body}</p>
                    </div>
                  ))}
                </div>
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
              <>
                {/* ── Top-line verdict: one status, one reason, one next action ── */}
                {verdict && verdictKind && (
                  <div className={cn('verdict', verdictKind.cls)}>
                    <span className="verdict-icon">{verdictKind.icon}</span>
                    <div className="verdict-body">
                      <div className="verdict-line">
                        <span className="verdict-head">{verdict.headline}</span>
                      </div>
                      {verdict.detail && <p className="verdict-detail">{verdict.detail}</p>}
                    </div>
                    {verdict.action && (
                      <button type="button" onClick={runVerdictAction} className="verdict-action">
                        <span>{verdict.action.label}</span>
                      </button>
                    )}
                  </div>
                )}

                {/* ── 1 · Target & plan ─────────────────────────────────────── */}
                <SectionHeader
                  step="1"
                  title={`Target & plan · ${quarterLabel(period)}`}
                  source="How you're tracking to your number, and how many leads to source for each ICP to hit it."
                >
                  {!editingTarget && (
                    <button
                      type="button"
                      className="sec-edit"
                      onClick={() => {
                        setDraftValue(target?.type === 'revenue' ? String(target.value) : '');
                        setEditingTarget(true);
                      }}
                    >
                      {target ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                      {target ? 'Edit target' : 'Set target'}
                    </button>
                  )}
                </SectionHeader>

                <div className="glass cov-card">
                  {editingTarget ? (
                    /* Inline editor */
                    <div className="target-edit">
                      <div className="target-edit-row">
                        <span className="target-edit-dollar">$</span>
                        <input
                          value={draftValue}
                          onChange={(e) => setDraftValue(e.target.value)}
                          inputMode="numeric"
                          placeholder="2,000,000"
                          autoFocus
                          className="target-input"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveTarget();
                            if (e.key === 'Escape') setEditingTarget(false);
                          }}
                        />
                        <button
                          type="button"
                          className="target-save"
                          onClick={() => void saveTarget()}
                          disabled={savingTarget || !draftValue.trim()}
                        >
                          {savingTarget && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Save
                        </button>
                        <button type="button" className="target-cancel" onClick={() => setEditingTarget(false)}>
                          Cancel
                        </button>
                      </div>
                      <p className="target-edit-hint">
                        One overall {quarterLabel(period)} target. We split it across ICPs by throughput and
                        back-calculate how many contacts to source for each.
                      </p>
                    </div>
                  ) : !target ? (
                    /* Purpose-built no-target state: what setting it unlocks. */
                    <div className="cov-prompt">
                      <div>
                        <p className="cov-prompt-title">No {quarterLabel(period)} target yet.</p>
                        <p className="cov-prompt-sub">
                          Set one number and this becomes a per-ICP sourcing plan
                          {hasCrm && actuals && actuals.priorWonCount > 0
                            ? `. Last quarter you closed ${formatUsdZero(actuals.priorWonUsd)} across ${actuals.priorWonCount} deal${actuals.priorWonCount === 1 ? '' : 's'}.`
                            : ', weighted by how each ICP actually converts.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="cov-prompt-btn"
                        onClick={() =>
                          fireAgent(
                            `Help me set a realistic ${quarterLabel(period)} target. Anchor on my CRM history if I have any, suggest a bracket (flat, +20%, +50% vs last quarter), and when I commit call set_gtm_target.`,
                            'Help me size my quarterly target',
                          )
                        }
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Size it with the agent
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Hero: the number + attainment headline */}
                      <div className="hero-top">
                        <div className="hero-target">
                          <span className="hero-num">{formatTargetValue(target.type, target.value)}</span>
                          <span className="hero-num-label">target</span>
                        </div>
                        {hasCrm && actuals && attainPct != null ? (
                          <div className="hero-attain">
                            <div className="hero-attain-num">
                              {target.type === 'revenue' ? formatUsdZero(actuals.wonUsd) : `${actuals.wonCount} deals`}{' '}
                              <span className="pct">({formatPct(attainPct)})</span>
                            </div>
                            <div className="hero-attain-sub">
                              closed{progress ? ` · ${progress.weeksLeft} ${progress.weeksLeft === 1 ? 'week' : 'weeks'} left` : ''}
                            </div>
                          </div>
                        ) : (
                          <div className="hero-attain">
                            <div className="hero-attain-sub">Connect your CRM to track attainment here.</div>
                          </div>
                        )}
                      </div>

                      {/* Attainment bar: closed-won vs open pipeline vs pace */}
                      {hasCrm && attainPct != null && (
                        <>
                          <div className="attain-wrap">
                            <div className="attain">
                              <div className="attain-won" style={{ width: `${attainPct * 100}%` }} />
                              {openPipelinePct != null && openPipelinePct > 0 && (
                                <div
                                  className="attain-pipe"
                                  style={{ left: `${attainPct * 100}%`, width: `${openPipelinePct * 100}%` }}
                                />
                              )}
                            </div>
                            {progress && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div
                                    className="attain-pace"
                                    style={{ left: `calc(${progress.elapsedFraction * 100}% - 1px)` }}
                                  />
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                  Pace: {formatPct(progress.elapsedFraction)} of the quarter has elapsed
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                          <div className="attain-legend">
                            <span className="lg">
                              <span className="lg-dot won" /> Closed won
                            </span>
                            {openPipelinePct != null && openPipelinePct > 0 && actuals && (
                              <span className="lg">
                                <span className="lg-dot pipe" /> Open pipeline {formatUsd(actuals.openPipelineUsd)} (not
                                win-rate weighted)
                              </span>
                            )}
                            {progress && (
                              <span className="lg">
                                <span className="lg-bar" /> Quarter pace {formatPct(progress.elapsedFraction)}
                              </span>
                            )}
                          </div>
                        </>
                      )}

                      {/* What changed this quarter */}
                      {actuals && (actuals.wonCount > 0 || actuals.priorWonCount > 0) && (
                        <p className="hero-summary">
                          This quarter:{' '}
                          <strong>
                            {actuals.wonCount} deal{actuals.wonCount === 1 ? '' : 's'} closed (
                            {formatUsdZero(actuals.wonUsd)})
                          </strong>
                          {icpsClosedThisPeriod.length > 0 && (
                            <> from {icpsClosedThisPeriod.map((c) => c.label).join(', ')}</>
                          )}
                          . Last quarter: {actuals.priorWonCount} ({formatUsdZero(actuals.priorWonUsd)}).
                        </p>
                      )}

                      {/* Plan: closed, learning, or ranked sourcing list */}
                      {remainingTargetValue <= 0 ? (
                        <p className="hero-note">
                          <CheckCircle2 className="h-4 w-4" />
                          You&apos;ve closed your full {quarterLabel(period)} target. Nothing left to source for it.
                        </p>
                      ) : plan && !plan.canPlan ? (
                        <p className="hero-note" style={{ color: 'var(--ink-mute)' }}>
                          <span>
                            We need at least one ICP with closed-won revenue to turn this target into a sourcing plan.
                            Sync your CRM or add won-deal value so we can learn your ACV.
                          </span>
                        </p>
                      ) : plan && plan.canPlan ? (
                        <>
                          <p className="plan-intro">
                            {closedTowardTarget > 0 ? (
                              <>
                                To close the remaining{' '}
                                <strong>{formatTargetValue(target.type, remainingTargetValue)}</strong>, source{' '}
                              </>
                            ) : (
                              <>To hit {formatTargetValue(target.type, target.value)}, source </>
                            )}
                            <strong>~{plan.result.totalToBuy.toLocaleString()} new contacts</strong>, best-converting
                            ICPs first:
                          </p>

                          <div className="plan-list">
                            {rankedPlanRows.map((a, idx) => {
                              const isTop = topPriorityRow?.icpId === a.icpId;
                              return (
                                <div key={a.icpId} className={cn('plan-row', isTop && 'is-top')}>
                                  <span className="rank-pill">{idx === 0 ? 'First' : `#${idx + 1}`}</span>
                                  <IcpCell label={a.label} index={cardByIcpId.get(a.icpId)?.icp_index ?? 0} />
                                  <span className="plan-stat">
                                    <span className="plan-stat-label">Share</span>
                                    <span className="plan-stat-val">{Math.round((a.shareOfTarget ?? 0) * 100)}%</span>
                                  </span>
                                  <span className="plan-stat">
                                    <span className="plan-stat-label">Sub-target</span>
                                    <span className="plan-stat-val">{formatTargetValue(target.type, a.subTarget)}</span>
                                  </span>
                                  <span className="plan-stat">
                                    <span className="plan-stat-label">To source</span>
                                    <span className="plan-stat-val">{a.toBuy.toLocaleString()}</span>
                                  </span>
                                  {a.toBuy > 0 ? (
                                    <button
                                      type="button"
                                      className="row-source-link"
                                      onClick={() => openDataRequest(a.icpId, 'expand_companies', a.toBuy)}
                                    >
                                      <ArrowRight className="h-3.5 w-3.5" /> Source leads
                                    </button>
                                  ) : (
                                    <span />
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {plan.result.shortfall > 0 && (
                            <p className="plan-note warn">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              <span>
                                {formatTargetValue(target.type, plan.result.shortfall)} of this target is beyond your
                                ICPs&apos; addressable supply. Broaden an ICP, extend the timeline, or trim the number.
                              </span>
                            </p>
                          )}

                          {plan.result.notes
                            .filter((n) => !n.startsWith('Target exceeds'))
                            .map((note) => (
                              <p key={note} className="plan-note info">
                                <Sparkles className="h-3.5 w-3.5" />
                                <span>{note}</span>
                              </p>
                            ))}

                          {unallocatedIcpCount > 0 && (
                            <p className="plan-note">
                              <span>
                                {unallocatedIcpCount} ICP{unallocatedIcpCount === 1 ? ' has' : 's have'} no closed-won
                                evidence yet, so the ranking gives {unallocatedIcpCount === 1 ? 'it' : 'them'} no slice
                                of this target. That changes as soon as they win deals.
                              </span>
                            </p>
                          )}

                          {/* Honest provenance: which rates are measured vs assumed. */}
                          <div className="prov">
                            <span className="prov-item">
                              Win rate <b>{formatPct(plan.defaults.winRate)}</b>{' '}
                              {plan.sources.winRate === 'measured'
                                ? '(measured from your closed deals)'
                                : '(industry default)'}
                            </span>
                            <span className="prov-item">
                              Contact-to-deal <b>{formatPct(plan.defaults.contactToDeal)}</b>{' '}
                              {plan.sources.contactToDeal === 'measured' && plan.sources.conversionSample
                                ? `(${plan.sources.conversionSample.withDeals} of ${plan.sources.conversionSample.total} contacts produced a deal)`
                                : '(industry default, refines as deals link to contacts)'}
                            </span>
                            {target.type === 'revenue' && (
                              <span className="prov-item">
                                ACV <b>{formatUsd(plan.defaults.avgAcv)}</b>{' '}
                                {plan.sources.avgAcv === 'measured' ? '(measured from won deals)' : '(assumed)'}
                              </span>
                            )}
                          </div>
                        </>
                      ) : null}
                    </>
                  )}
                </div>

                {/* ── 2 · Deal performance ──────────────────────────────────── */}
                <SectionHeader
                  step="2"
                  title="Deal performance"
                  source={hasCrm ? 'Which ICPs actually win deals — win rate, deal size, and sales-cycle length from your CRM.' : 'Connect your CRM to see which ICPs actually win deals.'}
                />

                {!hasCrm ? (
                  /* Purpose-built no-CRM state: what connecting unlocks. */
                  <div className="glass cov-card cov-dashed cov-prompt">
                    <div>
                      <p className="cov-prompt-title">Connect your CRM to see which ICPs actually convert.</p>
                      <p className="cov-prompt-sub">
                        Win rate, deal size, and sales-cycle length per ICP, measured from your closed deals instead of
                        guessed. It also makes the sourcing plan above use your real funnel.
                      </p>
                    </div>
                    <button type="button" className="cov-prompt-btn solid" onClick={() => router.push(ROUTES.settings)}>
                      Connect CRM
                    </button>
                  </div>
                ) : (
                  <>
                    {/* The non-obvious winner, one line, in context with the table it explains. */}
                    {insight && (
                      <button
                        type="button"
                        className="cov-insight"
                        onClick={() => {
                          const p = insight.best.performance!;
                          fireAgent(
                            `"${insight.best.label}" is my strongest-converting ICP by throughput (win rate ${formatPct(p.win_rate)}, avg ACV ${formatUsd(p.avg_acv)}, avg cycle ${formatCycle(p.avg_cycle_days)}). ${insight.surprise ? 'It is NOT the ICP with the most companies. ' : ''}Explain what makes it my best ICP and whether I should lean into it.`,
                            `Why is ${insight.best.label} my best ICP?`,
                          );
                        }}
                      >
                        <Trophy className="h-4 w-4" />
                        <span className="cov-insight-text">
                          <strong>
                            {insight.surprise
                              ? `${insight.best.label} converts best, and it is not your biggest ICP.`
                              : `${insight.best.label} is your strongest converter.`}
                          </strong>{' '}
                          <span className="go">Click to see why.</span>
                        </span>
                      </button>
                    )}

                    <div className="glass dtable">
                      <div className="dtable-scroll">
                        <div style={{ minWidth: 820 }}>
                          <div className="dt-head" style={{ gridTemplateColumns: DEAL_COLS }}>
                            <span className="dt-th c">ICP</span>
                            <DtTh center tip="CRM deals attributed to this ICP: open, won, and lost.">Deals</DtTh>
                            <DtTh center tip="Open (not yet closed) deal value attributed to this ICP.">Pipeline</DtTh>
                            <DtTh center tip="Total closed-won revenue attributed to this ICP.">Closed won</DtTh>
                            <DtTh center tip="Won deals divided by closed deals (won + lost). Small samples can swing with a single deal.">
                              Win rate
                            </DtTh>
                            <DtTh center tip="Average value of this ICP's won deals.">Avg ACV</DtTh>
                            <DtTh center tip="Average days from first stage to closed-won. Uses stage history when available; otherwise falls back to created-to-close dates.">
                              Cycle
                            </DtTh>
                            <DtTh center tip="Throughput rank: win rate × won revenue ÷ average cycle days, i.e. expected revenue per selling day. This is what splits your target across ICPs.">
                              Rank
                            </DtTh>
                          </div>
                          {[...cards]
                            .sort((a, b) => {
                              const ra = rankMap.get(a.icp_id) ?? Infinity;
                              const rb = rankMap.get(b.icp_id) ?? Infinity;
                              if (ra !== rb) return ra - rb;
                              const pa = a.performance?.pipeline_usd ?? 0;
                              const pb = b.performance?.pipeline_usd ?? 0;
                              if (pa !== pb) return pb - pa;
                              return a.icp_index - b.icp_index;
                            })
                            .map((card) => {
                              const p = card.performance;
                              const totalDeals = p ? p.active_deal_count + p.won_count + p.lost_count : 0;
                              const rank = rankMap.get(card.icp_id);
                              const quiet = totalDeals === 0;
                              return (
                                <div
                                  key={card.icp_id}
                                  className={cn('dt-row', rank === 1 && 'is-leader', quiet && 'is-quiet')}
                                  style={{ gridTemplateColumns: DEAL_COLS }}
                                >
                                  <span className="icp-block">
                                    <IcpCell
                                      label={card.label}
                                      index={card.icp_index}
                                      trailing={
                                        /* Data-sufficiency flag (replaces the Health column): only
                                           the rows that can't yet be trusted get a warning. */
                                        !p || p.confidence === 'low' ? (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span className={cn('icp-warn', !p && 'muted')}>
                                                <AlertTriangle className="h-3.5 w-3.5" />
                                              </span>
                                            </TooltipTrigger>
                                            <TooltipContent side="top" className="max-w-[220px] text-xs">
                                              {p
                                                ? 'Thin sample — fewer than 4 closed deals. Treat as directional; it can flip with one deal.'
                                                : 'No deals yet for this ICP.'}
                                            </TooltipContent>
                                          </Tooltip>
                                        ) : null
                                      }
                                    />
                                    {p && p.won_count_in_period > 0 && (
                                      <span className="icp-sub">
                                        +{formatUsd(p.won_usd_in_period)} closed this quarter
                                      </span>
                                    )}
                                  </span>
                                  <span className={cn('dt-num', totalDeals === 0 && 'empty')}>
                                    {totalDeals > 0 ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="cursor-help">{totalDeals}</span>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="text-xs">
                                          {p!.active_deal_count} open · {p!.won_count} won · {p!.lost_count} lost
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      '—'
                                    )}
                                  </span>
                                  <span className={cn('dt-num', !(p?.pipeline_usd) && 'empty')}>{formatUsd(p?.pipeline_usd)}</span>
                                  <span className={cn('dt-num', !(p && p.won_usd > 0) && 'empty')}>
                                    {p && p.won_usd > 0 ? formatUsd(p.won_usd) : '—'}
                                  </span>
                                  <span className="winrate">
                                    {p?.win_rate == null ? (
                                      <span className="dt-num empty">—</span>
                                    ) : (
                                      <span className={cn('winrate-val', p.win_rate === 0 && 'zero')}>{formatPct(p.win_rate)}</span>
                                    )}
                                  </span>
                                  <span className={cn('dt-num', !(p?.avg_acv) && 'empty')}>{formatUsd(p?.avg_acv)}</span>
                                  <span className={cn('dt-num', p?.avg_cycle_days == null && 'empty')}>
                                    {p?.avg_cycle_days != null ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="cursor-help">{formatCycle(p.avg_cycle_days)}</span>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-[240px] text-xs">
                                          Based on {p.cycle_sample} closed deal{p.cycle_sample === 1 ? '' : 's'}.{' '}
                                          {p.cycle_from_history < p.cycle_sample
                                            ? `${p.cycle_sample - p.cycle_from_history} use created-to-close dates because stage history starts accruing from now.`
                                            : 'All from stage history.'}
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      '—'
                                    )}
                                  </span>
                                  <span style={{ textAlign: 'center' }}>
                                    {rank != null && p ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className={cn('rank-badge', rank === 1 && 'first')}>#{rank}</span>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-[280px] text-xs">
                                          <span className="font-semibold">Why #{rank}:</span> {formatPct(p.win_rate)} win
                                          rate × {formatUsd(p.won_usd)} won ÷ {formatCycle(p.avg_cycle_days)} cycle ≈{' '}
                                          {formatUsd(p.throughput)} of expected revenue per selling day.
                                          {p.confidence === 'low' && ' Thin sample: treat as directional.'}
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      <span className="dt-num empty">—</span>
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    </div>

                    {/* Data coverage of the deal data itself: what the table CAN'T see.
                        At 3+ unattributed deals this becomes a quality/risk review,
                        not automatic encouragement to create another ICP. */}
                    {meta && meta.unattributed.dealCount > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          meta.unattributed.dealCount >= 3
                            ? fireAgent(
                                `${meta.unattributed.dealCount} of my ${meta.totalDeals} CRM deals (${formatUsd(meta.unattributed.openUsd + meta.unattributed.wonUsd) === '—' ? 'no recorded value' : formatUsd(meta.unattributed.openUsd + meta.unattributed.wonUsd)}) could not be attributed to an ICP. Treat this as a pipeline quality and retention risk review, not as a prompt to create a new ICP by default. Analyze whether these deals are unattributed because of missing CRM links/data, poor ICP fit, weak retention or churn patterns, or only if the evidence supports it, a genuinely underserved segment. Tell me what to inspect next before recommending any new ICP.`,
                                'Review unattributed deal risk',
                              )
                            : fireAgent(
                                `${meta.unattributed.dealCount} of my ${meta.totalDeals} CRM deals (${formatUsd(meta.unattributed.openUsd + meta.unattributed.wonUsd) === '—' ? 'no recorded value' : formatUsd(meta.unattributed.openUsd + meta.unattributed.wonUsd)}) could not be attributed to any ICP, so they are invisible in my per-ICP performance. Explain why deals end up unattributed (no company or contact link that maps to an ICP) and what I can do to fix the links.`,
                                'Why are some deals unattributed?',
                              )
                        }
                        className="attr-note"
                      >
                        <AlertTriangle className="h-4 w-4" />
                        <span className="attr-note-text">
                          {meta.unattributed.dealCount >= 3 ? (
                            <>
                              <strong>
                                {meta.unattributed.dealCount} of {meta.totalDeals}{' '}
                                {meta.totalDeals === 1 ? 'deal' : 'deals'}
                                {meta.unattributed.openUsd + meta.unattributed.wonUsd > 0 &&
                                  ` (${formatUsd(meta.unattributed.openUsd + meta.unattributed.wonUsd)})`}{' '}
                                don&apos;t match any of your ICPs.
                              </strong>{' '}
                              Treat this as an attribution, fit, or retention risk before creating a new ICP.
                            </>
                          ) : (
                            <>
                              <strong>
                                {meta.unattributed.dealCount} of {meta.totalDeals}{' '}
                                {meta.totalDeals === 1 ? 'deal' : 'deals'}
                                {meta.unattributed.openUsd + meta.unattributed.wonUsd > 0 &&
                                  ` (${formatUsd(meta.unattributed.openUsd + meta.unattributed.wonUsd)})`}{' '}
                                couldn&apos;t be attributed to an ICP
                              </strong>{' '}
                              and {meta.unattributed.dealCount === 1 ? 'isn' : 'aren'}&apos;t counted in this table.
                            </>
                          )}
                        </span>
                        <span className="attr-note-link">
                          {meta.unattributed.dealCount >= 3 ? 'Review the risk' : 'See why and how to fix it'} →
                        </span>
                      </button>
                    )}
                  </>
                )}

                {/* ── 3 · ICP coverage ──────────────────────────────────────── */}
                <SectionHeader
                  step="3"
                  title="ICP coverage"
                  source="How many companies and contacts you hold for each ICP, and where your coverage is thin. Works with no CRM."
                />

                <div className="glass dtable">
                  <div className="dtable-scroll">
                    <div style={{ minWidth: 720 }}>
                      <div className="dt-head" style={{ gridTemplateColumns: SRC_COLS }}>
                        <span className="dt-th c">ICP</span>
                        <DtTh center tip="Companies sourced and matched to this ICP.">Companies</DtTh>
                        <DtTh center tip="Average company fit score across this ICP's matched companies. Below 60% counts as a coverage gap.">
                          Company fit
                        </DtTh>
                        <DtTh center tip="Contacts held at this ICP's companies.">Contacts</DtTh>
                        <DtTh center tip="Average contact fit score: how well the people match your buyer personas.">
                          Contact fit
                        </DtTh>
                        <DtTh center tip="Average contacts per company. A healthy account has 3+ buyers — enough to multi-thread a deal; under 1.5 reads as thin.">Depth</DtTh>
                      </div>
                      {/* Ordered by coverage gap — thinnest first (fewest companies, then
                          weakest fit). This is deliberately a different priority from the
                          revenue-ranked plan above; the section copy names the distinction. */}
                      {[...cards]
                        .sort((a, b) => {
                          if (a.company_count !== b.company_count) return a.company_count - b.company_count;
                          const fa = a.avg_company_fit ?? 1;
                          const fb = b.avg_company_fit ?? 1;
                          if (fa !== fb) return fa - fb;
                          return a.icp_index - b.icp_index;
                        })
                        .map((card) => {
                        const gapClass =
                          card.overall === 'red' ? 'gap-red' : card.overall === 'amber' ? 'gap-amber' : '';
                        return (
                          <div
                            key={card.icp_id}
                            className={cn('dt-row', gapClass)}
                            style={{ gridTemplateColumns: SRC_COLS }}
                          >
                            <IcpCell
                              label={card.label}
                              index={card.icp_index}
                              trailing={
                                /* Coverage-gap flag, kept at the back of the column to match
                                   the deal-performance table's warning placement. */
                                card.overall !== 'green' ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        className="icp-warn"
                                        aria-label={`Coverage gap for ${card.label}`}
                                        onClick={() =>
                                          fireAgent(
                                            `Explain the health status for "${card.label}": it has ${card.company_count} companies, ${card.contact_count} contacts, avg company fit ${formatFitValue(card.avg_company_fit)}, avg contact fit ${formatFitValue(card.avg_contact_fit)}. Coverage is ${healthLabel(card.coverage)}, contact fit is ${healthLabel(card.contact_fit)}, depth is ${healthLabel(card.depth)}, overall ${healthLabel(card.overall)}. What's the issue and what should I do?`,
                                            `Explain health for ${card.label}`,
                                          )
                                        }
                                      >
                                        <AlertTriangle className="h-3.5 w-3.5" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-[220px] text-xs">
                                      Coverage gap. Click for what&apos;s wrong and how to fix it.
                                    </TooltipContent>
                                  </Tooltip>
                                ) : null
                              }
                            />
                            <span className={cn('dt-num', card.company_count === 0 && 'empty')}>
                              {card.company_count.toLocaleString()}
                            </span>
                            <span style={{ textAlign: 'center' }}>
                              <FitCell v={card.avg_company_fit} />
                            </span>
                            <span className={cn('dt-num', card.contact_count === 0 && 'empty')}>
                              {card.contact_count.toLocaleString()}
                              {card.recent_acquisition && card.recent_acquisition.imported_contact_count > 0 && (
                                <span className="ml-1 align-middle text-[10px] font-semibold text-emerald-600">
                                  +{card.recent_acquisition.imported_contact_count.toLocaleString()} recent
                                </span>
                              )}
                            </span>
                            <span style={{ textAlign: 'center' }}>
                              <FitCell v={card.avg_contact_fit} />
                            </span>
                            <span style={{ textAlign: 'center' }}>
                              <DepthCell v={card.avg_contacts_per_company} />
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* One CTA for the coverage play: stage sourcing across every gap ICP. */}
                {gapIcps.length > 0 && (
                  <div className="gap-banner">
                    <AlertTriangle className="gap-banner-icon h-4 w-4" />
                    <div className="gap-banner-body">
                      <p className="gap-banner-sub">
                        These ICPs have thin or no sourced companies. Source leads to improve your coverage.
                      </p>
                    </div>
                    <button type="button" className="gap-banner-btn" onClick={stageBlindSpots}>
                      <ArrowRight className="h-4 w-4" />
                      Fix blind spots
                    </button>
                  </div>
                )}

                <p className="table-footnote">
                  {hasAnyPerformance
                    ? 'Deal performance is measured from your connected CRM. Hover any column heading for its definition.'
                    : 'Connect your CRM (Settings) to unlock deal performance: win rate, ACV, sales cycle, and throughput per ICP.'}
                </p>

                {/* ── 4 · Target history (renders nothing without history) ──── */}
                <TargetHistoryTrend />
              </>
            )}
            </div>
          </div>
        </div>

        <AgentPanel
          className="max-[1439px]:!hidden min-[1440px]:!flex"
          page="coverage"
          pageContext={{
            healthCards: cards ?? [],
            healthTask: healthAgentTask || null,
            healthTaskIcpId: healthAgentIcpId || null,
            coveragePeriod: period,
            coverageTarget: target,
          }}
          pendingMessage={agentTrigger}
          onGtmTargetMutation={() => {
            void loadTarget();
          }}
        />
      </div>
    </div>
    </TooltipProvider>
  );
}
