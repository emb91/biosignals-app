'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { AgentPanel, type AgentPendingMessage, type AgentTableFilter } from '@/components/AgentPanel';
import { AgentChatBar } from '@/components/AgentChatBar';
import { useScrollMask } from '@/hooks/use-scroll-mask';
import { useAgentCollapsed } from '@/hooks/use-agent-collapsed';
import type {
  AccountQueryColumn,
  QueryAccount,
} from '@/lib/accounts-data';
import {
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Download,
  ExternalLink,
  Maximize2,
  Minimize2,
  Pencil,
  RotateCw,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { cachedJson, invalidateCache } from '@/lib/page-fetch-cache';
import { useCreditConfirm } from '@/context/CreditConfirmContext';
import { formatCurrencyShort } from '@/lib/funding-display';
import {
  CompanyIcpFitDetailPanel,
  type CompanyFitDetails,
} from '@/components/company-icp-fit-detail-panel';
import { TableFitGaugeButton } from '@/components/TableFitGaugeButton';
import { fitScoreArcColor, percentDisplayNumber, priorityScoreArcColor } from '@/lib/fit-gauge';
import { AnimatedCircularProgressBar } from '@/components/ui/animated-circular-progress-bar';
import { AccountEditDialog } from '@/components/AccountEditDialog';
import { formatProvenanceImportedAt } from '@/lib/data-provenance';
import {
  getAccountRowAction,
  hasContactBuyingSignal,
  isCrmSuppressed,
  LEAD_ACTION_PILL_CLASS,
  LEAD_ACTION_SORT_ORDER,
  type SequenceDispatchStatus,
  SOURCE_COMPANY_MIN,
  SOURCE_CONTACT_MAX,
} from '@/lib/lead-action';
import { ROUTES, withQuery } from '@/lib/routes';
import { EntitySignalsList } from '@/components/EntitySignalsList';

const PAGE_SIZE = 50;

function parseIdList(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((id) => id.trim()).filter(Boolean))];
}

type AccountRow = {
  id: string;
  company_name: string | null;
  domain: string | null;
  website: string | null;
  logo_url: string | null;
  logo_cached: string | null;
  company_fit_score: number | null;
  company_fit_coverage: number | null;
  matched_icp_id: string | null;
  matched_icp_label: string | null;
  therapeutic_areas: string[] | null;
  modalities: string[] | null;
  development_stages: string[] | null;
  customer_therapeutic_areas: string[] | null;
  customer_modalities: string[] | null;
  customer_development_stages: string[] | null;
  funding_stage: string | null;
  funding_status_label: string | null;
  company_type: string | null;
  industry: string | null;
  sub_industry: string | null;
  clinical_stage: string | null;
  platform_category: string | null;
  company_size_bucket: string | null;
  tagline: string | null;
  linkedin_url: string | null;
  description: string | null;
  bio_summary: string | null;
  employee_count: number | null;
  employee_range: string | null;
  headquarters_city: string | null;
  headquarters_state: string | null;
  headquarters_country: string | null;
  total_funding_usd: number | null;
  latest_funding_date: string | null;
  funding_resolution_summary: string | null;
  founded_year: number | null;
  specialties: string[] | null;
  products_services: string[] | null;
  services: string[] | null;
  technologies: string[] | null;
  last_enriched_at: string | null;
  // Dedicated company-enrichment job state — drives the side panel banner.
  // null/idle ≈ never run; running ≈ "Enrichment in progress" (real, not a lie);
  // failed ≈ "Enrichment failed, retry" (with last_error); succeeded ≈ no banner.
  enrichment_refresh_status?: 'idle' | 'running' | 'requested' | 'succeeded' | 'failed' | 'cancelled' | null;
  enrichment_refresh_last_error?: string | null;
  enrichment_refresh_started_at?: string | null;
  enrichment_refresh_finished_at?: string | null;
  contact_count: number;
  best_contact_fit: number | null;
  worst_contact_fit: number | null;
  avg_contact_fit: number | null;
  max_contact_readiness_score: number | null;
  data_provenance_type: string;
  data_provenance_imported_at: string | null;
  readiness_label?: string | null;
  readiness_score?: number | null;
  raw_readiness_score?: number | null;
  priority_score?: number | null;
  intrinsic_priority_score?: number | null;
  crm_is_suppressed?: boolean;
  crm_status?: 'customer' | 'active' | 'dormant' | 'context_only' | 'none' | null;
  crm_deal_stage_label?: string | null;
  crm_closed_at?: string | null;
  /** Aggregate outreach funnel state across the account's contacts — drives the
   *  Send outreach / Await reply action overlay (mirrors the contact action). */
  latest_sequence_status?: SequenceDispatchStatus;
  user_overrides?: Record<string, unknown> | null;
};

/**
 * Time-based enrichment progress shared by the side-panel banner and the
 * table-row animation. Company enrichment exposes a single `running` status
 * (no granular sub-stages like contacts' linkedin→profile), so we ease a
 * percent from a floor toward a ceiling (never 100 until the row actually
 * flips to `succeeded`) and rotate a stage label. The accounts page's 5s poll
 * flips the row to succeeded/failed, which unmounts the consumers.
 */
function useEnrichmentProgress(startedAt: string | null): { percent: number; label: string } {
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 900);
    return () => clearInterval(id);
  }, []);

  const started = startedAt ? new Date(startedAt).getTime() : null;
  const elapsed = started && nowMs ? Math.max(0, nowMs - started) : 0;
  // Ease toward 94% — hold short of 100 so the bar never claims "done" before
  // the server confirms it. Same exponential shape as the contacts gauge.
  const FLOOR = 8;
  const CEIL = 94;
  const PACE_MS = 9000;
  const percent = Math.round(FLOOR + (CEIL - FLOOR) * (1 - Math.exp(-elapsed / PACE_MS)));
  const label =
    elapsed < 3500
      ? 'Finding the company'
      : elapsed < 8000
        ? 'Pulling firmographics'
        : 'Finalizing details';

  return { percent, label };
}

/** Side-panel banner variant (stacked: heading + label + full-width bar +
 *  percent). Mirrors the /contacts in-panel enriching banner so the company
 *  card shows real, moving progress instead of a static label. */
function CompanyEnrichmentProgress({ startedAt }: { startedAt: string | null }) {
  const { percent, label } = useEnrichmentProgress(startedAt);
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[12.5px] font-semibold text-arcova-teal">Enriching this company…</p>
      <p className="mt-0.5 text-[11.5px] leading-snug text-arcova-teal/80">{label}…</p>
      <div className="mt-2 flex items-center gap-2.5">
        <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-arcova-teal/12">
          <div
            className="arcova-enrichment-progress absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
            style={{ width: `${percent}%` }}
          >
            <div className="arcova-enrichment-glow absolute inset-y-0 right-0 w-14 rounded-full" />
          </div>
        </div>
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-arcova-teal">{percent}%</span>
      </div>
    </div>
  );
}

/** Compact table-row variant (single line: label + inline bar + percent),
 *  spanning the non-identity columns of an enriching account row. Mirrors the
 *  /contacts table row treatment. */
function AccountRowEnrichingBar({ startedAt }: { startedAt: string | null }) {
  const { percent, label } = useEnrichmentProgress(startedAt);
  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className="hidden lg:block shrink-0 text-xs text-arcova-teal/80 truncate max-w-[10rem]">
        {label}…
      </span>
      <div className="relative h-2.5 flex-1 min-w-[3rem] overflow-hidden rounded-full bg-arcova-teal/12">
        <div
          className="arcova-enrichment-progress absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${percent}%` }}
        >
          <div className="arcova-enrichment-glow absolute inset-y-0 right-0 w-14 rounded-full" />
        </div>
      </div>
      <span className="shrink-0 text-[11px] font-medium tabular-nums text-arcova-teal">{percent}%</span>
    </div>
  );
}

function score01ForActionCopy(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value > 1 && value <= 100) return value / 100;
  if (value >= 0 && value <= 1) return value;
  return null;
}

/** Account-scope analogue of lead "monitor, awaiting signal" (company + best contact fit, no aggregate buying signal). */
function isAccountMonitorAwaitingSignal(account: AccountRow): boolean {
  const company = score01ForActionCopy(account.company_fit_score);
  const contact = score01ForActionCopy(account.best_contact_fit);
  if (company === null || company < SOURCE_COMPANY_MIN) return false;
  if (contact === null || contact < SOURCE_CONTACT_MAX) return false;
  return !hasContactBuyingSignal(account.max_contact_readiness_score);
}

type ContactAtCompany = {
  id: string;
  full_name: string | null;
  job_title: string | null;
  resolved_current_job_title: string | null;
  email: string | null;
  linkedin_url: string | null;
  contact_fit_score: number | null;
  overall_fit_score: number | null;
  priority_score: number | null;
  seniority_level: string | null;
};

type PanelMode = 'details' | 'fit' | 'action' | 'contacts' | 'signals' | 'priority' | 'crm' | 'reachout';

interface AccountCrmDealContact {
  arcova_contact_id: string | null;
  full_name: string | null;
  email: string | null;
  hubspot_contact_id: string | null;
}

interface AccountCrmDeal {
  hubspot_deal_id: string;
  deal_name: string | null;
  deal_stage: string | null;
  amount: number | null;
  close_date: string | null;
  hs_lastmodifieddate: string | null;
  synced_at: string | null;
  hubspot_company_name: string | null;
  hubspot_company_domain: string | null;
  resolution_status: string | null;
  resolution_suppressed: boolean;
  mismatch_reason: string | null;
  contacts: AccountCrmDealContact[];
}

interface AccountCrmContext {
  company_id: string;
  company_name: string | null;
  company_domain: string | null;
  deals: AccountCrmDeal[];
}

const formatLastUpdated = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatUsdValue = (value: number | null | undefined): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
};

// Inlined (and trimmed to the cases the accounts CRM panel needs) so this client
// page doesn't transitively pull @/lib/nango (server-only secretKey) via
// @/lib/hubspot-lead-state → @/lib/hubspot-deals.
const HUBSPOT_STAGE_LABELS: Record<string, string> = {
  appointmentscheduled: 'Appointment',
  qualifiedtobuy:        'Qualified',
  presentationscheduled: 'Presentation',
  decisionmakerboughtin: 'Decision-maker bought in',
  contractsent:          'Contract',
  closedwon:             'Closed won',
  closedlost:            'Closed lost',
  dealswon:              'Won',
};

const formatHubSpotStageLabel = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (HUBSPOT_STAGE_LABELS[normalized]) return HUBSPOT_STAGE_LABELS[normalized];
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_\s]+/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join(' ');
};

type ContactFitComponentKey = 'business_area' | 'seniority';

interface ContactFitBreakdownComponent {
  label: string;
  active: boolean;
  available: boolean;
  score01: number;
  detail: string;
  matchedValue?: string | null;
  matchStatus?: string;
}

interface ContactFitBreakdown {
  components: Record<ContactFitComponentKey, ContactFitBreakdownComponent>;
}

interface ContactFitDetails {
  contact_fit_score: number | null;
  winning_breakdown: ContactFitBreakdown | null;
}

const CONTACT_FIT_COMPONENT_ORDER: ContactFitComponentKey[] = ['business_area', 'seniority'];

const formatPct = (value: number | null | undefined): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return `${Math.round(value <= 1 ? value * 100 : value)}%`;
};

const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

function externalUrl(account: AccountRow): string | null {
  const raw = account.domain?.trim();
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
}

type CoverageStatus = 'opportunity' | 'covered' | 'weak' | null;

/** Returns a coverage status for the accounts table badge.
 *  - opportunity: strong company fit, poor/no contact coverage → source contacts
 *  - covered:     strong company fit + good contact coverage
 *  - weak:        low company fit → deprioritised
 *  - null:        no fit data
 */
function getCoverageStatus(account: AccountRow): CoverageStatus {
  const cf =
    typeof account.company_fit_score === 'number' && Number.isFinite(account.company_fit_score)
      ? account.company_fit_score
      : null;
  if (cf == null) return null;
  if (cf < 0.6) return 'weak';
  const best =
    typeof account.best_contact_fit === 'number' && Number.isFinite(account.best_contact_fit)
      ? account.best_contact_fit
      : null;
  if (best == null || best < 1) return 'opportunity';
  if (best >= 1) return 'covered';
  return null;
}

/** Up to `max` pills stacked vertically, then a "+N" badge. Optional click opens company details with Criteria expanded. */
function InlinePills({
  items,
  max = 2,
  onActivate,
}: {
  items: string[] | null | undefined;
  max?: number;
  onActivate?: () => void;
}) {
  const list = (items || []).filter(Boolean);
  if (list.length === 0) return <span className="text-xs text-gray-400">—</span>;
  const shown = list.slice(0, max);
  const extra = list.length - max;
  const body = (
    <>
      {shown.map((item) => (
        <span
          key={item}
          className="inline-flex w-fit rounded-full bg-arcova-teal/10 px-2 py-0.5 text-[11px] font-medium text-arcova-teal leading-tight truncate max-w-full"
        >
          {item}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[11px] text-gray-400">+{extra}</span>
      )}
    </>
  );

  if (!onActivate) {
    return <div className="flex flex-col gap-1">{body}</div>;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className="flex flex-col gap-1 -m-0.5 p-0.5 cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        onActivate();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onActivate();
        }
      }}
    >
      {body}
    </div>
  );
}

/** Full pills list for the detail panel */
const DEFAULT_COLUMNS: AccountQueryColumn[] = ['company', 'company_type', 'contacts', 'priority', 'crm_status', 'action'];
// Below 1280px the table is space-constrained (sidebar collapses to hamburger at
// <1280, agent panel is still ~380px until <768). Cramming all 5 columns turns the
// header into overlapping word soup — so below 1280 we keep just the essentials:
// Company (name), Company type, Fit. Same three columns hold at phone size — the
// agent is hidden at <768 so the table has plenty of room for Company type to stay.
const MEDIUM_COLUMNS: AccountQueryColumn[] = ['company', 'company_type', 'priority'];
const SMALL_COLUMNS: AccountQueryColumn[] = ['company', 'company_type', 'priority'];

const ACCOUNT_QUERY_COL_DEFS: Record<AccountQueryColumn, { label: string; width: string }> = {
  company: { label: 'Company', width: 'minmax(0,1.05fr)' },
  company_type: { label: 'Company type', width: 'minmax(0,0.82fr)' },
  fit: { label: 'Fit', width: 'minmax(0,4.25rem)' },
  priority: { label: 'Priority', width: 'minmax(0,4.75rem)' },
  contacts: { label: 'Contacts', width: 'minmax(0,6rem)' },
  crm_status: { label: 'CRM', width: 'minmax(0,6rem)' },
  readiness: { label: 'Readiness', width: 'minmax(0,6.5rem)' },
  therapeutic_areas: { label: 'Therapeutic areas', width: 'minmax(0,1fr)' },
  modalities: { label: 'Modalities', width: 'minmax(0,1fr)' },
  action: { label: 'Action', width: 'minmax(0,9rem)' },
  funding_stage: { label: 'Funding', width: 'minmax(0,9rem)' },
  icp_match: { label: 'ICP match', width: 'minmax(0,1fr)' },
  development_stages: { label: 'Development stage', width: 'minmax(0,1fr)' },
  employee_range: { label: 'Employees', width: 'minmax(0,8rem)' },
  location: { label: 'Location', width: 'minmax(0,0.8fr)' },
  source: { label: 'Source', width: 'minmax(0,7rem)' },
};

