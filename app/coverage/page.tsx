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
  CheckCircle2,
  Kanban,
  Loader2,
  Plus,
  Trophy,
  Target,
  Pencil,
  Search,
  TrendingDown,
  Sparkles,
  Database,
  BarChart3,
} from 'lucide-react';
import {
  healthLabel,
  isWeakDim,
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

// ─── Types ───────────────────────────────────────────────────────────────────

type CoverageTargetResponse = {
  period: string;
  target: { type: CoverageTargetType; value: number } | null;
  updatedAt: string | null;
  history: { period: string; type: CoverageTargetType; value: number }[];
};

type SupplyRow = {
  icpId: string;
  sourceableContacts: number | null;
  universeCompanies: number | null;
  heldCompanies: number;
  netNewCompanies: number;
  contactsPerCompany: number;
  estimate: true;
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

function healthAccentClass(d: HealthDim): string {
  switch (d) {
    case 'red':   return 'border-l-red-400';
    case 'amber': return 'border-l-amber-400';
    case 'green': return 'border-l-emerald-400';
  }
}

function buildCtas(card: IcpPipelineCard): { type: PipelineDataRequestType; label: string }[] {
  const out: { type: PipelineDataRequestType; label: string }[] = [];
  if (isWeakDim(card.coverage)) {
    out.push({ type: 'expand_companies', label: 'Find companies' });
  }
  if (card.company_count > 0 && (isWeakDim(card.contact_fit) || isWeakDim(card.depth))) {
    out.push({ type: 'more_contacts_at_accounts', label: 'Find contacts' });
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

const CONFIDENCE_LABEL: Record<IcpPerformance['confidence'], string> = {
  high: 'Strong sample',
  medium: 'Some signal',
  low: 'Thin sample',
};

const CONFIDENCE_CLASS: Record<IcpPerformance['confidence'], string> = {
  high: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  medium: 'border-sky-200 bg-sky-50 text-sky-700',
  low: 'border-gray-200 bg-gray-50 text-gray-500',
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

const TH_HEAD =
  'text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 px-2.5 py-3 whitespace-nowrap';
const TD = 'px-2.5 py-3 text-sm text-gray-900 align-top';
const TD_NUM = 'px-2.5 py-3 text-sm text-gray-900 tabular-nums text-right align-top whitespace-nowrap';

/** Column header with an inline definition tooltip ("where am I looking?"). */
function Th({ tip, right, children }: { tip?: string; right?: boolean; children: React.ReactNode }) {
  const cls = cn(TH_HEAD, right && 'text-right');
  if (!tip) return <th className={cls}>{children}</th>;
  return (
    <th className={cls}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help underline decoration-dotted decoration-gray-300 underline-offset-2">
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] text-xs font-normal normal-case tracking-normal">
          {tip}
        </TooltipContent>
      </Tooltip>
    </th>
  );
}

/** "ICP 5" tag pill + the ICP's own name, truncating gracefully. Compact mode shows just the number in the pill. */
function IcpName({ label, index, compact }: { label: string; index: number; compact?: boolean }) {
  const name = label.replace(/^ICP \d+:\s*/, '');
  return (
    <span className="flex min-w-0 items-center gap-2">
      {index > 0 && (
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full border border-gray-200 bg-gray-100 text-[10px] font-semibold text-gray-500',
            compact ? 'px-1.5 py-px' : 'px-1.5 py-0.5',
          )}
        >
          {compact ? index : `ICP ${index}`}
        </span>
      )}
      <span className={cn('font-medium text-gray-900', compact ? 'line-clamp-2' : 'truncate')} title={name}>
        {name}
      </span>
    </span>
  );
}

function HealthBadge({ dim, onClick }: { dim: HealthDim; onClick?: () => void }) {
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

/** Numbered tier header: gives the page its coverage → performance → plan legibility. */
function SectionHeader({
  step,
  icon,
  title,
  source,
  children,
}: {
  step: string;
  icon: React.ReactNode;
  title: string;
  source: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-gray-500">{icon}</div>
        <div>
          <p className="text-sm font-semibold text-gray-900">
            <span className="mr-1.5 text-gray-400">{step} ·</span>
            {title}
          </p>
          <p className="text-xs text-gray-400">{source}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

const VERDICT_STYLE: Record<
  CoverageVerdict['status'],
  { wrap: string; icon: React.ReactNode; chip: string; chipLabel: string }
> = {
  'on-track': {
    wrap: 'border-emerald-200 bg-emerald-50/70',
    icon: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
    chip: 'bg-emerald-100 text-emerald-800',
    chipLabel: 'On track',
  },
  behind: {
    wrap: 'border-amber-200 bg-amber-50/70',
    icon: <TrendingDown className="h-5 w-5 text-amber-500" />,
    chip: 'bg-amber-100 text-amber-800',
    chipLabel: 'Behind pace',
  },
  blocked: {
    wrap: 'border-red-200 bg-red-50/70',
    icon: <AlertTriangle className="h-5 w-5 text-red-500" />,
    chip: 'bg-red-100 text-red-800',
    chipLabel: 'Blocked',
  },
  'no-target': {
    wrap: 'border-arcova-teal/30 bg-arcova-teal/5',
    icon: <Target className="h-5 w-5 text-arcova-teal" />,
    chip: 'bg-arcova-teal/10 text-arcova-teal',
    chipLabel: 'No target set',
  },
  'plan-only': {
    wrap: 'border-sky-200 bg-sky-50/70',
    icon: <Sparkles className="h-5 w-5 text-sky-500" />,
    chip: 'bg-sky-100 text-sky-800',
    chipLabel: 'Plan ready',
  },
  'no-icps': {
    wrap: 'border-gray-200 bg-gray-50',
    icon: <Kanban className="h-5 w-5 text-gray-400" />,
    chip: 'bg-gray-100 text-gray-600',
    chipLabel: 'Not set up',
  },
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CoveragePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [cards, setCards] = useState<IcpPipelineCard[] | null>(null);
  const [meta, setMeta] = useState<CardsMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const agentTaskFiredRef = useRef<string | null>(null);

  // Coverage target (prescriptive tier)
  const [targetData, setTargetData] = useState<CoverageTargetResponse | null>(null);
  const [editingTarget, setEditingTarget] = useState(false);
  const [draftType, setDraftType] = useState<CoverageTargetType>('revenue');
  const [draftValue, setDraftValue] = useState('');
  const [savingTarget, setSavingTarget] = useState(false);

  // Addressable-supply ceilings (opt-in, credit-spending). `supplyRows` keeps
  // the full estimates so the UI can SHOW what the check found, not just cap rows.
  const [ceilings, setCeilings] = useState<Map<string, number | null> | null>(null);
  const [supplyRows, setSupplyRows] = useState<SupplyRow[] | null>(null);
  const [supplyLoading, setSupplyLoading] = useState(false);
  const [supplyError, setSupplyError] = useState<string | null>(null);

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
        body: JSON.stringify({ type: draftType, value }),
      });
      if (res.ok) {
        setEditingTarget(false);
        setCeilings(null); // target changed → prior supply plan is stale
        setSupplyRows(null);
        await loadTarget();
      }
    } finally {
      setSavingTarget(false);
    }
  }, [draftType, draftValue, loadTarget]);

  const checkSupply = useCallback(async () => {
    if (!cards) return;
    setSupplyLoading(true);
    setSupplyError(null);
    try {
      const contactsPerCompany: Record<string, number> = {};
      for (const c of cards) {
        if (c.avg_contacts_per_company != null && c.avg_contacts_per_company > 0) {
          contactsPerCompany[c.icp_id] = c.avg_contacts_per_company;
        }
      }
      const res = await fetch('/api/coverage/supply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contactsPerCompany }),
      });
      const payload = (await res.json().catch(() => ({}))) as { supply?: SupplyRow[]; error?: string };
      if (!res.ok) throw new Error(payload.error || 'Supply check failed');
      const map = new Map<string, number | null>();
      for (const row of payload.supply ?? []) map.set(row.icpId, row.sourceableContacts);
      setCeilings(map);
      setSupplyRows(payload.supply ?? []);
    } catch (e) {
      setSupplyError(e instanceof Error ? e.message : 'Supply check failed');
    } finally {
      setSupplyLoading(false);
    }
  }, [cards]);

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
          ceilings: ceilings ?? undefined,
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
                toBuy: topPriorityRow.capped ? topPriorityRow.sourceable : topPriorityRow.toBuy,
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
        setDraftType(target?.type ?? 'revenue');
        setDraftValue(target ? String(target.value) : '');
        setEditingTarget(true);
        break;
      case 'source':
      case 'add-companies': {
        const icpId = action.icpId ?? gapIcps[0]?.icp_id;
        if (icpId) openDataRequest(icpId, 'expand_companies', action.count);
        break;
      }
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

  const verdictStyle = verdict ? VERDICT_STYLE[verdict.status] : null;

  return (
    <TooltipProvider delayDuration={150}>
    <div className="flex h-screen bg-transparent">
      <AppSidebar />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <div className="bg-transparent flex-1 overflow-auto px-6 py-8 lg:px-10">
          <div className="mx-auto w-full max-w-[1180px]">
            <PageHeader
              eyebrow="Coverage"
              eyebrowIcon={<Activity className="h-3 w-3" />}
              title="Coverage"
              subtitle="One line per ICP: what you hold, how it converts, and what to source to hit your number."
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
                {verdict && verdictStyle && (
                  <div className={cn('mb-6 flex flex-wrap items-center gap-4 rounded-xl border px-5 py-4', verdictStyle.wrap)}>
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="mt-0.5 shrink-0">{verdictStyle.icon}</div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', verdictStyle.chip)}>
                            {verdictStyle.chipLabel}
                          </span>
                          <p className="text-sm font-semibold text-gray-900">{verdict.headline}</p>
                        </div>
                        {verdict.detail && <p className="mt-1 text-sm text-gray-600">{verdict.detail}</p>}
                      </div>
                    </div>
                    {verdict.action && (
                      <button
                        type="button"
                        onClick={runVerdictAction}
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-arcova-teal px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-arcova-teal/90"
                      >
                        {verdict.action.label}
                      </button>
                    )}
                  </div>
                )}

                {/* ── 1 · Target & plan ─────────────────────────────────────── */}
                <SectionHeader
                  step="1"
                  icon={<Target className="h-3.5 w-3.5" />}
                  title={`Target & plan · ${quarterLabel(period)}`}
                  source="Set one number; we split it across ICPs and back-calculate what to source."
                >
                  {!editingTarget && (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftType(target?.type ?? 'revenue');
                        setDraftValue(target ? String(target.value) : '');
                        setEditingTarget(true);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      {target ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                      {target ? 'Edit target' : 'Set target'}
                    </button>
                  )}
                </SectionHeader>

                <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                  {/* Inline editor */}
                  {editingTarget && (
                    <div className="space-y-3 border-b border-gray-100 px-5 py-4">
                      <div className="flex gap-2">
                        {(['revenue', 'deals'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setDraftType(t)}
                            className={cn(
                              'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                              draftType === t
                                ? 'border-arcova-teal bg-arcova-teal/10 text-arcova-teal'
                                : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                            )}
                          >
                            {t === 'revenue' ? 'Revenue ($)' : 'Deals (count)'}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-400">{draftType === 'revenue' ? '$' : '#'}</span>
                        <input
                          value={draftValue}
                          onChange={(e) => setDraftValue(e.target.value)}
                          inputMode="numeric"
                          placeholder={draftType === 'revenue' ? '2,000,000' : '40'}
                          autoFocus
                          className="w-44 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-arcova-teal focus:outline-none"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveTarget();
                            if (e.key === 'Escape') setEditingTarget(false);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => void saveTarget()}
                          disabled={savingTarget || !draftValue.trim()}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-teal px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-arcova-teal/90 disabled:opacity-50"
                        >
                          {savingTarget && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTarget(false)}
                          className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                      </div>
                      <p className="text-xs text-gray-400">
                        One overall {quarterLabel(period)} target. We split it across ICPs by throughput and
                        back-calculate how many contacts to source for each.
                      </p>
                    </div>
                  )}

                  {!target && !editingTarget && (
                    /* Purpose-built no-target state: what setting it unlocks. */
                    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5">
                      <div>
                        <p className="text-sm font-medium text-gray-900">No {quarterLabel(period)} target yet.</p>
                        <p className="mt-0.5 text-sm text-gray-500">
                          Set one number and this becomes a per-ICP sourcing plan
                          {hasCrm && actuals && actuals.priorWonCount > 0
                            ? `. Last quarter you closed ${formatUsdZero(actuals.priorWonUsd)} across ${actuals.priorWonCount} deal${actuals.priorWonCount === 1 ? '' : 's'}.`
                            : ', bounded by what each ICP can actually supply.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          fireAgent(
                            `Help me set a realistic ${quarterLabel(period)} target. Anchor on my CRM history if I have any, suggest a bracket (flat, +20%, +50% vs last quarter), and when I commit call set_gtm_target.`,
                            'Help me size my quarterly target',
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-arcova-teal/40 px-3 py-1.5 text-xs font-semibold text-arcova-teal transition-colors hover:bg-arcova-teal/5"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Size it with the agent
                      </button>
                    </div>
                  )}

                  {/* Attainment & pacing: target vs closed-won vs open pipeline. */}
                  {target && !editingTarget && (
                    <div className="border-b border-gray-100 px-5 py-4">
                      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm text-gray-700">
                          <span className="text-lg font-semibold text-gray-900">{formatTargetValue(target.type, target.value)}</span>
                          <span className="ml-2 text-xs text-gray-400">target</span>
                        </p>
                        {hasCrm && actuals && attainPct != null ? (
                          <p className="text-sm tabular-nums text-gray-700">
                            <span className="font-semibold text-gray-900">
                              {target.type === 'revenue' ? formatUsdZero(actuals.wonUsd) : `${actuals.wonCount} deals`}
                            </span>{' '}
                            closed ({formatPct(attainPct)})
                            {progress && (
                              <span className="text-gray-400"> · {progress.weeksLeft} wk left</span>
                            )}
                          </p>
                        ) : (
                          <p className="text-xs text-gray-400">Connect your CRM to track attainment here.</p>
                        )}
                      </div>

                      {hasCrm && attainPct != null && (
                        <>
                          <div className="relative h-3 w-full overflow-hidden rounded-full bg-gray-100">
                            {/* closed-won */}
                            <div
                              className="absolute inset-y-0 left-0 rounded-full bg-arcova-teal"
                              style={{ width: `${attainPct * 100}%` }}
                            />
                            {/* open pipeline (unweighted, so labelled as such) */}
                            {openPipelinePct != null && openPipelinePct > 0 && (
                              <div
                                className="absolute inset-y-0 bg-arcova-teal/25"
                                style={{ left: `${attainPct * 100}%`, width: `${openPipelinePct * 100}%` }}
                              />
                            )}
                            {/* pace marker */}
                            {progress && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div
                                    className="absolute inset-y-0 w-0.5 cursor-help bg-gray-500"
                                    style={{ left: `calc(${progress.elapsedFraction * 100}% - 1px)` }}
                                  />
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                  Pace: {formatPct(progress.elapsedFraction)} of the quarter has elapsed
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-arcova-teal" />
                              Closed won
                            </span>
                            {openPipelinePct != null && openPipelinePct > 0 && actuals && (
                              <span className="inline-flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-arcova-teal/25" />
                                Open pipeline {formatUsd(actuals.openPipelineUsd)} (not win-rate weighted)
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-2.5 w-0.5 bg-gray-500" />
                              Quarter pace
                            </span>
                          </div>
                          {/* What changed: movement, not just point-in-time. */}
                          {actuals && (actuals.wonCount > 0 || actuals.priorWonCount > 0) && (
                            <p className="mt-2.5 text-xs text-gray-500">
                              This quarter: {actuals.wonCount} deal{actuals.wonCount === 1 ? '' : 's'} closed (
                              {formatUsdZero(actuals.wonUsd)})
                              {icpsClosedThisPeriod.length > 0 && (
                                <> from {icpsClosedThisPeriod.map((c) => c.label).join(', ')}</>
                              )}
                              . Last quarter: {actuals.priorWonCount} ({formatUsdZero(actuals.priorWonUsd)}).
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Target already closed: nothing left to plan. */}
                  {!editingTarget && target && remainingTargetValue <= 0 && (
                    <div className="flex items-center gap-2 px-5 py-4">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                      <p className="text-sm text-gray-700">
                        You&apos;ve closed your full {quarterLabel(period)} target. Nothing left to source for it.
                      </p>
                    </div>
                  )}

                  {/* Sourcing plan: ranked into a "do this first" order. */}
                  {!editingTarget && target && plan && (
                    <div className="px-5 py-4">
                      {!plan.canPlan ? (
                        <p className="text-sm text-gray-500">
                          We need at least one ICP with closed-won deals (for average deal size) to plan a{' '}
                          <span className="font-medium">revenue</span> target. Switch to a deals target, or sync your
                          CRM so we can learn your ACV.
                        </p>
                      ) : (
                        <>
                          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                            <p className="text-sm text-gray-700">
                              {closedTowardTarget > 0 ? (
                                <>
                                  To close the remaining{' '}
                                  <span className="font-semibold text-gray-900">
                                    {formatTargetValue(target.type, remainingTargetValue)}
                                  </span>
                                  , source{' '}
                                </>
                              ) : (
                                <>To hit {formatTargetValue(target.type, target.value)}, source </>
                              )}
                              <span className="font-semibold text-gray-900">
                                ~{plan.result.totalToBuy.toLocaleString()} new contacts
                              </span>{' '}
                              in this order:
                            </p>
                            {ceilings == null ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => void checkSupply()}
                                    disabled={supplyLoading}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                                  >
                                    {supplyLoading ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Search className="h-3.5 w-3.5" />
                                    )}
                                    Check addressable supply
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-[280px] text-xs">
                                  Sanity-checks the plan against reality: asks Apollo how many companies matching
                                  each ICP exist, subtracts what you hold, and caps any row that wants more contacts
                                  than are actually out there. Count-only lookup, about 0.1 Apollo credits per ICP.
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="text-xs font-medium text-gray-400">Supply checked (estimate)</span>
                            )}
                          </div>

                          {supplyError && <p className="mb-2 text-xs text-red-600">{supplyError}</p>}

                          <div className="overflow-hidden rounded-lg border border-gray-100">
                            <table className="w-full border-collapse text-sm">
                              <thead>
                                <tr className="border-b border-gray-100 bg-gray-50/60">
                                  <Th>Priority</Th>
                                  <Th>ICP</Th>
                                  <Th right tip="This ICP's share of the overall target, weighted by throughput (your fastest, surest converters get more of the number).">
                                    Share
                                  </Th>
                                  <Th right tip="The slice of your target this ICP is expected to carry.">Sub-target</Th>
                                  <Th right tip="Contacts to source for this ICP, back-calculated from its sub-target through win rate and contact-to-deal conversion, minus contacts you already hold.">
                                    To source
                                  </Th>
                                  <Th> </Th>
                                </tr>
                              </thead>
                              <tbody>
                                {rankedPlanRows.map((a, idx) => {
                                  const isTop = topPriorityRow?.icpId === a.icpId;
                                  return (
                                    <tr key={a.icpId} className="border-b border-gray-50 last:border-b-0">
                                      <td className={`${TD} w-16`}>
                                        <span
                                          className={cn(
                                            'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                                            isTop
                                              ? 'border-arcova-teal/40 bg-arcova-teal/10 text-arcova-teal'
                                              : 'border-gray-200 bg-gray-50 text-gray-500',
                                          )}
                                        >
                                          {idx === 0 ? 'First' : `#${idx + 1}`}
                                        </span>
                                      </td>
                                      <td className={`${TD} w-full max-w-0`}>
                                        <IcpName label={a.label} index={cardByIcpId.get(a.icpId)?.icp_index ?? 0} />
                                      </td>
                                      <td className={TD_NUM}>{Math.round((a.shareOfTarget ?? 0) * 100)}%</td>
                                      <td className={TD_NUM}>{formatTargetValue(target.type, a.subTarget)}</td>
                                      <td className={TD_NUM}>
                                        {a.capped ? (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span className="cursor-help text-amber-700">
                                                {a.sourceable.toLocaleString()}
                                                <span className="text-gray-400"> / {a.toBuy.toLocaleString()}</span>
                                              </span>
                                            </TooltipTrigger>
                                            <TooltipContent side="top" className="max-w-[240px] text-xs">
                                              The plan wants {a.toBuy.toLocaleString()} contacts, but this ICP&apos;s
                                              addressable supply only has ~{a.sourceable.toLocaleString()} left.
                                            </TooltipContent>
                                          </Tooltip>
                                        ) : (
                                          a.toBuy.toLocaleString()
                                        )}
                                      </td>
                                      <td className={`${TD} whitespace-nowrap text-right`}>
                                        {a.capped && (
                                          <span className="mr-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                            Supply-limited
                                          </span>
                                        )}
                                        {a.toBuy > 0 && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              openDataRequest(
                                                a.icpId,
                                                'expand_companies',
                                                a.capped ? a.sourceable : a.toBuy,
                                              )
                                            }
                                            className={cn(
                                              'rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors',
                                              isTop
                                                ? 'bg-arcova-teal text-white hover:bg-arcova-teal/90'
                                                : 'text-arcova-teal hover:underline',
                                            )}
                                          >
                                            Source {(a.capped ? a.sourceable : a.toBuy).toLocaleString()}
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          {/* What the supply check actually found: otherwise the button
                              appears to do nothing when no row ends up capped. */}
                          {supplyRows && (
                            <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/70 px-3 py-2.5 text-xs text-gray-600">
                              <p className="mb-1 font-semibold text-gray-700">What the supply check found</p>
                              {rankedPlanRows.map((a) => {
                                const s = supplyRows.find((r) => r.icpId === a.icpId);
                                const idx = cardByIcpId.get(a.icpId)?.icp_index ?? 0;
                                const name = a.label.replace(/^ICP \d+:\s*/, '');
                                if (!s || s.sourceableContacts == null) {
                                  return (
                                    <p key={a.icpId} className="mt-0.5">
                                      <span className="font-medium text-gray-700">ICP {idx} ({name})</span>: couldn&apos;t
                                      be counted (Apollo rejected this ICP&apos;s filters), so its row stays uncapped.
                                    </p>
                                  );
                                }
                                return (
                                  <p key={a.icpId} className="mt-0.5">
                                    <span className="font-medium text-gray-700">ICP {idx} ({name})</span>: ~
                                    {s.universeCompanies?.toLocaleString() ?? '?'} matching companies exist,{' '}
                                    {s.netNewCompanies.toLocaleString()} are new to you, so roughly{' '}
                                    {s.sourceableContacts.toLocaleString()} contacts are sourceable vs{' '}
                                    {a.toBuy.toLocaleString()} needed:{' '}
                                    {a.capped ? (
                                      <span className="font-medium text-amber-700">not enough, row capped.</span>
                                    ) : (
                                      <span className="font-medium text-emerald-700">plenty of headroom.</span>
                                    )}
                                  </p>
                                );
                              })}
                              {(() => {
                                const plannedIds = new Set(rankedPlanRows.map((a) => a.icpId));
                                const failedOthers = supplyRows.filter(
                                  (r) => !plannedIds.has(r.icpId) && r.sourceableContacts == null,
                                ).length;
                                return failedOthers > 0 ? (
                                  <p className="mt-1 text-gray-400">
                                    {failedOthers} unplanned ICP{failedOthers === 1 ? '' : 's'} couldn&apos;t be counted
                                    (Apollo rejected their filters, often a paid-plan filter like funding stage).
                                  </p>
                                ) : null;
                              })()}
                            </div>
                          )}

                          {plan.result.shortfall > 0 && (
                            <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-700">
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span>
                                {formatTargetValue(target.type, plan.result.shortfall)} of this target is beyond your
                                ICPs&apos; addressable supply. Broaden an ICP, extend the timeline, or trim the number.
                              </span>
                            </p>
                          )}

                          {/* How the split was decided: even fallback vs evidence-based.
                              (The shortfall note is skipped; the amber line above covers it.) */}
                          {plan.result.notes.filter((n) => !n.startsWith('Target exceeds')).map((note) => (
                            <p key={note} className="mt-3 flex items-start gap-1.5 text-xs text-sky-700">
                              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span>{note}</span>
                            </p>
                          ))}
                          {unallocatedIcpCount > 0 && (
                            <p className="mt-2 text-xs text-gray-400">
                              {unallocatedIcpCount} ICP{unallocatedIcpCount === 1 ? ' has' : 's have'} no closed-won
                              evidence yet, so the ranking gives {unallocatedIcpCount === 1 ? 'it' : 'them'} no slice
                              of this target. That changes as soon as they win deals.
                            </p>
                          )}

                          {/* Honest provenance: which rates are measured vs assumed. */}
                          <p className="mt-3 text-xs text-gray-400">
                            Win rate {formatPct(plan.defaults.winRate)}{' '}
                            {plan.sources.winRate === 'measured' ? '(measured from your closed deals)' : '(industry default)'} ·
                            contact-to-deal {formatPct(plan.defaults.contactToDeal)}{' '}
                            {plan.sources.contactToDeal === 'measured' && plan.sources.conversionSample
                              ? `(measured: ${plan.sources.conversionSample.withDeals} of ${plan.sources.conversionSample.total} contacts produced a deal)`
                              : '(industry default, refines as deals link to contacts)'}
                            {target.type === 'revenue' && (
                              <>
                                {' '}· ACV {formatUsd(plan.defaults.avgAcv)}{' '}
                                {plan.sources.avgAcv === 'measured' ? '(measured from won deals)' : '(assumed)'}
                              </>
                            )}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* ── 2 · Deal performance ──────────────────────────────────── */}
                <SectionHeader
                  step="2"
                  icon={<BarChart3 className="h-3.5 w-3.5" />}
                  title="Deal performance"
                  source={hasCrm ? 'From your connected CRM. This is what ranks your ICPs.' : 'Locked until a CRM is connected.'}
                />

                {!hasCrm ? (
                  /* Purpose-built no-CRM state: what connecting unlocks. */
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-gray-300 bg-white/60 px-5 py-5">
                    <div className="flex items-start gap-3">
                      <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">Connect your CRM to see which ICPs actually convert.</p>
                        <p className="mt-0.5 text-sm text-gray-500">
                          Win rate, deal size, and sales-cycle length per ICP, measured from your closed deals instead
                          of guessed. It also makes the sourcing plan above use your real funnel.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push(ROUTES.settings)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      Connect CRM
                    </button>
                  </div>
                ) : (
                  <>
                    {/* The non-obvious winner, one line, in context with the table it explains. */}
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
                        className="mb-3 flex w-full items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-left transition-colors hover:bg-emerald-100"
                      >
                        <Trophy className="h-4 w-4 shrink-0 text-emerald-500" />
                        <p className="text-sm text-emerald-900">
                          <span className="font-medium">
                            {insight.surprise
                              ? `${insight.best.label} converts best, and it is not your biggest ICP.`
                              : `${insight.best.label} is your strongest converter.`}
                          </span>{' '}
                          <span className="text-emerald-700">Click to see why.</span>
                        </p>
                      </button>
                    )}

                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <Th>ICP</Th>
                            <Th right tip="CRM deals attributed to this ICP: open, won, and lost.">Deals</Th>
                            <Th right tip="Open (not yet closed) deal value attributed to this ICP.">Pipeline</Th>
                            <Th right tip="Total closed-won revenue attributed to this ICP.">Closed won</Th>
                            <Th right tip="Won deals divided by closed deals (won + lost). Small samples can swing with a single deal.">
                              Win rate
                            </Th>
                            <Th right tip="Average value of this ICP's won deals.">Avg ACV</Th>
                            <Th right tip="Average days from first stage to closed-won. Uses stage history when available; otherwise falls back to created-to-close dates.">
                              Cycle
                            </Th>
                            <Th right tip="Throughput rank: win rate × won revenue ÷ average cycle days, i.e. expected revenue per selling day. This is what splits your target across ICPs.">
                              Rank
                            </Th>
                            <Th tip="Evidence health by closed-deal sample: 10+ closed is strong, 4+ is some signal, fewer is thin. Thin samples can flip with one deal.">
                              Health
                            </Th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...cards]
                            .sort((a, b) => {
                              const ra = rankMap.get(a.icp_id) ?? Infinity;
                              const rb = rankMap.get(b.icp_id) ?? Infinity;
                              if (ra !== rb) return ra - rb;
                              const da = (a.performance?.active_deal_count ?? 0) + (a.performance?.won_count ?? 0) + (a.performance?.lost_count ?? 0);
                              const db = (b.performance?.active_deal_count ?? 0) + (b.performance?.won_count ?? 0) + (b.performance?.lost_count ?? 0);
                              return db - da;
                            })
                            .map((card) => {
                              const p = card.performance;
                              const totalDeals = p ? p.active_deal_count + p.won_count + p.lost_count : 0;
                              const rank = rankMap.get(card.icp_id);
                              return (
                                <tr key={card.icp_id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/80">
                                  <td className={`${TD} w-full max-w-0`}>
                                    <IcpName label={card.label} index={card.icp_index} />
                                    {p && p.won_count_in_period > 0 && (
                                      <p className="mt-0.5 text-[11px] text-emerald-600">
                                        +{formatUsd(p.won_usd_in_period)} closed this quarter
                                      </p>
                                    )}
                                  </td>
                                  <td className={TD_NUM}>
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
                                  </td>
                                  <td className={TD_NUM}>{formatUsd(p?.pipeline_usd)}</td>
                                  <td className={TD_NUM}>{p && p.won_usd > 0 ? formatUsd(p.won_usd) : '—'}</td>
                                  <td className={TD_NUM}>{p?.win_rate != null ? formatPct(p.win_rate) : '—'}</td>
                                  <td className={TD_NUM}>{formatUsd(p?.avg_acv)}</td>
                                  <td className={TD_NUM}>
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
                                  </td>
                                  <td className={TD_NUM}>
                                    {rank != null && p ? (
                                      /* Decomposed, not a black box: the formula behind the rank. */
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span
                                            className={cn(
                                              'inline-flex cursor-help items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                                              rank === 1
                                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                                : 'border-gray-200 bg-gray-50 text-gray-600',
                                            )}
                                          >
                                            #{rank}
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-[280px] text-xs">
                                          <span className="font-semibold">Why #{rank}:</span> {formatPct(p.win_rate)} win
                                          rate × {formatUsd(p.won_usd)} won ÷ {formatCycle(p.avg_cycle_days)} cycle ≈{' '}
                                          {formatUsd(p.throughput)} of expected revenue per selling day.
                                          {p.confidence === 'low' && ' Thin sample: treat as directional.'}
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                  <td className={`${TD} whitespace-nowrap`}>
                                    {/* Thin sample is muted plain text (like "No deals yet"): both mean
                                        "not enough evidence", only real signal earns a chip. */}
                                    {p && p.confidence !== 'low' ? (
                                      <span
                                        className={cn(
                                          'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
                                          CONFIDENCE_CLASS[p.confidence],
                                        )}
                                      >
                                        {CONFIDENCE_LABEL[p.confidence]}
                                      </span>
                                    ) : (
                                      <span className="text-xs text-gray-400">{p ? 'Thin sample' : 'No deals yet'}</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>

                    {/* Data coverage of the deal data itself: what the table CAN'T see. */}
                    {meta && meta.unattributed.dealCount > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          fireAgent(
                            `${meta.unattributed.dealCount} of my ${meta.totalDeals} CRM deals (${formatUsd(meta.unattributed.openUsd + meta.unattributed.wonUsd) === '—' ? 'no recorded value' : formatUsd(meta.unattributed.openUsd + meta.unattributed.wonUsd)}) could not be attributed to any ICP, so they are invisible in my per-ICP performance. Explain why deals end up unattributed (no company or contact link that maps to an ICP) and what I can do to fix the links.`,
                            'Why are some deals unattributed?',
                          )
                        }
                        className="mt-2.5 flex w-full items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2.5 text-left transition-colors hover:bg-amber-50"
                      >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                        <p className="text-xs text-amber-800">
                          <span className="font-semibold">
                            {meta.unattributed.dealCount} of {meta.totalDeals}{' '}
                            {meta.totalDeals === 1 ? 'deal' : 'deals'}
                            {meta.unattributed.openUsd + meta.unattributed.wonUsd > 0 &&
                              ` (${formatUsd(meta.unattributed.openUsd + meta.unattributed.wonUsd)})`}{' '}
                            couldn&apos;t be attributed to an ICP
                          </span>{' '}
                          and {meta.unattributed.dealCount === 1 ? 'is' : 'are'} not counted in this table. Click to see
                          why and how to fix it.
                        </p>
                      </button>
                    )}
                  </>
                )}

                {/* ── 3 · Sourced coverage ──────────────────────────────────── */}
                <SectionHeader
                  step="3"
                  icon={<Database className="h-3.5 w-3.5" />}
                  title="Sourced coverage"
                  source="From your sourced data. The raw material the plan draws on; works with no CRM."
                >
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
                      className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-100"
                    >
                      <AlertTriangle className="h-3 w-3" />
                      {gapIcps.length} {gapIcps.length === 1 ? 'coverage gap' : 'coverage gaps'}
                    </button>
                  )}
                </SectionHeader>

                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <Th>ICP</Th>
                        <Th right tip="Companies sourced and matched to this ICP.">Companies</Th>
                        <Th right tip="Average company fit score across this ICP's matched companies. Below 60% counts as a coverage gap.">
                          Company fit
                        </Th>
                        <Th right tip="Contacts held at this ICP's companies.">Contacts</Th>
                        <Th right tip="Average contact fit score: how well the people match your buyer personas.">
                          Contact fit
                        </Th>
                        <Th right tip="Average contacts per company. Multi-threaded deals usually need 3+.">Depth</Th>
                        <Th tip="The worst of company coverage, contact fit, and depth. Click a badge for an explanation.">
                          Health
                        </Th>
                        <Th> </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {cards.map((card) => {
                        const ctas = buildCtas(card);
                        const primaryCta = ctas[0] ?? null;
                        return (
                          <tr
                            key={card.icp_id}
                            className={cn(
                              'border-b border-gray-100 border-l-4 hover:bg-gray-50/80',
                              healthAccentClass(card.overall),
                              'last:border-b-0',
                            )}
                          >
                            <td className={`${TD} w-full max-w-0`}>
                              <IcpName label={card.label} index={card.icp_index} />
                            </td>
                            <td className={TD_NUM}>{card.company_count.toLocaleString()}</td>
                            <td className={TD_NUM}>{formatFitValue(card.avg_company_fit)}</td>
                            <td className={TD_NUM}>{card.contact_count.toLocaleString()}</td>
                            <td className={TD_NUM}>{formatFitValue(card.avg_contact_fit)}</td>
                            <td className={TD_NUM}>{formatDepthValue(card.avg_contacts_per_company)}</td>
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
                            <td className={`${TD} whitespace-nowrap text-right`}>
                              {primaryCta && (
                                <button
                                  type="button"
                                  onClick={() => openDataRequest(card.icp_id, primaryCta.type)}
                                  className="text-xs font-semibold text-arcova-teal hover:underline"
                                >
                                  {primaryCta.label}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <p className="mt-3 text-xs text-gray-400">
                  {hasAnyPerformance
                    ? 'Deal performance is measured from your connected CRM. Hover any column heading for its definition.'
                    : 'Connect your CRM (Settings) to unlock deal performance: win rate, ACV, sales cycle, and throughput per ICP.'}
                </p>
              </>
            )}
          </div>
        </div>

        <AgentPanel
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
            setCeilings(null); // target changed → prior supply plan is stale
            setSupplyRows(null);
            void loadTarget();
          }}
        />
      </div>
    </div>
    </TooltipProvider>
  );
}
