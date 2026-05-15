'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { AgentPanel, type AgentPendingMessage } from '@/components/AgentPanel';
import { AgentChatBar } from '@/components/AgentChatBar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getSignalDisplayName } from '@/lib/signal-display-names';
import { getSignalBaseImpactScore } from '@/lib/signals/readiness-catalog';
import type { SignalKey } from '@/lib/signals/readiness-types';
import { ROUTES, withQuery } from '@/lib/routes';
import { cn } from '@/lib/utils';
import '@/app/leads/contacts-layout.css';
import {
  Activity,
  ArrowUpRight,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  RotateCw,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';

type SignalPreviewTab = 'signal' | 'evidence' | 'context' | 'action';

type SignalFeedRow = {
  id: string;
  signalKey: string;
  signalScope: 'company' | 'contact';
  companyId: string | null;
  companyName: string | null;
  companyDomain: string | null;
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactJobTitle: string | null;
  contactLinkedinUrl: string | null;
  dimensions: string[];
  buyerFunctions: string[];
  intentMechanisms: string[];
  defaultStrength: string;
  defaultConfidence: string;
  eventAt: string | null;
  observedAt: string;
  evidenceExcerpt: string | null;
  source: string;
  sourceEventType: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceSummary: string | null;
  sourceExcerpt: string | null;
  sourceMetadata: Record<string, unknown>;
  readiness: {
    overallScore: number | null;
    overallLabel: string | null;
    newBudgetScore: number | null;
    newBudgetLabel: string | null;
    newNeedsScore: number | null;
    newNeedsLabel: string | null;
    newPeopleScore: number | null;
    newPeopleLabel: string | null;
    newStrategyScore: number | null;
    newStrategyLabel: string | null;
    cautionScore: number | null;
    cautionLabel: string | null;
  } | null;
  reason: {
    summaryShort: string | null;
    whyNow: string | null;
    suggestedAngle: string | null;
    confidenceLabel: string | null;
  } | null;
};

type MonitorRunResult = {
  contact_processed: number;
  contact_skipped_running: number;
  company_processed: number;
  processed: number;
  skipped_running: number;
  failed: number;
  emitted_signal_types: string[];
  recomputed_companies: string[];
  failures: { entity_type: 'contact' | 'company'; entity_id: string; error: string }[];
};

type SignalsScope = 'all' | 'contact' | 'company';

type SignalsWorkspaceProps = {
  scope?: SignalsScope;
  eyebrow?: string;
  title?: string;
  description?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  showRunSignals?: boolean;
};

const PAGE_SIZE = 25;
const PREVIEW_TABS: Array<{ id: SignalPreviewTab; label: string }> = [
  { id: 'signal', label: 'Signal' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'context', label: 'Context' },
  { id: 'action', label: 'Action' },
];

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toTitleCase(value: string) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatRelativeTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = date.getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
  const diffHours = Math.round(diffMin / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) return rtf.format(diffDays, 'day');
  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) return rtf.format(diffMonths, 'month');
  const diffYears = Math.round(diffMonths / 12);
  return rtf.format(diffYears, 'year');
}

function dimensionLabel(dimension: string) {
  switch (dimension) {
    case 'new_budget':
      return 'New budget';
    case 'new_needs':
      return 'New needs';
    case 'new_people':
      return 'New people';
    case 'new_strategy':
      return 'New strategy';
    case 'caution':
      return 'Caution';
    default:
      return toTitleCase(dimension);
  }
}

function primaryDimension(row: SignalFeedRow): string {
  return row.dimensions[0] || 'new_people';
}

function readinessCategoryPillClass(dimension: string) {
  switch (dimension) {
    case 'new_budget':
      return 'border-[rgba(45,138,138,0.2)] bg-[rgba(238,251,250,0.92)] text-[#2d8a8a]';
    case 'new_needs':
      return 'border-[rgba(73,111,157,0.18)] bg-[rgba(245,248,254,0.92)] text-[#496f9d]';
    case 'new_people':
      return 'border-[rgba(101,116,205,0.18)] bg-[rgba(245,243,255,0.92)] text-[#5b63b6]';
    case 'new_strategy':
      return 'border-[rgba(180,130,40,0.2)] bg-[rgba(255,248,230,0.95)] text-[#a07012]';
    case 'caution':
      return 'border-[rgba(220,107,61,0.22)] bg-[rgba(255,244,238,0.92)] text-[#dc6b3d]';
    default:
      return 'border-[rgba(73,111,157,0.18)] bg-[rgba(245,248,254,0.92)] text-[#496f9d]';
  }
}

function strengthNumber(strength?: string | null) {
  switch (strength) {
    case 'strong':
      return 3;
    case 'medium':
      return 2;
    case 'weak':
      return 1;
    default:
      return 2;
  }
}

function strengthLabel(strength?: string | null) {
  return `${toTitleCase(strength || 'medium')} (${strengthNumber(strength)})`;
}

function impactScore(row: SignalFeedRow) {
  return getSignalBaseImpactScore(row.signalKey as SignalKey);
}

function signedImpactScore(row: SignalFeedRow) {
  const base = impactScore(row);
  return row.dimensions.includes('caution') ? -base : base;
}

function sourceLabel(row: SignalFeedRow) {
  if (row.source === 'external_contact_change' || row.source === 'apify_linkedin_people_monitor') {
    const provider = normalizeString(row.sourceMetadata.source_provider);
    if (provider) return `${provider} monitor`;
    return 'Apify / LinkedIn monitor';
  }
  if (row.source === 'hubspot_crm_deals' || row.source === 'hubspot_crm_contacts') {
    return 'HubSpot CRM';
  }
  return toTitleCase(row.source.replace(/[-:]/g, ' '));
}