function accountQueryGridCols(columns: AccountQueryColumn[]): string {
  return columns.map((column) => ACCOUNT_QUERY_COL_DEFS[column].width).join(' ');
}

// When the agent is collapsed the table reclaims its ~360px column, so treat the
// layout as that much wider and step up to the next column tier.
const COLLAPSED_AGENT_WIDTH = 360;

function pickAccountColumns(width: number, agentCollapsed: boolean): AccountQueryColumn[] {
  const effective = width + (agentCollapsed ? COLLAPSED_AGENT_WIDTH : 0);
  if (effective >= 1280) return DEFAULT_COLUMNS;
  if (effective < 640) return SMALL_COLUMNS;
  return MEDIUM_COLUMNS;
}

function useResponsiveAccountColumns(): AccountQueryColumn[] {
  const agentCollapsed = useAgentCollapsed();
  // Initialize synchronously from `window.innerWidth` so there's no flash of the
  // wrong (default 5-col) template on first render — that flash caused the data
  // rows to render cells in the wrong column slots on initial paint at narrow widths.
  const [columns, setColumns] = useState<AccountQueryColumn[]>(() =>
    typeof window === 'undefined' ? DEFAULT_COLUMNS : pickAccountColumns(window.innerWidth, agentCollapsed),
  );

  useEffect(() => {
    const updateColumns = () => setColumns(pickAccountColumns(window.innerWidth, agentCollapsed));

    updateColumns();
    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, [agentCollapsed]);

  return columns;
}

function accountName(account: AccountRow | QueryAccount): string {
  return account.company_name || account.domain || '';
}

function accountLocation(account: AccountRow | QueryAccount): string {
  return [account.headquarters_city, account.headquarters_country].filter(Boolean).join(', ');
}

function getAccountSortValue(account: AccountRow | QueryAccount, col: string): string | number {
  switch (col) {
    case 'company':
      return accountName(account).toLowerCase();
    case 'company_type':
      return (account.company_type || '').toLowerCase();
    case 'fit':
      return account.company_fit_score ?? -1;
    case 'contacts':
      return account.contact_count;
    case 'priority':
      return (account as AccountRow).priority_score ?? -1;
    case 'added':
      // ISO timestamps sort lexically = chronologically; '' (no date) sorts oldest.
      // Used by the /today "new accounts" deep-link (?sort=newest).
      return (account as AccountRow).data_provenance_imported_at ?? '';
    case 'therapeutic_areas':
      return ((account.therapeutic_areas || [])[0] || '').toLowerCase();
    case 'modalities':
      return ((account.modalities || [])[0] || '').toLowerCase();
    case 'action': {
      const action = getAccountRowAction(account);
      return LEAD_ACTION_SORT_ORDER[action];
    }
    case 'funding_stage':
      return (account.funding_stage || account.funding_status_label || '').toLowerCase();
    case 'icp_match':
      return (account.matched_icp_label || '').toLowerCase();
    case 'development_stages':
      return ((account.development_stages || [])[0] || '').toLowerCase();
    case 'employee_range':
      return account.employee_count ?? account.employee_range ?? '';
    case 'location':
      return accountLocation(account).toLowerCase();
    case 'source':
      return (account.data_provenance_type || '').toLowerCase();
    default:
      return '';
  }
}

function applyAccountSort<T extends AccountRow | QueryAccount>(
  items: T[],
  col: string | null,
  dir: 'asc' | 'desc',
): T[] {
  if (!col) return items;
  return [...items].sort((a, b) => {
    const va = getAccountSortValue(a, col);
    const vb = getAccountSortValue(b, col);
    const cmp =
      typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb));
    return dir === 'asc' ? cmp : -cmp;
  });
}

function SortArrow({ col, activeCol, dir }: { col: string; activeCol: string | null; dir: 'asc' | 'desc' }) {
  if (col !== activeCol) return <ChevronsUpDown className="w-3 h-3 text-gray-300 shrink-0" />;
  return dir === 'asc'
    ? <ChevronUp className="w-3 h-3 text-arcova-teal shrink-0" />
    : <ChevronDown className="w-3 h-3 text-arcova-teal shrink-0" />;
}

/* ── Side-panel design primitives (Companies Side Panel design) ──
   A single collapsible "card" + an uppercase-eyebrow key/value field, used
   across the Details / CRM tabs so every section shares one type system:
   section title = Manrope 13px bold navy; field label = 10px uppercase pale. */
function DetailCard({
  title,
  open,
  onToggle,
  count,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.82)] shadow-[0_1px_4px_-2px_rgba(13,53,71,0.1)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left transition-colors hover:bg-white/60"
      >
        <span className="font-manrope text-[13px] font-bold tracking-[-0.01em] text-[#0d3547]">{title}</span>
        <span className="inline-flex items-center gap-2">
          {count != null && (
            <span className="rounded-full bg-[rgba(13,53,71,0.06)] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#7d909a]">
              {count}
            </span>
          )}
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-[#7d909a] transition-transform duration-200', open ? '' : '-rotate-90')} />
        </span>
      </button>
      {open && <div className="border-t border-[rgba(13,53,71,0.06)] px-3.5 py-3.5">{children}</div>}
    </div>
  );
}

/** Key/value field — uppercase pale eyebrow label above a navy value (design .field). */
function EyebrowField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7d909a]">{label}</p>
      <p className="mt-1.5 text-[13.5px] leading-[1.4] text-[#0d3547] break-words">{children}</p>
    </div>
  );
}

