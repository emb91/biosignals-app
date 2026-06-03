'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { AgentPanel, type AgentPendingMessage, type AgentTableFilter } from '@/components/AgentPanel';
import { AgentChatBar } from '@/components/AgentChatBar';
import { useScrollMask } from '@/hooks/use-scroll-mask';
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
  ExternalLink,
  Pencil,
  RotateCw,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { cachedJson, invalidateCache } from '@/lib/page-fetch-cache';
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
  LEAD_ACTION_PILL_CLASS,
  LEAD_ACTION_SORT_ORDER,
  SOURCE_COMPANY_MIN,
  SOURCE_CONTACT_MAX,
} from '@/lib/lead-action';
import { ROUTES, withQuery } from '@/lib/routes';
import { EntitySignalsList } from '@/components/EntitySignalsList';

const PAGE_SIZE = 50;

type AccountRow = {
  id: string;
  company_name: string | null;
  domain: string | null;
  website: string | null;
  logo_url: string | null;
  company_fit_score: number | null;
  company_fit_coverage: number | null;
  matched_icp_id: string | null;
  matched_icp_label: string | null;
  therapeutic_areas: string[] | null;
  modalities: string[] | null;
  development_stages: string[] | null;
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
  crm_status?: 'customer' | 'active' | 'dormant' | 'context_only' | 'none' | null;
  crm_deal_stage_label?: string | null;
  user_overrides?: Record<string, unknown> | null;
};

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
  seniority_level: string | null;
};