function effectLabel(row: SignalFeedRow) {
  return row.dimensions.includes('caution') ? 'Lowers readiness' : 'Raises readiness';
}

function effectPillClass(row: SignalFeedRow) {
  if (row.dimensions.includes('caution')) {
    return 'border-[rgba(220,107,61,0.22)] bg-[rgba(255,244,238,0.92)] text-[#dc6b3d]';
  }
  return 'border-[rgba(45,138,138,0.2)] bg-[rgba(238,251,250,0.92)] text-[#2d8a8a]';
}

function confidencePillClass(confidence?: string | null) {
  switch (confidence) {
    case 'high':
      return 'border-[rgba(45,138,138,0.2)] bg-[rgba(238,251,250,0.92)] text-[#2d8a8a]';
    case 'low':
      return 'border-[rgba(220,107,61,0.18)] bg-[rgba(255,244,238,0.92)] text-[#dc6b3d]';
    default:
      return 'border-[rgba(73,111,157,0.18)] bg-[rgba(245,248,254,0.92)] text-[#496f9d]';
  }
}

function readinessToneClass(label?: string | null) {
  switch (label) {
    case 'high':
      return 'border-[rgba(45,138,138,0.2)] bg-[rgba(238,251,250,0.92)] text-[#2d8a8a]';
    case 'low':
      return 'border-[rgba(220,107,61,0.18)] bg-[rgba(255,244,238,0.92)] text-[#dc6b3d]';
    default:
      return 'border-[rgba(73,111,157,0.18)] bg-[rgba(245,248,254,0.92)] text-[#496f9d]';
  }
}

function overallScoreDisplay(score?: number | null) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '—';
  return Math.round(score * 100);
}

function categoryScoreDisplay(score?: number | null) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '—';
  return Math.round(score * 100);
}

function targetName(row: SignalFeedRow) {
  return row.contactName || row.companyName || 'Unknown target';
}

function signalScopeLabel(row: SignalFeedRow) {
  return row.signalScope === 'company' ? 'Account signal' : 'Contact signal';
}