/** Teal tag-pill cluster — company type, therapeutic areas, modalities, stages (design .tagpills). */
function TagPillCluster({ items }: { items: (string | null | undefined)[] }) {
  const list = items.filter((t): t is string => Boolean(t && t.trim()));
  if (list.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {list.map((t, i) => (
        <span
          key={`${t}-${i}`}
          className="inline-flex items-center whitespace-nowrap rounded-full bg-arcova-teal/10 px-3 py-[5px] text-[12.5px] font-semibold text-[#0a7b88]"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

/** Products / Services / Technology — one bordered text row per entity (design .ent-row). */
function EntityRows({ items }: { items: string[] }) {
  return (
    <div className="flex flex-col">
      {items.map((t, i) => (
        <p
          key={`${t}-${i}`}
          className="border-t border-[rgba(13,53,71,0.06)] py-2.5 font-manrope text-[13px] font-bold leading-[1.3] tracking-[-0.01em] text-[#0d3547] first:border-t-0 first:pt-0"
        >
          {t}
        </p>
      ))}
    </div>
  );
}

export default function CompaniesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const confirmCredits = useCreditConfirm();
  const searchParams = useSearchParams();
  const accountsDeepLinkCompanyIdRef = useRef<string | null>(null);
  const accountsScrollRef = useRef<HTMLDivElement | null>(null);
  const tableColumns = useResponsiveAccountColumns();

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [agentTrigger, setAgentTrigger] = useState<AgentPendingMessage | undefined>();
  const fireAgent = (text: string, threadPreview?: string) =>
    setAgentTrigger((prev) => ({
      text,
      nonce: (prev?.nonce ?? 0) + 1,
      ...(threadPreview ? { threadPreview } : {}),
    }));
  const agentTaskFiredRef = useRef<string | null>(null);

  const [agentFilterIds, setAgentFilterIds] = useState<Set<string> | null>(null);
  const [agentFilterLabel, setAgentFilterLabel] = useState('Filtered by agent');
  // ?sort=newest (from the /today "new accounts" priority) lands sorted by most-recently
  // added, so just-added accounts aren't buried at the bottom of the default priority sort.
  const [tableSortCol, setTableSortCol] = useState<string | null>(
    searchParams.get('sort') === 'newest' ? 'added' : 'priority',
  );
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc');
  const [editAccountOpen, setEditAccountOpen] = useState(false);

  // Panel state
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  // Detail fetched per-selection from /api/companies/[id]. Side panel reads
  // from the merged object so it has both the lean-list fields (computed
  // priority, crm status, etc.) AND the canonical detail fields (firmographics,
  // products, funding detail) without bloating the list payload.
  const [selectedAccountDetailById, setSelectedAccountDetailById] = useState<Record<string, Partial<AccountRow>>>({});
  const [panelMode, setPanelMode] = useState<PanelMode>('details');
  const [failedLogoByAccountId, setFailedLogoByAccountId] = useState<Record<string, true>>({});

  // Floating chat-bar value — shown while a company card is open (same pattern as
  // /contacts). On submit we dismiss the company card and forward the text
  // to AgentPanel as a pending message; the agent expands back into view.
  const [agentChatBarValue, setAgentChatBarValue] = useState('');

  // Agent docking — when true the agent expands into the TOP HALF and the company
  // card drops to the bottom half (50/50 split); when false the card takes the
  // full column and the agent collapses to the floating chat bar at the top.
  // Mirrors the /contacts drawer behaviour exactly.
  const [agentDocked, setAgentDocked] = useState(false);

  // Top-of-page Actions menu state (Import / Export CSV / HubSpot sync).
  const [hubspotConnected, setHubspotConnected] = useState(false);
  const [pushingToHubspot, setPushingToHubspot] = useState(false);
  const [pullingHubspotCrm, setPullingHubspotCrm] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);

  // Mirror the AgentPanel column's bounding rect so the company card and floating
  // chat bar can overlay it pixel-for-pixel. AgentPanel renders its outermost div
  // with the marker class `.accounts-agent-col` (passed via the className prop).
  const [agentRect, setAgentRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const el = document.querySelector<HTMLElement>('.accounts-agent-col');
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      // Below 768px the AgentPanel is `display: none` — its bounding rect is 0×0.
      // Null out the rect in that case so the company card / floating chat bar fall
      // back to their CSS-class positioning (full-bleed glass card from the right).
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

  // Measured height of the floating agent chat bar that sits ABOVE the company
  // card. The card is seated just below the bar's real bottom (+ a small gap) so
  // the spacing stays tight regardless of the bar's exact rendered height — a
  // hardcoded offset drifts whenever the bar's padding/contents change.
  const AGENT_BAR_GAP = 8;
  const agentBarRef = useRef<HTMLDivElement | null>(null);
  const [agentBarHeight, setAgentBarHeight] = useState(56);
  useEffect(() => {
    if (!selectedAccountId || !agentRect) return;
    const measure = () => {
      const h = agentBarRef.current?.offsetHeight;
      if (h && Math.abs(h - agentBarHeight) > 0.5) setAgentBarHeight(h);
    };
    measure();
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    if (agentBarRef.current) ro.observe(agentBarRef.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [selectedAccountId, agentRect, agentBarHeight]);

  // Contacts panel
  const [contacts, setContacts] = useState<ContactAtCompany[]>([]);
  /** Ranked contacts shown in the "Choose a contact to reach out to" picker
   *  (only used when an account with >1 contact has the Reach out action). */
  const [reachOutCandidates, setReachOutCandidates] = useState<ContactAtCompany[]>([]);
  const [reachOutLoadingId, setReachOutLoadingId] = useState<string | null>(null);
  const [loadingContacts, setLoadingContacts] = useState(false);

  // Detail panel accordion open state
  // Details segments are UNFOLDED by default (matches /contacts). The user can
  // still collapse any segment; selecting a new account re-expands them.
  const ALL_DETAILS_EXPANDED = {
    about: true,
    classification: true,
    firmographics: true,
    funding: true,
    products: true,
    services: true,
    technology: true,
  } as const;
  const [detailPanelOpen, setDetailPanelOpen] = useState({ ...ALL_DETAILS_EXPANDED });
  const toggleDetail = (key: keyof typeof detailPanelOpen) =>
    setDetailPanelOpen((s) => ({ ...s, [key]: !s[key] }));

  /** When opening details from a taxonomy cell, set so Criteria stays expanded after account selection. */
  const pendingOpenCriteriaRef = useRef(false);

  const companyFitCacheRef = useRef<Record<string, CompanyFitDetails>>({});
  const [companyFitPanel, setCompanyFitPanel] = useState<{
    loading: boolean;
    data: CompanyFitDetails | null;
    error: string | null;
    message: string | null;
  }>({ loading: false, data: null, error: null, message: null });

  const hubspotCrmCacheRef = useRef<Record<string, AccountCrmContext>>({});
  const [hubspotCrmPanel, setHubspotCrmPanel] = useState<{
    loading: boolean;
    data: AccountCrmContext | null;
    error: string | null;
  }>({ loading: false, data: null, error: null });

  // Reset detail accordion when account changes (or open Criteria after taxonomy click)
  useEffect(() => {
    if (!selectedAccountId) return;

    if (pendingOpenCriteriaRef.current) {
      pendingOpenCriteriaRef.current = false;
    }
    // Always re-expand all segments when the selected account changes.
    setDetailPanelOpen({ ...ALL_DETAILS_EXPANDED });
  }, [selectedAccountId]);

  useEffect(() => {
    if (!selectedAccountId) return;
    const selected = accounts.find((account) => account.id === selectedAccountId);
    if (!selected?.logo_cached && !selected?.logo_url) return;
    setFailedLogoByAccountId((prev) => {
      if (!prev[selectedAccountId]) return prev;
      const next = { ...prev };
      delete next[selectedAccountId];
      return next;
    });
  }, [selectedAccountId, accounts]);

  // Company enrichment refresh.
  // Hits the dedicated company-enrichment endpoint (not /api/monitor-company,
  // which only re-runs funding/taxonomy and doesn't actually fetch
  // firmographics or stamp last_enriched_at). The endpoint returns 200
  // immediately and runs the heavy work async via Next's after() —
  // the row flips to enrichment_refresh_status='running' synchronously,
  // so the next refetch already shows the new state.
  const [refreshingCompanyId, setRefreshingCompanyId] = useState<string | null>(null);
  const rerunCompanyEnrichment = async (companyId: string) => {
    setRefreshingCompanyId(companyId);

    // Optimistically flip the row to "running" in BOTH the lean list and the
    // per-id detail cache (the side panel merges detail OVER lean, so patching
    // only one lets the stale copy win — same bug the contacts page documents
    // in stopLeadEnrichment). This gives the instant "in progress" feedback
    // the contacts refresh has; the 5s poll below then reflects completion.
    const nowIso = new Date().toISOString();
    const runningPatch: Partial<AccountRow> = {
      enrichment_refresh_status: 'running',
      enrichment_refresh_started_at: nowIso,
      enrichment_refresh_finished_at: null,
      enrichment_refresh_last_error: null,
    };
    setAccounts((prev) => prev.map((a) => (a.id === companyId ? { ...a, ...runningPatch } : a)));
    setSelectedAccountDetailById((prev) =>
      companyId in prev ? { ...prev, [companyId]: { ...prev[companyId], ...runningPatch } } : prev,
    );

    try {
      const ok = await confirmCredits({
        title: 'Refresh this company?',
        description: 'Arcova re-runs enrichment to pull the latest firmographics, signals and fit.',
        cost: 3,
        confirmLabel: 'Refresh',
      });
      if (!ok) {
        invalidateAccountCaches(companyId, { clearDetailState: false });
        await fetchAccounts(true);
        return;
      }
      await fetch(`/api/companies/${companyId}/enrich`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-operation-id': crypto.randomUUID(),
        },
      });
      // The endpoint returns immediately (work runs in after()). Refresh once
      // now so the server-confirmed "running" state lands; the 5s poll picks
      // up the eventual succeeded/failed flip.
      invalidateAccountCaches(companyId, { clearDetailState: false });
      await fetchAccounts(true);
      await loadAccountDetail(companyId, true);
    } catch (err) {
      console.error('Error refreshing company enrichment:', err);
    } finally {
      setRefreshingCompanyId(null);
    }
  };

  // Stop a running company enrichment (mirrors the contacts stop control).
  // Optimistically flips the row out of "running" so the UI stops animating
  // immediately; the DELETE endpoint sets status='cancelled' server-side and
  // the background job declines to overwrite it.
  const stopCompanyEnrichment = async (companyId: string) => {
    const cancelledPatch: Partial<AccountRow> = {
      enrichment_refresh_status: 'cancelled',
      enrichment_refresh_finished_at: new Date().toISOString(),
    };
    setAccounts((prev) => prev.map((a) => (a.id === companyId ? { ...a, ...cancelledPatch } : a)));
    setSelectedAccountDetailById((prev) =>
      companyId in prev ? { ...prev, [companyId]: { ...prev[companyId], ...cancelledPatch } } : prev,
    );
    if (refreshingCompanyId === companyId) setRefreshingCompanyId(null);
    try {
      await fetch(`/api/companies/${companyId}/enrich`, { method: 'DELETE' });
      invalidateAccountCaches(companyId, { clearDetailState: false });
      await fetchAccounts(true);
      await loadAccountDetail(companyId, true);
    } catch (err) {
      console.error('Error stopping company enrichment:', err);
    }
  };

  // Contact accordion
  const [expandedContactId, setExpandedContactId] = useState<string | null>(null);
  const [contactFitCache, setContactFitCache] = useState<Record<string, ContactFitDetails | null>>({});
  const [contactFitLoadingIds, setContactFitLoadingIds] = useState<Set<string>>(new Set());
  const [expandedBars, setExpandedBars] = useState<Set<string>>(new Set());
  const toggleBar = (key: string) =>
    setExpandedBars((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });


  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  useEffect(() => {
    const id = searchParams.get('companyId')?.trim();
    if (id) accountsDeepLinkCompanyIdRef.current = id;
  }, [searchParams]);

  const fetchAccounts = useCallback(async (silent = false) => {
    if (!user) return;
    const focusAccountIds = parseIdList(searchParams.get('accountIds'));
    const focusId = accountsDeepLinkCompanyIdRef.current || (focusAccountIds.length === 1 ? focusAccountIds[0] : null);
    // `silent` skips the full-table loading spinner — used by the 5s enrichment
    // poll so the list doesn't flash a skeleton every tick.
    if (!silent) setLoadingAccounts(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (focusId) params.set('companyId', focusId);
      // Module-level cache: tab-switch-and-back doesn't refetch within TTL.
      // After mutations (enrich/stop/edit/archive) we call invalidateAccountCaches().
      const { data: result } = await cachedJson<{
        data?: AccountRow[];
        total?: number;
        page?: number;
      }>(`/api/companies?${params}`);
      let next: AccountRow[] = result.data || [];
      if (focusAccountIds.length > 1) {
        const existingIds = new Set(next.map((account) => account.id));
        const missingIds = focusAccountIds.filter((id) => !existingIds.has(id));
        if (missingIds.length > 0) {
          const supplemental = await Promise.all(
            missingIds.map(async (id) => {
              try {
                const { data: detail } = await cachedJson<{ data?: Partial<AccountRow> }>(
                  `/api/companies/${encodeURIComponent(id)}`,
                );
                return detail.data ? ({ ...detail.data, id } as AccountRow) : null;
              } catch {
                return null;
              }
            }),
          );
          next = [...next, ...supplemental.filter((account): account is AccountRow => Boolean(account))];
        }
        setAgentFilterIds(new Set(focusAccountIds));
        setAgentFilterLabel('Priority changes');
        setTableSortCol('priority');
        setTableSortDir('desc');
      }
      setAccounts(next);
      setTotal(result.total || 0);
      if (typeof result.page === 'number' && result.page >= 1) {
        setPage(result.page);
      }
      // Preserve the user's current selection / deep-link focus if still present,
      // but otherwise keep nothing selected so the agent shows as the full card by
      // default.
      setSelectedAccountId((current) => {
        if (focusId && next.some((a) => a.id === focusId)) return focusId;
        if (current && next.some((a) => a.id === current)) return current;
        return null;
      });
    } catch (err) {
      console.error('Error fetching accounts:', err);
    } finally {
      if (focusId) accountsDeepLinkCompanyIdRef.current = null;
      if (!silent) setLoadingAccounts(false);
    }
  }, [user, page, searchParams]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  // Load (or force-reload) a single account's detail record into the per-id
  // cache. The side panel merges this over the lean list row, so after a
  // mutation we must refresh it here or the panel keeps showing stale state
  // (e.g. enrichment_refresh_status). `force` bypasses the module fetch cache.
  const loadAccountDetail = useCallback(async (companyId: string, force = false) => {
    if (!companyId) return;
    try {
      if (force) invalidateCache(`/api/companies/${encodeURIComponent(companyId)}`);
      const { data: result } = await cachedJson<{ data?: Partial<AccountRow> }>(
        `/api/companies/${encodeURIComponent(companyId)}`,
      );
      if (!result.data) return;
      setSelectedAccountDetailById((prev) => ({ ...prev, [companyId]: result.data! }));
    } catch (e) {
      console.error('Error fetching account detail:', e);
    }
  }, []);

  // Invalidate EVERY cache layer for an account after a mutation. There are
  // THREE and forgetting any one leaves the side panel showing stale data
  // (see memory/project_enrichment_safety.md):
  //   1. the module-level list cache       (/api/companies)
  //   2. the module-level per-id detail    (/api/companies/[id])
  //   3. the per-id detail in React state  (selectedAccountDetailById)
  // Pass clearDetailState:false when the caller will immediately force-reload
  // the detail (loadAccountDetail(id, true)) — keeping the existing state entry
  // avoids a flicker (used by the enrichment refresh/poll path, which also
  // wants its optimistic "running" patch to survive until the reload lands).
  const invalidateAccountCaches = useCallback(
    (companyId: string, opts?: { clearDetailState?: boolean }) => {
      invalidateCache('/api/companies');
      invalidateCache(`/api/companies/${encodeURIComponent(companyId)}`);
      if (opts?.clearDetailState ?? true) {
        setSelectedAccountDetailById((prev) => {
          if (!(companyId in prev)) return prev;
          const next = { ...prev };
          delete next[companyId];
          return next;
        });
      }
    },
    [],
  );

  // Fetch full detail for the selected account (firmographics, products,
  // funding detail, etc.) — these fields aren't in the lean list response.
  // Cached via the module-level fetch cache so re-selecting is instant.
  useEffect(() => {
    if (!selectedAccountId) return;
    if (selectedAccountDetailById[selectedAccountId]) return; // already loaded
    loadAccountDetail(selectedAccountId);
  }, [selectedAccountId, selectedAccountDetailById, loadAccountDetail]);

  // Auto-poll every 5s while any company enrichment is running (mirrors the
  // contacts page). Company enrichment runs async via after(), so without a
  // poll the side panel would never reflect the succeeded/failed flip until
  // the user manually navigated away and back. We poll the lean list (cheap)
  // and force-refresh the selected account's detail so its banner updates.
  //
  // CRITICAL: the lean list (`/api/companies` → list_user_accounts RPC) does
  // NOT carry enrichment_refresh_status — only the detail endpoint
  // (accounts_view) does. So we MUST also check the selected account's detail
  // status, or the poll would die the moment fetchAccounts() overwrites the
  // optimistic patch on the lean list (the banner reads detail and would then
  // be stuck "running" forever). The detail cache is the reliable source here.
  const selectedDetailStatus = selectedAccountId
    ? selectedAccountDetailById[selectedAccountId]?.enrichment_refresh_status ?? null
    : null;
  // 'requested' = queued for the deep-enrichment cron (company-first import);
  // treat it as in-progress so the list keeps polling until the fit upgrades.
  const inProgressStatus = (s: string | null | undefined) => s === 'running' || s === 'requested';
  const anyCompanyEnrichmentRunning =
    refreshingCompanyId != null ||
    inProgressStatus(selectedDetailStatus) ||
    accounts.some((a) => inProgressStatus(a.enrichment_refresh_status));
  useEffect(() => {
    if (!anyCompanyEnrichmentRunning) return;
    const interval = setInterval(() => {
      invalidateCache('/api/companies');
      fetchAccounts(true);
      if (selectedAccountId) loadAccountDetail(selectedAccountId, true);
    }, 5000);
    return () => clearInterval(interval);
  }, [anyCompanyEnrichmentRunning, selectedAccountId, fetchAccounts, loadAccountDetail]);

  const accountAgentTask = searchParams.get('agentTask') ?? '';
  useEffect(() => {
    if (!user || agentTaskFiredRef.current === accountAgentTask) return;
    const icpId = searchParams.get('icpId') ?? '';
    if (accountAgentTask !== 'arcova_companies_for_icp' || !icpId) return;

    agentTaskFiredRef.current = accountAgentTask;
    setAgentTrigger((prev) => ({
      text: `Filter the accounts table to Arcova-sourced companies for ICP id ${icpId}. Use filter_accounts_table with filters.icpSearch="${icpId}" and filters.sources=["arcova"], columns company/company_type/fit/contacts/action/source/icp_match, sort by company_fit_desc. Keep your reply short and friendly, and mention these are the new Arcova companies for this ICP.`,
      nonce: (prev?.nonce ?? 0) + 1,
      threadPreview: 'Show Arcova companies for this ICP',
    }));
  }, [accountAgentTask, searchParams, user]);

  // Reset accordion when switching accounts or panel mode
  useEffect(() => {
    setExpandedContactId(null);
    setContactFitCache({});
    setContactFitLoadingIds(new Set());
    setExpandedBars(new Set());
  }, [selectedAccountId, panelMode]);

  useEffect(() => {
    if ((panelMode !== 'fit' && panelMode !== 'priority') || !selectedAccountId) return;

    const cached = companyFitCacheRef.current[selectedAccountId];
    if (cached) {
      setCompanyFitPanel({
        loading: false,
        data: cached,
        error: null,
        message: null,
      });
      return;
    }

    let cancelled = false;

    setCompanyFitPanel({ loading: true, data: null, error: null, message: null });

    (async () => {
      try {
        const response = await fetch(`/api/companies/${encodeURIComponent(selectedAccountId)}/fit`);
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(typeof result.error === 'string' ? result.error : 'Failed to load company fit details.');
        }

        if (cancelled) return;

        const data = (result.data ?? null) as CompanyFitDetails | null;
        if (data && selectedAccountId) {
          companyFitCacheRef.current[selectedAccountId] = data;
        }

        setCompanyFitPanel({
          loading: false,
          data,
          error: null,
          message: typeof result.message === 'string' ? result.message : null,
        });
      } catch (err) {
        if (cancelled) return;
        setCompanyFitPanel({
          loading: false,
          data: null,
          error: err instanceof Error ? err.message : 'Failed to load company fit details.',
          message: null,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [panelMode, selectedAccountId]);

  // Lazy-load HubSpot CRM context when the CRM tab opens. Caches per account so
  // re-opening the tab is instant; the cache lives for the lifetime of the page.
  useEffect(() => {
    if (panelMode !== 'crm' || !selectedAccountId) return;

    const cached = hubspotCrmCacheRef.current[selectedAccountId];
    if (cached) {
      setHubspotCrmPanel({ loading: false, data: cached, error: null });
      return;
    }

    let cancelled = false;
    setHubspotCrmPanel({ loading: true, data: null, error: null });

    (async () => {
      try {
        const response = await fetch(`/api/companies/${encodeURIComponent(selectedAccountId)}/hubspot-crm`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof result.error === 'string' ? result.error : 'Failed to load HubSpot CRM context.');
        }
        if (cancelled) return;
        const data = (result.data ?? null) as AccountCrmContext | null;
        if (data && selectedAccountId) {
          hubspotCrmCacheRef.current[selectedAccountId] = data;
        }
        setHubspotCrmPanel({ loading: false, data, error: null });
      } catch (err) {
        if (cancelled) return;
        setHubspotCrmPanel({
          loading: false,
          data: null,
          error: err instanceof Error ? err.message : 'Failed to load HubSpot CRM context.',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [panelMode, selectedAccountId]);

  const toggleContact = (contactId: string) => {
    setExpandedContactId((prev) => {
      const opening = prev !== contactId;
      if (!opening) return null; // collapse
      // Fetch fit data if not cached
      if (!(contactId in contactFitCache) && !contactFitLoadingIds.has(contactId)) {
        setContactFitLoadingIds((s) => new Set(s).add(contactId));
        fetch(`/api/contacts/${encodeURIComponent(contactId)}/fit`)
          .then((r) => r.json())
          .then((result) => setContactFitCache((c) => ({ ...c, [contactId]: result.data ?? null })))
          .catch(() => setContactFitCache((c) => ({ ...c, [contactId]: null })))
          .finally(() => setContactFitLoadingIds((s) => { const n = new Set(s); n.delete(contactId); return n; }));
      }
      return contactId;
    });
  };

  // Fetch contacts when contacts panel opens
  useEffect(() => {
    if (!selectedAccountId || panelMode !== 'contacts') {
      setContacts([]);
      return;
    }
    let cancelled = false;
    setLoadingContacts(true);
    fetch(`/api/contacts?companyId=${encodeURIComponent(selectedAccountId)}&pageSize=100`)
      .then((r) => r.json())
      .then((result) => {
        if (!cancelled) setContacts(result.data || []);
      })
      .catch(() => { if (!cancelled) setContacts([]); })
      .finally(() => { if (!cancelled) setLoadingContacts(false); });
    return () => { cancelled = true; };
  }, [selectedAccountId, panelMode]);

  // Auto-fetch fit for all contacts once they load (fit breakdown is always visible now)
  useEffect(() => {
    for (const contact of contacts) {
      if (contact.id in contactFitCache || contactFitLoadingIds.has(contact.id)) continue;
      setContactFitLoadingIds((s) => new Set(s).add(contact.id));
      fetch(`/api/contacts/${encodeURIComponent(contact.id)}/fit`)
        .then((r) => r.json())
        .then((result) => setContactFitCache((c) => ({ ...c, [contact.id]: result.data ?? null })))
        .catch(() => setContactFitCache((c) => ({ ...c, [contact.id]: null })))
        .finally(() => setContactFitLoadingIds((s) => { const n = new Set(s); n.delete(contact.id); return n; }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts]);

  const handleTableFilter = (_filter: AgentTableFilter, filteredAccounts: QueryAccount[]) => {
    setAgentFilterIds(new Set(filteredAccounts.map((a) => a.id)));
    setAgentFilterLabel('Filtered by agent');
    setTableSortCol(null);
    setSelectedAccountId(null);
  };

  const handleQueryClear = () => {
    setAgentFilterIds(null);
    setAgentFilterLabel('Filtered by agent');
    setSelectedAccountId(null);
    setTableSortCol(null);
    if (searchParams.get('accountIds') || searchParams.get('focus')) {
      router.replace(ROUTES.accounts);
    }
  };

  const handleSortCol = (col: string) => {
    if (tableSortCol === col) {
      setTableSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setTableSortCol(col);
      setTableSortDir('asc');
    }
  };

  const openDetails = (id: string) => {
    pendingOpenCriteriaRef.current = false;
    setSelectedAccountId(id);
    setPanelMode('details');
  };

  const openCompanyFitTab = (id: string) => {
    pendingOpenCriteriaRef.current = false;
    setSelectedAccountId(id);
    setPanelMode('fit');
  };

  const openDetailsWithCriteria = (id: string) => {
    setPanelMode('details');
    if (selectedAccountId === id) {
      setDetailPanelOpen({ ...ALL_DETAILS_EXPANDED });
      return;
    }
    pendingOpenCriteriaRef.current = true;
    setSelectedAccountId(id);
  };

  const openContacts = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    pendingOpenCriteriaRef.current = false;
    setSelectedAccountId(id);
    setPanelMode('contacts');
  };

  const openActionTab = (id: string) => {
    pendingOpenCriteriaRef.current = false;
    setSelectedAccountId(id);
    setPanelMode('action');
  };

  /** Reach out happens at the CONTACT level (its outreach tab). Send the rep to
   *  the contact's Reach out tab on /contacts — mirroring the contact
   *  page, where Reach out opens the side-panel Outreach tab. */
  const navigateToContactReachOut = (contactId: string) => {
    router.push(`${ROUTES.contacts}?lead=${encodeURIComponent(contactId)}&tab=outreach`);
  };

  /** Reach out on an account: 1 contact → go straight to that contact's Reach
   *  out tab; >1 → open the side panel with a picker ranked by contact priority
   *  so the rep chooses who to approach. */
  const handleAccountReachOut = async (account: AccountRow | QueryAccount) => {
    setReachOutLoadingId(account.id);
    try {
      const res = await fetch(
        `/api/contacts?companyId=${encodeURIComponent(account.id)}&pageSize=100`,
      );
      const json = await res.json();
      const ranked = ((json?.data ?? []) as ContactAtCompany[])
        .slice()
        .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0));
      if (ranked.length === 1) {
        navigateToContactReachOut(ranked[0].id);
      } else if (ranked.length > 1) {
        setReachOutCandidates(ranked);
        setSelectedAccountId(account.id);
        setPanelMode('reachout');
      } else {
        // No contacts on file (shouldn't reach here for reach_out) → explain.
        openActionTab(account.id);
      }
    } catch {
      openActionTab(account.id);
    } finally {
      setReachOutLoadingId(null);
    }
  };

  /** Action-pill routing — mirrors the contact action button:
   *  reach_out → contact's Reach out (picker if >1); send_outreach → /outreach;
   *  source_contact → /data with full company+ICP context; everything else
   *  (monitor / deprioritise / await_reply) → the side-panel Action drawer. */
  const handleAccountActionClick = (account: AccountRow | QueryAccount) => {
    const action = getAccountRowAction(account);
    if (action === 'reach_out') {
      void handleAccountReachOut(account);
      return;
    }
    if (action === 'send_outreach') {
      router.push(ROUTES.outreach);
      return;
    }
    if (action === 'source_contact') {
      openContactAcquisition(account as AccountRow);
      return;
    }
    openActionTab(account.id);
  };

  const openSignalsTab = (id: string) => {
    pendingOpenCriteriaRef.current = false;
    setSelectedAccountId(id);
    setPanelMode('signals');
  };

  const openPriorityTab = (id: string) => {
    pendingOpenCriteriaRef.current = false;
    setSelectedAccountId(id);
    setPanelMode('priority');
  };

  const openCrmTab = (id: string) => {
    pendingOpenCriteriaRef.current = false;
    setSelectedAccountId(id);
    setPanelMode('crm');
  };

  const openContactAcquisition = (account: AccountRow) => {
    const params = new URLSearchParams({
      mode: 'contacts_at_company',
      companyId: account.id,
      companyName: account.company_name || account.domain || 'Selected company',
      source: 'accounts',
    });
    if (account.matched_icp_id) params.set('icpId', account.matched_icp_id);
    router.push(withQuery(ROUTES.data, params));
  };

  const closePanel = () => {
    setSelectedAccountId(null);
  };

  // ── Top-of-page Actions menu ──
  // HubSpot connection drives whether the Pull/Push items appear (mirrors /contacts).
  useEffect(() => {
    fetch('/api/hubspot/status')
      .then((r) => r.json())
      .then((data) => setHubspotConnected(data?.connected === true))
      .catch(() => {});
  }, []);

  // Org-wide HubSpot sync (same endpoints the contacts page uses). The trigger
  // icon spins while a sync is in flight; on pull we refresh the table so any
  // new CRM status lands.
  const handlePushToHubspot = useCallback(async () => {
    if (pushingToHubspot) return;
    setPushingToHubspot(true);
    try {
      await fetch('/api/hubspot/push-enrichment', { method: 'POST' });
    } catch (err) {
      console.error('Error pushing to HubSpot:', err);
    } finally {
      setPushingToHubspot(false);
    }
  }, [pushingToHubspot]);

  const handlePullHubspotCrm = useCallback(async () => {
    if (pullingHubspotCrm) return;
    setPullingHubspotCrm(true);
    try {
      await fetch('/api/hubspot/pull-crm', { method: 'POST' });
      invalidateCache('/api/companies');
      await fetchAccounts(true);
    } catch (err) {
      console.error('Error pulling HubSpot CRM:', err);
    } finally {
      setPullingHubspotCrm(false);
    }
  }, [pullingHubspotCrm, fetchAccounts]);

  // Export the current view to CSV, client-side (no dedicated endpoint). Honours
  // the active agent filter and the on-screen sort so it matches what's shown.
  const handleExportCsv = useCallback(() => {
    if (exportingCsv) return;
    setExportingCsv(true);
    try {
      const rows = applyAccountSort(
        agentFilterIds ? accounts.filter((a) => agentFilterIds.has(a.id)) : accounts,
        tableSortCol,
        tableSortDir,
      );
      const headers = ['Company', 'Domain', 'Company type', 'Company fit', 'Priority', 'Contacts', 'CRM status'];
      const escape = (v: string | number | null | undefined) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [headers.join(',')];
      for (const a of rows) {
        lines.push(
          [
            a.company_name ?? '',
            a.domain ?? '',
            a.company_type ?? '',
            formatPct(a.company_fit_score) ?? '',
            formatPct((a as AccountRow).priority_score) ?? '',
            a.contact_count,
            (a as AccountRow).crm_status ?? '',
          ]
            .map(escape)
            .join(','),
        );
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `companies-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setExportingCsv(false);
    }
  }, [accounts, agentFilterIds, tableSortCol, tableSortDir, exportingCsv]);

  const renderAccountQueryCell = (account: AccountRow | QueryAccount, col: AccountQueryColumn) => {
    const isSelected = selectedAccountId === account.id;
    const href = externalUrl(account as AccountRow);
    const companyLabel = account.company_name || account.domain || '—';
    // Cap long values at 35 chars + ellipsis; full text stays available on
    // hover via the title attribute.
    const truncate35 = (s: string) => (s.length > 35 ? s.slice(0, 35) + '…' : s);
    const isArcovaAccount = (account.data_provenance_type || '').toLowerCase().includes('arcova');

    switch (col) {
      case 'company':
        return (
          <div className="flex items-start gap-1.5 min-w-0">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="truncate text-[12px] font-medium text-arcova-teal hover:underline min-w-0"
                title={companyLabel}
              >
                {truncate35(companyLabel)}
              </a>
            ) : (
              <span className="truncate text-[12px] font-medium text-gray-900 min-w-0" title={companyLabel}>
                {truncate35(companyLabel)}
              </span>
            )}
            {href && (
              <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-arcova-teal/60 hover:text-arcova-teal shrink-0 mt-0.5">
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        );
      case 'company_type':
        return (
          <div className="flex items-center min-w-0">
            {account.company_type ? (
              <button
                type="button"
                className="min-w-0 text-left cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  openDetailsWithCriteria(account.id);
                }}
              >
                <span className="block truncate text-[12px] text-gray-700" title={account.company_type}>
                  {truncate35(account.company_type)}
                </span>
              </button>
            ) : (
              <span className="text-[12px] text-gray-700">—</span>
            )}
          </div>
        );
      case 'fit':
        return (
          <div className="flex items-center justify-center">
            <TableFitGaugeButton
              score={account.company_fit_score}
              title="View company fit"
              onOpen={(e) => {
                e.stopPropagation();
                openCompanyFitTab(account.id);
              }}
            />
          </div>
        );
      case 'contacts':
        return (
          <button
            type="button"
            onClick={(e) => openContacts(account.id, e)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
              account.contact_count === 0
                ? (isSelected && panelMode === 'contacts'
                    ? 'bg-amber-500 text-white'
                    : 'bg-amber-50 text-amber-700 hover:bg-amber-100')
                : (isSelected && panelMode === 'contacts'
                    ? 'bg-arcova-teal text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-arcova-teal/10 hover:text-arcova-teal'),
            )}
          >
            <Users className="w-3 h-3 shrink-0" />
            <span>{account.contact_count}</span>
          </button>
        );
      case 'crm_status': {
        const row = account as AccountRow;
        const crmStatus = row.crm_status ?? null;
        // Mirror getHubSpotTableBadge from the contacts view exactly.
        // 'context_only' (in CRM, no actionable deal) and 'none'/null both
        // render as "No deal" — same neutral pill.
        const isNoDeal = !crmStatus || crmStatus === 'none' || crmStatus === 'context_only';
        const badge = isNoDeal
          ? { label: 'No deal',     className: 'border-[rgba(13,53,71,0.10)] bg-[rgba(13,53,71,0.04)] text-[#7d909a]' }
          : crmStatus === 'customer'
            ? { label: 'Won',       className: 'border-[rgba(45,138,138,0.24)] bg-[rgba(45,138,138,0.08)] text-[#2d8a8a]' }
            : crmStatus === 'dormant'
              ? { label: 'Lost',    className: 'border-[rgba(220,38,38,0.24)] bg-[rgba(220,38,38,0.08)] text-[#b91c1c]' }
              : /* active */
                { label: row.crm_deal_stage_label ?? 'Active deal', className: 'border-[rgba(245,115,22,0.24)] bg-[rgba(255,122,89,0.08)] text-[#cc5b3f]' };
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openCrmTab(account.id);
            }}
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium cursor-pointer transition-shadow hover:shadow-sm active:scale-[0.97]',
              badge.className,
            )}
          >
            {badge.label}
          </button>
        );
      }
      case 'therapeutic_areas': {
        // For CRO/vendor/services accounts the firm's own TAs are empty by design;
        // fall back to the disease areas they serve so the column isn't blank.
        const taItems = (account.therapeutic_areas || []).length > 0
          ? account.therapeutic_areas
          : account.customer_therapeutic_areas;
        return (
          <InlinePills
            items={taItems}
            max={2}
            onActivate={
              (taItems || []).length > 0
                ? () => openDetailsWithCriteria(account.id)
                : undefined
            }
          />
        );
      }
      case 'modalities': {
        const modItems = (account.modalities || []).length > 0
          ? account.modalities
          : account.customer_modalities;
        return (
          <InlinePills
            items={modItems}
            max={2}
            onActivate={
              (modItems || []).length > 0
                ? () => openDetailsWithCriteria(account.id)
                : undefined
            }
          />
        );
      }
      case 'action': {
        const action = getAccountRowAction(account);
        const config = LEAD_ACTION_PILL_CLASS[action];
        const actionPillEmphasized = isSelected && panelMode === 'action';
        return (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleAccountActionClick(account);
              }}
              disabled={reachOutLoadingId === account.id}
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium cursor-pointer select-none',
                'transition-colors duration-150 ease-out hover:shadow-sm active:scale-[0.97]',
                reachOutLoadingId === account.id && 'opacity-60',
                actionPillEmphasized
                  ? config.rowSelectedClassName
                  : cn(config.className, config.interactiveClassName, 'shadow-sm'),
              )}
            >
              {config.label}
            </button>
          </div>
        );
      }
      case 'funding_stage':
        return <span className="text-[12px] text-gray-600 line-clamp-2">{account.funding_stage || account.funding_status_label || '—'}</span>;
      case 'icp_match':
        return <span className="text-[12px] text-gray-600 line-clamp-2">{account.matched_icp_label || '—'}</span>;
      case 'development_stages':
        return (
          <InlinePills
            items={account.development_stages}
            max={2}
            onActivate={
              (account.development_stages || []).length > 0
                ? () => openDetailsWithCriteria(account.id)
                : undefined
            }
          />
        );
      case 'employee_range':
        return <span className="text-[12px] text-gray-600 truncate">{account.employee_range || (account.employee_count != null ? account.employee_count.toLocaleString() : '—')}</span>;
      case 'location':
        return <span className="text-[12px] text-gray-600 line-clamp-2">{accountLocation(account) || '—'}</span>;
      case 'source':
        return (
          <span
            className={cn(
              'inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
              isArcovaAccount ? 'bg-arcova-teal/10 text-arcova-teal' : 'bg-gray-100 text-gray-500',
            )}
          >
            {account.data_provenance_type || '—'}
          </span>
        );
      case 'priority': {
        const ps = (account as AccountRow).priority_score ?? null;
        return (
          <div className="flex items-center justify-center">
            <TableFitGaugeButton
              score={ps}
              title="View priority score (fit × readiness)"
              arcColorFn={priorityScoreArcColor}
              onOpen={(e) => {
                e.stopPropagation();
                openPriorityTab(account.id);
              }}
            />
          </div>
        );
      }
      case 'readiness': {
        const rs = (account as AccountRow).readiness_score ?? null;
        return (
          <div className="flex items-center justify-center">
            <TableFitGaugeButton
              score={rs}
              title="View account readiness"
              onOpen={(e) => {
                e.stopPropagation();
                openSignalsTab(account.id);
              }}
            />
          </div>
        );
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const sortedAccounts = applyAccountSort(
    agentFilterIds ? accounts.filter((a) => agentFilterIds.has(a.id)) : accounts,
    tableSortCol,
    tableSortDir,
  );

  // Only fade the bottom of the list while there's more content below the viewport;
  // when scrolled to the end the last rows render in full without the mask clipping
  // them. Re-measures whenever the row count changes (agent filter / fetch / etc.).
  const { hasMore: hasMoreBelow } = useScrollMask(accountsScrollRef, [sortedAccounts.length]);

  // Lean list row from the table fetch.
  const selectedAccountLean = selectedAccountId
    ? accounts.find((a) => a.id === selectedAccountId) ?? null
    : null;
  // Merge in the detail fetch (firmographics, products, funding detail, etc.).
  // Detail wins where it has a value; lean fills the rest (computed fields like
  // priority_score, crm_status, data_provenance_type live only on lean).
  const selectedAccount: AccountRow | null = selectedAccountLean
    ? {
        ...selectedAccountLean,
        ...(selectedAccountId ? selectedAccountDetailById[selectedAccountId] ?? {} : {}),
      } as AccountRow
    : null;

  return (
    <div className="flex min-h-0 h-screen bg-transparent">
      <AppSidebar />

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 overflow-hidden p-3.5 md:flex-row md:gap-2">
        {/* ── Main content (table) ── */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] bg-transparent px-3 py-3 sm:px-5 sm:py-4 min-[1280px]:pr-2">
          <div className="flex min-h-0 w-full max-w-none flex-1 flex-col">

            <div className="mb-6 shrink-0 max-[767px]:pl-14">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-arcova-teal">
                <Building2 className="h-3.5 w-3.5" />
                Companies
              </div>
              <h1 className="font-manrope mt-2 text-3xl font-bold leading-tight tracking-[-0.028em] text-[rgb(13,53,71)] sm:text-[2.25rem]">
                Companies
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                {total > 0
                  ? `${total.toLocaleString()} compan${total === 1 ? 'y' : 'ies'}. Click a row to open the company card, or the company name to open the account.`
                  : 'One row per company, with firmographics and ICP fit at a glance.'}
              </p>

              {total > 0 && (
                // Sits directly under the intro sentence — mirrors the /contacts Actions menu.
                <div className="mt-4 flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="inline-flex items-center gap-2 px-3 py-2 bg-arcova-teal text-white rounded-lg text-sm font-medium hover:bg-arcova-teal/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-sm focus-visible:outline-none"
                        title="Actions"
                      >
                        {pullingHubspotCrm || pushingToHubspot ? (
                          <RotateCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                        Actions
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={6} className="min-w-[14rem]">
                      <DropdownMenuItem onSelect={() => router.push('/import')}>
                        <Upload className="w-3.5 h-3.5" />
                        Import companies
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={handleExportCsv} disabled={exportingCsv}>
                        <Download className="w-3.5 h-3.5" />
                        Export CSV
                      </DropdownMenuItem>
                      {hubspotConnected && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={handlePullHubspotCrm} disabled={pullingHubspotCrm}>
                            {pullingHubspotCrm ? (
                              <RotateCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Download className="w-3.5 h-3.5" />
                            )}
                            {pullingHubspotCrm ? 'Pulling…' : 'Pull HubSpot CRM'}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={handlePushToHubspot} disabled={pushingToHubspot}>
                            {pushingToHubspot ? (
                              <RotateCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Upload className="w-3.5 h-3.5" />
                            )}
                            {pushingToHubspot ? 'Syncing…' : 'Push to HubSpot'}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>

            {loadingAccounts ? (
              <div className="flex items-center justify-center py-24">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-arcova-teal" />
              </div>
            ) : accounts.length === 0 && !agentFilterIds ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-16 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Building2 className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No companies yet</h3>
                <p className="text-gray-500 mb-6 max-w-md mx-auto">
                  Companies appear here once you import contacts with a resolved company.
                </p>
                <button
                  type="button"
                  onClick={() => router.push('/import')}
                  className="px-6 py-3 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors inline-flex items-center gap-2"
                >
                  <Users className="w-4 h-4" />
                  Import contacts
                </button>
              </div>
            ) : (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">

                {/* Agent filter banner */}
                {agentFilterIds && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-arcova-teal/20 bg-arcova-teal/5 px-4 py-2.5">
                    <p className="text-xs font-medium text-arcova-teal">
                      {agentFilterLabel} · {sortedAccounts.length} compan{sortedAccounts.length === 1 ? 'y' : 'ies'}
                    </p>
                    <button
                      type="button"
                      onClick={handleQueryClear}
                      className="text-xs text-arcova-teal/70 hover:text-arcova-teal underline shrink-0 transition-colors"
                    >
                      Clear filter
                    </button>
                  </div>
                )}

                <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.5rem] border border-[rgba(13,53,71,0.1)] bg-[rgba(255,255,255,0.52)] shadow-[0_24px_60px_-32px_rgba(13,53,71,0.16),0_2px_6px_-2px_rgba(13,53,71,0.06)] backdrop-blur-2xl backdrop-saturate-150">
                    {/* Header */}
                    <div
                      onWheel={(e) => {
                        if (accountsScrollRef.current) {
                          accountsScrollRef.current.scrollTop += e.deltaY;
                        }
                      }}
                      className="grid w-full shrink-0 min-w-0 pl-9 pr-4 py-3 bg-[rgba(255,255,255,0.4)] border-b border-[rgba(13,53,71,0.08)] text-[13px] font-semibold text-[#7d909a] uppercase tracking-wide gap-x-5"
                      style={{ gridTemplateColumns: accountQueryGridCols(tableColumns) }}
                    >
                      {tableColumns.map((col) => (
                        <button
                          key={col}
                          type="button"
                          onClick={() => handleSortCol(col)}
                          className={cn(
                            'flex min-w-0 items-center gap-1 hover:text-gray-800 transition-colors text-left',
                            col === 'fit' || col === 'priority' || col === 'readiness' || col === 'action' || col === 'contacts' || col === 'crm_status' ? 'justify-center text-center' : '',
                          )}
                        >
                          {ACCOUNT_QUERY_COL_DEFS[col].label}
                          <SortArrow col={col} activeCol={tableSortCol} dir={tableSortDir} />
                        </button>
                      ))}
                    </div>

                    {/* Rows — single render path; agent filter narrows sortedAccounts in-place */}
                    <div
                      ref={accountsScrollRef}
                      className="min-h-0 flex-1 divide-y divide-[rgba(13,53,71,0.06)] overflow-y-auto"
                      style={
                        hasMoreBelow
                          ? {
                              maskImage: 'linear-gradient(to bottom, black calc(100% - 9rem), transparent)',
                              WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 9rem), transparent)',
                            }
                          : undefined
                      }
                    >
                      {sortedAccounts.map((account, index) => {
                        const isSelected = selectedAccountId === account.id;
                        const rowNumber = (page - 1) * PAGE_SIZE + index + 1;
                        // While enrichment runs, replace the data columns with an
                        // animated progress bar (mirrors the /contacts table row).
                        // The first column ('company' at every breakpoint) keeps the
                        // identity so you can see WHICH company is enriching; the bar
                        // spans the remaining columns. The 5s poll flips the row to
                        // succeeded/failed, returning it to the normal cells.
                        const enriching =
                          account.enrichment_refresh_status === 'running' ||
                          account.enrichment_refresh_status === 'requested';

                        return (
                          <div
                            key={account.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => openDetails(account.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetails(account.id); }
                            }}
                            className={cn(
                              "relative grid w-full min-w-0 pl-9 pr-4 py-3 gap-x-5 items-center cursor-pointer transition-all duration-150 before:pointer-events-none before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-sm before:content-[''] before:transition-colors",
                              isSelected
                                ? 'bg-arcova-teal/10 before:bg-arcova-teal'
                                : 'before:bg-transparent hover:bg-arcova-teal/5 hover:before:bg-arcova-teal/35',
                            )}
                            style={{ gridTemplateColumns: accountQueryGridCols(tableColumns) }}
                          >
                            <span aria-hidden className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-medium tabular-nums text-gray-400 select-none">
                              {rowNumber}
                            </span>
                            {enriching ? (
                              <>
                                <div className="min-w-0">
                                  {renderAccountQueryCell(account, tableColumns[0])}
                                </div>
                                <div className="min-w-0" style={{ gridColumn: '2 / -1' }}>
                                  <AccountRowEnrichingBar
                                    startedAt={account.enrichment_refresh_started_at ?? null}
                                  />
                                </div>
                              </>
                            ) : (
                              tableColumns.map((col) => (
                                <div
                                  key={col}
                                  className={cn(
                                    'min-w-0',
                                    col === 'fit' || col === 'priority' || col === 'action' || col === 'contacts' || col === 'crm_status' ? 'flex justify-center' : '',
                                    col === 'therapeutic_areas' ? 'pl-2' : '',
                                  )}
                                >
                                  {renderAccountQueryCell(account, col)}
                                </div>
                              ))
                            )}
                          </div>
                        );
                      })}
                    </div>

                  {!agentFilterIds && totalPages > 1 && (
                    <div className="flex shrink-0 items-center justify-between px-4 py-3 border-t border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.35)]">
                      <p className="text-xs text-gray-500">
                        {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}
                      </p>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                          className="p-1.5 rounded text-gray-500 hover:text-gray-900 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-xs text-gray-600">{page} / {totalPages}</span>
                        <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                          className="p-1.5 rounded text-gray-500 hover:text-gray-900 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>{/* end table card */}

                {/* Mobile dismiss backdrop (<1280px) — matches /contacts */}
                {selectedAccountId && selectedAccount && (
                  <button
                    type="button"
                    className="fixed inset-0 z-40 transition-opacity min-[1280px]:hidden"
                    aria-label="Close panel"
                    onClick={closePanel}
                  />
                )}

                {/* ── Company card — overlays the AgentPanel column while open.
                    Visual style matches the contact card on /contacts (glass
                    surface, dimensions, blur). Position + size mirror the
                    AgentPanel's actual bounding rect so it fully covers the agent
                    column; the agent itself is `invisible` in this state and the
                    floating chat bar below acts as the agent's surface. ── */}
                {selectedAccountId && selectedAccount && (
                  <aside
                    className={cn(
                      'flex min-h-0 flex-col overflow-hidden rounded-[1.3125rem] border border-[rgba(255,255,255,0.88)] bg-[rgba(255,255,255,0.55)] shadow-[0_24px_60px_-32px_rgba(13,53,71,0.2)] backdrop-blur-2xl backdrop-saturate-150',
                      'fixed z-50',
                      // Fallback for the first paint, before the rect is measured.
                      !agentRect && 'max-md:bottom-3.5 max-md:top-3.5 max-md:right-3.5 max-md:w-[min(calc(100vw-1.75rem),22.5rem)] md:top-[14px] md:bottom-[14px] md:right-[1.625rem] md:w-[22.5rem]',
                    )}
                    style={
                      agentRect
                        ? agentDocked
                          ? {
                              // Docked: card takes the bottom half; the agent fills the top
                              // half (50/50 split, viewport-relative — mirrors /contacts).
                              top: 'calc(50vh + 6px)',
                              left: agentRect.left,
                              width: agentRect.width,
                              height: 'calc(50vh - 20px)',
                            }
                          : {
                              // Seat the card just below the floating chat bar's measured
                              // bottom (+ a small gap) so the spacing stays tight.
                              top: agentRect.top + agentBarHeight + AGENT_BAR_GAP,
                              left: agentRect.left,
                              width: agentRect.width,
                              height: Math.max(0, agentRect.height - agentBarHeight - AGENT_BAR_GAP),
                            }
                        : undefined
                    }
                  >
                    {/* Panel header — logo leads, then eyebrow + name, close trails (design .dh).
                        Mirrors the shipped /contacts header for cross-panel consistency. */}
                    <div className="relative flex shrink-0 items-center gap-3 border-b border-[rgba(13,53,71,0.08)] px-4 pb-3.5 pt-[18px] before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-0 before:h-24 before:bg-gradient-to-b before:from-[rgba(227,243,241,0.7)] before:via-[rgba(255,255,255,0.2)] before:to-transparent">
                      {(selectedAccount.logo_cached || selectedAccount.logo_url) && !failedLogoByAccountId[selectedAccount.id] ? (
                        <img
                          src={selectedAccount.logo_cached ?? selectedAccount.logo_url ?? ''}
                          alt=""
                          className="relative z-[1] h-[3.375rem] w-[3.375rem] shrink-0 rounded-[13px] border border-[rgba(13,53,71,0.08)] bg-white object-contain p-1 shadow-sm ring-1 ring-black/5"
                          onError={() =>
                            setFailedLogoByAccountId((prev) => ({
                              ...prev,
                              [selectedAccount.id]: true,
                            }))
                          }
                        />
                      ) : (
                        <div className="relative z-[1] flex h-[3.375rem] w-[3.375rem] shrink-0 items-center justify-center rounded-[13px] border border-[rgba(13,53,71,0.08)] bg-white font-manrope text-2xl font-semibold text-arcova-teal shadow-sm ring-1 ring-black/5">
                          {(selectedAccount.company_name?.[0] || selectedAccount.domain?.[0] || '?').toUpperCase()}
                        </div>
                      )}
                      <div className="relative z-[1] min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7d909a]">
                          {panelMode === 'fit'
                            ? 'Fit'
                            : panelMode === 'action'
                              ? 'Action'
                              : panelMode === 'reachout'
                                ? 'Reach out'
                                : panelMode === 'contacts'
                                  ? 'Contacts'
                                  : panelMode === 'priority'
                                    ? 'Priority'
                                    : panelMode === 'signals'
                                      ? 'Signals'
                                      : panelMode === 'crm'
                                        ? 'CRM'
                                        : 'Company'}
                        </p>
                        <h2 className="font-manrope mt-1 break-words text-xl font-bold leading-tight tracking-[-0.024em] text-[rgb(13,53,71)] sm:text-[1.4375rem]">
                          {selectedAccount.company_name || selectedAccount.domain || 'Company'}
                        </h2>
                      </div>
                      {agentRect && (
                        <button
                          type="button"
                          onClick={() => setAgentDocked((d) => !d)}
                          className="relative z-[1] grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] border border-[rgba(13,53,71,0.08)] bg-white/70 text-[#7d909a] transition-colors hover:bg-white hover:text-[#0d3547]"
                          aria-label={agentDocked ? 'Expand panel to full height' : 'Share space with the agent'}
                          title={agentDocked ? 'Expand to full height' : 'Shrink — open the agent above'}
                        >
                          {agentDocked ? (
                            <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
                          ) : (
                            <Minimize2 className="h-3.5 w-3.5" strokeWidth={2} />
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={closePanel}
                        className="relative z-[1] grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] border border-[rgba(13,53,71,0.08)] bg-white/70 text-[#7d909a] transition-colors hover:bg-white hover:text-[#0d3547]"
                        aria-label="Close"
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    </div>

                    {/* Peer tab strip — teal button style, matching /contacts.
                        Order: Details, Contacts, Fit, Priority, Signals, CRM, Action. */}
                    <div className="relative z-[1] flex items-center gap-0.5 border-b border-[rgba(13,53,71,0.06)] bg-white/60 px-2.5 py-2">
                      {([
                        { mode: 'details', label: 'Details' },
                        { mode: 'contacts', label: 'Contacts' },
                        { mode: 'fit', label: 'Fit' },
                        { mode: 'priority', label: 'Priority' },
                        { mode: 'signals', label: 'Signals' },
                        { mode: 'crm', label: 'CRM' },
                        { mode: 'action', label: 'Action' },
                      ] as { mode: PanelMode; label: string }[]).map(({ mode, label }) => {
                        const isActive = panelMode === mode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setPanelMode(mode)}
                            className={cn(
                              // Equal-width tabs so all 7 fit without horizontal scroll (design .tabs)
                              'min-w-0 flex-1 whitespace-nowrap rounded-[9px] px-1 py-1.5 text-center text-[11.5px] font-semibold transition-colors',
                              isActive
                                ? 'bg-arcova-teal/10 text-arcova-teal'
                                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
                            )}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Panel body */}
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">

                      {panelMode === 'fit' && (
                        <CompanyIcpFitDetailPanel
                          embedded
                          companyId={selectedAccount.id}
                          details={companyFitPanel.data}
                          loading={companyFitPanel.loading}
                          error={companyFitPanel.error}
                          message={companyFitPanel.message}
                          tableCompanyFitScore={selectedAccount.company_fit_score}
                          tableMatchedIcpLabel={selectedAccount.matched_icp_label}
                        />
                      )}

                      {panelMode === 'action' && (() => {
                        const action = getAccountRowAction(selectedAccount);
                        const config = LEAD_ACTION_PILL_CLASS[action];
                        const companyLabel =
                          selectedAccount.company_name || selectedAccount.domain || 'This company';
                        const updatedAt = selectedAccount.last_enriched_at;
                        // "Why this action" bullets — built from the real fit / coverage /
                        // CRM signals behind the recommendation (design .bullets card).
                        const whyFitPct = formatPct(selectedAccount.company_fit_score);
                        const whyBestContactPct = formatPct(selectedAccount.best_contact_fit);
                        const whyBullets: string[] = [];
                        whyBullets.push(
                          whyFitPct
                            ? `${companyLabel} is a ${whyFitPct} company fit to your ICP.`
                            : `${companyLabel} hasn't been scored for ICP fit yet.`,
                        );
                        whyBullets.push(
                          selectedAccount.contact_count > 0
                            ? whyBestContactPct
                              ? `${selectedAccount.contact_count} contact${selectedAccount.contact_count === 1 ? '' : 's'} mapped — best contact fit ${whyBestContactPct}.`
                              : `${selectedAccount.contact_count} contact${selectedAccount.contact_count === 1 ? '' : 's'} mapped at this company.`
                            : 'No contacts on file yet — source contacts to start working this account.',
                        );
                        {
                          const crm = selectedAccount.crm_status;
                          if (crm && crm !== 'none' && crm !== 'context_only') {
                            whyBullets.push(
                              crm === 'customer'
                                ? 'Already a closed-won customer in your CRM.'
                                : crm === 'dormant'
                                  ? 'A previous deal was lost — held in cooldown for now.'
                                  : 'An active deal is in motion in your CRM — loop in the owner before reaching out.',
                            );
                          }
                        }
                        return (
                          <div className="flex flex-col gap-3">
                            {/* Recommended action card — pill + updated + rationale (design "Recommended action") */}
                            <div className="rounded-[14px] border border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.82)] px-3.5 py-3.5 shadow-[0_1px_4px_-2px_rgba(13,53,71,0.1)]">
                              <p className="font-manrope text-[13px] font-bold tracking-[-0.01em] text-[#0d3547]">Recommended action</p>
                              <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                                <span className={cn('inline-flex items-center rounded-full px-3 py-1 text-sm font-medium', config.className)}>
                                  {config.label}
                                </span>
                                {updatedAt ? (
                                  <span className="text-[11px] text-[#7d909a]">Updated {formatDate(updatedAt)}</span>
                                ) : null}
                              </div>
                              <div className="mt-3 space-y-3">
                            {action === 'monitor' &&
                              (isAccountMonitorAwaitingSignal(selectedAccount) ? (
                                <div className="space-y-3">
                                  <p className="text-[13.5px] leading-[1.55] text-[#0d3547]">
                                    <strong>{companyLabel}</strong> is a strong match on both the company and the best
                                    contact fit we have. Keep the account on your radar and wait for a buying signal
                                    before reaching out.
                                  </p>
                                </div>
                              ) : (
                                <div className="space-y-3">
                                  <p className="text-[13.5px] leading-[1.55] text-[#0d3547]">
                                    <strong>{companyLabel}</strong> sits in the watch band: company fit is promising but
                                    contact coverage or fit is not yet where you want it. Keep the account visible and
                                    revisit when enrichment or the company moves.
                                  </p>
                                  <div className="rounded-xl border border-arcova-teal/25 bg-arcova-teal/5 p-4">
                                    <button
                                      type="button"
                                      onClick={() => router.push(ROUTES.accounts)}
                                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-arcova-teal hover:text-arcova-teal/85 transition-colors"
                                    >
                                      View Signals
                                      <ChevronRight className="w-4 h-4" aria-hidden />
                                    </button>
                                  </div>
                                </div>
                              ))}

                            {action === 'reach_out' && (
                              <div className="space-y-3">
                                <p className="text-[13.5px] leading-[1.55] text-[#0d3547]">
                                  At least one contact shows strong fit and a tracked buying signal for{' '}
                                  <strong>{companyLabel}</strong>. It is a good moment for personalised outreach.
                                </p>
                                <p className="text-[13.5px] leading-[1.55] text-[#4a6470]">
                                  Lead with relevance to their role and therapeutic focus, and tie your message to
                                  signals or milestones when you can.
                                </p>
                                <button
                                  type="button"
                                  onClick={() => handleAccountReachOut(selectedAccount)}
                                  disabled={reachOutLoadingId === selectedAccount.id}
                                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-arcova-teal/30 bg-arcova-teal/5 px-4 py-2.5 text-sm font-semibold text-[#0a7b88] transition-colors hover:bg-arcova-teal/10 disabled:opacity-60"
                                >
                                  Choose a contact
                                  <ChevronRight className="h-4 w-4" aria-hidden />
                                </button>
                              </div>
                            )}

                            {action === 'send_outreach' && (
                              <div className="space-y-3">
                                <p className="text-[13.5px] leading-[1.55] text-[#0d3547]">
                                  An outreach sequence is staged for the team at <strong>{companyLabel}</strong> but
                                  hasn&apos;t been sent yet. Review the draft and send it when you&apos;re ready.
                                </p>
                                <button
                                  type="button"
                                  onClick={() => router.push(ROUTES.outreach)}
                                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#11526a] to-[#0d3547] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_-10px_rgba(13,53,71,0.6)] transition-[filter] hover:brightness-110"
                                >
                                  Open outreach
                                  <ChevronRight className="h-4 w-4" aria-hidden />
                                </button>
                              </div>
                            )}

                            {action === 'source_contact' && (
                              <div className="space-y-3">
                                {selectedAccount.contact_count === 0 ? (
                                  <>
                                    <p className="text-[13.5px] leading-[1.55] text-[#0d3547]">
                                      <strong>{companyLabel}</strong> has no contacts on file yet. Source contacts to
                                      start working this company.
                                    </p>
                                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                                      <p className="text-[12.5px] leading-[1.5] text-amber-800">
                                        Open the Data page to source contacts here. This company and ICP context are
                                        passed through, and you confirm any credit spend before it runs.
                                      </p>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <p className="text-[13.5px] leading-[1.55] text-[#0d3547]">
                                      <strong>{companyLabel}</strong> is a strong ICP fit, but the contacts on file are not
                                      the right personas to approach yet. Source a better-matched contact before you reach
                                      out.
                                    </p>
                                    <p className="text-[13.5px] leading-[1.55] text-[#4a6470]">
                                      Open the Data page to request more contacts for this company. This company and ICP
                                      context are passed through so the agent can help you queue the right acquisition
                                      job.
                                    </p>
                                  </>
                                )}
                                <div className="rounded-xl border border-arcova-teal/25 bg-arcova-teal/5 p-4">
                                  <button
                                    type="button"
                                    onClick={() => openContactAcquisition(selectedAccount)}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-arcova-teal/30 bg-white px-4 py-2.5 text-sm font-semibold text-arcova-teal transition-colors hover:bg-arcova-teal/5"
                                  >
                                    <Users className="h-4 w-4" />
                                    Find contacts
                                  </button>
                                </div>
                              </div>
                            )}

                            {action === 'deprioritize' && (
                              <div className="space-y-3">
                                <p className="text-[13.5px] leading-[1.55] text-[#0d3547]">
                                  Company or contact fit for <strong>{companyLabel}</strong> sits below your
                                  thresholds. Leave this one aside for now.
                                </p>
                                <p className="text-[13.5px] leading-[1.55] text-[#4a6470]">
                                  This does not mean they are permanently out. If their situation changes or you revisit
                                  your ICP criteria, they may score higher in a future run.
                                </p>
                              </div>
                            )}
                              </div>
                            </div>

                            {/* Why this action — bullet rationale (design "Why this action" card) */}
                            <div className="rounded-[14px] border border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.82)] px-3.5 py-3.5 shadow-[0_1px_4px_-2px_rgba(13,53,71,0.1)]">
                              <p className="font-manrope text-[13px] font-bold tracking-[-0.01em] text-[#0d3547]">Why this action</p>
                              <ul className="mt-3 flex flex-col gap-2.5">
                                {whyBullets.map((b, i) => (
                                  <li key={i} className="flex gap-2.5 text-[13.5px] leading-[1.45] text-[#4a6470]">
                                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-arcova-teal" />
                                    <span>{b}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        );
                      })()}

                      {panelMode === 'details' && (() => {
                        const aboutText = selectedAccount.bio_summary || selectedAccount.description || null;
                        const hasFirmographics = !!(
                          selectedAccount.employee_count != null ||
                          selectedAccount.employee_range ||
                          selectedAccount.founded_year != null ||
                          selectedAccount.headquarters_city ||
                          selectedAccount.headquarters_state ||
                          selectedAccount.headquarters_country
                        );
                        const hasFunding = !!(selectedAccount.funding_stage || selectedAccount.funding_status_label || selectedAccount.total_funding_usd != null || selectedAccount.latest_funding_date);
                        // Banner branches on the dedicated company-enrichment job state
                        // (mirrors the contacts pattern):
                        //   running   → animated "Enriching…" bar (real in-flight run;
                        //               markCompanyEnrichmentRunning always sets
                        //               started_at, so the bar has a real clock)
                        //   failed    → "Enrichment failed" + last error
                        //   never run → static "not enriched yet" prompt (NO animation,
                        //               button ENABLED so the user can trigger it)
                        //   succeeded → no banner
                        //
                        // IMPORTANT: `running` is gated strictly on status==='running'.
                        // We must NOT treat a bare stub (null/idle/cancelled with no
                        // last_enriched_at) as "running" — doing so rendered a fake
                        // animated bar stuck at the 8% floor (no started_at) AND
                        // disabled the Refresh button, so the user could never trigger
                        // enrichment. This also keeps the banner in lockstep with the
                        // poll's `anyCompanyEnrichmentRunning` (also status==='running').
                        const enrichmentStatus = selectedAccount.enrichment_refresh_status ?? null;
                        const enrichmentFailed = enrichmentStatus === 'failed';
                        const enrichmentRunning = enrichmentStatus === 'running' || enrichmentStatus === 'requested';
                        const neverEnriched =
                          !enrichmentRunning &&
                          !enrichmentFailed &&
                          !selectedAccount.last_enriched_at;
                        return (
                          <div className="space-y-3">
                            {neverEnriched && (
                              <div className="rounded-xl border border-[rgba(13,53,71,0.1)] bg-[rgba(13,53,71,0.03)] px-3.5 py-3">
                                <p className="text-[12.5px] leading-relaxed text-[#1f475a]">
                                  This company hasn&apos;t been enriched yet. Click{' '}
                                  <span className="font-semibold">Refresh enrichment</span> below to
                                  pull its details, fit score, and signals.
                                </p>
                              </div>
                            )}
                            {enrichmentFailed && (
                              <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3.5 py-3 flex gap-2.5">
                                <svg className="mt-0.5 w-4 h-4 shrink-0 text-amber-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                                  <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                                </svg>
                                <div className="min-w-0">
                                  <p className="text-[12.5px] font-semibold text-amber-800">Enrichment failed</p>
                                  <p className="mt-0.5 text-[12px] leading-relaxed text-amber-700">
                                    {selectedAccount.enrichment_refresh_last_error?.trim() ||
                                      "We couldn't pull firmographics for this company on the last run."}
                                    {' '}Try Refresh enrichment below.
                                  </p>
                                </div>
                              </div>
                            )}
                            {!enrichmentFailed && enrichmentRunning && (
                              <div className="rounded-xl border border-arcova-teal/25 bg-arcova-teal/5 px-3.5 py-3 flex gap-2.5">
                                <RotateCw className="mt-0.5 w-4 h-4 shrink-0 text-arcova-teal animate-spin" aria-hidden />
                                <CompanyEnrichmentProgress
                                  startedAt={selectedAccount.enrichment_refresh_started_at ?? null}
                                />
                              </div>
                            )}
                            {getAccountRowAction(selectedAccount) === 'monitor' && (
                              <div className="rounded-xl border border-arcova-teal/25 bg-arcova-teal/5 p-4 space-y-2">
                                <p className="text-[13px] leading-snug text-[#0d3547]">
                                  This account is on Monitor. Review signals to see activity before you reach out.
                                </p>
                                <button
                                  type="button"
                                  onClick={() => router.push(ROUTES.accounts)}
                                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-arcova-teal hover:text-arcova-teal/85 transition-colors"
                                >
                                  Review signals
                                  <ChevronRight className="w-4 h-4" aria-hidden />
                                </button>
                              </div>
                            )}
                            {/* Data source / enrichment box is rendered at the BOTTOM of the
                                Details tab (after all segments) — see below. */}

                            {/* About — profile summary + tagline (design "About" card) */}
                            {(aboutText || selectedAccount.tagline) && (
                              <DetailCard title="About" open={detailPanelOpen.about} onToggle={() => toggleDetail('about')}>
                                <div className="space-y-3">
                                  {aboutText && (
                                    <p className="text-[13.5px] leading-[1.55] text-[#4a6470]">{aboutText}</p>
                                  )}
                                  {selectedAccount.tagline && (
                                    <EyebrowField label="Tagline">{selectedAccount.tagline}</EyebrowField>
                                  )}
                                </div>
                              </DetailCard>
                            )}

                            {/* Classification — company type + taxonomy tag-pills (design "Classification" card) */}
                            {(selectedAccount.company_type ||
                              selectedAccount.sub_industry ||
                              selectedAccount.platform_category ||
                              (selectedAccount.therapeutic_areas || []).length > 0 ||
                              (selectedAccount.modalities || []).length > 0 ||
                              (selectedAccount.development_stages || []).length > 0 ||
                              (selectedAccount.customer_therapeutic_areas || []).length > 0 ||
                              (selectedAccount.customer_modalities || []).length > 0 ||
                              (selectedAccount.customer_development_stages || []).length > 0) && (
                              <DetailCard title="Classification" open={detailPanelOpen.classification} onToggle={() => toggleDetail('classification')}>
                                <div className="space-y-3.5">
                                  {selectedAccount.company_type && (
                                    <div>
                                      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7d909a]">Company type</p>
                                      <TagPillCluster items={[selectedAccount.company_type]} />
                                    </div>
                                  )}
                                  {/* Raw Apollo `industry` intentionally hidden — it's free-text,
                                      not an ICP/taxonomy criterion (company_type pill covers it). */}
                                  {selectedAccount.sub_industry && (
                                    <EyebrowField label="Sub-industry">{selectedAccount.sub_industry}</EyebrowField>
                                  )}
                                  {selectedAccount.platform_category && (
                                    <EyebrowField label="Platform category">{selectedAccount.platform_category}</EyebrowField>
                                  )}
                                  {(selectedAccount.therapeutic_areas || []).length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7d909a]">Therapeutic areas</p>
                                      <TagPillCluster items={selectedAccount.therapeutic_areas || []} />
                                    </div>
                                  )}
                                  {(selectedAccount.modalities || []).length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7d909a]">Modalities</p>
                                      <TagPillCluster items={selectedAccount.modalities || []} />
                                    </div>
                                  )}
                                  {(selectedAccount.development_stages || []).length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7d909a]">Development stage</p>
                                      <TagPillCluster items={selectedAccount.development_stages || []} />
                                    </div>
                                  )}
                                  {/* Customer-facing taxonomy: who a CRO/vendor/services account serves.
                                      Shown when the firm's own taxonomy above is empty (or alongside it). */}
                                  {(selectedAccount.customer_therapeutic_areas || []).length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7d909a]">Therapeutic areas served</p>
                                      <TagPillCluster items={selectedAccount.customer_therapeutic_areas || []} />
                                    </div>
                                  )}
                                  {(selectedAccount.customer_modalities || []).length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7d909a]">Modalities served</p>
                                      <TagPillCluster items={selectedAccount.customer_modalities || []} />
                                    </div>
                                  )}
                                  {(selectedAccount.customer_development_stages || []).length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7d909a]">Development stages served</p>
                                      <TagPillCluster items={selectedAccount.customer_development_stages || []} />
                                    </div>
                                  )}
                                </div>
                              </DetailCard>
                            )}

                            {/* Firmographics */}
                            {hasFirmographics && (
                              <DetailCard title="Firmographics" open={detailPanelOpen.firmographics} onToggle={() => toggleDetail('firmographics')}>
                                <div className="grid grid-cols-2 items-start gap-x-4 gap-y-3.5">
                                  {(selectedAccount.employee_count != null || selectedAccount.employee_range) && (
                                    <EyebrowField label="Employees">
                                      {selectedAccount.employee_count != null ? selectedAccount.employee_count.toLocaleString() : selectedAccount.employee_range}
                                    </EyebrowField>
                                  )}
                                  {/* Size bucket intentionally NOT shown here — it's an ICP
                                      criterion, not an account firmographic. */}
                                  {selectedAccount.founded_year != null && (
                                    <EyebrowField label="Founded">{selectedAccount.founded_year}</EyebrowField>
                                  )}
                                  {selectedAccount.headquarters_city && (
                                    <EyebrowField label="City">{selectedAccount.headquarters_city}</EyebrowField>
                                  )}
                                  {selectedAccount.headquarters_state && (
                                    <EyebrowField label="State">{selectedAccount.headquarters_state}</EyebrowField>
                                  )}
                                  {selectedAccount.headquarters_country && (
                                    <EyebrowField label="Country">{selectedAccount.headquarters_country}</EyebrowField>
                                  )}
                                </div>
                              </DetailCard>
                            )}

                            {/* Funding */}
                            {hasFunding && (
                              <DetailCard title="Funding" open={detailPanelOpen.funding} onToggle={() => toggleDetail('funding')}>
                                <div className="grid grid-cols-2 items-start gap-x-4 gap-y-3.5">
                                  {(selectedAccount.funding_stage || selectedAccount.funding_status_label) && (
                                    <EyebrowField label="Stage">{selectedAccount.funding_stage ?? selectedAccount.funding_status_label}</EyebrowField>
                                  )}
                                  {selectedAccount.total_funding_usd != null && (
                                    <EyebrowField label="Total raised">{formatCurrencyShort(selectedAccount.total_funding_usd)}</EyebrowField>
                                  )}
                                  {selectedAccount.latest_funding_date && (
                                    <EyebrowField label="Latest round">{formatDate(selectedAccount.latest_funding_date)}</EyebrowField>
                                  )}
                                </div>
                                {selectedAccount.funding_resolution_summary && (
                                  <p className="mt-3.5 text-[13px] leading-[1.55] text-[#4a6470]">{selectedAccount.funding_resolution_summary}</p>
                                )}
                              </DetailCard>
                            )}

                            {/* Products */}
                            {(() => {
                              const hasProducts = (selectedAccount.products_services?.length ?? 0) > 0;
                              const hasSpecialties = (selectedAccount.specialties?.length ?? 0) > 0;
                              if (!hasProducts && !hasSpecialties) return null;
                              const items = hasProducts ? selectedAccount.products_services! : selectedAccount.specialties!;
                              return (
                                <DetailCard title="Products" open={detailPanelOpen.products} onToggle={() => toggleDetail('products')}>
                                  <EntityRows items={items} />
                                </DetailCard>
                              );
                            })()}

                            {/* Services */}
                            {(selectedAccount.services?.length ?? 0) > 0 && (
                              <DetailCard title="Services" open={detailPanelOpen.services} onToggle={() => toggleDetail('services')}>
                                <EntityRows items={selectedAccount.services!} />
                              </DetailCard>
                            )}

                            {/* Technology */}
                            {(selectedAccount.technologies?.length ?? 0) > 0 && (
                              <DetailCard title="Technology" open={detailPanelOpen.technology} onToggle={() => toggleDetail('technology')}>
                                <EntityRows items={selectedAccount.technologies!} />
                              </DetailCard>
                            )}

                            {/* Data source / enrichment box — pinned to the BOTTOM of the
                                Details tab (matches /contacts). Holds Type/Imported +
                                the Refresh / Stop enrichment controls. */}
                            <div className="rounded-xl border border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.82)] px-3 py-3 shadow-[0_1px_4px_-2px_rgba(13,53,71,0.08)]">
                              <p className="mb-3 font-manrope text-[13px] font-bold tracking-[-0.01em] text-[#0d3547]">Data source</p>
                              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                                <div className="min-w-0">
                                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7d909a]">Type</p>
                                  <p className="mt-2 text-sm leading-snug text-[#0d3547]">{selectedAccount.data_provenance_type}</p>
                                </div>
                                <div className="min-w-0">
                                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7d909a]">Imported</p>
                                  <p className="mt-2 text-sm leading-snug text-[#0d3547]">
                                    {formatProvenanceImportedAt(selectedAccount.data_provenance_imported_at)}
                                  </p>
                                </div>
                              </div>

                              <div className="mt-4 space-y-3 border-t border-[rgba(13,53,71,0.06)] pt-4">
                                {selectedAccount.last_enriched_at && (
                                  <p className="text-xs leading-snug text-[#4a6470]">
                                    Last updated {formatDate(selectedAccount.last_enriched_at)}
                                  </p>
                                )}
                                <p className="text-xs leading-relaxed text-[#6B7280]">
                                  You can refresh this enrichment again whenever you need updated data.
                                </p>
                                {(() => {
                                  // While a run is in flight (the request OR the async
                                  // after() job, until the 5s poll flips the row), show a
                                  // disabled "Enriching…" indicator PLUS an enabled "Stop"
                                  // control (mirrors the contacts stop button). Otherwise
                                  // the normal "Refresh enrichment" trigger.
                                  const isWorking =
                                    refreshingCompanyId === selectedAccount.id || enrichmentRunning;
                                  if (isWorking) {
                                    return (
                                      <div className="flex items-center gap-2">
                                        <span className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-[#1F2937] opacity-60">
                                          <RotateCw className="w-4 h-4 text-[#1F2937] animate-spin" />
                                          Enriching…
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => stopCompanyEnrichment(selectedAccount.id)}
                                          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
                                        >
                                          <X className="w-4 h-4" />
                                          Stop
                                        </button>
                                      </div>
                                    );
                                  }
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => rerunCompanyEnrichment(selectedAccount.id)}
                                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-[#1F2937] transition-colors hover:bg-gray-50"
                                    >
                                      <RotateCw className="w-4 h-4 text-[#1F2937]" />
                                      Refresh enrichment
                                    </button>
                                  );
                                })()}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {panelMode === 'reachout' && (
                        <div className="space-y-3">
                          <p className="text-[13.5px] leading-[1.55] text-[#0d3547]">
                            Choose a contact to reach out to at{' '}
                            <strong>{selectedAccount.company_name || selectedAccount.domain || 'this company'}</strong>.
                            Ranked by priority score — the strongest opportunity first.
                          </p>
                          <div className="space-y-2">
                            {reachOutCandidates.map((contact, idx) => {
                              const title =
                                contact.resolved_current_job_title || contact.job_title || null;
                              const priorityPct = formatPct(contact.priority_score);
                              return (
                                <button
                                  key={contact.id}
                                  type="button"
                                  onClick={() => navigateToContactReachOut(contact.id)}
                                  className="group w-full rounded-xl border border-gray-100 bg-gray-50/70 px-3.5 py-3 text-left transition-colors hover:border-arcova-teal/40 hover:bg-arcova-teal/5"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-2.5">
                                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-arcova-teal/10 text-[11px] font-semibold tabular-nums text-arcova-teal">
                                        {idx + 1}
                                      </span>
                                      <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-gray-900">
                                          {contact.full_name || '—'}
                                        </p>
                                        {title && (
                                          <p className="truncate text-xs text-gray-500 mt-0.5">{title}</p>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                      {priorityPct != null && (
                                        <span className="text-right">
                                          <span className="block text-sm font-semibold tabular-nums text-gray-900">
                                            {priorityPct}
                                          </span>
                                          <span className="block text-[10px] uppercase tracking-[0.12em] text-gray-400">
                                            priority
                                          </span>
                                        </span>
                                      )}
                                      <span className="text-xs font-semibold text-arcova-teal opacity-0 transition-opacity group-hover:opacity-100">
                                        Reach out →
                                      </span>
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {panelMode === 'contacts' && (
                        <div className="space-y-3">
                          {loadingContacts ? (
                            <div className="flex justify-center py-12">
                              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-arcova-teal" />
                            </div>
                          ) : contacts.length === 0 ? (
                            <div className="space-y-3 py-2">
                              {selectedAccount.contact_count === 0 ? (
                                <>
                                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
                                    <p className="text-[13px] font-semibold text-amber-900 mb-1">No contacts yet</p>
                                    <p className="text-[12.5px] leading-[1.5] text-amber-800">
                                      This company has no contacts on file. Source contacts to start working it —
                                      you choose when to spend credits.
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => openContactAcquisition(selectedAccount)}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-arcova-teal/30 bg-white px-3 py-2.5 text-sm font-semibold text-arcova-teal hover:bg-arcova-teal/5 transition-colors"
                                  >
                                    <Users className="h-3.5 w-3.5" />
                                    Find contacts
                                  </button>
                                </>
                              ) : (
                                <p className="text-sm text-gray-400 text-center py-12">No contacts found.</p>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {contacts.map((contact) => {
                                const title = contact.resolved_current_job_title || contact.job_title || null;
                                const fitPct = formatPct(contact.contact_fit_score);
                                const fit = contactFitCache[contact.id];
                                const fitLoading = contactFitLoadingIds.has(contact.id);
                                return (
                                  <div
                                    key={contact.id}
                                    className="overflow-hidden rounded-[14px] border border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.82)] shadow-[0_1px_4px_-2px_rgba(13,53,71,0.1)]"
                                  >
                                    {/* Contact header (design .cocard) */}
                                    <div className="px-3.5 py-3.5">
                                      <div className="flex items-start justify-between gap-2.5">
                                        <div className="min-w-0">
                                          <p className="truncate font-manrope text-[15px] font-bold tracking-[-0.01em] text-[#0d3547]">{contact.full_name || '—'}</p>
                                          {title && <p className="mt-0.5 text-[12.5px] leading-[1.35] text-[#4a6470]">{title}</p>}
                                          {contact.email && <p className="mt-1 break-all text-[12.5px] text-[#7d909a]">{contact.email}</p>}
                                        </div>
                                        {fitPct && (
                                          <span className="shrink-0 font-manrope text-base font-bold tabular-nums text-[#0d3547]">{fitPct}</span>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => router.push(withQuery(ROUTES.contacts, `lead=${encodeURIComponent(contact.id)}`))}
                                        className="mt-3 inline-flex items-center rounded-[9px] border border-arcova-teal/30 bg-arcova-teal/5 px-3 py-1.5 text-[12.5px] font-semibold text-[#0a7b88] transition-colors hover:bg-arcova-teal/10"
                                      >
                                        View contact
                                      </button>
                                    </div>

                                    {/* Fit breakdown — always visible */}
                                    <div className="border-t border-[rgba(13,53,71,0.06)] px-3.5 py-3.5 space-y-2.5">
                                      {fitLoading ? (
                                        <p className="text-xs text-gray-400">Loading fit…</p>
                                      ) : fit?.winning_breakdown ? (
                                        <>
                                          {CONTACT_FIT_COMPONENT_ORDER.map((key) => {
                                            const component = fit.winning_breakdown!.components[key];
                                            if (!component?.active) return null;
                                            const componentPct = formatPct(component.score01);
                                            const showPill = Boolean(component.matchedValue) && component.matchStatus !== 'mismatch';
                                            const detailText: string | null = (() => {
                                              if (component.matchStatus === 'exact') return 'Exact match';
                                              if (key === 'seniority' && contact.seniority_level) return `Contact is ${contact.seniority_level}. This is not the target buying group for this ICP`;
                                              return component.detail || null;
                                            })();
                                            return (
                                              <div key={key}>
                                                <div className="flex items-center justify-between gap-2">
                                                  <p className="text-xs font-medium text-gray-700">{component.label}</p>
                                                  {componentPct && <span className="text-[11px] text-slate-500 shrink-0">{componentPct}</span>}
                                                </div>
                                                <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200">
                                                  <div
                                                    className={`h-full rounded-full ${component.available ? 'bg-arcova-teal' : 'bg-slate-300'}`}
                                                    style={{ width: `${Math.max(0, Math.min(100, Math.round(component.score01 * 100)))}%` }}
                                                  />
                                                </div>
                                                {(showPill || detailText) && (
                                                  <div className="mt-1.5 space-y-1">
                                                    {showPill && (
                                                      <span className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2 py-0.5 text-[11px] font-medium text-arcova-teal">
                                                        {component.matchedValue}
                                                      </span>
                                                    )}
                                                    {detailText && <p className="text-[11px] leading-relaxed text-gray-400">{detailText}</p>}
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </>
                                      ) : (
                                        <p className="text-xs text-gray-400">No contact fit data yet.</p>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {panelMode === 'signals' && (
                        <EntitySignalsList
                          companyId={selectedAccount.id}
                          grouped
                          effectiveReadinessScore={selectedAccount.readiness_score ?? null}
                          crmCappedReason={(() => {
                            const companyLabel = selectedAccount.company_name || 'This company';
                            // Only explain the CRM cap while the suppression cooldown is active;
                            // past it the account is no longer held back by the old deal.
                            if (!isCrmSuppressed(selectedAccount.crm_status ?? null, selectedAccount.crm_closed_at ?? null)) {
                              return null;
                            }
                            if (selectedAccount.crm_status === 'customer') {
                              return `${companyLabel} is a closed-won company. Readiness is low as you have already sold to this company — it becomes eligible again about a year after close for renewal or expansion.`;
                            }
                            if (selectedAccount.crm_status === 'dormant') {
                              return `${companyLabel} is a closed-lost company. Readiness is low because the last deal was lost — it can resurface after ~6 months if a new signal fires.`;
                            }
                            return null;
                          })()}
                        />
                      )}

                      {panelMode === 'crm' && (
                        <div className="space-y-4">
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[#ff7a59]" />
                              <span className="font-manrope text-[13px] font-bold tracking-[-0.01em] text-[#0d3547]">HubSpot CRM</span>
                              {hubspotCrmPanel.data?.deals.length ? (
                                <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-[#7d909a]">
                                  <span className="inline-flex h-[7px] w-[7px] rounded-full bg-[#2d8a8a]" />
                                  Connected
                                </span>
                              ) : null}
                            </div>
                            <p className="text-[13.5px] leading-[1.55] text-[#4a6470]">
                              Every HubSpot deal tied to a contact at this company, rolled up in one view.
                            </p>
                          </div>

                          {hubspotCrmPanel.loading ? (
                            <div className="rounded-xl border border-[rgba(13,53,71,0.08)] bg-white/80 px-4 py-4">
                              <p className="text-sm leading-snug text-[#4a6470]">Loading HubSpot CRM…</p>
                            </div>
                          ) : hubspotCrmPanel.error ? (
                            <div className="rounded-xl border border-[#ffd8c7] bg-[#fff7f3] px-4 py-4">
                              <p className="text-sm leading-snug text-[#b45309]">{hubspotCrmPanel.error}</p>
                            </div>
                          ) : hubspotCrmPanel.data?.deals.length ? (
                            <div className="space-y-3">
                              {hubspotCrmPanel.data.deals.map((deal) => {
                                const arcovaDomain = hubspotCrmPanel.data?.company_domain ?? selectedAccount.domain ?? null;
                                const hasMismatch =
                                  Boolean(deal.hubspot_company_domain) &&
                                  Boolean(arcovaDomain) &&
                                  deal.hubspot_company_domain !== arcovaDomain;
                                const stageLabel = formatHubSpotStageLabel(deal.deal_stage) ?? '—';

                                return (
                                  <div
                                    key={deal.hubspot_deal_id}
                                    className="rounded-2xl border border-[rgba(13,53,71,0.08)] bg-white/90 px-4 py-4 shadow-[0_1px_4px_-2px_rgba(13,53,71,0.08)]"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="font-manrope text-[15px] font-bold tracking-[-0.01em] text-[#0d3547]">
                                          {deal.deal_name || 'HubSpot deal'}
                                        </p>
                                        <p className="mt-1 text-xs text-[#7d909a]">
                                          HubSpot company:{' '}
                                          <span className="font-medium text-[#4a6470]">
                                            {deal.hubspot_company_name || deal.hubspot_company_domain || '—'}
                                          </span>
                                        </p>
                                      </div>
                                      <span className="inline-flex shrink-0 items-center rounded-full bg-[#fff1ec] px-2.5 py-1 text-[11px] font-semibold text-[#cc5b3f]">
                                        {stageLabel}
                                      </span>
                                    </div>

                                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                                      <div>
                                        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7d909a]">
                                          Amount
                                        </p>
                                        <p className="mt-1 text-sm leading-snug text-[#0d3547]">
                                          {formatUsdValue(deal.amount) || '—'}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7d909a]">
                                          Close date
                                        </p>
                                        <p className="mt-1 text-sm leading-snug text-[#0d3547]">
                                          {formatLastUpdated(deal.close_date)}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7d909a]">
                                          Last synced
                                        </p>
                                        <p className="mt-1 text-sm leading-snug text-[#0d3547]">
                                          {formatLastUpdated(deal.synced_at)}
                                        </p>
                                      </div>
                                    </div>

                                    {deal.contacts.length > 0 && (
                                      <div className="mt-3 border-t border-[rgba(13,53,71,0.06)] pt-3">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7d909a]">
                                          Involved contacts
                                        </p>
                                        <ul className="mt-2 space-y-1">
                                          {deal.contacts.map((c, idx) => (
                                            <li
                                              key={`${deal.hubspot_deal_id}:${c.arcova_contact_id ?? c.email ?? idx}`}
                                              className="text-xs text-[#4a6470]"
                                            >
                                              <span className="font-medium text-[#0d3547]">
                                                {c.full_name || c.email || 'Unknown contact'}
                                              </span>
                                              {c.email && c.full_name ? (
                                                <span className="text-[#7d909a]"> · {c.email}</span>
                                              ) : null}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}

                                    {hasMismatch && (
                                      <div className="mt-3 rounded-lg border border-[#ffd8c7] bg-[#fff7f3] px-3 py-2">
                                        <p className="text-xs leading-snug text-[#b45309]">
                                          HubSpot company domain ({deal.hubspot_company_domain}) doesn't match the Arcova
                                          company ({arcovaDomain}).
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="rounded-xl border border-[rgba(13,53,71,0.08)] bg-white/80 px-4 py-4">
                              <p className="text-sm leading-snug text-[#4a6470]">
                                No HubSpot deal activity on this company yet.
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {panelMode === 'priority' && (() => {
                        const fitNorm = (() => {
                          const v = selectedAccount.company_fit_score;
                          if (v == null || !Number.isFinite(v)) return null;
                          return v > 1 ? v / 100 : v;
                        })();
                        const readinessNorm = selectedAccount.readiness_score ?? null;
                        const priorityNorm = selectedAccount.priority_score ?? null;
                        const bestContactFitNorm = selectedAccount.best_contact_fit ?? null;
                        const priorityPct = percentDisplayNumber(priorityNorm);
                        const fitPct = percentDisplayNumber(fitNorm);
                        const readinessPct = percentDisplayNumber(readinessNorm);
                        const bestContactFitPct = percentDisplayNumber(bestContactFitNorm);
                        // Design score-row: mini ring + label + chevron, rows divided inside one card.
                        const ScoreRow = ({
                          label,
                          pct,
                          arcColor,
                          onOpen,
                          divider,
                        }: {
                          label: string;
                          pct: number | null;
                          arcColor: string;
                          onOpen: () => void;
                          divider?: boolean;
                        }) => (
                          <button
                            type="button"
                            onClick={onOpen}
                            className={cn(
                              'flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-white/70',
                              divider && 'border-t border-[rgba(13,53,71,0.06)]',
                            )}
                          >
                            <AnimatedCircularProgressBar
                              value={pct ?? 0}
                              gaugePrimaryColor={arcColor}
                              gaugeSecondaryColor="rgba(13,53,71,0.09)"
                              animateOnMount
                              deferAnimationMs={160}
                              label={
                                <span className="block text-[11px] font-bold leading-snug tabular-nums text-[#0d3547]">
                                  {pct != null ? pct : '—'}
                                </span>
                              }
                              className="size-9 shrink-0 [--transition-length:0.95s]"
                            />
                            <span className="flex-1 text-[13.5px] font-semibold text-[#0d3547]">{label}</span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-[#b6c2c8]" aria-hidden />
                          </button>
                        );
                        return (
                          <div className="space-y-3">
                            {/* Priority — large gauge hero with caption + supporting line */}
                            <div className="flex flex-col items-center justify-center rounded-[14px] border border-[rgba(13,53,71,0.06)] bg-[rgba(246,250,250,0.7)] px-4 py-6 text-center">
                              <AnimatedCircularProgressBar
                                value={priorityPct ?? 0}
                                gaugePrimaryColor={priorityScoreArcColor(priorityPct)}
                                gaugeSecondaryColor="rgba(13,53,71,0.09)"
                                animateOnMount
                                deferAnimationMs={160}
                                label={
                                  <span className="block text-xl font-semibold leading-snug tabular-nums text-[#0d3547]">
                                    {priorityPct != null ? priorityPct : '—'}
                                  </span>
                                }
                                className="size-24 [--transition-length:0.95s]"
                              />
                              <p className="mt-3 font-manrope text-[15px] font-bold tracking-[-0.01em] text-[#0d3547]">
                                Priority score
                              </p>
                              <p className="mt-2 text-[12.5px] leading-[1.55] text-[#1f475a]">
                                Priority blends this company&apos;s fit with its best mapped contact and live readiness signals.
                              </p>
                            </div>

                            {/* Score breakdown — fit / best contact fit / readiness, one card */}
                            <div className="overflow-hidden rounded-[14px] border border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.82)] shadow-[0_1px_4px_-2px_rgba(13,53,71,0.1)]">
                              <ScoreRow
                                label="Company fit"
                                pct={fitPct}
                                arcColor={fitScoreArcColor(fitPct)}
                                onOpen={() => setPanelMode('fit')}
                              />
                              <ScoreRow
                                label="Best contact fit"
                                pct={bestContactFitPct}
                                arcColor={fitScoreArcColor(bestContactFitPct)}
                                onOpen={() => setPanelMode('contacts')}
                                divider
                              />
                              <ScoreRow
                                label="Readiness score"
                                pct={readinessPct}
                                arcColor={fitScoreArcColor(readinessPct)}
                                onOpen={() => setPanelMode('signals')}
                                divider
                              />
                            </div>
                          </div>
                        );
                      })()}

                    </div>

                    {/* Panel footer — persistent Edit / Archive company on every tab
                        (matches the Companies Side Panel design's drawer footer).
                        Refresh enrichment lives in the Details tab's Data source card. */}
                    {panelMode !== 'reachout' && (
                      <div className="px-4 py-4 border-t border-[rgba(13,53,71,0.08)]">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setEditAccountOpen(true)}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Edit company
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const label = selectedAccount.company_name || selectedAccount.domain || 'this company';
                              const ok = window.confirm(
                                `Are you sure you want to archive ${label}? It and its contacts will be hidden from active views and will not be re-imported or re-enriched automatically.`,
                              );
                              if (!ok) return;

                              try {
                                const response = await fetch(`/api/companies/${selectedAccount.id}`, {
                                  method: 'DELETE',
                                });
                                const result = await response.json();
                                if (!response.ok) {
                                  throw new Error(result.error || 'Failed to archive company.');
                                }

                                invalidateAccountCaches(selectedAccount.id);
                                setAccounts((prev) => prev.filter((account) => account.id !== selectedAccount.id));
                                setSelectedAccountId(null);
                              } catch (error) {
                                console.error('Error archiving company:', error);
                                window.alert(error instanceof Error ? error.message : 'Could not archive company.');
                              }
                            }}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Archive company
                          </button>
                        </div>
                      </div>
                    )}
                  </aside>
                )}

                {selectedAccount && (
                  <AccountEditDialog
                    account={selectedAccount as Parameters<typeof AccountEditDialog>[0]['account']}
                    open={editAccountOpen}
                    onClose={() => setEditAccountOpen(false)}
                    onSaved={() => {
                      // Edit changed user_overrides — invalidate ALL cache layers
                      // (list + per-id detail module cache + detail state) then refetch.
                      // The old code missed invalidating the /api/companies/[id] module
                      // cache, so the detail effect refetched stale overrides.
                      const editedId = selectedAccountId;
                      if (editedId) {
                        invalidateAccountCaches(editedId);
                        // Keep the just-edited account SELECTED after the refetch. Without
                        // this, fetchAccounts() resets selection to null whenever the edited
                        // account isn't in the refetched page (an override edit can change
                        // its fit → re-sort/filter drops it off the page). Setting the focus
                        // ref makes fetchAccounts include it (companyId param) and re-select it.
                        accountsDeepLinkCompanyIdRef.current = editedId;
                      }
                      fetchAccounts();
                    }}
                  />
                )}

                {/* Floating agent chat bar — sits at the TOP of the AgentPanel
                    column (above the company card) while a card is open. Uses the
                    shared `AgentChatBar` so it matches the side-panel agent input.
                    Submit dismisses the company card and forwards the text to the agent. */}
                {selectedAccountId && agentRect && !agentDocked && (
                  <div
                    ref={agentBarRef}
                    className={cn(
                      'fixed z-[51] flex items-center rounded-[1.3125rem] border border-arcova-teal/60 bg-[rgba(255,255,255,0.55)] px-3 py-2.5 shadow-[0_24px_60px_-32px_rgba(13,53,71,0.2)] ring-1 ring-arcova-teal/10 backdrop-blur-2xl backdrop-saturate-150',
                    )}
                    style={{
                      top: agentRect.top,
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
                        setSelectedAccountId(null);
                      }}
                      placeholder="Ask anything about your companies…"
                      className="w-full"
                    />
                    <button
                      type="button"
                      onClick={() => setAgentDocked(true)}
                      className="ml-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-arcova-teal/30 bg-white/70 text-arcova-teal transition-colors hover:bg-arcova-teal/5"
                      aria-label="Expand agent"
                      title="Open the agent above the panel"
                    >
                      <Maximize2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Agent panel (far right) ──
            Folds away (`invisible`) while a company card is open — the card
            overlays this column and the floating chat bar at the bottom takes
            over as the agent's surface. `invisible` keeps the column in layout
            so the agentRect tracker continues to measure its footprint. */}
        <AgentPanel
          className={cn(
            'accounts-agent-col min-[1280px]:pl-1.5',
            // While reviewing a company the agent is hidden by default (the floating
            // chat bar + full-height card take over). `invisible` keeps the column in
            // layout so agentRect keeps tracking its footprint.
            selectedAccountId && !agentDocked && 'invisible',
            // Docked: the agent shrinks to the TOP HALF and the card drops to the
            // bottom half (50/50 split). self-start stops the grid stretching it.
            selectedAccountId && agentDocked && 'z-[41] self-start max-h-[calc(50vh-1.25rem)] overflow-hidden',
          )}
          // Reserve the full expanded column width while a company card is open even
          // though the accounts page opens with the agent collapsed. Without this the
          // collapsed column is 0-wide, agentRect nulls out, and the card falls back
          // to a skinny fixed overlay in front of the table. Forcing the expanded
          // layout makes the table reflow (push) and the card mirror the real, wider
          // column — matching the "open agent, then click a row" path.
          forceExpandedLayout={!!selectedAccountId}
          page="accounts"
          pendingMessage={agentTrigger}
          pageContext={
            selectedAccount
              ? {
                  leadsView: 'accounts',
                  selectedAccount: {
                    id: selectedAccount.id,
                    name: selectedAccount.company_name || selectedAccount.domain,
                    matchedIcpId: selectedAccount.matched_icp_id,
                    bestContactFit: selectedAccount.best_contact_fit,
                    contactCount: selectedAccount.contact_count,
                  },
                }
              : { leadsView: 'accounts' }
          }
          onTableFilter={handleTableFilter}
          onTableClear={handleQueryClear}
        />
      </div>
    </div>
  );
}
