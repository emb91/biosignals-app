'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { AgentPanel, type AgentTableFilter } from '@/components/AgentPanel';
import type {
  AccountQueryColumn,
  QueryAccount,
} from '@/lib/accounts-data';
import {
  Activity,
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  ExternalLink,
  RotateCw,
  Users,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrencyShort } from '@/lib/funding-display';
import {
  CompanyIcpFitDetailPanel,
  type CompanyFitDetails,
} from '@/components/company-icp-fit-detail-panel';
import { TableFitGaugeButton } from '@/components/TableFitGaugeButton';
import { formatProvenanceImportedAt } from '@/lib/data-provenance';
import {
  getAccountRowAction,
  LEAD_ACTION_PILL_CLASS,
  LEAD_ACTION_SORT_ORDER,
} from '@/lib/lead-action';
import { ROUTES, withQuery } from '@/lib/routes';

const PAGE_SIZE = 50;

type AccountRow = {
  id: string;
  company_name: string | null;
  domain: string | null;
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
  linkedin_url: string | null;
  description: string | null;
  bio_summary: string | null;
  employee_count: number | null;
  employee_range: string | null;
  headquarters_city: string | null;
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
  max_contact_intent_score: number | null;
  data_provenance_type: string;
  data_provenance_imported_at: string | null;
};

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

type PanelMode = 'details' | 'fit' | 'contacts';

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

const DEFAULT_COLUMNS: AccountQueryColumn[] = ['company', 'company_type', 'fit', 'contacts', 'action'];
const MEDIUM_COLUMNS: AccountQueryColumn[] = ['company', 'fit', 'contacts', 'action'];
const SMALL_COLUMNS: AccountQueryColumn[] = ['company', 'fit', 'action'];

