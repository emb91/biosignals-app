'use client';

import { useAuth } from '@/context/AuthContext';
import { useEnrichmentGuard } from '@/context/EnrichmentGuardContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useCallback } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { AgentPanel, type AgentLeadsFilter } from '@/components/AgentPanel';
import { ArcovaLoader } from '@/components/ArcovaLoader';
import type { QueryLead } from '@/lib/leads-data';
import {
  type LeadAction,
  getLeadAction,
  getLeadActionFromFits,
  formatLeadActionLabel,
  resolveCompanyFitForLeadAction,
  resolveContactFitForLeadAction,
  isLeadReadyAwaitingContactSignal,
  LEAD_ACTION_PILL_CLASS,
  LEAD_ACTION_SORT_ORDER,
} from '@/lib/lead-action';
import { formatProvenanceImportedAt } from '@/lib/data-provenance';
import { ROUTES, withQuery } from '@/lib/routes';
import type { ContactEmailCategory, ContactEmailRow } from '@/lib/contact-emails';
import { cn } from '@/lib/utils';
import { TableFitGaugeButton } from '@/components/TableFitGaugeButton';
import '@/app/leads/contacts-layout.css';
import {
  Activity,
  AlertTriangle,
  Users,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Pencil,
  Trash2,
  X,
  ExternalLink,
  RotateCw,
  Ban,
  Upload,
  Download,
  Check,
} from 'lucide-react';

interface EmploymentHistoryItem {
  company_name: string | null;
  title: string | null;
  start_date: string | null;
  end_date: string | null;
  current: boolean;
}

interface CompanyFirmographics {
  name?: string | null;
  company_type?: string | null;
  platform_category?: string | null;
  description?: string | null;
  bio_summary?: string | null;
  tagline?: string | null;
  website?: string | null;
  domain?: string | null;
  logo_url?: string | null;
  follower_count?: number | null;
  employee_count?: number | null;
  employee_range?: string | null;
  industry?: string | null;
  founded_year?: number | null;
  hq_city?: string | null;
  hq_state?: string | null;
  hq_country?: string | null;
  specialties?: string[] | null;
  products_services?: string[] | null;
  services?: string[] | null;
  technologies?: string[] | null;
  linkedin_url?: string | null;
  funding_stage?: string | null;
  funding_status_label?: string | null;
  funding_resolution_summary?: string | null;
  total_funding_usd?: number | null;
  latest_funding_date?: string | null;
  therapeutic_areas?: string[] | null;
  modalities?: string[] | null;
  development_stages?: string[] | null;
}

type CompanyFitComponentKey =
  | 'company_type'
  | 'platform_category'
  | 'therapeutic_areas'
  | 'modalities'
  | 'development_stages'
  | 'company_size'
  | 'funding';

interface CompanyFitBreakdownComponent {
  label: string;
  active: boolean;
  available: boolean;
  weight: number;
  earned: number;
  score01: number;
  detail: string;
  matchedCount?: number;
  totalSelected?: number;
  matchStatus?: string;
  matchedValues?: string[];
  unmatchedValues?: string[];
}

interface CompanyFitBreakdown {
  score_version: string;
  matched_on: string[];
  gaps: string[];
  summary: {
    raw_score01: number;
    final_score01: number;
    raw_score_pct: number;
    final_score_pct: number;
    score_cap01: number;
    coverage01: number;
    reasoning: string;
  };
  components: Record<CompanyFitComponentKey, CompanyFitBreakdownComponent>;
}

interface CompanyFitCandidate {
  icp_id: string;
  icp_name: string | null;
  icp_index: number | null;
  final_score: number | null;
  raw_score: number | null;
  score_cap: number | null;
  coverage: number | null;
  company_type_match_status: string | null;
  breakdown: CompanyFitBreakdown | null;
}

interface CompanyFitDetails {
  company_id: string;
  company_fit_score: number | null;
  company_fit_coverage: number | null;
  company_fit_scored_at: string | null;
  company_fit_version: string | null;
  matched_icp_id: string | null;
  matched_icp_name: string | null;
  winning_breakdown: CompanyFitBreakdown | null;
  icp_scores: CompanyFitCandidate[];
}

interface CompanyFitFetchState {
  loading: boolean;
  data: CompanyFitDetails | null;
  error: string | null;
  message: string | null;
}

type ContactFitComponentKey = 'business_area' | 'seniority';

interface ContactFitBreakdownComponent {
  label: string;
  active: boolean;
  available: boolean;
  weight: number;
  earned: number;
  score01: number;
  detail: string;
  matchedValue?: string | null;
  matchStatus?: string;
}

interface ContactFitBreakdown {
  score_version: string;
  matched_on: string[];
  gaps: string[];
  summary: {
    raw_score01: number;
    final_score01: number;
    raw_score_pct: number;
    final_score_pct: number;
    coverage01: number;
    reasoning: string;
  };
  components: Record<ContactFitComponentKey, ContactFitBreakdownComponent>;
}

interface ContactFitCandidate {
  persona_id: string;
  persona_name: string | null;
  icp_id: string | null;
  icp_name: string | null;
  final_score: number | null;
  raw_score: number | null;
  coverage: number | null;
}

interface ContactFitDetails {
  contact_id: string;
  contact_fit_score: number | null;
  contact_fit_coverage: number | null;
  contact_fit_scored_at: string | null;
  contact_fit_version: string | null;
  scored_against_persona_id: string | null;
  matched_persona_name: string | null;
  matched_icp_id: string | null;
  matched_icp_name: string | null;
  winning_breakdown: ContactFitBreakdown | null;
  persona_scores: ContactFitCandidate[];
}

interface ContactFitFetchState {
  loading: boolean;
  data: ContactFitDetails | null;
  error: string | null;
  message: string | null;
}

interface Lead {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  job_title_standardised: string | null;
  seniority_level: string | null;
  business_area: string | null;
  company_name: string | null;
  company_domain: string | null;
  company_linkedin_url: string | null;
  email: string | null;
  email_status: string | null;
  email_status_reasoning: string | null;
  linkedin_url: string | null;
  profile_photo_url: string | null;
  headline: string | null;
  location: string | null;
  resolved_current_company_name: string | null;
  resolved_current_company_domain: string | null;
  resolved_current_job_title: string | null;
  resolved_employment_history: EmploymentHistoryItem[] | null;
  contact_bio: string[] | null;
  contact_discovery_status: string | null;
  linkedin_resolution_status: string | null;
  profile_enrichment_status: string | null;
  linkedin_resolution_last_error?: string | null;
  profile_enrichment_last_error?: string | null;
  linkedin_resolution_started_at?: string | null;
  linkedin_resolution_completed_at?: string | null;
  profile_enrichment_started_at?: string | null;
  profile_enrichment_completed_at?: string | null;
  enrichment_refresh_status?: 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled' | null;
  enrichment_refresh_last_error?: string | null;
  enrichment_refresh_started_at?: string | null;
  enrichment_refresh_finished_at?: string | null;
  fit_score: number | null;
  intent_score: number | null;
  overall_fit_score: number | null;
  company_fit_score: number | null;
  contact_fit_score: number | null;
  source: string;
  created_at: string;
  updated_at: string | null;
  company_id: string | null;
  matched_icp_name: string | null;
  matched_icp_index?: number | null;
  matched_icp_label?: string | null;
  /** CSV, HubSpot, Arcova label from API */
  data_provenance_type?: string | null;
  data_provenance_imported_at?: string | null;
  contact_emails?: ContactEmailRow[] | null;
  companies: {
    company_name: string | null;
    domain: string | null;
    website: string | null;
    linkedin_url: string | null;
    description: string | null;
    bio_summary: string | null;
    tagline: string | null;
    logo_url: string | null;
    follower_count: number | null;
    company_type: string | null;
    company_type_display: string | null;
    platform_category: string | null;
    funding_stage: string | null;
    funding_status_label: string | null;
    total_funding_usd: number | null;
    funding_data_source: string | null;
    funding_resolution_confidence: string | null;
    funding_resolution_summary: string | null;
    founded_year: number | null;
    headquarters_city: string | null;
    headquarters_state: string | null;
    headquarters_country: string | null;
    specialties: string[] | null;
    products_services: string[] | null;
    services: string[] | null;
    technologies: string[] | null;
    therapeutic_areas: string[] | null;
    modalities: string[] | null;
    development_stages: string[] | null;
    clinical_stage: string | null;
    employee_count: number | null;
    employee_range: string | null;
    industry: string | null;
    latest_funding_date: string | null;
    matched_icp_id: string | null;
    last_enriched_at: string | null;
    company_fit_score?: number | null;
  } | null;
}

type EditableLeadFields = {
  first_name: string;
  last_name: string;
  email: string;
};

type EnrichmentStageKey =
  | 'queued'
  | 'linkedin_processing'
  | 'linkedin_resolved'
  | 'profile_processing'
  | 'complete'
  | 'stopped';

type LeadRefreshStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled';

type EnrichmentVisualState = {
  stageKey: EnrichmentStageKey;
  startedAt: number;
  startPercent: number;
};

const PAGE_SIZE = 50;
const LEADS_TABLE_GRID =
  'grid grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,5.25rem)_minmax(0,5.25rem)_minmax(9.5rem,1.25fr)] gap-x-5';
const MAX_VISIBLE_WORK_HISTORY = 3;
const COMPANY_FIT_COMPONENT_ORDER: CompanyFitComponentKey[] = [
  'company_type',
  'platform_category',
  'therapeutic_areas',
  'modalities',
  'development_stages',
  'company_size',
  'funding',
];
const CONTACT_FIT_COMPONENT_ORDER: ContactFitComponentKey[] = ['business_area', 'seniority'];

const formatLastUpdated = (iso: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatPercentValue = (value: number | null | undefined): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return `${Math.round((value <= 1 ? value * 100 : value))}%`;
};

/** Integer 0–100 for progress bars */
const percentDisplayNumber = (value: number | null | undefined): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value <= 1 ? value * 100 : value);
};

function contactEmailCategoryLabel(category: ContactEmailCategory): string {
  switch (category) {
    case 'import':
      return 'Import';
    case 'user':
      return 'Added by you';
    case 'enriched_work':
      return 'Work';
    case 'enriched_personal':
      return 'Personal';
  }
}

function actionDrawerRelativeTime(iso?: string | null): string | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return null;
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

type ActionFitCriterion = { ok: 'pass' | 'warn' | 'miss'; text: string; val: string };

function score01ToFitOk(score01: number, matchStatus?: string | null): ActionFitCriterion['ok'] {
  if (matchStatus === 'mismatch') return 'miss';
  if (score01 >= 0.84) return 'pass';
  if (score01 >= 0.45) return 'warn';
  return 'miss';
}

const formatPercent = (value: number | null | undefined): string | null => {
  const percent = formatPercentValue(value);
  return percent ? `${percent} fit` : null;
};

const formatCoverage = (value: number | null | undefined): string | null => {
  const percent = formatPercentValue(value);
  return percent ? `${percent} coverage` : null;
};

const formatMatchStatus = (value: string | null | undefined): string | null => {
  if (!value) return null;
  return value.replace(/_/g, ' ');
};

const getExactCompanyFitPillLabels = (
  key: CompanyFitComponentKey,
  detail: string | null | undefined,
): string[] => {
  if (!detail) return [];

  if (key === 'company_type') {
    const match = detail.match(/^Matches\s+(.+?)\.$/i);
    return match?.[1] ? [match[1]] : [];
  }

  if (key === 'company_size') {
    const match = detail.match(/^Exact size-band match on\s+(.+?)\.$/i);
    return match?.[1] ? [match[1]] : [];
  }

  if (key === 'funding') {
    const labels: string[] = [];
    const stageMatch = detail.match(/Funding stage\s+(.+?)\s+compared with ICP target/i);
    if (stageMatch?.[1]) labels.push(stageMatch[1]);

    const bucketMatch = detail.match(/Raised bucket\s+(.+?)\s+compared with ICP target bucket/i);
    if (bucketMatch?.[1]) labels.push(bucketMatch[1]);

    return labels;
  }

  return [];
};

const getExactCompanyFitStatusLabel = (
  key: CompanyFitComponentKey,
  component: { matchStatus?: string | null; detail?: string | null },
): string | null => {
  const hasExactPillFallback = getExactCompanyFitPillLabels(key, component.detail).length > 0;
  if (component.matchStatus !== 'exact' && !hasExactPillFallback) return null;

  if (key === 'company_type') return 'Company type match';
  if (key === 'company_size') return 'Company size match';
  if (key === 'funding') return 'Funding match';

  return null;
};