function displayMetadataLabel(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value
    .trim()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function primaryDimensionScore(row: SignalFeedRow) {
  if (!row.readiness) return -1;
  switch (primaryDimension(row)) {
    case 'new_budget':
      return row.readiness.newBudgetScore ?? -1;
    case 'new_needs':
      return row.readiness.newNeedsScore ?? -1;
    case 'new_people':
      return row.readiness.newPeopleScore ?? -1;
    case 'new_strategy':
      return row.readiness.newStrategyScore ?? -1;
    case 'caution':
      return row.readiness.cautionScore ?? -1;
    default:
      return -1;
  }
}

function changeRows(row: SignalFeedRow) {
  const meta = row.sourceMetadata || {};
  const previousTitle = normalizeString(meta.previous_job_title);
  const currentTitle = normalizeString(meta.current_job_title);
  const previousCompany = normalizeString(meta.previous_company_name);
  const currentCompany = normalizeString(meta.current_company_name);
  const previousFundingStage = displayMetadataLabel(meta.previous_funding_stage);
  const currentFundingStage = displayMetadataLabel(meta.current_funding_stage);
  const previousFundingStatus = normalizeString(meta.previous_funding_status_label);
  const currentFundingStatus = normalizeString(meta.current_funding_status_label);
  const previousSeniority = displayMetadataLabel(meta.previous_seniority_level);
  const currentSeniority = displayMetadataLabel(meta.current_seniority_level);
  const previousRoleFamily = displayMetadataLabel(meta.previous_role_family);
  const currentRoleFamily = displayMetadataLabel(meta.current_role_family);
  const out: Array<{ label: string; before: string | null; after: string | null }> = [];

  if (previousTitle || currentTitle) {
    out.push({ label: 'Role', before: previousTitle, after: currentTitle });
  }
  if ((previousSeniority || currentSeniority) && previousSeniority !== currentSeniority) {
    out.push({ label: 'Seniority', before: previousSeniority, after: currentSeniority });
  }
  if ((previousRoleFamily || currentRoleFamily) && previousRoleFamily !== currentRoleFamily) {
    out.push({ label: 'Role family', before: previousRoleFamily, after: currentRoleFamily });
  }
  if (previousCompany || currentCompany) {
    out.push({ label: 'Company', before: previousCompany, after: currentCompany });
  }
  if ((previousFundingStage || currentFundingStage) && previousFundingStage !== currentFundingStage) {
    out.push({ label: 'Funding stage', before: previousFundingStage, after: currentFundingStage });
  }
  if ((previousFundingStatus || currentFundingStatus) && previousFundingStatus !== currentFundingStatus) {
    out.push({ label: 'Funding status', before: previousFundingStatus, after: currentFundingStatus });
  }
  return out;
}

function metadataValue(meta: Record<string, unknown>, key: string) {
  const value = meta[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').join(', ');
  return null;
}

function SortArrow({ active }: { active: boolean }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 shrink-0 text-gray-300" />;
  return <ChevronDown className="h-3 w-3 shrink-0 text-arcova-teal" />;
}

export function SignalsWorkspace({
  scope = 'all',
  eyebrow = 'Signals',
  title = 'Recent signals',
  description,
  emptyTitle = 'No signals yet',
  emptyDescription,
  showRunSignals = scope !== 'company',
}: SignalsWorkspaceProps) {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [agentTrigger, setAgentTrigger] = useState<AgentPendingMessage | undefined>();
  const [agentChatBarValue, setAgentChatBarValue] = useState('');
  const [signals, setSignals] = useState<SignalFeedRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingSignals, setLoadingSignals] = useState(true);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<SignalPreviewTab>('signal');
  const [runningSignals, setRunningSignals] = useState(false);
  const [runSignalsResult, setRunSignalsResult] = useState<MonitorRunResult | null>(null);
  const [tableSortCol, setTableSortCol] = useState<'detected' | 'signal' | 'name' | 'company' | 'readiness' | 'overall'>('detected');
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc');
  const [agentRect, setAgentRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  const fireAgent = (text: string, threadPreview?: string) =>
    setAgentTrigger((prev) => ({
      text,
      nonce: (prev?.nonce ?? 0) + 1,
      ...(threadPreview ? { threadPreview } : {}),
    }));

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, router, user]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const el = document.querySelector<HTMLElement>('.contacts-leads-agent-col');
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) {
        setAgentRect(null);
        return;
      }
      setAgentRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, []);

  const fetchSignals = useCallback(
    async (silent = false) => {
      if (!user) return;
      if (!silent) setLoadingSignals(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
        });
        if (scope !== 'all') params.set('scope', scope);
        const res = await fetch(`/api/signals/feed?${params}`);
        if (!res.ok) throw new Error('Failed to fetch signals');
        const data = await res.json();
        setSignals(Array.isArray(data.data) ? data.data : []);
        setTotal(typeof data.total === 'number' ? data.total : 0);
        setSelectedSignalId((current) => {
          if (current && (data.data || []).some((row: SignalFeedRow) => row.id === current)) return current;
          return null;
        });
      } catch (error) {
        console.error('Error fetching signals:', error);
        if (!silent) {
          setSignals([]);
          setTotal(0);
        }
      } finally {
        if (!silent) setLoadingSignals(false);
      }
    },
    [page, scope, user],
  );

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  const handleRunSignals = useCallback(async () => {
    if (runningSignals) return;
    setRunningSignals(true);
    setRunSignalsResult(null);
    try {
      const res = await fetch('/api/signals/run', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        console.error('Run signals failed:', json?.error || 'Unknown error');
        return;
      }
      const result = json?.result ?? null;
      if (result) {
        setRunSignalsResult(result);
        await fetchSignals(true);
      }
    } catch (error) {
      console.error('Run signals error:', error);
    } finally {
      setRunningSignals(false);
    }
  }, [fetchSignals, runningSignals]);

  const selectedSignal = useMemo(
    () => signals.find((row) => row.id === selectedSignalId) ?? null,
    [selectedSignalId, signals],
  );

  const sortedSignals = useMemo(() => {
    const items = [...signals];
    const cmp = (a: SignalFeedRow, b: SignalFeedRow) => {
      switch (tableSortCol) {
        case 'name':
          return targetName(a).localeCompare(targetName(b));
        case 'company':
          return (a.companyName || '').localeCompare(b.companyName || '');
        case 'signal':
          return getSignalDisplayName(a.signalKey).localeCompare(getSignalDisplayName(b.signalKey));
        case 'readiness':
          return primaryDimensionScore(a) - primaryDimensionScore(b);
        case 'overall':
          return (a.readiness?.overallScore ?? -1) - (b.readiness?.overallScore ?? -1);
        case 'detected':
        default:
          return new Date(a.eventAt || a.observedAt).getTime() - new Date(b.eventAt || b.observedAt).getTime();
      }
    };
    items.sort((a, b) => (tableSortDir === 'asc' ? cmp(a, b) : -cmp(a, b)));
    return items;
  }, [signals, tableSortCol, tableSortDir]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const tableGridClass =
    scope === 'contact'
      ? 'grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)_minmax(0,0.95fr)_minmax(0,1.05fr)_minmax(0,0.92fr)_minmax(0,0.62fr)]'
      : 'grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)]';

  const signalTitleBlock = (
    <div className="mb-6 shrink-0 flex flex-col gap-4 max-[767px]:pl-14 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-arcova-teal">
          <Activity className="h-3.5 w-3.5" />
          {eyebrow}
        </div>
        <h1 className="font-manrope mt-2 text-3xl font-semibold leading-tight tracking-[-0.028em] text-slate-950 sm:text-[2.25rem]">
          {title}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          {total > 0
            ? description || `${total.toLocaleString()} signal${total !== 1 ? 's' : ''} detected. Click a row for the evidence, readiness context, and next action.`
            : emptyDescription || 'Externally monitored readiness signals will appear here as Arcova detects meaningful change.'}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-arcova-teal px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-arcova-teal/90 disabled:cursor-not-allowed disabled:opacity-60"
              title="Actions"
            >
              {runningSignals ? <RotateCw className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
              Actions
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="min-w-[14rem]">
            <DropdownMenuItem onSelect={() => fetchSignals()}>
              <RotateCw className="h-3.5 w-3.5" />
              Refresh list
            </DropdownMenuItem>
            {showRunSignals ? (
              <DropdownMenuItem onSelect={handleRunSignals} disabled={runningSignals}>
                {runningSignals ? <RotateCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {runningSignals ? 'Running…' : 'Run signals now'}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );

  const runSignalsBanner = runSignalsResult ? (
    <div className="mb-4 shrink-0 rounded-lg border border-gray-200 bg-white px-4 py-3.5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold text-gray-900">Signals monitor ran</span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
            {runSignalsResult.contact_processed} contacts checked
          </span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
            {runSignalsResult.company_processed} accounts checked
          </span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
            {runSignalsResult.emitted_signal_types.length} signal{runSignalsResult.emitted_signal_types.length !== 1 ? 's' : ''}
          </span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
            {runSignalsResult.recomputed_companies.length} account{runSignalsResult.recomputed_companies.length !== 1 ? 's' : ''} updated
          </span>
          {runSignalsResult.contact_skipped_running > 0 ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              {runSignalsResult.contact_skipped_running} skipped running
            </span>
          ) : null}
          {runSignalsResult.failed > 0 ? (
            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-600">
              {runSignalsResult.failed} failed
            </span>
          ) : null}
        </div>
        {runSignalsResult.emitted_signal_types.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {runSignalsResult.emitted_signal_types.map((signal) => (
              <span
                key={signal}
                className="inline-flex items-center rounded-full border border-[rgba(45,138,138,0.2)] bg-[rgba(238,251,250,0.92)] px-2 py-0.5 text-[10px] font-medium text-[#2d8a8a]"
              >
                {getSignalDisplayName(signal)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <button
        onClick={() => setRunSignalsResult(null)}
        className="shrink-0 text-gray-400 hover:text-gray-600 mt-0.5"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  ) : null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-32 w-32 animate-spin rounded-full border-b-2 border-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-0 h-screen bg-transparent">
      <AppSidebar />

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 overflow-hidden p-3.5 md:flex-row md:gap-2">
        <div className="contacts-leads-main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] bg-transparent px-3 py-3 sm:px-5 sm:py-4 min-[1280px]:pr-2">
          <div className="flex min-h-0 w-full max-w-none flex-1 flex-col">
            {loadingSignals ? (
              <>
                {signalTitleBlock}
                {showRunSignals ? runSignalsBanner : null}
                <div className="flex items-center justify-center py-24">
                  <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-arcova-teal" />
                </div>
              </>
            ) : sortedSignals.length === 0 ? (
              <>
                {signalTitleBlock}
                {showRunSignals ? runSignalsBanner : null}
                <div className="rounded-lg border border-gray-200 bg-white p-16 text-center shadow-sm">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                    <Activity className="h-8 w-8 text-gray-400" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-gray-900">{emptyTitle}</h3>
                  <p className="mx-auto mb-6 max-w-sm text-gray-500">
                    {emptyDescription || 'Run the signal monitor or wait for the next scheduled pass. External readiness changes will land here.'}
                  </p>
                  {showRunSignals ? (
                    <button
                      onClick={handleRunSignals}
                      disabled={runningSignals}
                      className="rounded-lg bg-arcova-teal px-6 py-3 text-white transition-colors hover:bg-arcova-teal/90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {runningSignals ? 'Running…' : 'Run signals now'}
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden">
                  {signalTitleBlock}
                  {showRunSignals ? runSignalsBanner : null}

                  <div className="flex min-h-0 flex-1 flex-col gap-2">
                    <div className="rounded-[1.5rem] border border-[rgba(13,53,71,0.1)] bg-[rgba(255,255,255,0.52)] shadow-[0_24px_60px_-32px_rgba(13,53,71,0.16),0_2px_6px_-2px_rgba(13,53,71,0.06)] backdrop-blur-2xl backdrop-saturate-150 overflow-hidden flex min-h-0 flex-1 flex-col">
                      <div className={cn('grid gap-4 border-b border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.35)] pl-9 pr-4 py-3 text-[11px] font-medium text-slate-500', tableGridClass)}>
                        <button type="button" onClick={() => {
                          setTableSortCol('name');
                          setTableSortDir((current) => (tableSortCol === 'name' && current === 'asc' ? 'desc' : 'asc'));
                        }} className="flex items-center gap-1.5 text-left">
                          {scope === 'company' ? 'Account' : 'Name'} <SortArrow active={tableSortCol === 'name'} />
                        </button>
                        {scope === 'contact' ? <div>Job title</div> : null}
                        <button type="button" onClick={() => {
                          setTableSortCol('company');
                          setTableSortDir((current) => (tableSortCol === 'company' && current === 'asc' ? 'desc' : 'asc'));
                        }} className="flex items-center gap-1.5 text-left">
                          {scope === 'company' ? 'Domain' : 'Company'} <SortArrow active={tableSortCol === 'company'} />
                        </button>
                        <button type="button" onClick={() => {
                          setTableSortCol('signal');
                          setTableSortDir((current) => (tableSortCol === 'signal' && current === 'asc' ? 'desc' : 'asc'));
                        }} className="flex items-center gap-1.5 text-left">
                          Signal <SortArrow active={tableSortCol === 'signal'} />
                        </button>
                        <button type="button" onClick={() => {
                          setTableSortCol('readiness');
                          setTableSortDir((current) => (tableSortCol === 'readiness' && current === 'asc' ? 'desc' : 'asc'));
                        }} className="flex items-center gap-1.5 text-left">
                          Readiness <SortArrow active={tableSortCol === 'readiness'} />
                        </button>
                        <button type="button" onClick={() => {
                          setTableSortCol('overall');
                          setTableSortDir((current) => (tableSortCol === 'overall' && current === 'asc' ? 'desc' : 'asc'));
                        }} className="flex items-center gap-1.5 text-left">
                          Overall <SortArrow active={tableSortCol === 'overall'} />
                        </button>
                      </div>

                      <div className="min-h-0 flex-1 overflow-y-auto">
                        {sortedSignals.map((row, index) => {
                          const isSelected = row.id === selectedSignalId;
                          const rowNumber = (page - 1) * PAGE_SIZE + index + 1;
                          return (
                            <div
                              key={row.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setSelectedSignalId(row.id);
                                setSelectedPreview('signal');
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setSelectedSignalId(row.id);
                                  setSelectedPreview('signal');
                                }
                              }}
                              className={cn(
                                "grid relative items-center gap-4 pl-9 pr-4 py-3 transition-all duration-150 cursor-pointer before:pointer-events-none before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-sm before:content-[''] before:transition-colors",
                                tableGridClass,
                                isSelected
                                  ? 'bg-arcova-teal/10 before:bg-arcova-teal'
                                  : 'before:bg-transparent hover:bg-arcova-teal/5 hover:before:bg-arcova-teal/35',
                              )}
                            >
                              <span
                                aria-hidden
                                className="absolute left-2 top-1/2 -translate-y-1/2 select-none text-[10px] font-medium tabular-nums text-gray-400"
                              >
                                {rowNumber}
                              </span>
                              <div className="min-w-0">
                                <div className="truncate text-[11px] font-medium text-slate-900">{targetName(row)}</div>
                              </div>

                              {scope === 'contact' ? (
                                <div className="min-w-0">
                                  <div className="truncate text-[11px] leading-snug text-slate-700">{row.contactJobTitle || '—'}</div>
                                </div>
                              ) : null}

                              <div className="min-w-0">
                                {scope === 'company' ? (
                                  <div className="truncate text-[11px] text-slate-500">{row.companyDomain || '—'}</div>
                                ) : row.companyId && row.companyName ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      router.push(withQuery(ROUTES.accounts, `companyId=${encodeURIComponent(row.companyId!)}`));
                                    }}
                                    className="block w-full truncate text-left text-[11px] font-medium text-arcova-teal hover:text-arcova-teal/85"
                                  >
                                    {row.companyName}
                                  </button>
                                ) : (
                                  <div className="truncate text-[11px] text-slate-500">—</div>
                                )}
                              </div>

                              <div className="min-w-0">
                                <div className="truncate text-[11px] font-medium text-slate-900">{getSignalDisplayName(row.signalKey)}</div>
                                <div className="mt-1 truncate text-[10px] text-slate-500">{sourceLabel(row)}</div>
                              </div>

                              <div className="min-w-0">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedSignalId(row.id);
                                    setSelectedPreview('signal');
                                  }}
                                  className={cn(
                                    'inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors hover:opacity-85',
                                    readinessCategoryPillClass(primaryDimension(row)),
                                  )}
                                >
                                  <span className="truncate">{dimensionLabel(primaryDimension(row))}</span>
                                </button>
                              </div>

                              <div className="min-w-0">
                                {row.readiness ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedSignalId(row.id);
                                      setSelectedPreview('context');
                                    }}
                                    className={cn(
                                      'inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors hover:opacity-85',
                                      readinessToneClass(row.readiness.overallLabel),
                                    )}
                                  >
                                    <span className="truncate">
                                      {overallScoreDisplay(row.readiness.overallScore)}
                                    </span>
                                  </button>
                                ) : (
                                  <span className="text-[11px] text-slate-400">—</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {totalPages > 1 ? (
                        <div className="flex items-center justify-between border-t border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.35)] px-4 py-3">
                          <p className="text-xs text-gray-500">
                            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setPage((current) => Math.max(1, current - 1))}
                              disabled={page === 1}
                              className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            <span className="text-xs text-gray-600">{page} / {totalPages}</span>
                            <button
                              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                              disabled={page === totalPages}
                              className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                {selectedSignalId ? (
                  <>
                    <button
                      type="button"
                      className="fixed inset-0 z-40 transition-opacity min-[1280px]:hidden"
                      aria-label="Close panel"
                      onClick={() => setSelectedSignalId(null)}
                    />
                    {agentRect ? (
                      <div
                        className="fixed z-[51] flex items-center rounded-[1.3125rem] border border-[rgba(255,255,255,0.88)] bg-[rgba(255,255,255,0.55)] px-3 py-2.5 shadow-[0_24px_60px_-32px_rgba(13,53,71,0.2)] backdrop-blur-2xl backdrop-saturate-150"
                        style={{
                          top: agentRect.top + agentRect.height - 58,
                          left: agentRect.left,
                          width: agentRect.width,
                        }}
                      >
                        <AgentChatBar
                          value={agentChatBarValue}
                          onChange={setAgentChatBarValue}
                          onSubmit={() => {
                            const text = agentChatBarValue.trim();
                            if (!text) return;
                            fireAgent(text);
                            setAgentChatBarValue('');
                            setSelectedSignalId(null);
                          }}
                          placeholder="Ask anything about your signals…"
                          className="w-full"
                        />
                      </div>
                    ) : null}

                    <aside
                      className={cn(
                        'contacts-leads-drawer fixed z-50 flex min-h-0 flex-col overflow-hidden rounded-[1.3125rem] border border-[rgba(255,255,255,0.88)] bg-[rgba(255,255,255,0.55)] shadow-[0_24px_60px_-32px_rgba(13,53,71,0.2)] backdrop-blur-2xl backdrop-saturate-150',
                        !agentRect && 'max-md:bottom-3.5 max-md:top-3.5 max-md:right-3.5 max-md:w-[min(calc(100vw-1.75rem),22.5rem)] md:top-[14px] md:bottom-[14px] md:right-[1.625rem] md:w-[22.5rem]',
                      )}
                      style={
                        agentRect
                          ? {
                              top: agentRect.top,
                              left: agentRect.left,
                              width: agentRect.width,
                              height: Math.max(0, agentRect.height - 64),
                            }
                          : undefined
                      }
                    >
                      {selectedSignal ? (
                        <div className="flex min-h-0 h-full flex-col">
                          <div className="border-b border-[rgba(13,53,71,0.08)] px-4 pb-3 pt-5">
                            <div className="flex items-start gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7d909a]">
                                  {signalScopeLabel(selectedSignal)}
                                </p>
                                <h2 className="mt-2 text-[1.35rem] font-semibold leading-tight text-[#0d3547]">
                                  {getSignalDisplayName(selectedSignal.signalKey)}
                                </h2>
                                <p className="mt-1 text-[13px] text-[#6b7280]">
                                  {targetName(selectedSignal)}
                                  {selectedSignal.companyName && selectedSignal.contactName ? ` · ${selectedSignal.companyName}` : ''}
                                </p>
                              </div>
                              <button
                                type="button"
                                className="contacts-drawer-close"
                                aria-label="Close panel"
                                onClick={() => setSelectedSignalId(null)}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                              {PREVIEW_TABS.map((tab) => {
                                const active = selectedPreview === tab.id;
                                return (
                                  <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setSelectedPreview(tab.id)}
                                    className={cn(
                                      'shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors',
                                      active
                                        ? 'bg-[#0d3547] text-white'
                                        : 'bg-white/75 text-[#4a6470] hover:bg-white hover:text-[#0d3547]',
                                    )}
                                  >
                                    {tab.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                            {selectedPreview === 'signal' ? (
                              <div className="space-y-4">
                                <div className="flex flex-wrap gap-2">
                                  <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium', effectPillClass(selectedSignal))}>
                                    {effectLabel(selectedSignal)}
                                  </span>
                                  <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium', confidencePillClass(selectedSignal.defaultConfidence))}>
                                    {toTitleCase(selectedSignal.defaultConfidence)} confidence
                                  </span>
                                  <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium', readinessCategoryPillClass(primaryDimension(selectedSignal)))}>
                                    {dimensionLabel(primaryDimension(selectedSignal))}
                                  </span>
                                  <span className="inline-flex items-center rounded-full border border-[rgba(13,53,71,0.1)] bg-white/80 px-2.5 py-1 text-[11px] font-medium text-[#4a6470]">
                                    Source: {sourceLabel(selectedSignal)}
                                  </span>
                                </div>

                                <div className="rounded-2xl border border-[rgba(13,53,71,0.08)] bg-white/70 p-4">
                                  <p className="text-sm font-semibold text-[#0d3547]">Readiness category</p>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {selectedSignal.dimensions.map((dimension) => (
                                      <span
                                        key={dimension}
                                        className={cn(
                                          'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium',
                                          readinessCategoryPillClass(dimension),
                                        )}
                                      >
                                        {dimensionLabel(dimension)}
                                      </span>
                                    ))}
                                  </div>
                                  <div className="mt-4 rounded-xl border border-[rgba(13,53,71,0.08)] bg-[rgba(245,248,254,0.8)] p-3">
                                    <div className="flex items-start justify-between gap-4">
                                      <div>
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d909a]">
                                          Mapped signal
                                        </p>
                                        <p className="mt-1 text-sm font-medium text-[#0d3547]">
                                          {getSignalDisplayName(selectedSignal.signalKey)}
                                        </p>
                                      </div>
                                      <div className="text-right">
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d909a]">
                                          Impact
                                        </p>
                                        <p className="mt-1 text-sm font-medium text-[#0d3547]">
                                          {signedImpactScore(selectedSignal)}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="mt-3 flex items-center justify-between gap-4 border-t border-[rgba(13,53,71,0.08)] pt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d909a]">
                                        Strength band
                                      </p>
                                      <p className="text-sm font-medium text-[#0d3547]">
                                        {strengthLabel(selectedSignal.defaultStrength)}
                                      </p>
                                    </div>
                                  </div>
                                </div>

                                <div className="rounded-2xl border border-[rgba(13,53,71,0.08)] bg-white/70 p-4">
                                  <p className="text-sm font-semibold text-[#0d3547]">What changed</p>
                                  <p className="mt-2 text-[13.5px] leading-[1.6] text-[#4a6470]">
                                    {selectedSignal.sourceSummary || selectedSignal.sourceTitle || selectedSignal.evidenceExcerpt || 'Arcova detected a meaningful external change and refreshed readiness.'}
                                  </p>
                                </div>

                                {changeRows(selectedSignal).length > 0 ? (
                                  <div className="space-y-3">
                                    {changeRows(selectedSignal).map((change) => (
                                      <div key={change.label} className="rounded-2xl border border-[rgba(13,53,71,0.08)] bg-white/70 p-4">
                                        <p className="text-sm font-semibold text-[#0d3547]">{change.label}</p>
                                        <div className="mt-3 grid grid-cols-2 gap-3">
                                          <div className="rounded-xl border border-[rgba(13,53,71,0.08)] bg-[rgba(245,248,254,0.8)] p-3">
                                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d909a]">Before</p>
                                            <p className="mt-1 text-sm text-[#0d3547]">{change.before || '—'}</p>
                                          </div>
                                          <div className="rounded-xl border border-[rgba(45,138,138,0.14)] bg-[rgba(238,251,250,0.9)] p-3">
                                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#2d8a8a]">After</p>
                                            <p className="mt-1 text-sm text-[#0d3547]">{change.after || '—'}</p>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}

                            {selectedPreview === 'evidence' ? (
                              <div className="space-y-4">
                                <div className="rounded-2xl border border-[rgba(13,53,71,0.08)] bg-white/70 p-4">
                                  <p className="text-sm font-semibold text-[#0d3547]">Evidence</p>
                                  <p className="mt-2 text-[13.5px] leading-[1.6] text-[#4a6470]">
                                    {selectedSignal.sourceExcerpt || selectedSignal.evidenceExcerpt || selectedSignal.sourceSummary || 'No excerpt stored for this signal yet.'}
                                  </p>
                                  {selectedSignal.sourceUrl ? (
                                    <a
                                      href={selectedSignal.sourceUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-arcova-teal hover:text-arcova-teal/85"
                                    >
                                      Open source
                                      <ExternalLink className="h-4 w-4" />
                                    </a>
                                  ) : null}
                                </div>

                                <div className="rounded-2xl border border-[rgba(13,53,71,0.08)] bg-white/70 p-4">
                                  <p className="text-sm font-semibold text-[#0d3547]">Monitoring metadata</p>
                                  <div className="mt-3 space-y-2 text-[13px] text-[#4a6470]">
                                    <div className="flex items-start justify-between gap-4">
                                      <span className="text-[#7d909a]">Observed</span>
                                      <span className="text-right text-[#0d3547]">{formatDateTime(selectedSignal.observedAt)}</span>
                                    </div>
                                    <div className="flex items-start justify-between gap-4">
                                      <span className="text-[#7d909a]">Event time</span>
                                      <span className="text-right text-[#0d3547]">{formatDateTime(selectedSignal.eventAt || selectedSignal.observedAt)}</span>
                                    </div>
                                    <div className="flex items-start justify-between gap-4">
                                      <span className="text-[#7d909a]">Source</span>
                                      <span className="text-right text-[#0d3547]">{sourceLabel(selectedSignal)}</span>
                                    </div>
                                    {metadataValue(selectedSignal.sourceMetadata, 'source_provider') ? (
                                      <div className="flex items-start justify-between gap-4">
                                        <span className="text-[#7d909a]">Provider</span>
                                        <span className="text-right text-[#0d3547]">{metadataValue(selectedSignal.sourceMetadata, 'source_provider')}</span>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            ) : null}

                            {selectedPreview === 'context' ? (
                              <div className="space-y-4">
                                {selectedSignal.readiness ? (
                                  <div className="rounded-2xl border border-[rgba(13,53,71,0.08)] bg-white/70 p-4">
                                    <div className="flex items-start justify-between gap-4">
                                      <div>
                                        <p className="text-sm font-semibold text-[#0d3547]">Overall readiness breakdown</p>
                                        <p className="mt-2 text-[13.5px] leading-[1.6] text-[#4a6470]">
                                          Overall readiness reflects the full mix of active signals on this account, not just this one event.
                                        </p>
                                      </div>
                                      <span
                                        className={cn(
                                          'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium',
                                          readinessToneClass(selectedSignal.readiness.overallLabel),
                                        )}
                                      >
                                        Overall {overallScoreDisplay(selectedSignal.readiness.overallScore)}
                                      </span>
                                    </div>

                                    <div className="mt-4 space-y-3">
                                      {[
                                        {
                                          key: 'new_budget',
                                          label: 'New budget',
                                          score: selectedSignal.readiness.newBudgetScore,
                                          tone: selectedSignal.readiness.newBudgetLabel,
                                        },
                                        {
                                          key: 'new_needs',
                                          label: 'New needs',
                                          score: selectedSignal.readiness.newNeedsScore,
                                          tone: selectedSignal.readiness.newNeedsLabel,
                                        },
                                        {
                                          key: 'new_people',
                                          label: 'New people',
                                          score: selectedSignal.readiness.newPeopleScore,
                                          tone: selectedSignal.readiness.newPeopleLabel,
                                        },
                                        {
                                          key: 'new_strategy',
                                          label: 'New strategy',
                                          score: selectedSignal.readiness.newStrategyScore,
                                          tone: selectedSignal.readiness.newStrategyLabel,
                                        },
                                        {
                                          key: 'caution',
                                          label: 'Caution',
                                          score: selectedSignal.readiness.cautionScore,
                                          tone: selectedSignal.readiness.cautionLabel,
                                        },
                                      ].map((item) => (
                                        <div key={item.key} className="rounded-xl border border-[rgba(13,53,71,0.08)] bg-[rgba(245,248,254,0.8)] p-3">
                                          <div className="flex items-center justify-between gap-4">
                                            <p className="text-sm font-medium text-[#0d3547]">{item.label}</p>
                                            <span
                                              className={cn(
                                                'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium',
                                                item.key === 'caution'
                                                  ? readinessCategoryPillClass('caution')
                                                  : readinessToneClass(item.tone),
                                              )}
                                            >
                                              {categoryScoreDisplay(item.score)}
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}

                                <div className="rounded-2xl border border-[rgba(13,53,71,0.08)] bg-white/70 p-4">
                                  <p className="text-sm font-semibold text-[#0d3547]">Entity context</p>
                                  <div className="mt-3 space-y-2 text-[13px] text-[#4a6470]">
                                    {selectedSignal.contactName ? (
                                      <div className="flex items-start justify-between gap-4">
                                        <span className="text-[#7d909a]">Contact</span>
                                        <span className="text-right text-[#0d3547]">{selectedSignal.contactName}</span>
                                      </div>
                                    ) : null}
                                    {selectedSignal.contactJobTitle ? (
                                      <div className="flex items-start justify-between gap-4">
                                        <span className="text-[#7d909a]">Role</span>
                                        <span className="text-right text-[#0d3547]">{selectedSignal.contactJobTitle}</span>
                                      </div>
                                    ) : null}
                                    {selectedSignal.companyName ? (
                                      <div className="flex items-start justify-between gap-4">
                                        <span className="text-[#7d909a]">Company</span>
                                        <span className="text-right text-[#0d3547]">{selectedSignal.companyName}</span>
                                      </div>
                                    ) : null}
                                    {selectedSignal.companyDomain ? (
                                      <div className="flex items-start justify-between gap-4">
                                        <span className="text-[#7d909a]">Domain</span>
                                        <span className="text-right text-[#0d3547]">{selectedSignal.companyDomain}</span>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>

                                {selectedSignal.readiness ? (
                                  <div className="rounded-2xl border border-[rgba(13,53,71,0.08)] bg-white/70 p-4">
                                    <p className="text-sm font-semibold text-[#0d3547]">Readiness state</p>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium', readinessToneClass(selectedSignal.readiness.overallLabel))}>
                                        Overall {toTitleCase(selectedSignal.readiness.overallLabel || 'medium')}
                                      </span>
                                      {selectedSignal.readiness.newPeopleLabel ? (
                                        <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium', readinessToneClass(selectedSignal.readiness.newPeopleLabel))}>
                                          New people {toTitleCase(selectedSignal.readiness.newPeopleLabel)}
                                        </span>
                                      ) : null}
                                      {selectedSignal.readiness.cautionLabel ? (
                                        <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium', readinessToneClass(selectedSignal.readiness.cautionLabel))}>
                                          Caution {toTitleCase(selectedSignal.readiness.cautionLabel)}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : null}

                                {selectedSignal.reason ? (
                                  <div className="rounded-2xl border border-[rgba(13,53,71,0.08)] bg-white/70 p-4">
                                    <p className="text-sm font-semibold text-[#0d3547]">Why now</p>
                                    <p className="mt-2 text-[13.5px] leading-[1.6] text-[#4a6470]">
                                      {selectedSignal.reason.whyNow || selectedSignal.reason.summaryShort || 'No generated reason yet.'}
                                    </p>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}

                            {selectedPreview === 'action' ? (
                              <div className="space-y-4">
                                <div className="rounded-2xl border border-[rgba(13,53,71,0.08)] bg-white/70 p-4">
                                  <p className="text-sm font-semibold text-[#0d3547]">Suggested angle</p>
                                  <p className="mt-2 text-[13.5px] leading-[1.6] text-[#4a6470]">
                                    {selectedSignal.reason?.suggestedAngle || selectedSignal.reason?.summaryShort || 'Use this signal as a prompt to review the account and decide whether the change opens a better route or timing window.'}
                                  </p>
                                </div>

                                <div className="space-y-2">
                                  {selectedSignal.companyId ? (
                                    <button
                                      type="button"
                                      onClick={() => router.push(withQuery(ROUTES.accounts, `companyId=${encodeURIComponent(selectedSignal.companyId!)}`))}
                                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-[#1f2937] transition-colors hover:bg-gray-50"
                                    >
                                      <Building2 className="h-4 w-4" />
                                      Open account
                                    </button>
                                  ) : null}
                                  {selectedSignal.contactId ? (
                                    <button
                                      type="button"
                                      onClick={() => router.push(withQuery(ROUTES.contacts, `lead=${encodeURIComponent(selectedSignal.contactId!)}`))}
                                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-[#1f2937] transition-colors hover:bg-gray-50"
                                    >
                                      <UserRound className="h-4 w-4" />
                                      Open contact
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      fireAgent(
                                        `Help me understand this signal and what to do next: ${getSignalDisplayName(selectedSignal.signalKey)} for ${targetName(selectedSignal)} at ${selectedSignal.companyName || 'the account'}.`,
                                        `Review ${getSignalDisplayName(selectedSignal.signalKey)}`,
                                      );
                                      setSelectedSignalId(null);
                                    }}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-arcova-teal/25 bg-arcova-teal/5 px-4 py-2.5 text-sm font-semibold text-arcova-teal transition-colors hover:bg-arcova-teal/10"
                                  >
                                    <ArrowUpRight className="h-4 w-4" />
                                    Ask Arcova Agent
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </aside>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <AgentPanel
          className={cn('contacts-leads-agent-col min-[1280px]:pl-1.5', selectedSignalId && 'invisible')}
          page="signals"
          pageContext={
            selectedSignal
              ? {
                  selectedSignal: {
                    id: selectedSignal.id,
                    signal_key: selectedSignal.signalKey,
                    signal_name: getSignalDisplayName(selectedSignal.signalKey),
                    source: sourceLabel(selectedSignal),
                    company_name: selectedSignal.companyName,
                    company_domain: selectedSignal.companyDomain,
                    contact_name: selectedSignal.contactName,
                    contact_title: selectedSignal.contactJobTitle,
                    dimensions: selectedSignal.dimensions,
                    reason: selectedSignal.reason?.summaryShort,
                  },
                }
              : undefined
          }
          pendingMessage={agentTrigger}
        />
      </div>
    </div>
  );
}