const ACCOUNT_QUERY_COL_DEFS: Record<AccountQueryColumn, { label: string; width: string }> = {
  company: { label: 'Company', width: 'minmax(0,1.05fr)' },
  company_type: { label: 'Company type', width: 'minmax(0,0.82fr)' },
  fit: { label: 'Fit', width: 'minmax(0,4.25rem)' },
  contacts: { label: 'Contacts', width: 'minmax(0,7.5rem)' },
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

function useResponsiveAccountColumns(): AccountQueryColumn[] {
  const [columns, setColumns] = useState<AccountQueryColumn[]>(DEFAULT_COLUMNS);

  useEffect(() => {
    const updateColumns = () => {
      if (window.innerWidth < 640) {
        setColumns(SMALL_COLUMNS);
      } else if (window.innerWidth < 900) {
        setColumns(MEDIUM_COLUMNS);
      } else {
        setColumns(DEFAULT_COLUMNS);
      }
    };

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
  const tableColumns = useResponsiveAccountColumns();

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [agentTrigger, setAgentTrigger] = useState<{ text: string; nonce: number; isHidden?: boolean } | undefined>();
  const fireAgent = (text: string) =>
    setAgentTrigger((prev) => ({ text, nonce: (prev?.nonce ?? 0) + 1 }));
  const agentTaskFiredRef = useRef<string | null>(null);

  const [agentFilterIds, setAgentFilterIds] = useState<Set<string> | null>(null);
  const [tableSortCol, setTableSortCol] = useState<string | null>(null);
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('asc');

  // Panel state
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>('details');

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
      const res = await fetch(`/api/accounts?${params}`);
      if (res.ok) {
        const result = await res.json();
        const next: AccountRow[] = result.data || [];
        setAccounts(next);
        setTotal(result.total || 0);
        if (typeof result.page === 'number' && result.page >= 1) {
          setPage(result.page);
        }
        setSelectedAccountId((current) => {
          if (focusId && next.some((a) => a.id === focusId)) return focusId;
          if (current && next.some((a) => a.id === current)) return current;
          return next[0]?.id ?? null;
        });
      }
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
      isHidden: true,
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
    if (panelMode !== 'fit' || !selectedAccountId) return;

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

  const openContactAcquisition = (account: AccountRow) => {
    const params = new URLSearchParams({
      mode: 'contacts_at_company',
      companyId: account.id,
      companyName: account.company_name || account.domain || 'Selected company',
      source: 'accounts',
    });
    if (account.matched_icp_id) params.set('icpId', account.matched_icp_id);
    router.push(withQuery(ROUTES.leads.data, params));
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
              isRowSelected={isSelected}
              isGaugeHighlighted={isSelected && panelMode === 'fit'}
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
              isSelected && panelMode === 'contacts'
                ? 'bg-arcova-teal text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-arcova-teal/10 hover:text-arcova-teal',
            )}
          >
            <Users className="w-3 h-3" />
            {account.contact_count} contact{account.contact_count !== 1 ? 's' : ''}
          </button>
        );
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
        /** Solid pill when the open panel matches the journey from this action (avoid generic teal ring or mute). */
        const actionPillEmphasized =
          isSelected &&
          ((action === 'source_contact' && panelMode === 'contacts') ||
            (action === 'deprioritize' && panelMode === 'fit') ||
            ((action === 'monitor' || action === 'reach_out') && panelMode === 'details'));
        return (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openDetails(account.id);
                if (action === 'source_contact') setPanelMode('contacts');
                else if (action === 'deprioritize') setPanelMode('fit');
                else setPanelMode('details');
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
  const selectedAccount = selectedAccountId
    ? accounts.find((a) => a.id === selectedAccountId) ?? null
    : null;

  return (
    <div className="flex h-screen bg-transparent">
      <AppSidebar />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden min-[1280px]:flex-row">
        {/* ── Main scrollable content ── */}
        <div className="arcova-scroll-surface flex-1 overflow-auto p-4 min-w-0 sm:p-6">
          <div className="w-full max-w-none">

            <div className="mb-6">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-arcova-teal">
                <Building2 className="h-3.5 w-3.5" />
                Leads
              </div>
              <h1 className="mt-2 text-2xl font-semibold leading-tight text-slate-950 sm:text-3xl">Accounts</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                One row per company, with firmographics and ICP fit at a glance.
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
              <div className={cn('grid min-w-0 gap-4', selectedAccountId ? 'min-[1700px]:grid-cols-[minmax(0,1fr)_360px]' : '')}>

                {/* ── Table ── */}
                <div className="min-w-0 flex flex-col gap-2">

                {/* Contact coverage gap banner */}
                {(() => {
                  const opportunityAccounts = accounts.filter(
                    (a) => getCoverageStatus(a) === 'opportunity',
                  );
                  if (opportunityAccounts.length === 0) return null;
                  const names = opportunityAccounts
                    .slice(0, 5)
                    .map((a) => a.company_name || a.domain || 'Unknown')
                    .join(', ');
                  const more = opportunityAccounts.length > 5
                    ? ` and ${opportunityAccounts.length - 5} more`
                    : '';
                  return (
                    <button
                      type="button"
                      onClick={() =>
                        fireAgent(
                          `${opportunityAccounts.length === 1 ? 'One account is' : `${opportunityAccounts.length} accounts are`} missing strong contact coverage: ${names}${more}. Explain what is going on and what I should do next.`,
                        )
                      }
                      className="w-full flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left transition-colors hover:bg-amber-100"
                    >
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                      <p className="text-sm font-medium text-amber-800">
                        {opportunityAccounts.length === 1
                          ? '1 account is missing strong contact coverage.'
                          : `${opportunityAccounts.length} accounts are missing strong contact coverage.`}
                        <span className="ml-1.5 font-normal text-amber-600">Click to learn more.</span>
                      </p>
                      <Activity className="ml-auto h-4 w-4 shrink-0 text-amber-400" />
                    </button>
                  );
                })()}

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

                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  <div className="min-w-0">
                    {/* Header */}
                    <div
                      className="grid w-full min-w-0 px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide gap-x-5"
                      style={{ gridTemplateColumns: accountQueryGridCols(tableColumns) }}
                    >
                      {tableColumns.map((col) => (
                        <button
                          key={col}
                          type="button"
                          onClick={() => handleSortCol(col)}
                          className={cn(
                            'flex min-w-0 items-center gap-1 hover:text-gray-800 transition-colors text-left',
                            col === 'fit' || col === 'action' ? 'justify-center text-center' : '',
                          )}
                        >
                          {ACCOUNT_QUERY_COL_DEFS[col].label}
                          <SortArrow col={col} activeCol={tableSortCol} dir={tableSortDir} />
                        </button>
                      ))}
                    </div>

                    {/* Rows — single render path; agent filter narrows sortedAccounts in-place */}
                    <div className="divide-y divide-gray-100">
                      {sortedAccounts.map((account) => {
                        const isSelected = selectedAccountId === account.id;

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
                              'grid w-full min-w-0 px-4 py-3 gap-x-5 items-center cursor-pointer transition-all duration-150 border-l-2',
                              isSelected
                                ? 'border-arcova-teal'
                                : 'border-transparent hover:bg-arcova-teal/5 hover:border-arcova-teal/30',
                            )}
                            style={{ gridTemplateColumns: accountQueryGridCols(tableColumns) }}
                          >
                            {tableColumns.map((col) => (
                              <div
                                key={col}
                                className={cn(
                                  'min-w-0',
                                  col === 'fit' || col === 'action' ? 'flex justify-center' : '',
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
                  </div>

                  {!agentFilterIds && totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
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
                </div>
                </div>{/* end table + banner wrapper */}

                {/* ── Side panel ── */}
                {selectedAccountId && selectedAccount && (
                  <aside className="bg-white rounded-lg shadow-sm border border-gray-200 min-h-[520px] flex flex-col">
                    {/* Panel header */}
                    <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-200">
                      {/* Name / links (left) */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium uppercase tracking-wide text-arcova-teal">Company details</p>
                        <h2 className="text-lg font-semibold text-gray-900 mt-1 leading-tight break-words">
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
                        {selectedAccount.logo_url ? (
                          <img
                            src={selectedAccount.logo_url}
                            alt=""
                            className="w-16 h-16 rounded-xl object-contain bg-gray-50 border border-gray-100 p-1"
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

                    <div className="flex border-b border-gray-200 px-5">
                      {(['details', 'fit', 'contacts'] as PanelMode[]).map((mode) => (
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
                            ? `Contacts (${selectedAccount.contact_count})`
                            : mode === 'fit'
                              ? 'Fit'
                              : 'Details'}
                        </button>
                      ))}
                    </div>

                    {/* Panel body */}
                    <div className="flex-1 overflow-auto px-5 py-4">

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

                      {panelMode === 'details' && (() => {
                        const aboutText = selectedAccount.bio_summary || selectedAccount.description || null;
                        const hasCriteria = !!(
                          aboutText ||
                          selectedAccount.company_type ||
                          (selectedAccount.therapeutic_areas || []).length ||
                          (selectedAccount.modalities || []).length ||
                          (selectedAccount.development_stages || []).length
                        );
                        const hasFirmographics = !!(selectedAccount.employee_count != null || selectedAccount.employee_range || selectedAccount.founded_year != null || selectedAccount.headquarters_city || selectedAccount.headquarters_country);
                        const hasFunding = !!(selectedAccount.funding_stage || selectedAccount.funding_status_label || selectedAccount.total_funding_usd != null || selectedAccount.latest_funding_date);
                        return (
                          <div className="space-y-3">
                            <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-3">
                              <p className="text-xs font-semibold text-gray-700 mb-2">Data source</p>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                <div>
                                  <p className="text-gray-400 text-xs">Type</p>
                                  <p className="text-gray-900 mt-0.5">{selectedAccount.data_provenance_type}</p>
                                </div>
                                <div>
                                  <p className="text-gray-400 text-xs">Imported</p>
                                  <p className="text-gray-900 mt-0.5">
                                    {formatProvenanceImportedAt(selectedAccount.data_provenance_imported_at)}
                                  </p>
                                </div>
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
                                    {selectedAccount.company_type && (
                                      <div>
                                        <p className="text-gray-400 text-xs mb-1">Company type</p>
                                        <span className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2.5 py-0.5 text-xs font-medium text-arcova-teal">{selectedAccount.company_type}</span>
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
                            <p className="text-sm text-gray-400 text-center py-12">No contacts found.</p>
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
                                              onClick={() => router.push(withQuery(ROUTES.leads.contacts, `search=${encodeURIComponent(contact.full_name || contact.email || '')}`))}
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
                    </div>

                    {/* Panel footer */}
                    <div className="px-5 py-4 border-t border-gray-100 space-y-2">
                      {selectedAccount.last_enriched_at && (
                        <p className="text-xs text-gray-400">
                          Last updated {formatDate(selectedAccount.last_enriched_at)}
                        </p>
                      )}
                      <p className="text-xs text-gray-500">
                        You can refresh this enrichment again whenever you need updated data.
                      </p>
                      <button
                        type="button"
                        onClick={() => rerunCompanyEnrichment(selectedAccount.id)}
                        disabled={refreshingCompanyId === selectedAccount.id}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-arcova-teal/30 bg-arcova-teal/5 px-4 py-2 text-sm font-medium text-arcova-teal hover:bg-arcova-teal/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <RotateCw className={cn('w-4 h-4', refreshingCompanyId === selectedAccount.id ? 'animate-spin' : '')} />
                        {refreshingCompanyId === selectedAccount.id ? 'Refreshing…' : 'Refresh enrichment'}
                      </button>
                    </div>
                  </aside>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Agent panel (far right) ── */}
        <AgentPanel
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