const getDisplayedCompanyFirmographics = (lead: Lead | null): CompanyFirmographics | null => {
  if (!lead) return null;

  const company = lead.companies;
  if (!company && !lead.resolved_current_company_name && !lead.company_name) {
    return null;
  }

  return {
    name: company?.company_name || lead.resolved_current_company_name || lead.company_name || null,
    company_type: company?.company_type || company?.company_type_display || null,
    platform_category: company?.platform_category || null,
    description: company?.description || null,
    bio_summary: company?.bio_summary || null,
    tagline: company?.tagline || null,
    website: company?.website || null,
    domain: company?.domain || lead.resolved_current_company_domain || lead.company_domain || null,
    logo_url: company?.logo_url || null,
    follower_count: company?.follower_count ?? null,
    employee_count: company?.employee_count ?? null,
    employee_range: company?.employee_range ?? null,
    industry: company?.industry || null,
    founded_year: company?.founded_year ?? null,
    hq_city: company?.headquarters_city || null,
    hq_state: company?.headquarters_state || null,
    hq_country: company?.headquarters_country || null,
    specialties: company?.specialties || null,
    products_services: company?.products_services || null,
    services: company?.services || null,
    technologies: company?.technologies || null,
    linkedin_url: company?.linkedin_url || lead.company_linkedin_url || null,
    funding_stage: company?.funding_stage || null,
    funding_status_label: company?.funding_status_label || null,
    funding_resolution_summary: company?.funding_resolution_summary || null,
    total_funding_usd: company?.total_funding_usd ?? null,
    latest_funding_date: company?.latest_funding_date || null,
    therapeutic_areas: company?.therapeutic_areas || null,
    modalities: company?.modalities || null,
    development_stages: company?.development_stages || null,
  };
};

const getEnrichmentStage = (lead: Lead): {
  key: EnrichmentStageKey;
  label: string;
  floor: number;
  ceiling: number;
  paceMs: number;
} => {
  const linkedinStatus = lead.linkedin_resolution_status || 'pending';
  const profileStatus = lead.profile_enrichment_status || 'pending';

  if (profileStatus === 'completed' || profileStatus === 'ambiguous') {
    return { key: 'complete', label: 'Enrichment complete', floor: 100, ceiling: 100, paceMs: 1 };
  }

  if (profileStatus === 'failed' || profileStatus === 'blocked') {
    return { key: 'stopped', label: 'Enrichment stopped', floor: 100, ceiling: 100, paceMs: 1 };
  }

  if (profileStatus === 'processing') {
    return {
      key: 'profile_processing',
      label: 'Resolving company data',
      floor: 68,
      ceiling: 94,
      paceMs: 12000,
    };
  }

  if (linkedinStatus === 'completed' && profileStatus === 'pending') {
    return {
      key: 'linkedin_resolved',
      label: 'Gathering company details',
      floor: 48,
      ceiling: 66,
      paceMs: 7000,
    };
  }

  if (linkedinStatus === 'processing') {
    return {
      key: 'linkedin_processing',
      label: 'Finding LinkedIn contact',
      floor: 16,
      ceiling: 46,
      paceMs: 10000,
    };
  }

  return {
    key: 'queued',
    label: 'Queued for enrichment',
    floor: 6,
    ceiling: 18,
    paceMs: 6000,
  };
};

const getEnrichmentLabel = (
  stage: ReturnType<typeof getEnrichmentStage>,
  percent: number
): string => {
  if (stage.key === 'complete' || stage.key === 'stopped' || stage.key === 'queued') {
    return stage.label;
  }

  if (stage.key === 'linkedin_processing') {
    return percent < 32 ? 'Finding LinkedIn contact' : 'Building contact profile';
  }

  if (stage.key === 'linkedin_resolved') {
    return percent < 58 ? 'Gathering company details' : 'Building company profile';
  }

  if (stage.key === 'profile_processing') {
    return percent < 84 ? 'Resolving company data' : 'Finalizing enrichment';
  }

  return stage.label;
};

const getInterpolatedEnrichmentPercent = (
  startPercent: number,
  stage: ReturnType<typeof getEnrichmentStage>,
  elapsedMs: number
): number => {
  if (stage.floor >= stage.ceiling) {
    return stage.ceiling;
  }

  const safeStart = Math.min(Math.max(startPercent, stage.floor), stage.ceiling);
  const progress = 1 - Math.exp(-Math.max(elapsedMs, 0) / stage.paceMs);
  return safeStart + (stage.ceiling - safeStart) * progress;
};

const getEnrichmentErrorMessage = (lead: Lead): string | null => {
  const refreshError = lead.enrichment_refresh_last_error?.trim();
  if (refreshError) return refreshError;

  const profileError = lead.profile_enrichment_last_error?.trim();
  if (profileError) return profileError;

  const linkedinError = lead.linkedin_resolution_last_error?.trim();
  if (linkedinError) return linkedinError;

  if ((lead.profile_enrichment_status || '') === 'blocked') {
    return 'Blocked because LinkedIn resolution did not complete successfully.';
  }

  return null;
};

const normalizeLeadRefreshStatus = (
  status?: Lead['enrichment_refresh_status'],
): LeadRefreshStatus => {
  if (status === 'running' || status === 'succeeded' || status === 'failed' || status === 'cancelled') {
    return status;
  }

  return 'idle';
};

const getLeadRefreshStatusMeta = (
  status: LeadRefreshStatus,
): { label: string; className: string } => {
  switch (status) {
    case 'running':
      return {
        label: 'Enrichment in progress',
        className: 'border-arcova-teal/25 bg-arcova-teal/5 text-arcova-teal',
      };
    case 'succeeded':
      return {
        label: 'Enrichment done',
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      };
    case 'failed':
      return {
        label: 'Previous enrichment failed to run',
        className: 'border-amber-200 bg-amber-50 text-amber-700',
      };
    case 'cancelled':
      return {
        label: 'Enrichment stopped',
        className: 'border-slate-200 bg-slate-50 text-slate-600',
      };
    default:
      return {
        label: 'Idle',
        className: 'border-gray-200 bg-gray-50 text-gray-500',
      };
  }
};



function getSortValue(lead: Lead | QueryLead, col: string): string | number {
  switch (col) {
    case 'name':
      return (
        (lead as Lead).full_name ||
        [(lead as Lead).first_name, (lead as Lead).last_name].filter(Boolean).join(' ') ||
        ''
      ).toLowerCase();
    case 'job_title':
      return ((lead.resolved_current_job_title || lead.job_title) ?? '').toLowerCase();
    case 'company':
      return (
        (lead.resolved_current_company_name || lead.company_name) ?? ''
      ).toLowerCase();
    case 'status': {
      const companyFit =
        (lead as QueryLead).company_fit_score ??
        (lead as QueryLead).companies?.company_fit_score ??
        null;
      const order = LEAD_ACTION_SORT_ORDER;
      return order[getLeadActionFromFits(companyFit, lead.contact_fit_score ?? null, lead.intent_score ?? null)] ?? 0;
    }
    case 'company_fit':
      return (
        (lead as QueryLead).company_fit_score ??
        (lead as QueryLead).companies?.company_fit_score ??
        -1
      );
    case 'contact_fit':
      return lead.contact_fit_score ?? -1;
    case 'source':
      return ((lead as QueryLead).data_provenance_type ?? '').toLowerCase();
    case 'signals':
      return lead.intent_score && lead.intent_score > 0 ? 1 : 0;
    case 'icp_match':
      return ((lead as QueryLead).matched_icp_label ?? '').toLowerCase();
    case 'funding_stage':
      return ((lead as QueryLead).companies?.funding_stage ?? '').toLowerCase();
    case 'therapeutic_areas':
      return (((lead as QueryLead).companies?.therapeutic_areas ?? [])[0] ?? '').toLowerCase();
    case 'seniority':
      return (lead.seniority_level ?? '').toLowerCase();
    default:
      return '';
  }
}