type PanelMode = 'details' | 'fit' | 'action' | 'contacts' | 'signals' | 'priority' | 'crm';

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
function TaxonomyPills({ items }: { items: string[] | null | undefined }) {
  const list = (items || []).filter(Boolean);
  if (list.length === 0) return <p className="text-xs text-gray-400">—</p>;
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((item) => (
        <span
          key={item}
          className="inline-flex rounded-full bg-arcova-teal/10 px-2 py-0.5 text-[11px] font-medium text-arcova-teal"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

const DEFAULT_COLUMNS: AccountQueryColumn[] = ['company', 'company_type', 'priority', 'contacts', 'crm_status', 'action'];
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

function pickAccountColumns(width: number): AccountQueryColumn[] {
  if (width >= 1280) return DEFAULT_COLUMNS;
  if (width < 640) return SMALL_COLUMNS;
  return MEDIUM_COLUMNS;
}

function useResponsiveAccountColumns(): AccountQueryColumn[] {
  // Initialize synchronously from `window.innerWidth` so there's no flash of the
  // wrong (default 5-col) template on first render — that flash caused the data
  // rows to render cells in the wrong column slots on initial paint at narrow widths.
  const [columns, setColumns] = useState<AccountQueryColumn[]>(() =>
    typeof window === 'undefined' ? DEFAULT_COLUMNS : pickAccountColumns(window.innerWidth),
  );

  useEffect(() => {
    const updateColumns = () => setColumns(pickAccountColumns(window.innerWidth));

    updateColumns();
    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, []);

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

export default function AccountsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
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
  const [tableSortCol, setTableSortCol] = useState<string | null>('priority');
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc');
  const [editAccountOpen, setEditAccountOpen] = useState(false);

  // Panel state
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  // Detail fetched per-selection from /api/accounts/[id]. Side panel reads
  // from the merged object so it has both the lean-list fields (computed
  // priority, crm status, etc.) AND the canonical detail fields (firmographics,
  // products, funding detail) without bloating the list payload.
  const [selectedAccountDetailById, setSelectedAccountDetailById] = useState<Record<string, Partial<AccountRow>>>({});
  const [panelMode, setPanelMode] = useState<PanelMode>('details');
  const [failedLogoByAccountId, setFailedLogoByAccountId] = useState<Record<string, true>>({});

  // Floating chat-bar value — shown while a company card is open (same pattern as
  // /leads/contacts). On submit we dismiss the company card and forward the text
  // to AgentPanel as a pending message; the agent expands back into view.
  const [agentChatBarValue, setAgentChatBarValue] = useState('');

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

  // Contacts panel
  const [contacts, setContacts] = useState<ContactAtCompany[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);

  // Detail panel accordion open state
  const [detailPanelOpen, setDetailPanelOpen] = useState({
    criteria: false,
    firmographics: false,
    funding: false,
    products: false,
    services: false,
    technology: false,
  });
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
      setDetailPanelOpen({
        criteria: true,
        firmographics: false,
        funding: false,
        products: false,
        services: false,
        technology: false,
      });
      return;
    }

    setDetailPanelOpen({
      criteria: false,
      firmographics: false,
      funding: false,
      products: false,
      services: false,
      technology: false,
    });
  }, [selectedAccountId]);

  // Fetch full detail for the selected account (firmographics, products,
  // funding detail, etc.) — these fields aren't in the lean list response.
  // Cached via the module-level fetch cache so re-selecting is instant.
  useEffect(() => {
    if (!selectedAccountId) return;
    if (selectedAccountDetailById[selectedAccountId]) return; // already loaded
    let cancelled = false;
    (async () => {
      try {
        const { data: result } = await cachedJson<{ data?: Partial<AccountRow> }>(
          `/api/accounts/${encodeURIComponent(selectedAccountId)}`,
        );
        if (cancelled || !result.data) return;
        setSelectedAccountDetailById((prev) => ({
          ...prev,
          [selectedAccountId]: result.data!,
        }));
      } catch (e) {
        console.error('Error fetching account detail:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId, selectedAccountDetailById]);

  useEffect(() => {
    if (!selectedAccountId) return;
    const selected = accounts.find((account) => account.id === selectedAccountId);
    if (!selected?.logo_url) return;
    setFailedLogoByAccountId((prev) => {
      if (!prev[selectedAccountId]) return prev;
      const next = { ...prev };
      delete next[selectedAccountId];
      return next;
    });
  }, [selectedAccountId, accounts]);

  // Company enrichment refresh
  const [refreshingCompanyId, setRefreshingCompanyId] = useState<string | null>(null);
  const rerunCompanyEnrichment = async (companyId: string) => {
    setRefreshingCompanyId(companyId);
    try {
      await fetch('/api/monitor-company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId }),
      });
      invalidateCache('/api/accounts');
      await fetchAccounts();
    } catch (err) {
      console.error('Error refreshing company enrichment:', err);
    } finally {
      setRefreshingCompanyId(null);
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

  const fetchAccounts = useCallback(async () => {
    if (!user) return;
    const focusId = accountsDeepLinkCompanyIdRef.current;
    setLoadingAccounts(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (focusId) params.set('companyId', focusId);
      // Module-level cache: tab-switch-and-back doesn't refetch within TTL.
      // After mutations (edit/archive) we call invalidateCache('/api/accounts').
      const { data: result } = await cachedJson<{
        data?: AccountRow[];
        total?: number;
        page?: number;
      }>(`/api/accounts?${params}`);
      const next: AccountRow[] = result.data || [];
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
      setLoadingAccounts(false);
    }
  }, [user, page]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

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
        const response = await fetch(`/api/accounts/${encodeURIComponent(selectedAccountId)}/hubspot-crm`);
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
    fetch(`/api/leads?companyId=${encodeURIComponent(selectedAccountId)}&pageSize=100`)
      .then((r) => r.json())
      .then((result) => {
        if (!cancelled) setContacts(result.data || []);
      })
      .catch(() => { if (!cancelled) setContacts([]); })
      .finally(() => { if (!cancelled) setLoadingContacts(false); });
    return () => { cancelled = true; };
  }, [selectedAccountId, panelMode]);

  const handleTableFilter = (_filter: AgentTableFilter, filteredAccounts: QueryAccount[]) => {
    setAgentFilterIds(new Set(filteredAccounts.map((a) => a.id)));
    setTableSortCol(null);
    setSelectedAccountId(null);
  };

  const handleQueryClear = () => {
    setAgentFilterIds(null);
    setSelectedAccountId(null);
    setTableSortCol(null);
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
      setDetailPanelOpen({
        criteria: true,
        firmographics: false,
        funding: false,
        products: false,
        services: false,
        technology: false,
      });
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

  const renderAccountQueryCell = (account: AccountRow | QueryAccount, col: AccountQueryColumn) => {
    const isSelected = selectedAccountId === account.id;
    const href = externalUrl(account as AccountRow);
    const companyLabel = account.company_name || account.domain || '—';
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
                className="text-sm font-medium text-arcova-teal hover:underline line-clamp-2 break-words leading-snug min-w-0"
                title={companyLabel}
              >
                {companyLabel}
              </a>
            ) : (
              <span className="text-sm font-medium text-gray-900 line-clamp-2 break-words leading-snug min-w-0" title={companyLabel}>
                {companyLabel}
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
        return account.company_type ? (
          <button
            type="button"
            className="-m-0.5 p-0.5 text-left cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              openDetailsWithCriteria(account.id);
            }}
          >
            <span className="block text-xs text-gray-700 line-clamp-2 break-words leading-snug" title={account.company_type}>
              {account.company_type}
            </span>
          </button>
        ) : (
          <span className="text-xs text-gray-700">—</span>
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
      case 'therapeutic_areas':
        return (
          <InlinePills
            items={account.therapeutic_areas}
            max={2}
            onActivate={
              (account.therapeutic_areas || []).length > 0
                ? () => openDetailsWithCriteria(account.id)
                : undefined
            }
          />
        );
      case 'modalities':
        return (
          <InlinePills
            items={account.modalities}
            max={2}
            onActivate={
              (account.modalities || []).length > 0
                ? () => openDetailsWithCriteria(account.id)
                : undefined
            }
          />
        );
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
                openActionTab(account.id);
              }}
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer select-none',
                'transition-colors duration-150 ease-out hover:shadow-sm active:scale-[0.97]',
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
        return <span className="text-xs text-gray-600 line-clamp-2">{account.funding_stage || account.funding_status_label || '—'}</span>;
      case 'icp_match':
        return <span className="text-xs text-gray-600 line-clamp-2">{account.matched_icp_label || '—'}</span>;
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
        return <span className="text-xs text-gray-600 truncate">{account.employee_range || (account.employee_count != null ? account.employee_count.toLocaleString() : '—')}</span>;
      case 'location':
        return <span className="text-xs text-gray-600 line-clamp-2">{accountLocation(account) || '—'}</span>;
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
                Leads
              </div>
              <h1 className="font-manrope mt-2 text-3xl font-bold leading-tight tracking-[-0.028em] text-[rgb(13,53,71)] sm:text-[2.25rem]">
                Accounts
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                {total > 0
                  ? `${total.toLocaleString()} account${total === 1 ? '' : 's'}. Click a row to open the company card.`
                  : 'One row per company, with firmographics and ICP fit at a glance.'}
              </p>
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
                  Accounts appear here once you import contacts with a resolved company.
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
                      Filtered by agent · {sortedAccounts.length} account{sortedAccounts.length !== 1 ? 's' : ''}
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
                            col === 'fit' || col === 'priority' || col === 'readiness' || col === 'action' ? 'justify-center text-center' : '',
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
                            {tableColumns.map((col) => (
                              <div
                                key={col}
                                className={cn(
                                  'min-w-0',
                                  col === 'fit' || col === 'priority' || col === 'action' ? 'flex justify-center' : '',
                                  col === 'therapeutic_areas' ? 'pl-2' : '',
                                )}
                              >
                                {renderAccountQueryCell(account, col)}
                              </div>
                            ))}
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

                {/* Mobile dismiss backdrop (<1280px) — matches /leads/contacts */}
                {selectedAccountId && selectedAccount && (
                  <button
                    type="button"
                    className="fixed inset-0 z-40 transition-opacity min-[1280px]:hidden"
                    aria-label="Close panel"
                    onClick={closePanel}
                  />
                )}

                {/* ── Company card — overlays the AgentPanel column while open.
                    Visual style matches the contact card on /leads/contacts (glass
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
                        ? {
                            top: agentRect.top,
                            left: agentRect.left,
                            width: agentRect.width,
                            // Leaves ~64px at the bottom for the floating chat bar.
                            height: Math.max(0, agentRect.height - 64),
                          }
                        : undefined
                    }
                  >
                    {/* Panel header — matches the contact-card header on /leads/contacts */}
                    <div className="flex shrink-0 items-start gap-3 px-4 pb-3 pt-5 border-b border-[rgba(13,53,71,0.08)]">
                      {/* Name / links (left) */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7d909a]">
                          {panelMode === 'fit'
                            ? 'Fit'
                            : panelMode === 'action'
                              ? 'Action'
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
                        <h2 className="font-manrope mt-1.5 break-words text-xl font-bold leading-tight tracking-[-0.024em] text-[rgb(13,53,71)] sm:text-2xl">
                          {selectedAccount.company_name || selectedAccount.domain || 'Company'}
                        </h2>
                        {(() => {
                          const ext = externalUrl(selectedAccount);
                          return (
                            <div className="mt-1 space-y-1">
                              {selectedAccount.domain && ext && (
                                <a href={ext} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-arcova-teal hover:underline">
                                  {selectedAccount.domain}<ExternalLink className="w-3 h-3 shrink-0" />
                                </a>
                              )}
                              {selectedAccount.linkedin_url && (
                                <a href={selectedAccount.linkedin_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-arcova-teal hover:underline">
                                  {selectedAccount.linkedin_url.replace(/^https?:\/\/(www\.)?/, '')}<ExternalLink className="w-3 h-3 shrink-0" />
                                </a>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                      {/* Logo + close (right, matches Leads company panel) */}
                      <div className="flex items-start gap-2 shrink-0">
                        {selectedAccount.logo_url && !failedLogoByAccountId[selectedAccount.id] ? (
                          <img
                            src={selectedAccount.logo_url}
                            alt=""
                            className="w-16 h-16 rounded-xl object-contain bg-gray-50 border border-gray-100 p-1"
                            onError={() =>
                              setFailedLogoByAccountId((prev) => ({
                                ...prev,
                                [selectedAccount.id]: true,
                              }))
                            }
                          />
                        ) : (
                          <div className="w-16 h-16 rounded-xl bg-gray-100 flex items-center justify-center text-xl font-semibold text-gray-400">
                            {(selectedAccount.company_name?.[0] || selectedAccount.domain?.[0] || '?').toUpperCase()}
                          </div>
                        )}
                        <button type="button" onClick={closePanel} className="text-gray-400 hover:text-gray-700 transition-colors" aria-label="Close">
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex shrink-0 border-b border-[rgba(13,53,71,0.08)] px-5">
                      {(['details', 'priority', 'fit', 'action', 'contacts', 'signals', 'crm'] as PanelMode[]).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setPanelMode(mode)}
                          className={cn(
                            'py-2.5 pr-4 text-xs font-medium border-b-2 -mb-px transition-colors capitalize',
                            panelMode === mode
                              ? 'border-arcova-teal text-arcova-teal'
                              : 'border-transparent text-gray-500 hover:text-gray-700',
                          )}
                        >
                          {mode === 'contacts'
                            ? 'Contacts'
                            : mode === 'fit'
                              ? 'Fit'
                              : mode === 'action'
                                ? 'Action'
                                : mode === 'signals'
                                  ? 'Signals'
                                  : mode === 'priority'
                                    ? 'Priority'
                                    : mode === 'crm'
                                      ? 'CRM'
                                      : 'Details'}
                        </button>
                      ))}
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
                        const companyLabel =
                          selectedAccount.company_name || selectedAccount.domain || 'This company';
                        return (
                          <div className="flex flex-col gap-3.5">
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
                                      onClick={() => router.push(ROUTES.accountSignals)}
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
                              </div>
                            )}

                            {action === 'source_contact' && (
                              <div className="space-y-3">
                                {selectedAccount.contact_count === 0 ? (
                                  <>
                                    <p className="text-[13.5px] leading-[1.55] text-[#0d3547]">
                                      <strong>{companyLabel}</strong> has no contacts on file. Your last known contact
                                      at this account has moved on — find a replacement to keep this account warm.
                                    </p>
                                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                                      <p className="text-[12.5px] leading-[1.5] text-amber-800">
                                        Arcova detected a contact departure at this account. Sourcing a new contact
                                        here lets you re-establish coverage without losing the account entirely.
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
                                      Open the Data page to request more contacts for this account. This company and ICP
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
                                    Find replacement contact
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

                            <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-3">
                              <p className="text-xs font-semibold text-gray-700 mb-2">Fit snapshot</p>
                              <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                  <p className="text-gray-400 text-xs">Company fit</p>
                                  <p className="text-gray-900 font-semibold mt-0.5 tabular-nums">
                                    {formatPct(selectedAccount.company_fit_score) ?? '—'}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-gray-400 text-xs">Best contact fit</p>
                                  <p className="text-gray-900 font-semibold mt-0.5 tabular-nums">
                                    {formatPct(selectedAccount.best_contact_fit) ?? '—'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {panelMode === 'details' && (() => {
                        const aboutText = selectedAccount.bio_summary || selectedAccount.description || null;
                        const hasCriteria = !!(
                          aboutText ||
                          selectedAccount.tagline ||
                          selectedAccount.company_type ||
                          selectedAccount.industry ||
                          selectedAccount.sub_industry ||
                          selectedAccount.platform_category ||
                          (selectedAccount.therapeutic_areas || []).length ||
                          (selectedAccount.modalities || []).length ||
                          (selectedAccount.development_stages || []).length
                        );
                        const hasFirmographics = !!(
                          selectedAccount.employee_count != null ||
                          selectedAccount.employee_range ||
                          selectedAccount.company_size_bucket ||
                          selectedAccount.founded_year != null ||
                          selectedAccount.headquarters_city ||
                          selectedAccount.headquarters_state ||
                          selectedAccount.headquarters_country
                        );
                        const hasFunding = !!(selectedAccount.funding_stage || selectedAccount.funding_status_label || selectedAccount.total_funding_usd != null || selectedAccount.latest_funding_date);
                        const isPendingEnrichment = !selectedAccount.last_enriched_at;
                        return (
                          <div className="space-y-3">
                            {isPendingEnrichment && (
                              <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3.5 py-3 flex gap-2.5">
                                <svg className="mt-0.5 w-4 h-4 shrink-0 text-amber-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                                  <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                                </svg>
                                <div className="min-w-0">
                                  <p className="text-[12.5px] font-semibold text-amber-800">Enrichment in progress</p>
                                  <p className="mt-0.5 text-[12px] leading-relaxed text-amber-700">
                                    This company was added automatically when a contact changed jobs. Details, fit score, and signals will populate within the hour.
                                  </p>
                                </div>
                              </div>
                            )}
                            {getAccountRowAction(selectedAccount) === 'monitor' && (
                              <div className="rounded-xl border border-arcova-teal/25 bg-arcova-teal/5 p-4 space-y-2">
                                <p className="text-[13px] leading-snug text-[#0d3547]">
                                  This account is on Monitor. Review signals to see activity before you reach out.
                                </p>
                                <button
                                  type="button"
                                  onClick={() => router.push(ROUTES.accountSignals)}
                                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-arcova-teal hover:text-arcova-teal/85 transition-colors"
                                >
                                  Review signals
                                  <ChevronRight className="w-4 h-4" aria-hidden />
                                </button>
                              </div>
                            )}
                            {/* Data source — matches the contact card's Data source card.
                                Holds the Type/Imported metadata + the Refresh enrichment
                                action inside the same segment (no separate footer button). */}
                            <div className="rounded-xl border border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.82)] px-3 py-3 shadow-[0_1px_4px_-2px_rgba(13,53,71,0.08)]">
                              <p className="mb-3 font-manrope text-xs font-semibold text-[#0d3547]">Data source</p>
                              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                                <div className="min-w-0">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">Type</p>
                                  <p className="mt-2 text-sm leading-snug text-[#0d3547]">{selectedAccount.data_provenance_type}</p>
                                </div>
                                <div className="min-w-0">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">Imported</p>
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
                                <button
                                  type="button"
                                  onClick={() => rerunCompanyEnrichment(selectedAccount.id)}
                                  disabled={refreshingCompanyId === selectedAccount.id}
                                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-[#1F2937] transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <RotateCw className={cn('w-4 h-4 text-[#1F2937]', refreshingCompanyId === selectedAccount.id ? 'animate-spin' : '')} />
                                  {refreshingCompanyId === selectedAccount.id ? 'Refreshing…' : 'Refresh enrichment'}
                                </button>
                              </div>
                            </div>

                            {/* Criteria */}
                            {hasCriteria && (
                              <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                                <button type="button" onClick={() => toggleDetail('criteria')}
                                  className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-100/60 transition-colors">
                                  <span className="text-xs font-semibold text-gray-700">Criteria</span>
                                  <ChevronDown className={cn('w-3.5 h-3.5 text-gray-400 transition-transform duration-200', detailPanelOpen.criteria ? '' : '-rotate-90')} />
                                </button>
                                {detailPanelOpen.criteria && (
                                  <div className="px-3 pb-3 space-y-3">
                                    {aboutText && (
                                      <div>
                                        <p className="text-gray-400 text-xs mb-1">Profile summary</p>
                                        <p className="text-sm text-gray-700 leading-relaxed">{aboutText}</p>
                                      </div>
                                    )}
                                    {selectedAccount.tagline && (
                                      <div>
                                        <p className="text-gray-400 text-xs mb-1">Tagline</p>
                                        <p className="text-sm text-gray-700 leading-relaxed">{selectedAccount.tagline}</p>
                                      </div>
                                    )}
                                    {selectedAccount.company_type && (
                                      <div>
                                        <p className="text-gray-400 text-xs mb-1">Company type</p>
                                        <span className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2.5 py-0.5 text-xs font-medium text-arcova-teal">{selectedAccount.company_type}</span>
                                      </div>
                                    )}
                                    {selectedAccount.industry && (
                                      <div>
                                        <p className="text-gray-400 text-xs mb-1">Industry</p>
                                        <p className="text-sm text-gray-700">{selectedAccount.industry}</p>
                                      </div>
                                    )}
                                    {selectedAccount.sub_industry && (
                                      <div>
                                        <p className="text-gray-400 text-xs mb-1">Sub-industry</p>
                                        <p className="text-sm text-gray-700">{selectedAccount.sub_industry}</p>
                                      </div>
                                    )}
                                    {selectedAccount.platform_category && (
                                      <div>
                                        <p className="text-gray-400 text-xs mb-1">Platform category</p>
                                        <p className="text-sm text-gray-700">{selectedAccount.platform_category}</p>
                                      </div>
                                    )}
                                    {(selectedAccount.therapeutic_areas || []).length > 0 && (
                                      <div>
                                        <p className="text-gray-400 text-xs mb-1">Therapeutic areas</p>
                                        <TaxonomyPills items={selectedAccount.therapeutic_areas} />
                                      </div>
                                    )}
                                    {(selectedAccount.modalities || []).length > 0 && (
                                      <div>
                                        <p className="text-gray-400 text-xs mb-1">Modalities</p>
                                        <TaxonomyPills items={selectedAccount.modalities} />
                                      </div>
                                    )}
                                    {(selectedAccount.development_stages || []).length > 0 && (
                                      <div>
                                        <p className="text-gray-400 text-xs mb-1">Development stage</p>
                                        <TaxonomyPills items={selectedAccount.development_stages} />
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Firmographics */}
                            {hasFirmographics && (
                              <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                                <button type="button" onClick={() => toggleDetail('firmographics')}
                                  className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-100/60 transition-colors">
                                  <span className="text-xs font-semibold text-gray-700">Firmographics</span>
                                  <ChevronDown className={cn('w-3.5 h-3.5 text-gray-400 transition-transform duration-200', detailPanelOpen.firmographics ? '' : '-rotate-90')} />
                                </button>
                                {detailPanelOpen.firmographics && (
                                  <div className="px-3 pb-3">
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                                      {(selectedAccount.employee_count != null || selectedAccount.employee_range) && (
                                        <div>
                                          <p className="text-gray-400 text-xs">Employees</p>
                                          <p className="text-gray-900 text-sm mt-0.5">{selectedAccount.employee_count != null ? selectedAccount.employee_count.toLocaleString() : selectedAccount.employee_range}</p>
                                        </div>
                                      )}
                                      {selectedAccount.company_size_bucket && (
                                        <div>
                                          <p className="text-gray-400 text-xs">Size bucket</p>
                                          <p className="text-gray-900 text-sm mt-0.5">{selectedAccount.company_size_bucket}</p>
                                        </div>
                                      )}
                                      {selectedAccount.founded_year != null && (
                                        <div>
                                          <p className="text-gray-400 text-xs">Founded</p>
                                          <p className="text-gray-900 text-sm mt-0.5">{selectedAccount.founded_year}</p>
                                        </div>
                                      )}
                                      {selectedAccount.headquarters_city && (
                                        <div>
                                          <p className="text-gray-400 text-xs">City</p>
                                          <p className="text-gray-900 text-sm mt-0.5">{selectedAccount.headquarters_city}</p>
                                        </div>
                                      )}
                                      {selectedAccount.headquarters_state && (
                                        <div>
                                          <p className="text-gray-400 text-xs">State</p>
                                          <p className="text-gray-900 text-sm mt-0.5">{selectedAccount.headquarters_state}</p>
                                        </div>
                                      )}
                                      {selectedAccount.headquarters_country && (
                                        <div>
                                          <p className="text-gray-400 text-xs">Country</p>
                                          <p className="text-gray-900 text-sm mt-0.5">{selectedAccount.headquarters_country}</p>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Funding */}
                            {hasFunding && (
                              <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                                <button type="button" onClick={() => toggleDetail('funding')}
                                  className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-100/60 transition-colors">
                                  <span className="text-xs font-semibold text-gray-700">Funding</span>
                                  <ChevronDown className={cn('w-3.5 h-3.5 text-gray-400 transition-transform duration-200', detailPanelOpen.funding ? '' : '-rotate-90')} />
                                </button>
                                {detailPanelOpen.funding && (
                                  <div className="px-3 pb-3 space-y-1.5">
                                    {(selectedAccount.funding_stage || selectedAccount.funding_status_label) && (
                                      <div className="flex items-baseline gap-2">
                                        <span className="text-xs text-gray-400 w-24 shrink-0">Stage</span>
                                        <span className="text-xs text-gray-900">{selectedAccount.funding_stage ?? selectedAccount.funding_status_label}</span>
                                      </div>
                                    )}
                                    {selectedAccount.total_funding_usd != null && (
                                      <div className="flex items-baseline gap-2">
                                        <span className="text-xs text-gray-400 w-24 shrink-0">Total raised</span>
                                        <span className="text-xs text-gray-900">{formatCurrencyShort(selectedAccount.total_funding_usd)}</span>
                                      </div>
                                    )}
                                    {selectedAccount.latest_funding_date && (
                                      <div className="flex items-baseline gap-2">
                                        <span className="text-xs text-gray-400 w-24 shrink-0">Latest round</span>
                                        <span className="text-xs text-gray-900">{formatDate(selectedAccount.latest_funding_date)}</span>
                                      </div>
                                    )}
                                    {selectedAccount.funding_resolution_summary && (
                                      <p className="text-xs text-gray-500 leading-snug pt-1">{selectedAccount.funding_resolution_summary}</p>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Products */}
                            {(() => {
                              const hasProducts = (selectedAccount.products_services?.length ?? 0) > 0;
                              const hasSpecialties = (selectedAccount.specialties?.length ?? 0) > 0;
                              if (!hasProducts && !hasSpecialties) return null;
                              const items = hasProducts ? selectedAccount.products_services! : selectedAccount.specialties!;
                              return (
                                <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                                  <button type="button" onClick={() => toggleDetail('products')}
                                    className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-100/60 transition-colors">
                                    <span className="text-xs font-semibold text-gray-700">Products</span>
                                    <ChevronDown className={cn('w-3.5 h-3.5 text-gray-400 transition-transform duration-200', detailPanelOpen.products ? '' : '-rotate-90')} />
                                  </button>
                                  {detailPanelOpen.products && (
                                    <div className="px-3 pb-3">
                                      <div className="flex flex-wrap gap-1.5">
                                        {items.map((p, i) => (
                                          <span key={i} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">{p}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}

                            {/* Services */}
                            {(selectedAccount.services?.length ?? 0) > 0 && (
                              <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                                <button type="button" onClick={() => toggleDetail('services')}
                                  className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-100/60 transition-colors">
                                  <span className="text-xs font-semibold text-gray-700">Services</span>
                                  <ChevronDown className={cn('w-3.5 h-3.5 text-gray-400 transition-transform duration-200', detailPanelOpen.services ? '' : '-rotate-90')} />
                                </button>
                                {detailPanelOpen.services && (
                                  <div className="px-3 pb-3">
                                    <div className="flex flex-wrap gap-1.5">
                                      {selectedAccount.services!.map((s, i) => (
                                        <span key={i} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">{s}</span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Technology */}
                            {(selectedAccount.technologies?.length ?? 0) > 0 && (
                              <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                                <button type="button" onClick={() => toggleDetail('technology')}
                                  className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-100/60 transition-colors">
                                  <span className="text-xs font-semibold text-gray-700">Technology</span>
                                  <ChevronDown className={cn('w-3.5 h-3.5 text-gray-400 transition-transform duration-200', detailPanelOpen.technology ? '' : '-rotate-90')} />
                                </button>
                                {detailPanelOpen.technology && (
                                  <div className="px-3 pb-3">
                                    <div className="flex flex-wrap gap-1.5">
                                      {selectedAccount.technologies!.map((t, i) => (
                                        <span key={i} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">{t}</span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {panelMode === 'contacts' && (
                        <div className="space-y-3">
                          <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5">
                            <p className="text-xs font-semibold text-gray-700 mb-3">Contact coverage</p>
                            <div className="grid grid-cols-3 gap-3 text-xs">
                              <div>
                                <p className="text-gray-400 mb-0.5">Contacts</p>
                                <p className="text-lg font-semibold text-gray-900">{selectedAccount.contact_count}</p>
                              </div>
                              <div>
                                <p className="text-gray-400 mb-0.5">Best fit</p>
                                <p className="text-lg font-semibold text-gray-900">{formatPct(selectedAccount.best_contact_fit) ?? '—'}</p>
                              </div>
                              <div>
                                <p className="text-gray-400 mb-0.5">Avg fit</p>
                                <p className="text-lg font-semibold text-gray-900">{formatPct(selectedAccount.avg_contact_fit) ?? '—'}</p>
                              </div>
                            </div>
                            {(selectedAccount.best_contact_fit == null || selectedAccount.best_contact_fit < 1) && (
                              <button
                                type="button"
                                onClick={() => openContactAcquisition(selectedAccount)}
                                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-arcova-teal/30 bg-white px-3 py-2 text-xs font-semibold text-arcova-teal hover:border-arcova-teal hover:bg-arcova-teal/5 transition-colors"
                              >
                                <Users className="h-3.5 w-3.5" />
                                Find buyer-persona contacts
                              </button>
                            )}
                          </div>

                          {loadingContacts ? (
                            <div className="flex justify-center py-12">
                              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-arcova-teal" />
                            </div>
                          ) : contacts.length === 0 ? (
                            <div className="space-y-3 py-2">
                              {selectedAccount.contact_count === 0 ? (
                                <>
                                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
                                    <p className="text-[13px] font-semibold text-amber-900 mb-1">Contact departed</p>
                                    <p className="text-[12.5px] leading-[1.5] text-amber-800">
                                      Your last known contact at this account has moved on. Source a replacement
                                      contact to keep this account warm and maintain coverage.
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => openContactAcquisition(selectedAccount)}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-arcova-teal/30 bg-white px-3 py-2.5 text-sm font-semibold text-arcova-teal hover:bg-arcova-teal/5 transition-colors"
                                  >
                                    <Users className="h-3.5 w-3.5" />
                                    Find replacement contact
                                  </button>
                                </>
                              ) : (
                                <p className="text-sm text-gray-400 text-center py-12">No contacts found.</p>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {contacts.map((contact) => {
                                const isExpanded = expandedContactId === contact.id;
                                const title = contact.resolved_current_job_title || contact.job_title || null;
                                const fitPct = formatPct(contact.contact_fit_score);
                                const fit = contactFitCache[contact.id];
                                const fitLoading = contactFitLoadingIds.has(contact.id);
                                return (
                                  <div
                                    key={contact.id}
                                    className={cn(
                                      'rounded-xl border bg-gray-50/60 overflow-hidden transition-colors',
                                      isExpanded ? 'border-arcova-teal/30' : 'border-gray-100',
                                    )}
                                  >
                                    {/* Row header — click to toggle */}
                                    <button
                                      type="button"
                                      onClick={() => toggleContact(contact.id)}
                                      className="w-full text-left px-3 py-2.5 hover:bg-arcova-teal/5 transition-colors"
                                    >
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                          <p className="text-sm font-medium text-gray-900 truncate">{contact.full_name || '—'}</p>
                                          {title && <p className="text-xs text-gray-500 truncate mt-0.5">{title}</p>}
                                          {contact.email && <p className="text-xs text-gray-400 truncate mt-0.5">{contact.email}</p>}
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                          {fitPct && (
                                            <span className="text-sm font-semibold tabular-nums text-gray-900">{fitPct}</span>
                                          )}
                                          <ChevronDown className={cn('w-3.5 h-3.5 text-gray-400 transition-transform duration-200 shrink-0', isExpanded ? 'rotate-0' : '-rotate-90')} />
                                        </div>
                                      </div>
                                    </button>

                                    {/* Expanded fit breakdown */}
                                    {isExpanded && (
                                      <div className="border-t border-gray-100 px-3 py-3 space-y-2.5">
                                        {fitLoading ? (
                                          <p className="text-xs text-gray-400">Loading fit…</p>
                                        ) : fit?.winning_breakdown ? (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() => router.push(withQuery(ROUTES.contacts, `lead=${encodeURIComponent(contact.id)}&search=${encodeURIComponent(contact.full_name || contact.email || '')}`))}
                                              className="inline-flex items-center gap-1 rounded-full border border-arcova-teal/30 bg-white px-2.5 py-1 text-xs font-semibold text-arcova-teal hover:border-arcova-teal hover:bg-arcova-teal/10 transition-colors"
                                            >
                                              View contact
                                            </button>
                                            <p className="text-[11px] text-gray-400">Click a row to unfold detail</p>
                                            {CONTACT_FIT_COMPONENT_ORDER.map((key) => {
                                              const component = fit.winning_breakdown!.components[key];
                                              if (!component?.active) return null;
                                              const componentPct = formatPct(component.score01);
                                              const barKey = `${contact.id}:${key}`;
                                              const isOpen = expandedBars.has(barKey);
                                              const showPill = Boolean(component.matchedValue) && component.matchStatus !== 'mismatch';
                                              const detailText: string | null = (() => {
                                                if (component.matchStatus === 'exact') return 'Exact match';
                                                if (key === 'seniority' && contact.seniority_level) return `Contact is ${contact.seniority_level}. This is not the target buying group for this ICP`;
                                                return component.detail || null;
                                              })();
                                              return (
                                                <div key={key}>
                                                  <button
                                                    type="button"
                                                    onClick={() => toggleBar(barKey)}
                                                    className="w-full rounded-md px-1 -mx-1 py-0.5 text-left transition-colors hover:bg-gray-100/80"
                                                  >
                                                    <div className="flex items-center justify-between gap-2">
                                                      <p className="text-xs font-medium text-gray-700">{component.label}</p>
                                                      <div className="flex items-center gap-1 shrink-0">
                                                        {componentPct && <span className="text-[11px] text-slate-500">{componentPct}</span>}
                                                        <ChevronDown className={cn('h-3 w-3 shrink-0 text-gray-400 transition-transform duration-200', isOpen ? 'rotate-0' : '-rotate-90')} aria-hidden />
                                                      </div>
                                                    </div>
                                                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200">
                                                      <div
                                                        className={`h-full rounded-full ${component.available ? 'bg-arcova-teal' : 'bg-slate-300'}`}
                                                        style={{ width: `${Math.max(0, Math.min(100, Math.round(component.score01 * 100)))}%` }}
                                                      />
                                                    </div>
                                                  </button>
                                                  {isOpen && (showPill || detailText) && (
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
                                    )}
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
                          effectiveReadinessScore={selectedAccount.readiness_score ?? null}
                          crmCappedReason={(() => {
                            const rawPct = percentDisplayNumber(selectedAccount.raw_readiness_score ?? selectedAccount.readiness_score ?? null);
                            const companyLabel = selectedAccount.company_name || 'This account';
                            if (selectedAccount.crm_status === 'customer') {
                              return `${companyLabel} is a closed-won account. Readiness is low as you have already sold to this company.`;
                            }
                            if (selectedAccount.crm_status === 'dormant') {
                              return `${companyLabel} is a closed-lost account. Readiness is low because the last deal was lost.`;
                            }
                            return null;
                          })()}
                        />
                      )}

                      {panelMode === 'crm' && (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[#ff7a59]" />
                              <h2 className="text-lg font-semibold leading-tight text-gray-900">HubSpot CRM</h2>
                            </div>
                            <p className="text-[13.5px] leading-[1.55] text-[#4a6470]">
                              Every HubSpot deal tied to a contact at this account, rolled up in one view.
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
                                        <p className="text-base font-semibold text-[#0d3547]">
                                          {deal.deal_name || 'HubSpot deal'}
                                        </p>
                                        <p className="mt-1 text-xs text-[#7d909a]">
                                          HubSpot account:{' '}
                                          <span className="font-medium text-[#4a6470]">
                                            {deal.hubspot_company_name || deal.hubspot_company_domain || '—'}
                                          </span>
                                        </p>
                                      </div>
                                      <span className="inline-flex shrink-0 items-center rounded-full border border-[rgba(13,53,71,0.10)] bg-[rgba(13,53,71,0.04)] px-2 py-0.5 text-[11px] font-medium text-[#4a6470]">
                                        {stageLabel}
                                      </span>
                                    </div>

                                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                                      <div>
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                          Amount
                                        </p>
                                        <p className="mt-1 text-sm leading-snug text-[#0d3547]">
                                          {formatUsdValue(deal.amount) || '—'}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                          Close date
                                        </p>
                                        <p className="mt-1 text-sm leading-snug text-[#0d3547]">
                                          {formatLastUpdated(deal.close_date)}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                          Last synced
                                        </p>
                                        <p className="mt-1 text-sm leading-snug text-[#0d3547]">
                                          {formatLastUpdated(deal.synced_at)}
                                        </p>
                                      </div>
                                    </div>

                                    {deal.contacts.length > 0 && (
                                      <div className="mt-3 border-t border-[rgba(13,53,71,0.06)] pt-3">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
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
                                          HubSpot account domain ({deal.hubspot_company_domain}) doesn't match the Arcova
                                          account ({arcovaDomain}).
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
                                No  HubSpot deal activity on this account yet.
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
                        const rawReadinessNorm = selectedAccount.raw_readiness_score ?? selectedAccount.readiness_score ?? null;
                        const priorityNorm = selectedAccount.priority_score ?? null;
                        const priorityPct = percentDisplayNumber(priorityNorm);
                        const fitPct = percentDisplayNumber(fitNorm);
                        const readinessPct = percentDisplayNumber(readinessNorm);
                        const rawReadinessPct = percentDisplayNumber(rawReadinessNorm);
                        const ScoreRow = ({
                          label,
                          pct,
                          arcColor,
                          onOpen,
                        }: {
                          label: string;
                          pct: number | null;
                          arcColor: string;
                          onOpen: () => void;
                        }) => (
                          <button
                            type="button"
                            onClick={onOpen}
                            className="w-full rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3 flex items-center gap-4 text-left transition-colors hover:bg-arcova-teal/5"
                          >
                            <AnimatedCircularProgressBar
                              value={pct ?? 0}
                              gaugePrimaryColor={arcColor}
                              gaugeSecondaryColor="rgba(13,53,71,0.09)"
                              animateOnMount
                              deferAnimationMs={160}
                              label={
                                <span className="block text-xs font-semibold text-gray-800 leading-snug tabular-nums">
                                  {pct != null ? pct : '—'}
                                </span>
                              }
                              className="size-12 shrink-0 [--transition-length:0.95s]"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7d909a]">
                                {label}
                              </p>
                              <p className="mt-1 text-[11px] font-semibold text-arcova-teal">
                                See details →
                              </p>
                            </div>
                          </button>
                        );
                        return (
                          <div className="space-y-3">
                            {/* Priority — large gauge, number only */}
                            <div className="flex flex-col items-center justify-center rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-6">
                              <AnimatedCircularProgressBar
                                value={priorityPct ?? 0}
                                gaugePrimaryColor={priorityScoreArcColor(priorityPct)}
                                gaugeSecondaryColor="rgba(13,53,71,0.09)"
                                animateOnMount
                                deferAnimationMs={160}
                                label={
                                  <span className="block text-xl font-semibold text-[#0d3547] leading-snug tabular-nums">
                                    {priorityPct != null ? priorityPct : '—'}
                                  </span>
                                }
                                className="size-24 [--transition-length:0.95s]"
                              />
                              <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7d909a]">
                                Priority score
                              </p>
                            </div>

                            <ScoreRow
                              label="Fit score"
                              pct={fitPct}
                              arcColor={fitScoreArcColor(fitPct)}
                              onOpen={() => setPanelMode('fit')}
                            />
                            <ScoreRow
                              label="Signal readiness"
                              pct={readinessPct}
                              arcColor={fitScoreArcColor(readinessPct)}
                              onOpen={() => setPanelMode('signals')}
                            />
                          </div>
                        );
                      })()}

                    </div>

                    {/* Panel footer — Edit / Archive account, mirrors the contact card.
                        Only rendered on the Details tab (matches contacts' Contact tab). */}
                    {panelMode === 'details' && (
                      <div className="px-4 py-4 border-t border-[rgba(13,53,71,0.08)]">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setEditAccountOpen(true)}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Edit account
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const label = selectedAccount.company_name || selectedAccount.domain || 'this account';
                              const ok = window.confirm(
                                `Are you sure you want to archive ${label}? It and its contacts will be hidden from active views and will not be re-imported or re-enriched automatically.`,
                              );
                              if (!ok) return;

                              try {
                                const response = await fetch(`/api/accounts/${selectedAccount.id}`, {
                                  method: 'DELETE',
                                });
                                const result = await response.json();
                                if (!response.ok) {
                                  throw new Error(result.error || 'Failed to archive account.');
                                }

                                invalidateCache('/api/accounts');
                                setAccounts((prev) => prev.filter((account) => account.id !== selectedAccount.id));
                                setSelectedAccountId(null);
                              } catch (error) {
                                console.error('Error archiving account:', error);
                                window.alert(error instanceof Error ? error.message : 'Could not archive account.');
                              }
                            }}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Archive account
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
                      // Edit changed user_overrides — drop the list cache AND the
                      // per-account detail cache so both refresh with new overrides.
                      invalidateCache('/api/accounts');
                      if (selectedAccountId) {
                        setSelectedAccountDetailById((prev) => {
                          const next = { ...prev };
                          delete next[selectedAccountId];
                          return next;
                        });
                      }
                      fetchAccounts();
                    }}
                  />
                )}

                {/* Floating agent chat bar — sits at the bottom of the AgentPanel
                    column while a company card is open. Uses the shared `AgentChatBar`
                    so it matches the side-panel agent input. Submit dismisses the
                    company card and forwards the text to the agent. */}
                {selectedAccountId && agentRect && (
                  <div
                    className={cn(
                      'fixed z-[51] flex items-center rounded-[1.3125rem] border border-[rgba(255,255,255,0.88)] bg-[rgba(255,255,255,0.55)] px-3 py-2.5 shadow-[0_24px_60px_-32px_rgba(13,53,71,0.2)] backdrop-blur-2xl backdrop-saturate-150',
                    )}
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
                        setSelectedAccountId(null);
                      }}
                      placeholder="Ask anything about your accounts…"
                      className="w-full"
                    />
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
            selectedAccountId && 'invisible',
          )}
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