function applySortCol<T extends Lead | QueryLead>(
  items: T[],
  col: string | null,
  dir: 'asc' | 'desc',
): T[] {
  if (!col) return items;
  return [...items].sort((a, b) => {
    const va = getSortValue(a, col);
    const vb = getSortValue(b, col);
    const cmp = typeof va === 'number' && typeof vb === 'number'
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

// ─────────────────────────────────────────────────────────────────────────────

export default function LeadsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { guardedNavigate } = useEnrichmentGuard();
  const searchParams = useSearchParams();

  const [agentTrigger, setAgentTrigger] = useState<{ text: string; nonce: number; isHidden?: boolean } | undefined>();
  const fireAgent = (text: string) =>
    setAgentTrigger((prev) => ({ text, nonce: (prev?.nonce ?? 0) + 1 }));
  const dashboardAgentTaskFiredRef = useRef<string | null>(null);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);
  const [editingFields, setEditingFields] = useState<EditableLeadFields | null>(null);
  const [savingLeadId, setSavingLeadId] = useState<string | null>(null);
  const [deletingLeadId, setDeletingLeadId] = useState<string | null>(null);
  const [refreshingLeadId, setRefreshingLeadId] = useState<string | null>(null);
  const [hubspotConnected, setHubspotConnected] = useState(false);
  const [pushingToHubspot, setPushingToHubspot] = useState(false);
  const [hubspotSyncResult, setHubspotSyncResult] = useState<{
    contacts: { upserted: number; errors: number };
    skipped: number;
    skippedContacts: { name: string; company: string | null; reason: string }[];
  } | null>(null);
  const [syncResultExpanded, setSyncResultExpanded] = useState(false);
  const [stoppingLeadId, setStoppingLeadId] = useState<string | null>(null);
  const [stopEnrichmentError, setStopEnrichmentError] = useState<string | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<'contact' | 'scoring' | 'action'>('contact');
  const [isWorkHistoryExpanded, setIsWorkHistoryExpanded] = useState(false);
  const [contactPanelOpen, setContactPanelOpen] = useState({
    fit: true,
    about: true,
    details: true,
    workHistory: true,
  });
  const [scoringPanelOpen, setScoringPanelOpen] = useState({
    priority: true,
    icpFit: true,
    contactFit: true,
    otherIcps: false,
  });
  const [expandedBars, setExpandedBars] = useState<Set<string>>(new Set());
  const toggleBar = (key: string) => setExpandedBars(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const [companyFitByCompanyId, setCompanyFitByCompanyId] = useState<Record<string, CompanyFitFetchState>>({});
  const [contactFitByContactId, setContactFitByContactId] = useState<Record<string, ContactFitFetchState>>({});
  const companyFitCacheRef = useRef(companyFitByCompanyId);
  companyFitCacheRef.current = companyFitByCompanyId;
  const contactFitCacheRef = useRef(contactFitByContactId);
  contactFitCacheRef.current = contactFitByContactId;
  const [enrichmentVisuals, setEnrichmentVisuals] = useState<Record<string, EnrichmentVisualState>>({});
  const [progressNow, setProgressNow] = useState(() => Date.now());

  // Agent-driven filter state — just the set of matching contact IDs
  const [agentFilterIds, setAgentFilterIds] = useState<Set<string> | null>(null);

  // Column sort state (client-side, applies to current page / agent filter)
  const [tableSortCol, setTableSortCol] = useState<string | null>(null);
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  const fetchLeads = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoadingLeads(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (search) params.set('search', search);

      const res = await fetch(`/api/leads?${params}`);
      if (res.ok) {
        const result = await res.json();
        const nextLeads = (result.data || []).slice().sort((a: Lead, b: Lead) => {
          const aScore = a.overall_fit_score ?? -1;
          const bScore = b.overall_fit_score ?? -1;
          return bScore - aScore;
        });
        setLeads(nextLeads);
        setTotal(result.total || 0);

        setSelectedLeadId((current) => {
          if (current && nextLeads.some((lead: Lead) => lead.id === current)) return current;
          return nextLeads[0]?.id ?? null;
        });
      }
    } catch (err) {
      console.error('Error fetching leads:', err);
    } finally {
      if (!silent) setLoadingLeads(false);
    }
  }, [user, page, search]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  useEffect(() => {
    fetch('/api/hubspot/status')
      .then((r) => r.json())
      .then((data) => setHubspotConnected(data.connected === true))
      .catch(() => {});
  }, []);

  const handlePushToHubspot = useCallback(async () => {
    if (pushingToHubspot) return;
    setPushingToHubspot(true);
    setHubspotSyncResult(null);
    setSyncResultExpanded(false);
    try {
      const res = await fetch('/api/hubspot/push-enrichment', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.contacts) setHubspotSyncResult(data);
      } else {
        console.error('HubSpot push failed:', await res.text());
      }
    } catch (err) {
      console.error('HubSpot push error:', err);
    } finally {
      setPushingToHubspot(false);
    }
  }, [pushingToHubspot]);

  const handleDownloadCsv = useCallback(async () => {
    // Fetch all leads (loop pages)
    const allLeads: Lead[] = [];
    let p = 1;
    while (true) {
      const params = new URLSearchParams({ page: String(p), pageSize: '100' });
      if (search) params.set('search', search);
      const res = await fetch(`/api/leads?${params}`);
      if (!res.ok) break;
      const result = await res.json();
      const batch: Lead[] = result.data || [];
      allLeads.push(...batch);
      if (allLeads.length >= (result.total || 0) || batch.length === 0) break;
      p++;
    }

    const actionLabel = (lead: Lead) => formatLeadActionLabel(getLeadAction(lead));

    const pct = (n: number | null | undefined) =>
      n != null && Number.isFinite(n) ? `${Math.round(n * 100)}%` : '';

    const headers = [
      // Contact
      'Name', 'Email', 'LinkedIn', 'Job Title', 'Seniority', 'Function',
      // Company
      'Company', 'Company Domain', 'Company LinkedIn',
      // Firmographics
      'Company Type', 'Therapeutic Areas', 'Modalities', 'Development Stages',
      'Funding Stage', 'Total Raised (USD)', 'Employees', 'HQ City', 'HQ Country', 'Founded',
      // Fit & ICP
      'Overall Fit', 'Company Fit', 'Contact Fit', 'ICP Best Match',
      // Action
      'Action',
    ];

    const rows = allLeads.map((l) => {
      const co = l.companies;
      return [
        // Contact
        l.full_name ?? '',
        l.email ?? '',
        l.linkedin_url ?? '',
        l.job_title ?? '',
        l.seniority_level ?? '',
        l.business_area ?? '',
        // Company
        l.company_name ?? co?.company_name ?? '',
        l.company_domain ?? co?.domain ?? '',
        co?.linkedin_url ?? '',
        // Firmographics
        co?.company_type ?? '',
        (co?.therapeutic_areas ?? []).join('; '),
        (co?.modalities ?? []).join('; '),
        (co?.development_stages ?? []).join('; '),
        co?.funding_stage ?? '',
        co?.total_funding_usd != null ? String(co.total_funding_usd) : '',
        co?.employee_count != null ? String(co.employee_count) : (co?.employee_range ?? ''),
        co?.headquarters_city ?? '',
        co?.headquarters_country ?? '',
        co?.founded_year != null ? String(co.founded_year) : '',
        // Fit & ICP
        pct(l.overall_fit_score),
        pct(typeof l.company_fit_score === 'number' ? l.company_fit_score : co?.company_fit_score ?? null),
        pct(l.contact_fit_score),
        l.matched_icp_label ?? '',
        // Action
        actionLabel(l),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });

    const csv = [headers.map((h) => `"${h}"`).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [search]);


  useEffect(() => {
    const id = searchParams.get('lead');
    if (!id || leads.length === 0) return;
    if (leads.some((l) => l.id === id)) {
      setSelectedLeadId(id);
      setSelectedPreview('contact');
    }
  }, [searchParams, leads]);

  const urlSearchParam = searchParams.get('search') ?? '';
  useEffect(() => {
    const q = urlSearchParam.trim();
    if (!q) return;
    setSearchInput(q);
    setSearch(q);
    setPage(1);
  }, [urlSearchParam]);

  const dashboardAgentTask = searchParams.get('agentTask') ?? '';
  useEffect(() => {
    if (!user || dashboardAgentTaskFiredRef.current === dashboardAgentTask) return;

    const taskMessages: Record<string, string> = {
      new_contacts:
        'Filter the contacts table to the newest contacts from the latest import batch. Use filter_leads_table with filters.latestImportOnly=true, columns name/job_title/company/status/company_fit/contact_fit/source, sort by status_best_first. Keep your reply short and friendly.',
      best_leads:
        'Filter the contacts table to the best leads to work now. Use filter_leads_table with filters.actions=["reach_out","monitor"], columns name/job_title/company/status/company_fit/contact_fit/source, sort by status_best_first. Keep your reply short and friendly.',
      arcova_contacts_today:
        'Filter the contacts table to Arcova-sourced contacts imported today. Use filter_leads_table with filters.sources=["arcova"] and filters.importedToday=true, columns name/job_title/company/status/company_fit/contact_fit/source, sort by status_best_first. Keep your reply short and friendly, and mention these are the new Arcova contacts from today.',
    };

    const companyId = searchParams.get('companyId') ?? '';
    if (dashboardAgentTask === 'arcova_contacts_at_company' && companyId) {
      taskMessages.arcova_contacts_at_company =
        `Filter the contacts table to Arcova-sourced contacts at company id ${companyId}. Use filter_leads_table with filters.companyIds=["${companyId}"] and filters.sources=["arcova"], columns name/job_title/company/status/company_fit/contact_fit/source, sort by status_best_first. Keep your reply short and friendly, and mention these are the new Arcova contacts for this company.`;
    }

    const message = taskMessages[dashboardAgentTask];
    if (!message) return;

    dashboardAgentTaskFiredRef.current = dashboardAgentTask;
    setAgentTrigger((prev) => ({
      text: message,
      nonce: (prev?.nonce ?? 0) + 1,
      isHidden: true,
    }));
  }, [dashboardAgentTask, user]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setIsWorkHistoryExpanded(false);
  }, [selectedLeadId, selectedPreview]);

  const startEditingLead = (lead: Lead) => {
    setEditingLeadId(lead.id);
    setEditingFields({
      first_name: lead.first_name || '',
      last_name: lead.last_name || '',
      email: lead.email || '',
    });
  };

  const cancelEditingLead = () => {
    setEditingLeadId(null);
    setEditingFields(null);
  };

  const handleLeadsFilter = (_filter: AgentLeadsFilter, leads: QueryLead[]) => {
    setAgentFilterIds(new Set(leads.map((l) => l.id)));
    setSelectedLeadId(null);
    setTableSortCol(null);
  };

  const handleQueryClear = () => {
    setAgentFilterIds(null);
    setSelectedLeadId(null);
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

  const updateEditingField = (field: keyof EditableLeadFields, value: string) => {
    setEditingFields((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const saveLead = async (leadId: string) => {
    if (!editingFields) return;

    setSavingLeadId(leadId);
    try {
      const response = await fetch(`/api/leads/${leadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editingFields,
          full_name: `${editingFields.first_name} ${editingFields.last_name}`.trim(),
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update lead.');
      }

      setLeads((prev) =>
        prev.map((lead) =>
          lead.id === leadId
            ? {
                ...lead,
                full_name: result.data.full_name,
                first_name: result.data.first_name,
                last_name: result.data.last_name,
                email: result.data.email,
                updated_at: result.data.updated_at,
                contact_emails: Array.isArray(result.data.contact_emails)
                  ? (result.data.contact_emails as ContactEmailRow[])
                  : lead.contact_emails,
              }
            : lead
        )
      );
      cancelEditingLead();
    } catch (error) {
      console.error('Error updating lead:', error);
    } finally {
      setSavingLeadId(null);
    }
  };

  const deleteLead = async (leadId: string) => {
    const confirmed = window.confirm('Remove this contact from Leads?');
    if (!confirmed) return;

    setDeletingLeadId(leadId);
    try {
      const response = await fetch(`/api/leads/${leadId}`, {
        method: 'DELETE',
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete lead.');
      }

      setLeads((prev) => prev.filter((lead) => lead.id !== leadId));
      setTotal((prev) => Math.max(prev - 1, 0));

      cancelEditingLead();
      if (selectedLeadId === leadId) {
        setSelectedLeadId(null);
      }
    } catch (error) {
      console.error('Error deleting lead:', error);
    } finally {
      setDeletingLeadId(null);
    }
  };

  const rerunEnrichment = async (leadId: string) => {
    const companyId = leads.find((lead) => lead.id === leadId)?.company_id ?? null;
    const startedAt = new Date().toISOString();
    setContactFitByContactId((prev) => {
      if (!prev[leadId]) return prev;
      const next = { ...prev };
      delete next[leadId];
      return next;
    });
    setRefreshingLeadId(leadId);
    setLeads((prev) =>
      prev.map((lead) =>
        lead.id === leadId
          ? {
              ...lead,
              linkedin_resolution_status: 'processing',
              profile_enrichment_status: 'pending',
              linkedin_resolution_last_error: null,
              profile_enrichment_last_error: null,
              enrichment_refresh_status: 'running',
              enrichment_refresh_last_error: null,
              enrichment_refresh_started_at: startedAt,
              enrichment_refresh_finished_at: null,
            }
          : lead
      )
    );
    if (companyId) {
      setCompanyFitByCompanyId((prev) => {
        if (!prev[companyId]) return prev;
        const next = { ...prev };
        delete next[companyId];
        return next;
      });
    }

    try {
      const response = await fetch(`/api/enrich/${leadId}`, {
        method: 'POST',
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to refresh enrichment.');
      }

      if (result.alreadyRunning) {
        await fetchLeads(true);
        return;
      }

      await fetchLeads(true);
    } catch (error) {
      console.error('Error refreshing enrichment:', error);
      await fetchLeads(true);
      window.alert('Could not refresh enrichment for this lead. Please try again.');
    } finally {
      setRefreshingLeadId(null);
    }
  };

  const stopLeadEnrichment = async (leadId: string) => {
    setStoppingLeadId(leadId);
    setStopEnrichmentError(null);
    try {
      const response = await fetch(`/api/enrich/${leadId}`, { method: 'DELETE' });
      // 409 means enrichment already finished — not an error worth surfacing
      if (!response.ok && response.status !== 409) {
        const result = await response.json().catch(() => ({}));
        setStopEnrichmentError(
          typeof result.error === 'string' ? result.error : 'Could not stop enrichment.',
        );
      }
      await fetchLeads(true);
    } catch (error) {
      console.error('Error stopping enrichment:', error);
      setStopEnrichmentError('Could not stop enrichment. Please try again.');
      await fetchLeads(true);
    } finally {
      setStoppingLeadId(null);
    }
  };

  const isEnriching = (lead: Lead) =>
    ['pending', 'processing'].includes(lead.linkedin_resolution_status || '') ||
    ['pending', 'processing'].includes(lead.profile_enrichment_status || '');

  const anyEnriching = leads.some(isEnriching);
  const isLeadRefreshRunning = (lead: Lead) =>
    normalizeLeadRefreshStatus(lead.enrichment_refresh_status) === 'running' ||
    isEnriching(lead);
  const anyLeadRefreshRunning = leads.some(isLeadRefreshRunning);

  const getLeadRefreshStatus = (lead: Lead): LeadRefreshStatus => {
    const normalizedStatus = normalizeLeadRefreshStatus(lead.enrichment_refresh_status);
    if (normalizedStatus !== 'idle') {
      return normalizedStatus;
    }

    if (isEnriching(lead)) {
      return 'running';
    }

    if (getEnrichmentErrorMessage(lead)) {
      return 'failed';
    }

    return 'idle';
  };

  useEffect(() => {
    const now = Date.now();
    setEnrichmentVisuals((previous) => {
      const next: Record<string, EnrichmentVisualState> = {};

      for (const lead of leads) {
        if (!isEnriching(lead)) continue;

        const stage = getEnrichmentStage(lead);
        const prior = previous[lead.id];

        if (prior && prior.stageKey === stage.key) {
          next[lead.id] = prior;
          continue;
        }

        const priorPercent = prior
          ? getInterpolatedEnrichmentPercent(
              prior.startPercent,
              getEnrichmentStage({ ...lead, linkedin_resolution_status: '', profile_enrichment_status: '' } as Lead),
              0
            )
          : stage.floor;

        const carriedPercent = prior
          ? getInterpolatedEnrichmentPercent(
              prior.startPercent,
              {
                ...getEnrichmentStage(lead),
                key: prior.stageKey,
                label: stage.label,
                floor: prior.startPercent,
                ceiling: Math.max(prior.startPercent, stage.floor),
                paceMs: 1,
              },
              now - prior.startedAt
            )
          : stage.floor;

        next[lead.id] = {
          stageKey: stage.key,
          startedAt: now,
          startPercent: Math.max(stage.floor, prior ? Math.max(priorPercent, carriedPercent) : stage.floor),
        };
      }

      return next;
    });
  }, [leads]);

  useEffect(() => {
    if (!anyEnriching) return;
    setProgressNow(Date.now());
    const interval = setInterval(() => {
      setProgressNow(Date.now());
    }, 900);
    return () => clearInterval(interval);
  }, [anyEnriching]);

  const getEnrichmentProgress = (lead: Lead): { percent: number; label: string } => {
    const stage = getEnrichmentStage(lead);
    const visual = enrichmentVisuals[lead.id];

    if (!visual || visual.stageKey !== stage.key) {
      const percent = Math.round(stage.floor);
      return { percent, label: getEnrichmentLabel(stage, percent) };
    }

    const percent = getInterpolatedEnrichmentPercent(
      visual.startPercent,
      stage,
      progressNow - visual.startedAt
    );

    const roundedPercent = Math.round(percent);
    return { percent: roundedPercent, label: getEnrichmentLabel(stage, roundedPercent) };
  };

  // Auto-poll every 5s while any contact is still being enriched
  useEffect(() => {
    if (!anyLeadRefreshRunning) return;
    const interval = setInterval(() => { fetchLeads(true); }, 5000);
    return () => clearInterval(interval);
  }, [anyLeadRefreshRunning, fetchLeads]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const sortedLeads = applySortCol(
    agentFilterIds ? leads.filter((l) => agentFilterIds.has(l.id)) : leads,
    tableSortCol,
    tableSortDir,
  );
  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) ?? null;
  const selectedContactFitState = selectedLeadId ? contactFitByContactId[selectedLeadId] ?? null : null;
  const selectedContactFit = selectedContactFitState?.data ?? null;
  const selectedCompanyId = selectedLead?.company_id ?? null;
  const selectedCompanyFitState = selectedCompanyId ? companyFitByCompanyId[selectedCompanyId] ?? null : null;
  const selectedCompanyFit = selectedCompanyFitState?.data ?? null;
  const isEditingSelected = selectedLead ? editingLeadId === selectedLead.id : false;
  const isSavingSelected = selectedLead ? savingLeadId === selectedLead.id : false;
  const isDeletingSelected = selectedLead ? deletingLeadId === selectedLead.id : false;
  const isRefreshingSelected = selectedLead ? refreshingLeadId === selectedLead.id : false;
  const isStoppingSelected = selectedLead ? stoppingLeadId === selectedLead.id : false;
  const isSelectedLeadRefreshRunning = selectedLead ? isLeadRefreshRunning(selectedLead) : false;
  const selectedLeadRefreshStatus = selectedLead ? getLeadRefreshStatus(selectedLead) : 'idle';
  const selectedLeadRefreshStatusMeta = getLeadRefreshStatusMeta(selectedLeadRefreshStatus);

  const selectedLeadDataSourceTypeLabel =
    !selectedLead
      ? '—'
      : (selectedLead.data_provenance_type ?? '').toLowerCase() === 'arcova'
        ? 'Arcova enrich'
        : (selectedLead.data_provenance_type ?? '').toLowerCase() === 'csv'
          ? 'CSV upload'
          : selectedLead.data_provenance_type ?? '—';

  const enrichmentFinishedDisplayIso: string | null =
    !selectedLead
      ? null
      : selectedLeadRefreshStatus === 'succeeded'
        ? selectedLead.enrichment_refresh_finished_at ?? selectedLead.profile_enrichment_completed_at ?? null
        : selectedLeadRefreshStatus === 'idle' &&
            ['completed', 'ambiguous'].includes(selectedLead.profile_enrichment_status || '')
          ? selectedLead.profile_enrichment_completed_at ?? null
          : null;

  const showEnrichmentDoneCopy =
    !!selectedLead &&
    !!enrichmentFinishedDisplayIso &&
    selectedLeadRefreshStatus !== 'running' &&
    selectedLeadRefreshStatus !== 'failed' &&
    selectedLeadRefreshStatus !== 'cancelled' &&
    (selectedLeadRefreshStatus === 'succeeded' ||
      (selectedLeadRefreshStatus === 'idle' &&
        ['completed', 'ambiguous'].includes(selectedLead.profile_enrichment_status || '')));

  useEffect(() => {
    if ((selectedPreview !== 'scoring' && selectedPreview !== 'action') || !selectedCompanyId) return;

    const cached = companyFitCacheRef.current[selectedCompanyId];
    const shouldRefreshForScoreMismatch =
      cached?.data &&
      typeof cached.data.company_fit_score === 'number' &&
      typeof selectedLead?.fit_score === 'number' &&
      Math.abs(cached.data.company_fit_score - selectedLead.fit_score) > 0.0001;

    if ((cached && !shouldRefreshForScoreMismatch) || cached?.loading) {
      return;
    }

    let cancelled = false;

    setCompanyFitByCompanyId((prev) => ({
      ...prev,
      [selectedCompanyId]: {
        loading: true,
        data: shouldRefreshForScoreMismatch ? null : prev[selectedCompanyId]?.data ?? null,
        error: null,
        message: null,
      },
    }));

    (async () => {
      try {
        const response = await fetch(`/api/companies/${selectedCompanyId}/fit`);
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.error || 'Failed to load company fit details.');
        }

        if (cancelled) return;

        setCompanyFitByCompanyId((prev) => ({
          ...prev,
          [selectedCompanyId]: {
            loading: false,
            data: result.data ?? null,
            error: null,
            message: typeof result.message === 'string' ? result.message : null,
          },
        }));
      } catch (error) {
        if (cancelled) return;

        setCompanyFitByCompanyId((prev) => ({
          ...prev,
          [selectedCompanyId]: {
            loading: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to load company fit details.',
            message: null,
          },
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId, selectedLead?.fit_score, selectedPreview]);

  useEffect(() => {
    if (!selectedLeadId) return;

    const cached = contactFitCacheRef.current[selectedLeadId];
    if (cached) {
      return;
    }

    let cancelled = false;

    setContactFitByContactId((prev) => ({
      ...prev,
      [selectedLeadId]: {
        loading: true,
        data: null,
        error: null,
        message: null,
      },
    }));

    (async () => {
      try {
        const response = await fetch(`/api/contacts/${selectedLeadId}/fit`);
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.error || 'Failed to load contact fit details.');
        }

        if (cancelled) return;

        setContactFitByContactId((prev) => ({
          ...prev,
          [selectedLeadId]: {
            loading: false,
            data: result.data ?? null,
            error: null,
            message: typeof result.message === 'string' ? result.message : null,
          },
        }));
      } catch (error) {
        if (cancelled) return;

        setContactFitByContactId((prev) => ({
          ...prev,
          [selectedLeadId]: {
            loading: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to load contact fit details.',
            message: null,
          },
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedLeadId, selectedPreview]);

  const renderCompanyIcpFitScoresCard = () => {
    const companyFitHeaderPct = selectedLead ? resolveCompanyFitForLeadAction(selectedLead) : null;
    return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
      <button
        type="button"
        onClick={() => setScoringPanelOpen((s) => ({ ...s, icpFit: !s.icpFit }))}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-100/60 transition-colors"
      >
        <span className="text-xs font-semibold text-gray-700">Company Fit</span>
        <div className="flex items-center gap-2">
          {companyFitHeaderPct !== null && (
            <span className="text-sm font-semibold tabular-nums text-gray-900">
              {formatPercentValue(companyFitHeaderPct)}
            </span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-gray-400 transition-transform duration-200 ${scoringPanelOpen.icpFit ? '' : '-rotate-90'}`} />
        </div>
      </button>
      {scoringPanelOpen.icpFit && (
        <div className="px-4 pb-4 space-y-3">
          {selectedCompanyFitState?.loading ? (
            <p className="text-xs text-gray-400">Loading ICP scores…</p>
          ) : selectedCompanyFit?.icp_scores?.length ? (
            (() => {
              const bestScore =
                selectedCompanyFit.icp_scores.find((s) => s.icp_id === selectedCompanyFit.matched_icp_id) ??
                selectedCompanyFit.icp_scores[0];
              const otherScores = selectedCompanyFit.icp_scores.filter((s) => s.icp_id !== bestScore?.icp_id);
              const renderScoreInner = (score: typeof bestScore) => {
                const isBest = score.icp_id === selectedCompanyFit.matched_icp_id;
                const breakdown = score.breakdown;
                return (
                  <div
                    key={score.icp_id}
                    className={
                      isBest
                        ? ''
                        : 'rounded-lg border border-slate-200 bg-white/80 px-3 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
                    }
                  >
                    <div>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                        {isBest ? 'Best fit' : 'Also scored'}
                        {score.icp_index != null ? `: ICP ${score.icp_index}` : ''}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold text-gray-900">{score.icp_name || 'Unnamed ICP'}</p>
                      {formatPercentValue(score.final_score) && (
                        <div className="mt-2">
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                            {formatPercentValue(score.final_score)}
                          </span>
                        </div>
                      )}
                    </div>

                    {isBest && breakdown && (
                      <div className="mt-5 space-y-2.5">
                        <p className="text-[11px] text-gray-400">Click a row to unfold detail</p>
                        {COMPANY_FIT_COMPONENT_ORDER.map((key) => {
                          const component = breakdown.components[key];
                          if (!component?.active) return null;
                          const componentPercent = formatPercentValue(component.score01);
                          const exactPillLabels = getExactCompanyFitPillLabels(key, component.detail);
                          const barKey = `icp:${score.icp_id}:${key}`;
                          const isOpen = expandedBars.has(barKey);
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
                                    {componentPercent && (
                                      <span className="text-[11px] text-slate-500">{componentPercent}</span>
                                    )}
                                    <ChevronDown
                                      className={`h-3 w-3 shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-0' : '-rotate-90'}`}
                                      aria-hidden
                                    />
                                  </div>
                                </div>
                                <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200">
                                  <div
                                    className={`h-full rounded-full ${component.available ? 'bg-arcova-teal' : 'bg-slate-300'}`}
                                    style={{
                                      width: `${Math.max(0, Math.min(100, Math.round(component.score01 * 100)))}%`,
                                    }}
                                  />
                                </div>
                              </button>
                              {isOpen && (
                                <div className="mt-1.5 space-y-1">
                                  {component.matchedValues && component.matchedValues.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {component.matchedValues.map((v) => (
                                        <span
                                          key={v}
                                          className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2 py-0.5 text-[11px] font-medium text-arcova-teal"
                                        >
                                          {v}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  {!(component.matchedValues && component.matchedValues.length > 0) &&
                                    exactPillLabels.length > 0 && (
                                      <div className="flex flex-wrap gap-1">
                                        {exactPillLabels.map((label) => (
                                          <span
                                            key={label}
                                            className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2 py-0.5 text-[11px] font-medium text-arcova-teal"
                                          >
                                            {label}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  {component.unmatchedValues && component.unmatchedValues.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {component.unmatchedValues.map((v) => (
                                        <span
                                          key={v}
                                          className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500"
                                        >
                                          {v}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              };
              return (
                <div className="space-y-3">
                  {bestScore && renderScoreInner(bestScore)}
                  {otherScores.length > 0 && (
                    <div className="pt-3 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={() => setScoringPanelOpen((s) => ({ ...s, otherIcps: !s.otherIcps }))}
                        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <ChevronDown
                          className={`w-3 h-3 transition-transform duration-200 ${scoringPanelOpen.otherIcps ? '' : '-rotate-90'}`}
                        />
                        {scoringPanelOpen.otherIcps
                          ? 'Hide'
                          : `${otherScores.length} other ICP${otherScores.length > 1 ? 's' : ''}`}
                      </button>
                      {scoringPanelOpen.otherIcps && (
                        <div className="mt-3 space-y-3">
                          {otherScores.map((s) => renderScoreInner(s))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()
          ) : selectedLead?.fit_score != null ? (
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-gray-900">{formatPercentValue(selectedLead.fit_score)}</p>
              {selectedLead.matched_icp_name && (
                <span className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2 py-0.5 text-[11px] font-medium text-arcova-teal">
                  {selectedLead.matched_icp_name}
                </span>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400">No ICP fit yet.</p>
          )}
        </div>
      )}
    </div>
    );
  };

  const renderContactFitScoresCard = () => {
    const contactFitHeaderPct = selectedLead ? resolveContactFitForLeadAction(selectedLead) : null;
    return (
      <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
        <button
          type="button"
          onClick={() => setScoringPanelOpen((s) => ({ ...s, contactFit: !s.contactFit }))}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-100/60 transition-colors"
        >
          <span className="text-xs font-semibold text-gray-700">Contact Fit</span>
          <div className="flex items-center gap-2">
            {contactFitHeaderPct !== null && (
              <span className="text-sm font-semibold tabular-nums text-gray-900">
                {formatPercentValue(contactFitHeaderPct)}
              </span>
            )}
            <ChevronDown
              className={`w-3.5 h-3.5 shrink-0 text-gray-400 transition-transform duration-200 ${scoringPanelOpen.contactFit ? '' : '-rotate-90'}`}
            />
          </div>
        </button>
        {scoringPanelOpen.contactFit && (
          <div className="px-4 pb-4 space-y-3">
            {selectedContactFitState?.loading ? (
              <p className="text-xs text-gray-400">Loading contact fit…</p>
            ) : selectedContactFit?.winning_breakdown && selectedLead ? (
              (() => {
                const fitBreakdown = selectedContactFit.winning_breakdown;
                return (
                  <div>
                    {formatPercentValue(selectedContactFit.contact_fit_score) && (
                      <div>
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                          {formatPercentValue(selectedContactFit.contact_fit_score)}
                        </span>
                      </div>
                    )}

                    <div className="mt-5 space-y-2.5">
                      <p className="text-[11px] text-gray-400">Click a row to unfold detail</p>
                      {CONTACT_FIT_COMPONENT_ORDER.map((key) => {
                        const component = fitBreakdown.components[key];
                        if (!component?.active) return null;
                        const componentPercent = formatPercentValue(component.score01);
                        const barKey = `contact:${key}`;
                        const isOpen = expandedBars.has(barKey);
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
                                  {componentPercent && (
                                    <span className="text-[11px] text-slate-500">{componentPercent}</span>
                                  )}
                                  <ChevronDown
                                    className={`h-3 w-3 shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-0' : '-rotate-90'}`}
                                    aria-hidden
                                  />
                                </div>
                              </div>
                              <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200">
                                <div
                                  className={`h-full rounded-full ${component.available ? 'bg-arcova-teal' : 'bg-slate-300'}`}
                                  style={{
                                    width: `${Math.max(0, Math.min(100, Math.round(component.score01 * 100)))}%`,
                                  }}
                                />
                              </div>
                            </button>
                            {isOpen &&
                              (() => {
                                const showPill = Boolean(component.matchedValue) && component.matchStatus !== 'mismatch';
                                const detailText: string | null = (() => {
                                  if (component.matchStatus === 'exact') return 'Exact match';
                                  if (key === 'seniority') {
                                    const contactSeniority = selectedLead.seniority_level ?? null;
                                    if (contactSeniority) {
                                      return `Contact is ${contactSeniority}. This is not the target buying group for this ICP`;
                                    }
                                  }
                                  return component.detail || null;
                                })();
                                if (!showPill && !detailText) return null;
                                return (
                                  <div className="mt-1.5 space-y-1">
                                    {showPill && (
                                      <div className="flex flex-wrap gap-1">
                                        <span className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2 py-0.5 text-[11px] font-medium text-arcova-teal">
                                          {component.matchedValue}
                                        </span>
                                      </div>
                                    )}
                                    {detailText && (
                                      <p className="text-[11px] leading-relaxed text-gray-400">{detailText}</p>
                                    )}
                                  </div>
                                );
                              })()}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()
            ) : (
              <p className="text-xs text-gray-400">No contact fit yet.</p>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderActionFitDesignCard = (
    title: string,
    pct01: number | null | undefined,
    criteria: ActionFitCriterion[],
    opts?: { emptyHint?: string; loading?: boolean },
  ) => {
    const n = percentDisplayNumber(pct01 ?? null);
    return (
      <div className="contacts-fit-card">
        <div className="contacts-fit-head">
          <span className="contacts-fit-head-title">{title}</span>
          <span className="contacts-fit-head-num">
            {opts?.loading ? (
              <span className="text-xs font-medium text-[#7d909a]">…</span>
            ) : n != null ? (
              <>
                {n}
                <span>%</span>
              </>
            ) : (
              <span className="text-sm font-semibold text-[#7d909a]">—</span>
            )}
          </span>
        </div>
        <div className="contacts-fit-bar" aria-hidden>
          {!opts?.loading && n != null ? (
            <span className="contacts-fit-bar-fill" style={{ width: `${Math.min(100, n)}%` }} />
          ) : null}
        </div>
        <div className="contacts-fit-criteria">
          {opts?.loading ? (
            <p className="text-xs text-[#7d909a]">Loading…</p>
          ) : criteria.length ? (
            criteria.map((row, i) => (
              <div key={`${row.text}-${i}`} className="contacts-fit-criterion">
                <span
                  className={cn(
                    'contacts-fit-criterion-icon',
                    row.ok === 'pass' && 'contacts-fit-criterion-pass',
                    row.ok === 'warn' && 'contacts-fit-criterion-warn',
                    row.ok === 'miss' && 'contacts-fit-criterion-miss',
                  )}
                >
                  {row.ok === 'pass' ? '✓' : row.ok === 'warn' ? '~' : '✗'}
                </span>
                <span className="contacts-fit-criterion-text">{row.text}</span>
                <span className="contacts-fit-criterion-val">{row.val}</span>
              </div>
            ))
          ) : (
            <p className="text-xs text-[#7d909a]">{opts?.emptyHint ?? 'No breakdown yet.'}</p>
          )}
        </div>
      </div>
    );
  };

  const buildActionContactFitCriteria = (): ActionFitCriterion[] => {
    const fitBreakdown = selectedContactFit?.winning_breakdown;
    if (!fitBreakdown) return [];
    const out: ActionFitCriterion[] = [];
    for (const key of CONTACT_FIT_COMPONENT_ORDER) {
      const c = fitBreakdown.components[key];
      if (!c?.active) continue;
      out.push({
        ok: score01ToFitOk(c.score01, c.matchStatus ?? null),
        text: c.label,
        val: formatPercentValue(c.score01) ?? '—',
      });
    }
    return out;
  };

  const renderOverallFitActionCard = () => {
    const overall =
      selectedLead &&
      typeof selectedLead.overall_fit_score === 'number' &&
      Number.isFinite(selectedLead.overall_fit_score)
        ? selectedLead.overall_fit_score
        : null;
    return (
      <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
        <div className="flex w-full items-center justify-between px-4 py-3">
          <span className="text-xs font-semibold text-gray-700">Overall Fit</span>
          {overall !== null ? (
            <span className="text-sm font-semibold tabular-nums text-gray-900">{formatPercentValue(overall)}</span>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-0 h-screen bg-transparent">
      <AppSidebar />

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 p-3.5 min-[1280px]:flex-row min-[1280px]:overflow-hidden">
        <div className="arcova-scroll-surface contacts-leads-main min-h-0 min-w-0 flex-1 overflow-y-auto rounded-[1.75rem] px-3 py-3 sm:px-5 sm:py-4">
          <div className="w-full max-w-none">
            <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-arcova-teal">
                  <Users className="h-3.5 w-3.5" />
                  Leads
                </div>
                <h1 className="font-manrope mt-2 text-3xl font-semibold leading-tight tracking-[-0.028em] text-slate-950 sm:text-[2.25rem]">
                  Contacts
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                  {total > 0
                    ? `${total.toLocaleString()} contact${total !== 1 ? 's' : ''} ready to review. Click a row for details, or the company name to open the account.`
                    : 'Your imported contacts will appear here once they are ready to review.'}
                </p>
              </div>

              {total > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => router.push('/import')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-arcova-teal text-white rounded-lg text-sm hover:bg-arcova-teal/90 transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Import
                  </button>
                  <button
                    onClick={handleDownloadCsv}
                    className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-200 bg-white text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                    title="Export leads as CSV"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export CSV
                  </button>
                  {hubspotConnected && (
                    <button
                      onClick={handlePushToHubspot}
                      disabled={pushingToHubspot}
                      className="inline-flex items-center gap-2 px-3 py-2 bg-[#ff7a59] text-white rounded-lg text-sm font-medium hover:bg-[#e8693f] transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
                      title="Sync enrichment data to HubSpot"
                    >
                      {pushingToHubspot ? (
                        <RotateCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M18.164 7.932V5.085a2.198 2.198 0 0 0 1.268-1.978V3.06A2.199 2.199 0 0 0 17.235.862h-.047a2.199 2.199 0 0 0-2.197 2.197v.047a2.199 2.199 0 0 0 1.268 1.978v2.847a6.232 6.232 0 0 0-2.962 1.302L5.028 3.617a2.44 2.44 0 0 0 .072-.573A2.455 2.455 0 1 0 2.645 5.5a2.43 2.43 0 0 0 1.194-.315l8.122 4.707a6.248 6.248 0 0 0 0 4.208L4.123 18.5a2.432 2.432 0 0 0-1.478-.498 2.455 2.455 0 1 0 2.455 2.455 2.43 2.43 0 0 0-.388-1.337l7.91-4.583a6.266 6.266 0 0 0 8.976-5.628 6.25 6.25 0 0 0-3.434-5.977zm-1.023 9.565a3.59 3.59 0 1 1 0-7.181 3.59 3.59 0 0 1 0 7.181z"/>
                        </svg>
                      )}
                      {pushingToHubspot ? 'Syncing…' : 'HubSpot Sync'}
                    </button>
                  )}
                </div>
              )}
            </div>

            {hubspotSyncResult && (
              <div className="mb-4 rounded-lg border border-[#ff7a59]/30 bg-[#fff5f2] pl-4 pr-4 pt-3.5 pb-3.5 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <svg className="w-4 h-4 shrink-0 mt-0.5 text-[#ff7a59]" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.164 7.932V5.085a2.198 2.198 0 0 0 1.268-1.978V3.06A2.199 2.199 0 0 0 17.235.862h-.047a2.199 2.199 0 0 0-2.197 2.197v.047a2.199 2.199 0 0 0 1.268 1.978v2.847a6.232 6.232 0 0 0-2.962 1.302L5.028 3.617a2.44 2.44 0 0 0 .072-.573A2.455 2.455 0 1 0 2.645 5.5a2.43 2.43 0 0 0 1.194-.315l8.122 4.707a6.248 6.248 0 0 0 0 4.208L4.123 18.5a2.432 2.432 0 0 0-1.478-.498 2.455 2.455 0 1 0 2.455 2.455 2.43 2.43 0 0 0-.388-1.337l7.91-4.583a6.266 6.266 0 0 0 8.976-5.628 6.25 6.25 0 0 0-3.434-5.977zm-1.023 9.565a3.59 3.59 0 1 1 0-7.181 3.59 3.59 0 0 1 0 7.181z"/>
                  </svg>
                  <div className="min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">
                        {hubspotSyncResult.contacts.upserted} contact{hubspotSyncResult.contacts.upserted !== 1 ? 's' : ''} synced
                      </span>
                      {hubspotSyncResult.contacts.errors > 0 && (
                        <span className="text-xs font-medium text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">
                          {hubspotSyncResult.contacts.errors} error{hubspotSyncResult.contacts.errors !== 1 ? 's' : ''}
                        </span>
                      )}
                      {hubspotSyncResult.skipped > 0 && (
                        <button
                          onClick={() => setSyncResultExpanded((v) => !v)}
                          className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full flex items-center gap-1 hover:bg-amber-100 transition-colors"
                        >
                          <svg className={`w-2.5 h-2.5 transition-transform ${syncResultExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                          {hubspotSyncResult.skipped} skipped
                        </button>
                      )}
                    </div>
                    {syncResultExpanded && hubspotSyncResult.skippedContacts.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {hubspotSyncResult.skippedContacts.map((c, i) => (
                          <li key={i} className="text-xs text-gray-600">
                            <span className="font-medium text-gray-800">{c.name}</span>
                            {c.company && <span className="text-gray-400"> · {c.company}</span>}
                            <span className="ml-1.5 text-amber-600">— {c.reason.toLowerCase()}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setHubspotSyncResult(null)}
                  className="shrink-0 text-gray-400 hover:text-gray-600 mt-0.5"
                  aria-label="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {loadingLeads ? (
              <div className="flex items-center justify-center py-24">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-arcova-teal" />
              </div>
            ) : leads.length === 0 && !search && !agentFilterIds ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-16 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No leads yet</h3>
                <p className="text-gray-500 mb-6 max-w-sm mx-auto">
                  Import a CSV of contacts to start reviewing enriched leads.
                </p>
                <button
                  onClick={() => router.push('/import')}
                  className="px-6 py-3 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors"
                >
                  Import contacts
                </button>
              </div>
            ) : leads.length === 0 && search && !agentFilterIds ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                <p className="text-gray-500">No leads matching &ldquo;{search}&rdquo;</p>
              </div>
            ) : (
              <>
              <div className="flex flex-col gap-4">
                {/* ── Leads table ── */}
                <div className="flex flex-col gap-2">

                {/* Contact coverage gap banner */}
                {(() => {
                  // Group leads by company_id; find companies with good fit but no perfect contact
                  const byCompany = new Map<string, { name: string; bestContactFit: number }>();
                  for (const lead of leads) {
                    if (!lead.company_id) continue;
                    const companyFit =
                      lead.company_fit_score ??
                      lead.companies?.company_fit_score ??
                      0;
                    if (companyFit < 0.6) continue;
                    const contactFit = lead.contact_fit_score ?? 0;
                    const existing = byCompany.get(lead.company_id);
                    if (existing) {
                      existing.bestContactFit = Math.max(existing.bestContactFit, contactFit);
                    } else {
                      byCompany.set(lead.company_id, {
                        name:
                          lead.resolved_current_company_name ??
                          lead.company_name ??
                          lead.companies?.company_name ??
                          'Unknown',
                        bestContactFit: contactFit,
                      });
                    }
                  }
                  const gapCompanies = Array.from(byCompany.values()).filter(
                    (c) => c.bestContactFit < 1,
                  );
                  if (gapCompanies.length === 0) return null;
                  const names = gapCompanies
                    .slice(0, 5)
                    .map((c) => c.name)
                    .join(', ');
                  const more = gapCompanies.length > 5 ? ` and ${gapCompanies.length - 5} more` : '';
                  return (
                    <button
                      type="button"
                      onClick={() =>
                        fireAgent(
                          `${gapCompanies.length === 1 ? 'One company in my leads is' : `${gapCompanies.length} companies in my leads are`} missing strong contact coverage: ${names}${more}. Explain what is going on and what I should do next.`,
                        )
                      }
                      className="w-full flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left transition-colors hover:bg-amber-100"
                    >
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                      <p className="text-sm font-medium text-amber-800">
                        {gapCompanies.length === 1
                          ? '1 company is missing strong contact coverage.'
                          : `${gapCompanies.length} companies are missing strong contact coverage.`}{' '}
                        <span className="font-normal text-amber-600">Click to learn more.</span>
                      </p>
                      <Activity className="ml-auto h-4 w-4 shrink-0 text-amber-400" />
                    </button>
                  );
                })()}

                {/* Agent filter banner */}
                {agentFilterIds && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-arcova-teal/20 bg-arcova-teal/5 px-4 py-2.5">
                    <p className="text-xs font-medium text-arcova-teal">
                      Filtered by agent · {sortedLeads.length} contact{sortedLeads.length !== 1 ? 's' : ''}
                    </p>
                    <button
                      onClick={handleQueryClear}
                      className="text-xs text-arcova-teal/70 hover:text-arcova-teal underline shrink-0 transition-colors"
                    >
                      Clear filter
                    </button>
                  </div>
                )}

                <div className="overflow-hidden rounded-[1.5rem] border border-[rgba(13,53,71,0.1)] bg-[rgba(255,255,255,0.52)] shadow-[0_24px_60px_-32px_rgba(13,53,71,0.16),0_2px_6px_-2px_rgba(13,53,71,0.06)] backdrop-blur-2xl backdrop-saturate-150">
                  {/* Table header */}
                  <div
                    className={`${LEADS_TABLE_GRID} items-start px-4 py-3 border-b border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.4)] text-xs font-semibold uppercase tracking-wide text-[#7d909a]`}
                  >
                    {(['name', 'job_title', 'company'] as const).map((col) => (
                      <button
                        key={col}
                        onClick={() => handleSortCol(col)}
                        className={`${
                          col === 'company'
                            ? 'flex flex-col items-start gap-0.5'
                            : 'flex items-start gap-1'
                        } hover:text-gray-800 transition-colors text-left`}
                      >
                        <span className="flex items-start gap-1">
                          {col === 'name' ? 'Name' : col === 'job_title' ? 'Job title' : 'Company name'}
                          <SortArrow col={col} activeCol={tableSortCol} dir={tableSortDir} />
                        </span>
                        {col === 'company' ? (
                          <span className="text-[10px] font-normal normal-case tracking-normal text-gray-400">
                            (click to view)
                          </span>
                        ) : null}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => handleSortCol('company_fit')}
                      className="flex w-full items-start justify-center gap-1 hover:text-gray-800 transition-colors"
                    >
                      <span className="flex items-center gap-1">
                        Company fit
                        <SortArrow col="company_fit" activeCol={tableSortCol} dir={tableSortDir} />
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSortCol('contact_fit')}
                      className="flex w-full items-start justify-center gap-1 hover:text-gray-800 transition-colors"
                    >
                      <span className="flex items-center gap-1">
                        Contact fit
                        <SortArrow col="contact_fit" activeCol={tableSortCol} dir={tableSortDir} />
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSortCol('status')}
                      className="flex w-full items-start justify-center gap-1 hover:text-gray-800 transition-colors"
                    >
                      Action
                      <SortArrow col="status" activeCol={tableSortCol} dir={tableSortDir} />
                    </button>
                  </div>

                  <div className="divide-y divide-[rgba(13,53,71,0.06)]">
                    {/* Single render path — agent filter narrows sortedLeads in-place */}
                    {sortedLeads.map((lead) => {
                      const isSelected = selectedLeadId === lead.id;
                      const enriching = isEnriching(lead);
                      const enrichmentProgress = getEnrichmentProgress(lead);

                      if (enriching) {
                        return (
                          <div
                            key={lead.id}
                            onClick={() => {
                              setSelectedLeadId(lead.id);
                              setSelectedPreview('contact');
                              cancelEditingLead();
                            }}
                            className={`${LEADS_TABLE_GRID} px-4 py-3 items-center cursor-pointer transition-all duration-150 border-b border-gray-50 last:border-0 ${
                              isSelected
                                ? 'border-l-2 border-arcova-teal'
                                : 'border-l-2 border-transparent hover:bg-arcova-teal/5 hover:border-arcova-teal/30'
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-400 truncate">
                                {lead.full_name ||
                                  [lead.first_name, lead.last_name].filter(Boolean).join(' ') ||
                                  '—'}
                              </p>
                            </div>

                            <div className="min-w-0">
                              <p className="text-xs text-gray-400 truncate leading-snug">
                                {enrichmentProgress.label}...
                              </p>
                            </div>

                            <div className="min-w-0 pr-3">
                              <div className="flex items-center gap-3">
                                <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200/80">
                                  <div
                                    className="arcova-enrichment-progress absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
                                    style={{ width: `${enrichmentProgress.percent}%` }}
                                  >
                                    <div className="arcova-enrichment-glow absolute inset-y-0 right-0 w-14 rounded-full" />
                                  </div>
                                </div>
                                <span className="text-[11px] font-medium tabular-nums text-gray-400">
                                  {enrichmentProgress.percent}%
                                </span>
                              </div>
                            </div>

                            <div className="min-w-0 flex items-center justify-center">
                              <span className="text-[11px] text-gray-300 tabular-nums">—</span>
                            </div>
                            <div className="min-w-0 flex items-center justify-center">
                              <span className="text-[11px] text-gray-300 tabular-nums">—</span>
                            </div>

                            <div className="min-w-0 flex items-center justify-center">
                              <ArcovaLoader size={28} />
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={lead.id}
                          onClick={() => {
                            setSelectedLeadId(lead.id);
                            setSelectedPreview('contact');
                            cancelEditingLead();
                          }}
                          className={`${LEADS_TABLE_GRID} px-4 py-3 items-center cursor-pointer transition-all duration-150 opacity-100 ${
                            isSelected
                              ? 'border-l-2 border-arcova-teal'
                              : 'border-l-2 border-transparent hover:bg-arcova-teal/5 hover:border-arcova-teal/30'
                          }`}
                        >
                          {/* Full name */}
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="font-medium text-gray-900 truncate text-sm">
                                {lead.full_name ||
                                  [lead.first_name, lead.last_name].filter(Boolean).join(' ') ||
                                  '—'}
                              </p>
                            </div>
                          </div>

                          {/* Job title */}
                          <div className="min-w-0">
                            <p className="text-xs text-gray-700 truncate leading-snug">
                              {((t) => t.length > 30 ? t.slice(0, 30) + '…' : t)(lead.resolved_current_job_title || lead.job_title || '—')}
                            </p>
                          </div>

                          {/* Company name */}
                          <div className="min-w-0">
                            {(() => {
                              const companyFirmographics = getDisplayedCompanyFirmographics(lead);
                              const name =
                                companyFirmographics?.name ||
                                lead.resolved_current_company_name ||
                                lead.company_name ||
                                '—';
                              const truncated = name.length > 30 ? name.slice(0, 30) + '…' : name;
                              const domain = companyFirmographics?.domain || lead.company_domain;
                              const href = companyFirmographics?.website || (domain ? `https://${domain}` : null);
                              if (lead.company_id) {
                                return (
                                  <div className="min-w-0">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        router.push(withQuery(ROUTES.leads.accounts, `companyId=${encodeURIComponent(lead.company_id!)}`));
                                      }}
                                      className="text-sm text-arcova-teal hover:underline truncate max-w-full text-left"
                                    >
                                      {truncated}
                                    </button>
                                  </div>
                                );
                              }
                              return href ? (
                                <div className="min-w-0">
                                  <a href={href} target="_blank" rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-sm text-arcova-teal hover:underline truncate max-w-full inline-block">
                                    {truncated}
                                  </a>
                                </div>
                              ) : (
                                <div className="min-w-0">
                                  <p className="text-sm text-gray-700 truncate">{truncated}</p>
                                </div>
                              );
                            })()}
                          </div>

                          {/* Company fit */}
                          <div className="min-w-0 flex items-center justify-center">
                            <TableFitGaugeButton
                              score={
                                lead.company_fit_score ?? lead.companies?.company_fit_score ?? null
                              }
                              isRowSelected={isSelected}
                              isGaugeHighlighted={isSelected && selectedPreview === 'scoring'}
                              title="View company fit"
                              onOpen={(e) => {
                                e.stopPropagation();
                                setSelectedLeadId(lead.id);
                                setSelectedPreview('scoring');
                                cancelEditingLead();
                              }}
                            />
                          </div>

                          {/* Contact fit */}
                          <div className="min-w-0 flex items-center justify-center">
                            <TableFitGaugeButton
                              score={lead.contact_fit_score}
                              isRowSelected={isSelected}
                              isGaugeHighlighted={isSelected && selectedPreview === 'scoring'}
                              title="View contact fit"
                              onOpen={(e) => {
                                e.stopPropagation();
                                setSelectedLeadId(lead.id);
                                setSelectedPreview('scoring');
                                cancelEditingLead();
                              }}
                            />
                          </div>

                          {/* Action */}
                          <div className="min-w-0 flex items-center justify-center">
                            {(() => {
                              const action = getLeadAction(lead);
                              const config = LEAD_ACTION_PILL_CLASS[action];
                              return (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedLeadId(lead.id);
                                    setSelectedPreview('action');
                                    cancelEditingLead();
                                  }}
                                  className={cn(
                                    'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer select-none',
                                    'transition-colors duration-150 ease-out hover:shadow-sm active:scale-[0.97]',
                                    isSelected && selectedPreview === 'action'
                                      ? config.rowSelectedClassName
                                      : cn(config.className, config.interactiveClassName),
                                  )}
                                >
                                  {config.label}
                                </button>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer — pagination when not filtered */}
                  {!agentFilterIds && totalPages > 1 && (
                    <div className="flex items-center justify-between border-t border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.35)] px-4 py-3">
                      <p className="text-xs text-gray-500">
                        {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of{' '}
                        {total.toLocaleString()}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          disabled={page === 1}
                          className="p-1.5 rounded text-gray-500 hover:text-gray-900 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-xs text-gray-600">
                          {page} / {totalPages}
                        </span>
                        <button
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                          disabled={page === totalPages}
                          className="p-1.5 rounded text-gray-500 hover:text-gray-900 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                </div>{/* end table + banner wrapper */}

                </div>{/* end flex flex-col gap-4 */}

                {/* ── Detail panel (overlays main column; sits left of agent on wide screens) ── */}
                {selectedLeadId && (
                  <>
                    <button
                      type="button"
                      className="fixed inset-0 z-40 bg-[rgba(13,53,71,0.14)] backdrop-blur-[1px] transition-opacity min-[1280px]:pointer-events-none min-[1280px]:opacity-0"
                      aria-label="Close panel"
                      onClick={() => {
                        setSelectedLeadId(null);
                        cancelEditingLead();
                      }}
                    />
                    <aside
                      className={cn(
                        'contacts-leads-drawer fixed z-50 flex max-h-[calc(100vh-1.75rem)] min-h-0 w-[min(22.5rem,calc(100vw-1.75rem))] flex-col overflow-hidden rounded-[1.3125rem] border border-[rgba(255,255,255,0.88)] bg-[rgba(255,255,255,0.55)] shadow-[0_24px_60px_-32px_rgba(13,53,71,0.2)] backdrop-blur-2xl backdrop-saturate-150',
                        'bottom-3.5 top-3.5 max-[1279px]:left-3.5 max-[1279px]:right-3.5 max-[1279px]:w-auto',
                        'min-[1280px]:right-[calc(22.5rem+1.75rem)]',
                      )}
                    >
                  {selectedLead ? (
                    <div
                      className={cn(
                        'flex h-full flex-col',
                        selectedPreview === 'contact' &&
                          'relative z-[1] before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-0 before:h-28 before:bg-gradient-to-b before:from-[rgba(227,243,241,0.75)] before:via-[rgba(255,255,255,0.35)] before:to-transparent',
                      )}
                    >
                      {/* Panel header */}
                      <div
                        className={cn(
                          'relative z-[1] flex items-start border-b border-[rgba(13,53,71,0.08)]',
                          selectedPreview === 'contact'
                            ? 'gap-3 px-4 pb-4 pt-5'
                            : 'gap-4 px-6 pb-5 pt-6',
                        )}
                      >
                        {/* Name / label */}
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              selectedPreview === 'contact'
                                ? 'text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7d909a]'
                                : selectedPreview === 'action'
                                  ? 'text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7d909a]'
                                  : 'text-xs font-medium uppercase tracking-wide text-arcova-teal',
                            )}
                          >
                            {selectedPreview === 'contact'
                              ? 'Contact details'
                              : selectedPreview === 'action'
                                ? 'Recommended action'
                                : 'Fit score'}
                          </p>
                          {selectedPreview === 'contact' && (
                            <h2 className="font-manrope mt-1.5 break-words text-xl font-bold leading-tight tracking-[-0.024em] text-[rgb(13,53,71)] sm:text-2xl">
                              {[selectedLead.first_name, selectedLead.last_name]
                                .filter(Boolean)
                                .join(' ') ||
                                selectedLead.full_name ||
                                'Selected contact'}
                            </h2>
                          )}
                          {selectedPreview === 'action' &&
                            (() => {
                              const action = getLeadAction(selectedLead);
                              const config = LEAD_ACTION_PILL_CLASS[action];
                              const contactName =
                                [selectedLead.first_name, selectedLead.last_name].filter(Boolean).join(' ') ||
                                selectedLead.full_name ||
                                'Selected contact';
                              const updatedIso =
                                selectedContactFit?.contact_fit_scored_at ??
                                selectedLead.updated_at ??
                                selectedLead.created_at ??
                                null;
                              const rel = actionDrawerRelativeTime(updatedIso);
                              return (
                                <>
                                  <h2 className="mt-1.5 font-manrope text-[22px] font-semibold leading-[1.1] tracking-[-0.02em] text-[#0d3547]">
                                    {contactName}
                                  </h2>
                                  <div className="mt-1 flex flex-wrap items-center gap-2.5">
                                    <span
                                      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${config.className}`}
                                    >
                                      {config.label}
                                    </span>
                                    {rel ? (
                                      <span className="text-[11px] text-[#7d909a]">Updated {rel}</span>
                                    ) : null}
                                  </div>
                                </>
                              );
                            })()}
                          {selectedPreview === 'scoring' && (
                            <div className="mt-1 space-y-2">
                              <h2 className="text-lg font-semibold text-gray-900 leading-tight">Lead prioritisation</h2>
                              <div className="flex flex-wrap gap-1.5">
                                {(selectedLead.matched_icp_index != null || selectedLead.matched_icp_name) && (
                                  <span className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2.5 py-0.5 text-xs font-medium text-arcova-teal">
                                    {selectedLead.matched_icp_index != null
                                      ? `Best fit ICP-${selectedLead.matched_icp_index}`
                                      : `Best fit: ${selectedLead.matched_icp_name}`}
                                  </span>
                                )}
                                {selectedContactFit?.contact_fit_score != null && (
                                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                                    Contact fit {formatPercentValue(selectedContactFit.contact_fit_score)}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Photo / logo + close (right side) */}
                        <div className="flex items-start gap-2 flex-shrink-0">
                          {selectedPreview === 'contact' ? (
                            selectedLead.profile_photo_url ? (
                              <img
                                src={selectedLead.profile_photo_url}
                                alt=""
                                className="h-[3.375rem] w-[3.375rem] shrink-0 rounded-xl object-cover shadow-sm ring-1 ring-black/5"
                              />
                            ) : (
                              <div className="flex h-[3.375rem] w-[3.375rem] shrink-0 items-center justify-center rounded-xl bg-gray-200 text-lg font-medium text-gray-500 shadow-sm ring-1 ring-black/5">
                                {(
                                  selectedLead.first_name?.[0] ||
                                  selectedLead.full_name?.[0] ||
                                  '?'
                                ).toUpperCase()}
                              </div>
                            )
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedLeadId(null);
                              cancelEditingLead();
                            }}
                            className="contacts-drawer-close"
                            aria-label="Close details"
                          >
                            <X className="h-3.5 w-3.5" strokeWidth={2} />
                          </button>
                        </div>
                      </div>

                      {/* Panel body */}
                      <div
                        className={cn(
                          'flex-1 overflow-auto',
                          selectedPreview === 'contact' ? 'space-y-4 px-4 py-4' : 'space-y-5 px-5 py-4',
                        )}
                      >
                        {selectedPreview === 'contact' ? (
                          isEditingSelected ? (
                            /* ── Edit mode ── */
                            <div className="space-y-3">
                              <div className="space-y-1">
                                <label className="text-xs text-gray-400">First name</label>
                                <input
                                  value={editingFields?.first_name || ''}
                                  onChange={(e) => updateEditingField('first_name', e.target.value)}
                                  className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-arcova-teal/30"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs text-gray-400">Last name</label>
                                <input
                                  value={editingFields?.last_name || ''}
                                  onChange={(e) => updateEditingField('last_name', e.target.value)}
                                  className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-arcova-teal/30"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs text-gray-400">Email</label>
                                <input
                                  value={editingFields?.email || ''}
                                  onChange={(e) => updateEditingField('email', e.target.value)}
                                  className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-arcova-teal/30"
                                />
                              </div>
                            </div>
                          ) : (
                            /* ── View mode ── */
                            <div className="space-y-4">
                              {selectedLead.contact_bio && selectedLead.contact_bio.length > 0 && (
                                <div className="overflow-hidden rounded-xl border border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.82)] shadow-[0_1px_4px_-2px_rgba(13,53,71,0.08)]">
                                  <button
                                    type="button"
                                    onClick={() => setContactPanelOpen((s) => ({ ...s, about: !s.about }))}
                                    className="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-[rgba(255,255,255,0.95)]"
                                  >
                                    <span className="font-manrope text-xs font-semibold text-[#0d3547]">
                                      About
                                    </span>
                                    <ChevronDown
                                      className={`h-4 w-4 shrink-0 text-[#7d909a] transition-transform duration-200 ${
                                        contactPanelOpen.about ? '' : '-rotate-90'
                                      }`}
                                    />
                                  </button>
                                  {contactPanelOpen.about && (
                                    <div className="border-t border-[rgba(13,53,71,0.06)] px-3 pb-3 pt-3">
                                      {selectedLead.contact_bio.length === 1 ? (
                                        <p className="text-sm leading-[1.55] text-[#4a6470]">
                                          {selectedLead.contact_bio[0]}
                                        </p>
                                      ) : (
                                        <ul className="space-y-3">
                                          {selectedLead.contact_bio.map((bullet, i) => (
                                            <li key={i} className="flex gap-3 text-sm leading-snug text-[#4a6470]">
                                              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-arcova-teal" />
                                              {bullet}
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="overflow-hidden rounded-xl border border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.82)] shadow-[0_1px_4px_-2px_rgba(13,53,71,0.08)]">
                                <button
                                  type="button"
                                  onClick={() => setContactPanelOpen((s) => ({ ...s, details: !s.details }))}
                                  className="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-[rgba(255,255,255,0.95)]"
                                >
                                  <span className="font-manrope text-xs font-semibold text-[#0d3547]">
                                    Role &amp; contact
                                  </span>
                                  <ChevronDown
                                    className={`h-4 w-4 shrink-0 text-[#7d909a] transition-transform duration-200 ${
                                      contactPanelOpen.details ? '' : '-rotate-90'
                                    }`}
                                  />
                                </button>
                                {contactPanelOpen.details && (
                                  <div className="border-t border-[rgba(13,53,71,0.06)] px-3 pb-3 pt-3">
                                    <div className="min-w-0 space-y-5">
                                      <div className="min-w-0">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                          Job title
                                        </p>
                                        <p className="mt-2 break-words text-sm leading-snug text-[#0d3547]">
                                          {selectedLead.resolved_current_job_title ||
                                            selectedLead.job_title ||
                                            '—'}
                                        </p>
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                          Location
                                        </p>
                                        <p className="mt-2 break-words text-sm leading-snug text-[#0d3547]">
                                          {selectedLead.location || '—'}
                                        </p>
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                          Email
                                        </p>
                                        <p className="mt-2 break-all text-sm leading-snug text-[#0d3547]">
                                          {selectedLead.email || '—'}
                                        </p>
                                        {selectedLead.contact_emails &&
                                          selectedLead.contact_emails.filter(
                                            (row) =>
                                              !selectedLead.email ||
                                              row.email.trim().toLowerCase() !==
                                                selectedLead.email!.trim().toLowerCase(),
                                          ).length > 0 && (
                                            <ul className="mt-3 space-y-2 border-t border-[rgba(13,53,71,0.06)] pt-3">
                                              {selectedLead.contact_emails
                                                .filter(
                                                  (row) =>
                                                    !selectedLead.email ||
                                                    row.email.trim().toLowerCase() !==
                                                      selectedLead.email!.trim().toLowerCase(),
                                                )
                                                .map((row) => (
                                                  <li
                                                    key={row.id}
                                                    className="break-all text-sm leading-snug text-[#0d3547]"
                                                  >
                                                    <span>{row.email}</span>
                                                    <span className="ml-2 text-[11px] font-medium text-[#7d909a]">
                                                      ({contactEmailCategoryLabel(row.category)})
                                                    </span>
                                                  </li>
                                                ))}
                                            </ul>
                                          )}
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                          LinkedIn
                                        </p>
                                        {selectedLead.linkedin_url ? (
                                          <a
                                            href={selectedLead.linkedin_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="mt-2 inline-flex min-w-0 items-start gap-1.5 break-all text-sm font-medium leading-snug text-arcova-teal hover:underline"
                                          >
                                            <span className="min-w-0">
                                              {selectedLead.linkedin_url.replace(/^https?:\/\/(www\.)?/, '')}
                                            </span>
                                            <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-arcova-teal" />
                                          </a>
                                        ) : (
                                          <p className="mt-2 text-sm leading-snug text-[#0d3547]">—</p>
                                        )}
                                      </div>
                                    </div>
                                    {selectedLead.email &&
                                      (selectedLead.email_status === 'candidate' ||
                                        selectedLead.email_status === 'stale_suspected') && (
                                        <p className="mt-4 text-xs leading-snug text-[#7d909a]">
                                          This email may be outdated.
                                        </p>
                                      )}
                                  </div>
                                )}
                              </div>

                              {selectedLead.resolved_employment_history &&
                                selectedLead.resolved_employment_history.length > 0 && (
                                  <div className="overflow-hidden rounded-xl border border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.82)] shadow-[0_1px_4px_-2px_rgba(13,53,71,0.08)]">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setContactPanelOpen((s) => ({ ...s, workHistory: !s.workHistory }))
                                      }
                                      className="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-[rgba(255,255,255,0.95)]"
                                    >
                                      <span className="font-manrope text-xs font-semibold text-[#0d3547]">
                                        Work history
                                      </span>
                                      <ChevronDown
                                        className={`h-4 w-4 shrink-0 text-[#7d909a] transition-transform duration-200 ${
                                          contactPanelOpen.workHistory ? '' : '-rotate-90'
                                        }`}
                                      />
                                    </button>
                                    {contactPanelOpen.workHistory && (
                                      <div className="space-y-4 border-t border-[rgba(13,53,71,0.06)] px-3 pb-3 pt-4">
                                        <div className="space-y-5">
                                          {(isWorkHistoryExpanded
                                            ? selectedLead.resolved_employment_history
                                            : selectedLead.resolved_employment_history.slice(
                                                0,
                                                MAX_VISIBLE_WORK_HISTORY,
                                              )
                                          ).map((job, i, arr) => (
                                            <div key={i} className="flex items-stretch gap-4">
                                              <div className="flex w-4 shrink-0 flex-col items-center pt-1">
                                                <div
                                                  className={`z-[1] h-2.5 w-2.5 rounded-full ${
                                                    job.current ? 'bg-arcova-teal' : 'bg-[rgba(13,53,71,0.2)]'
                                                  }`}
                                                />
                                                {i < arr.length - 1 ? (
                                                  <div className="mx-auto mt-1 w-px flex-1 bg-[rgba(13,53,71,0.1)]" />
                                                ) : null}
                                              </div>
                                              <div className="min-w-0 pb-1">
                                                <p className="text-sm font-semibold leading-snug text-[#0d3547]">
                                                  {job.title || '—'}
                                                </p>
                                                <p className="mt-1 text-sm leading-snug text-[#4a6470]">
                                                  {job.company_name || '—'}
                                                </p>
                                                <p className="mt-1.5 text-xs tabular-nums text-[#7d909a]">
                                                  {[job.start_date, job.end_date].filter(Boolean).join(' → ')}
                                                </p>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                        {selectedLead.resolved_employment_history.length >
                                          MAX_VISIBLE_WORK_HISTORY && (
                                          <button
                                            type="button"
                                            onClick={() => setIsWorkHistoryExpanded((prev) => !prev)}
                                            className="inline-flex items-center gap-1.5 pt-1 text-sm font-semibold text-arcova-teal transition-colors hover:text-arcova-teal/85"
                                          >
                                            <ChevronDown
                                              className={`h-4 w-4 transition-transform ${
                                                isWorkHistoryExpanded ? 'rotate-180' : ''
                                              }`}
                                            />
                                            {isWorkHistoryExpanded
                                              ? 'Show fewer roles'
                                              : `Show ${
                                                  selectedLead.resolved_employment_history.length -
                                                  MAX_VISIBLE_WORK_HISTORY
                                                } more roles`}
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}

                              <div className="rounded-xl border border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.82)] px-3 py-3 shadow-[0_1px_4px_-2px_rgba(13,53,71,0.08)]">
                                <p className="mb-3 font-manrope text-xs font-semibold text-[#0d3547]">Data source</p>
                                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                                  <div className="min-w-0">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                      Type
                                    </p>
                                    <p className="mt-2 text-sm leading-snug text-[#0d3547]">
                                      {selectedLeadDataSourceTypeLabel}
                                    </p>
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                      Imported
                                    </p>
                                    <p className="mt-2 text-sm leading-snug text-[#0d3547]">
                                      {formatProvenanceImportedAt(selectedLead.data_provenance_imported_at)}
                                    </p>
                                  </div>
                                </div>

                                <div className="mt-4 space-y-3 border-t border-[rgba(13,53,71,0.06)] pt-4">
                                  <p className="text-xs leading-snug text-[#4a6470]">
                                    Last updated {formatLastUpdated(selectedLead.updated_at || selectedLead.created_at)}
                                  </p>

                                  {selectedLeadRefreshStatus === 'running' && (
                                    <div
                                      className={`rounded-lg border px-3 py-2 text-xs ${selectedLeadRefreshStatusMeta.className}`}
                                    >
                                      <p className="font-medium">{selectedLeadRefreshStatusMeta.label}</p>
                                      <div className="mt-2 flex flex-col gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => stopLeadEnrichment(selectedLead.id)}
                                          disabled={isStoppingSelected}
                                          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          <Ban className="h-3.5 w-3.5" aria-hidden />
                                          {isStoppingSelected ? 'Stopping…' : 'Stop enrichment'}
                                        </button>
                                        {stopEnrichmentError && (
                                          <p className="text-xs text-red-500">{stopEnrichmentError}</p>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {showEnrichmentDoneCopy && enrichmentFinishedDisplayIso ? (
                                    <div className="rounded-xl bg-[#E6F4F1] px-4 py-3">
                                      <div className="flex gap-2.5">
                                        <Check
                                          className="mt-0.5 h-4 w-4 shrink-0 text-[#2D8A8A]"
                                          strokeWidth={2.25}
                                          aria-hidden
                                        />
                                        <div className="min-w-0 space-y-1">
                                          <p className="text-xs font-semibold text-[#2D8A8A]">Enrichment done</p>
                                          <p className="text-xs leading-snug text-[#6B7280]">
                                            Finished {formatLastUpdated(enrichmentFinishedDisplayIso)}.
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  ) : null}

                                  {selectedLeadRefreshStatus === 'cancelled' &&
                                    selectedLead.enrichment_refresh_finished_at && (
                                      <p className="text-xs leading-snug text-[#6B7280]">
                                        Stopped {formatLastUpdated(selectedLead.enrichment_refresh_finished_at)}.
                                      </p>
                                    )}

                                  {selectedLeadRefreshStatus === 'failed' && (
                                    <>
                                      <p className="text-xs font-semibold text-[rgb(13,53,71)]">
                                        {selectedLeadRefreshStatusMeta.label}
                                      </p>
                                      <p className="text-xs leading-snug text-[#7d909a]">Showing last known data.</p>
                                    </>
                                  )}

                                  {selectedLeadRefreshStatus !== 'running' && (
                                    <p className="text-xs leading-relaxed text-[#6B7280]">
                                      You can refresh this enrichment again whenever you need updated data.
                                    </p>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => rerunEnrichment(selectedLead.id)}
                                    disabled={
                                      isRefreshingSelected ||
                                      isStoppingSelected ||
                                      isEditingSelected ||
                                      isSelectedLeadRefreshRunning
                                    }
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-[#1F2937] transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <RotateCw
                                      className={`h-4 w-4 text-[#1F2937] ${isRefreshingSelected || isSelectedLeadRefreshRunning ? 'animate-spin' : ''}`}
                                    />
                                    {isRefreshingSelected
                                      ? 'Starting enrichment…'
                                      : isSelectedLeadRefreshRunning
                                        ? 'Enrichment running…'
                                        : 'Refresh enrichment'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          )
                        ) : selectedPreview === 'action' ? (
                          /* ── Action view ── */
                          (() => {
                            const action = getLeadAction(selectedLead);
                            const contactName =
                              [selectedLead.first_name, selectedLead.last_name].filter(Boolean).join(' ') ||
                              selectedLead.full_name;

                            const contactLoading = Boolean(selectedContactFitState?.loading);
                            const contactCriteria = contactLoading ? [] : buildActionContactFitCriteria();

                            return (
                              <div className="flex flex-col gap-3.5">
                                {/* Action explanation */}
                                {action === 'monitor' &&
                                  (isLeadReadyAwaitingContactSignal(selectedLead) ? (
                                    <div className="space-y-3">
                                      <p className="text-[13.5px] leading-[1.55] text-[#0d3547]">
                                        {contactName ? `${contactName} is` : 'This lead is'} a strong match on both the
                                        company and the persona. Keep the account on your radar and wait for a buying
                                        signal before reaching out.
                                      </p>
                                    </div>
                                  ) : (
                                    <div className="space-y-3">
                                      <p className="text-[13.5px] leading-[1.55] text-[#0d3547]">
                                        {contactName ? `${contactName} sits` : 'This lead sits'} in the watch band:
                                        company fit is promising but not yet high enough for sourcing the ideal persona.
                                        Keep the account visible and revisit when enrichment or the company moves.
                                      </p>
                                      <div className="rounded-xl border border-arcova-teal/25 bg-arcova-teal/5 p-4">
                                        <button
                                          type="button"
                                          onClick={() => guardedNavigate('/customer-signals')}
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
                                      This contact has a strong fit and at least one tracked buying signal. It is a
                                      good moment for personalised outreach.
                                    </p>
                                    <p className="text-[13.5px] leading-[1.55] text-[#4a6470]">
                                      Lead with relevance to their role and therapeutic focus, and tie your message to
                                      signals or milestones when you can.
                                    </p>
                                  </div>
                                )}

                                {action === 'source_contact' && (
                                  <div className="space-y-3">
                                    <p className="text-[13.5px] leading-[1.55] text-[#0d3547]">
                                      {selectedLead.companies?.company_name ? (
                                        <>
                                          <strong>{selectedLead.companies.company_name}</strong> is a strong ICP fit
                                        </>
                                      ) : (
                                        'The company is a strong ICP fit'
                                      )}
                                      , but {contactName || 'this contact'} isn&apos;t the right persona to approach
                                      this account. Source a better-matched contact before you reach out.
                                    </p>
                                    <p className="text-[13.5px] leading-[1.55] text-[#4a6470]">
                                      Try searching LinkedIn for the right title at this company, or use enrichment to
                                      surface additional contacts.
                                    </p>
                                    {(selectedLead.companies?.linkedin_url || selectedLead.companies?.company_name) && (
                                      <div className="rounded-xl border border-arcova-teal/25 bg-arcova-teal/5 p-4">
                                        <a
                                          href={
                                            selectedLead.companies?.linkedin_url
                                              ? `${selectedLead.companies.linkedin_url}/people/`
                                              : `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(selectedLead.companies?.company_name ?? '')}`
                                          }
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1.5 text-sm font-semibold text-arcova-teal hover:text-arcova-teal/85 transition-colors"
                                        >
                                          Search contacts on LinkedIn
                                          <ExternalLink className="w-3.5 h-3.5" aria-hidden />
                                        </a>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {action === 'deprioritize' && (
                                  <div className="space-y-3">
                                    <p className="text-[13.5px] leading-[1.55] text-[#0d3547]">
                                      Company or contact fit sits below your thresholds. Leave this one aside for now.
                                    </p>
                                    <p className="text-[13.5px] leading-[1.55] text-[#4a6470]">
                                      This doesn&apos;t mean they are permanently out. If their company situation changes
                                      or you revisit your ICP criteria, they may score higher in a future run.
                                    </p>
                                  </div>
                                )}

                                {renderActionFitDesignCard(
                                  'Contact fit',
                                  selectedContactFit?.contact_fit_score ??
                                    resolveContactFitForLeadAction(selectedLead),
                                  contactCriteria,
                                  {
                                    loading: contactLoading,
                                    emptyHint:
                                      !contactLoading && contactCriteria.length === 0
                                        ? 'Run enrichment to see contact-level criteria.'
                                        : undefined,
                                  },
                                )}
                              </div>
                            );
                          })()
                        ) : (
                          /* ── Scoring view ── */
                          <div className="space-y-3">

                            {renderContactFitScoresCard()}

                          </div>
                        )}
                      </div>

                      {/* Panel footer */}
                      <div
                        className={cn(
                          'border-t border-[rgba(13,53,71,0.08)] space-y-4 py-4',
                          selectedPreview === 'contact' ? 'px-4' : 'px-5',
                        )}
                      >
                        {selectedPreview !== 'contact' && (
                          <div className="space-y-4">
                            <p className="text-xs leading-snug text-[#4a6470]">
                              Last updated {formatLastUpdated(selectedLead.updated_at || selectedLead.created_at)}
                            </p>

                            {selectedLeadRefreshStatus === 'running' && (
                              <div
                                className={`rounded-lg border px-3 py-2 text-xs ${selectedLeadRefreshStatusMeta.className}`}
                              >
                                <p className="font-medium">{selectedLeadRefreshStatusMeta.label}</p>
                                <div className="mt-2 flex flex-col gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => stopLeadEnrichment(selectedLead.id)}
                                    disabled={isStoppingSelected}
                                    className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <Ban className="h-3.5 w-3.5" aria-hidden />
                                    {isStoppingSelected ? 'Stopping…' : 'Stop enrichment'}
                                  </button>
                                  {stopEnrichmentError && (
                                    <p className="text-xs text-red-500">{stopEnrichmentError}</p>
                                  )}
                                </div>
                              </div>
                            )}

                            {showEnrichmentDoneCopy && enrichmentFinishedDisplayIso ? (
                              <div className="rounded-xl bg-[#E6F4F1] px-4 py-3">
                                <div className="flex gap-2.5">
                                  <Check
                                    className="mt-0.5 h-4 w-4 shrink-0 text-[#2D8A8A]"
                                    strokeWidth={2.25}
                                    aria-hidden
                                  />
                                  <div className="min-w-0 space-y-1">
                                    <p className="text-xs font-semibold text-[#2D8A8A]">Enrichment done</p>
                                    <p className="text-xs leading-snug text-[#6B7280]">
                                      Finished {formatLastUpdated(enrichmentFinishedDisplayIso)}.
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ) : null}

                            {selectedLeadRefreshStatus === 'cancelled' &&
                              selectedLead.enrichment_refresh_finished_at && (
                                <p className="text-xs leading-snug text-[#6B7280]">
                                  Stopped {formatLastUpdated(selectedLead.enrichment_refresh_finished_at)}.
                                </p>
                              )}

                            {selectedLeadRefreshStatus === 'failed' && (
                              <>
                                <p className="text-xs font-semibold text-[rgb(13,53,71)]">
                                  {selectedLeadRefreshStatusMeta.label}
                                </p>
                                <p className="text-xs leading-snug text-[#7d909a]">Showing last known data.</p>
                              </>
                            )}

                            {selectedLeadRefreshStatus !== 'running' && (
                              <p className="text-xs leading-relaxed text-[#6B7280]">
                                You can refresh this enrichment again whenever you need updated data.
                              </p>
                            )}
                            <button
                              type="button"
                              onClick={() => rerunEnrichment(selectedLead.id)}
                              disabled={
                                isRefreshingSelected ||
                                isStoppingSelected ||
                                isEditingSelected ||
                                isSelectedLeadRefreshRunning
                              }
                              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-[#1F2937] transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <RotateCw
                                className={`h-4 w-4 text-[#1F2937] ${isRefreshingSelected || isSelectedLeadRefreshRunning ? 'animate-spin' : ''}`}
                              />
                              {isRefreshingSelected
                                ? 'Starting enrichment…'
                                : isSelectedLeadRefreshRunning
                                  ? 'Enrichment running…'
                                  : 'Refresh enrichment'}
                            </button>
                          </div>
                        )}

                        {selectedPreview === 'contact' && (
                          isEditingSelected ? (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => saveLead(selectedLead.id)}
                                disabled={isSavingSelected}
                                className="flex-1 rounded-lg border border-arcova-teal bg-arcova-teal text-white px-4 py-2 text-sm font-medium hover:bg-arcova-teal/90 disabled:opacity-50 transition-colors"
                              >
                                {isSavingSelected ? 'Saving…' : 'Save changes'}
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditingLead}
                                className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => startEditingLead(selectedLead)}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                Edit contact
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteLead(selectedLead.id)}
                                disabled={isDeletingSelected}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                {isDeletingSelected ? 'Deleting…' : 'Delete contact'}
                              </button>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  ) : null}
                    </aside>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex min-h-0 w-full shrink-0 flex-col min-[1280px]:w-[22.5rem] min-[1280px]:self-start">
          <AgentPanel
            wide
            page="leads"
            pageContext={{ leadsView: 'contacts' }}
            pendingMessage={agentTrigger}
            onLeadsFilter={handleLeadsFilter}
            onTableClear={handleQueryClear}
            surfaceClassName="relative w-full rounded-[inherit] border border-[rgba(13,53,71,0.1)] bg-[rgba(255,255,255,0.52)] shadow-[0_24px_60px_-32px_rgba(13,53,71,0.18),0_2px_6px_-2px_rgba(13,53,71,0.06)] ring-1 ring-white/80 backdrop-blur-2xl backdrop-saturate-150"
            className="min-h-0 min-[1280px]:sticky min-[1280px]:top-3.5 min-[1280px]:h-[calc(100vh-1.75rem)] max-[1279px]:h-80 max-[1279px]:shrink-0"
          />
        </div>
      </div>
    </div>
  );
}
