'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useCallback } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { ArcovaLoader } from '@/components/ArcovaLoader';
import { CONTACT_SIGNALS, isContactSignalComingSoon } from '@/lib/signals/catalog';
import {
  Users,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Pencil,
  Trash2,
  X,
  ExternalLink,
  Link,
  Briefcase,
  RotateCw,
  Sparkles,
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
  enrichment_refresh_status?: 'idle' | 'running' | 'succeeded' | 'failed' | null;
  enrichment_refresh_last_error?: string | null;
  enrichment_refresh_started_at?: string | null;
  enrichment_refresh_finished_at?: string | null;
  fit_score: number | null;
  intent_score: number | null;
  overall_fit_score: number | null;
  source: string;
  created_at: string;
  updated_at: string | null;
  company_id: string | null;
  matched_icp_name: string | null;
  matched_icp_index?: number | null;
  matched_icp_label?: string | null;
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

type LeadRefreshStatus = 'idle' | 'running' | 'succeeded' | 'failed';

type EnrichmentVisualState = {
  stageKey: EnrichmentStageKey;
  startedAt: number;
  startPercent: number;
};

const PAGE_SIZE = 50;
const MAX_VISIBLE_WORK_HISTORY = 5;
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

const formatCurrencyShort = (amount: number | null | undefined): string => {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    notation: amount >= 1_000_000 ? 'compact' : 'standard',
  }).format(amount);
};

const formatPercentValue = (value: number | null | undefined): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return `${Math.round((value <= 1 ? value * 100 : value))}%`;
};

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

const getCompanyFirmographicsLastRefresh = (lead: Lead | null): string | null => {
  if (!lead) return null;
  return lead.companies?.last_enriched_at || null;
};

const normalizeInlineText = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
};

const getFundingStatusDisplay = (
  company: Lead['companies'] | null
): { heading: 'Funding stage' | 'Funding status'; value: string } | null => {
  const stage = normalizeInlineText(company?.funding_stage);
  if (stage) {
    return {
      heading: 'Funding stage',
      value: stage,
    };
  }

  const statusLabel = normalizeInlineText(company?.funding_status_label);
  if (!statusLabel) return null;

  return { heading: 'Funding status', value: statusLabel };
};

const renderTaxonomyPills = (values: string[] | null | undefined) => {
  const cleaned = (values || []).map((value) => value.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {cleaned.map((value) => (
        <span
          key={value}
          className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2.5 py-0.5 text-xs font-medium text-arcova-teal"
        >
          {value}
        </span>
      ))}
    </div>
  );
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
  if (status === 'running' || status === 'succeeded' || status === 'failed') {
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
        label: 'Enrichment running',
        className: 'border-arcova-teal/25 bg-arcova-teal/5 text-arcova-teal',
      };
    case 'succeeded':
      return {
        label: 'Enrichment done',
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      };
    case 'failed':
      return {
        label: 'Enrichment failed',
        className: 'border-rose-200 bg-rose-50 text-rose-700',
      };
    default:
      return {
        label: 'Idle',
        className: 'border-gray-200 bg-gray-50 text-gray-500',
      };
  }
};

const REQUESTED_COMING_SOON_CONTACT_SIGNALS_KEY = 'biosignals_requested_contact_signals_v1';

export default function LeadsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

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
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<'contact' | 'company' | 'scoring'>('contact');
  const [isWorkHistoryExpanded, setIsWorkHistoryExpanded] = useState(false);
  const [companyPanelOpen, setCompanyPanelOpen] = useState<Record<string, boolean>>({
    summary: true,
    criteria: true,
    funding: true,
    products: true,
    services: true,
    technology: true,
    firmographics: true,
  });
  const [contactPanelOpen, setContactPanelOpen] = useState({
    fit: true,
    about: true,
    details: true,
    workHistory: true,
    signals: true,
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
  const [requestedComingSoonContactSignals, setRequestedComingSoonContactSignals] = useState<Set<string>>(
    () => new Set(),
  );
  const [companyFitByCompanyId, setCompanyFitByCompanyId] = useState<Record<string, CompanyFitFetchState>>({});
  const [contactFitByContactId, setContactFitByContactId] = useState<Record<string, ContactFitFetchState>>({});
  const companyFitCacheRef = useRef(companyFitByCompanyId);
  companyFitCacheRef.current = companyFitByCompanyId;
  const contactFitCacheRef = useRef(contactFitByContactId);
  contactFitCacheRef.current = contactFitByContactId;
  const [showPremiumAddonNotice, setShowPremiumAddonNotice] = useState(false);
  const [enrichmentVisuals, setEnrichmentVisuals] = useState<Record<string, EnrichmentVisualState>>({});
  const [progressNow, setProgressNow] = useState(() => Date.now());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(REQUESTED_COMING_SOON_CONTACT_SIGNALS_KEY);
      if (!raw) return;
      const ids = JSON.parse(raw) as unknown;
      if (!Array.isArray(ids)) return;
      setRequestedComingSoonContactSignals(
        new Set(ids.filter((id): id is string => typeof id === 'string')),
      );
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setShowPremiumAddonNotice(false);
  }, [selectedLeadId]);

  const toggleComingSoonContactSignalInterest = useCallback((signalId: string) => {
    setRequestedComingSoonContactSignals((prev) => {
      const next = new Set(prev);
      const adding = !next.has(signalId);
      if (adding) {
        next.add(signalId);
        queueMicrotask(() => setShowPremiumAddonNotice(true));
      } else {
        next.delete(signalId);
      }
      try {
        localStorage.setItem(REQUESTED_COMING_SOON_CONTACT_SIGNALS_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

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
        const nextLeads = result.data || [];
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
  const showSearchInput = total > 0 || searchInput.trim().length > 0 || search.trim().length > 0;
  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) || null;
  const selectedContactFitState = selectedLeadId ? contactFitByContactId[selectedLeadId] ?? null : null;
  const selectedContactFit = selectedContactFitState?.data ?? null;
  const selectedCompanyId = selectedLead?.company_id ?? null;
  const selectedCompanyFitState = selectedCompanyId ? companyFitByCompanyId[selectedCompanyId] ?? null : null;
  const selectedCompanyFit = selectedCompanyFitState?.data ?? null;
  const selectedCompanyFirmographics = getDisplayedCompanyFirmographics(selectedLead);
  const selectedCompanyFirmographicsLastRefresh = getCompanyFirmographicsLastRefresh(selectedLead);
  const isEditingSelected = selectedLead ? editingLeadId === selectedLead.id : false;
  const isSavingSelected = selectedLead ? savingLeadId === selectedLead.id : false;
  const isDeletingSelected = selectedLead ? deletingLeadId === selectedLead.id : false;
  const isRefreshingSelected = selectedLead ? refreshingLeadId === selectedLead.id : false;
  const isSelectedLeadRefreshRunning = selectedLead ? isLeadRefreshRunning(selectedLead) : false;
  const selectedEnrichmentError = selectedLead ? getEnrichmentErrorMessage(selectedLead) : null;
  const selectedLeadRefreshStatus = selectedLead ? getLeadRefreshStatus(selectedLead) : 'idle';
  const selectedLeadRefreshStatusMeta = getLeadRefreshStatusMeta(selectedLeadRefreshStatus);

  useEffect(() => {
    if ((selectedPreview !== 'company' && selectedPreview !== 'scoring') || !selectedCompanyId) return;

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
    if ((selectedPreview !== 'contact' && selectedPreview !== 'scoring') || !selectedLeadId) return;

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen bg-gray-50">
      <AppSidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-6">
          <div className="w-full max-w-none">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div>
                <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
                <p className="text-gray-600 mt-1">
                  {total > 0
                    ? `${total.toLocaleString()} contact${total !== 1 ? 's' : ''} ready to review. Click the contact or company icons on any row to preview enriched details.`
                    : 'Your imported contacts will appear here once they are ready to review'}
                </p>
                </div>
              </div>

              {total > 0 && (
                <button
                  onClick={() => router.push('/import')}
                  className="px-4 py-2 bg-arcova-teal text-white rounded-lg text-sm hover:bg-arcova-teal/90 transition-colors"
                >
                  + Import more
                </button>
              )}
            </div>

            {showSearchInput && (
              <div className="mb-4 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name, company, job title, company type, therapeutic area, modality or development stage…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-arcova-teal/30 bg-white"
                />
              </div>
            )}

            {loadingLeads ? (
              <div className="flex items-center justify-center py-24">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-arcova-teal" />
              </div>
            ) : leads.length === 0 && !search ? (
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
            ) : leads.length === 0 && search ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                <p className="text-gray-500">No leads matching &ldquo;{search}&rdquo;</p>
              </div>
            ) : (
              <div className={`grid gap-4 ${selectedLeadId ? 'xl:grid-cols-[minmax(0,1fr)_360px]' : ''}`}>
                {/* ── Leads table ── */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  <div className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1.35fr)_3.5rem_auto] gap-x-4 px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
                    <span>Name</span>
                    <span>Job title</span>
                    <span>Company name</span>
                    <span className="text-center leading-tight">Company details</span>
                    <span className="pl-24 text-right whitespace-nowrap justify-self-end">Fit score</span>
                  </div>

                  <div className="divide-y divide-gray-100">
                    {leads.map((lead) => {
                      const isSelected = selectedLeadId === lead.id;
                      const enriching = isEnriching(lead);
                      const enrichmentProgress = getEnrichmentProgress(lead);
                      const leadRefreshStatus = getLeadRefreshStatus(lead);
                      const leadRefreshError = getEnrichmentErrorMessage(lead);

                      if (enriching) {
                        return (
                          <div
                            key={lead.id}
                            onClick={() => {
                              setSelectedLeadId(lead.id);
                              setSelectedPreview('contact');
                              cancelEditingLead();
                            }}
                            className={`grid grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1.35fr)_3.5rem_auto] gap-x-4 px-4 py-3 items-center cursor-pointer transition-all duration-150 border-b border-gray-50 last:border-0 ${
                              isSelected
                                ? 'bg-arcova-teal/10 border-l-2 border-arcova-teal'
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

                            <div className="min-w-0 flex justify-center" />

                            <div className="flex items-center justify-end min-w-[5.5rem] pl-24">
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
                          className={`grid grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1.35fr)_3.5rem_auto] gap-x-4 px-4 py-3 items-center cursor-pointer transition-all duration-150 opacity-100 ${
                            isSelected
                              ? 'bg-arcova-teal/10 border-l-2 border-arcova-teal'
                              : 'border-l-2 border-transparent hover:bg-arcova-teal/5 hover:border-arcova-teal/30'
                          }`}
                        >
                          {/* Full name */}
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 truncate text-sm">
                              {lead.full_name ||
                                [lead.first_name, lead.last_name].filter(Boolean).join(' ') ||
                                '—'}
                            </p>
                            {leadRefreshStatus === 'failed' && leadRefreshError && (
                              <p className="mt-0.5 truncate text-[11px] text-rose-600">
                                Enrichment failed
                              </p>
                            )}
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

                          {/* Company details */}
                          <div className="min-w-0 flex justify-center">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedLeadId(lead.id);
                                setSelectedPreview('company');
                                cancelEditingLead();
                              }}
                              className={`inline-flex items-center justify-center rounded-md border p-1.5 transition-colors ${
                                isSelected && selectedPreview === 'company'
                                  ? 'border-arcova-teal bg-arcova-teal text-white'
                                  : 'border-arcova-teal/40 bg-arcova-teal/10 text-arcova-teal hover:bg-arcova-teal hover:text-white hover:border-arcova-teal'
                              }`}
                              title="Company details"
                            >
                              <Briefcase className="w-5 h-5" />
                            </button>
                          </div>

                          {/* Fit score */}
                          <div className="min-w-0 flex justify-end pl-24">
                            {formatPercent(lead.overall_fit_score) ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedLeadId(lead.id);
                                  setSelectedPreview('scoring');
                                  cancelEditingLead();
                                }}
                                className={`inline-flex items-center justify-center min-w-[3.75rem] rounded-full border px-2.5 py-1 text-xs font-semibold shadow-sm transition-colors ${
                                  isSelected && selectedPreview === 'scoring'
                                    ? 'border-arcova-teal bg-arcova-teal text-white'
                                    : 'border-arcova-teal/30 bg-white text-arcova-teal hover:border-arcova-teal hover:bg-arcova-teal/10'
                                }`}
                                title="Open scoring details"
                              >
                                {formatPercentValue(lead.overall_fit_score)}
                              </button>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
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

                {/* ── Detail panel ── */}
                {selectedLeadId && (
                <aside className="bg-white rounded-lg shadow-sm border border-gray-200 min-h-[520px]">
                  {selectedLead ? (
                    <div className="h-full flex flex-col">
                      {/* Panel header */}
                      <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-200">
                        {/* Name / label */}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium uppercase tracking-wide text-arcova-teal">
                            {selectedPreview === 'contact'
                              ? 'Contact details'
                              : selectedPreview === 'company'
                                ? 'Company details'
                                : 'Fit score'}
                          </p>
                          {selectedPreview !== 'scoring' && (
                            <h2 className="text-lg font-semibold text-gray-900 mt-1 leading-tight">
                              {selectedPreview === 'contact'
                                ? [selectedLead.first_name, selectedLead.last_name]
                                    .filter(Boolean)
                                    .join(' ') ||
                                  selectedLead.full_name ||
                                  'Selected contact'
                                : selectedCompanyFirmographics?.name ||
                                  selectedLead.resolved_current_company_name ||
                                  selectedLead.company_name ||
                                  'Selected company'}
                            </h2>
                          )}
                          {selectedPreview === 'contact' && selectedLead.headline && (
                            <p className="text-sm text-gray-500 mt-1 leading-snug line-clamp-2">
                              {selectedLead.headline}
                            </p>
                          )}
                          {selectedPreview === 'company' && (() => {
                            const domain =
                              selectedCompanyFirmographics?.domain ||
                              selectedLead.resolved_current_company_domain ||
                              selectedLead.company_domain;
                            const href = selectedCompanyFirmographics?.website || (domain ? `https://${domain}` : null);
                            const linkedIn = selectedCompanyFirmographics?.linkedin_url || selectedLead.company_linkedin_url;
                            return (
                              <div className="mt-1 space-y-2">
                                {domain && href && (
                                  <a href={href} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-xs text-arcova-teal hover:underline">
                                    {domain}
                                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                  </a>
                                )}
                                {linkedIn && (
                                  <a href={linkedIn} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-xs text-arcova-teal hover:underline">
                                    {linkedIn.replace(/^https?:\/\/(www\.)?/, '')}
                                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                  </a>
                                )}
                              </div>
                            );
                          })()}
                          {selectedPreview === 'scoring' && (
                            <div className="mt-1 space-y-2">
                              <h2 className="text-lg font-semibold text-gray-900 leading-tight">Lead prioritisation</h2>
                              <div className="flex flex-wrap gap-1.5">
                                {typeof selectedLead.overall_fit_score === 'number' && (
                                  <span className="inline-flex items-center rounded-full bg-arcova-teal px-2.5 py-0.5 text-xs font-semibold text-white">
                                    Overall fit {formatPercentValue(selectedLead.overall_fit_score)}
                                  </span>
                                )}
                                {(selectedLead.matched_icp_index != null || selectedLead.matched_icp_name) && (
                                  <span className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2.5 py-0.5 text-xs font-medium text-arcova-teal">
                                    {selectedLead.matched_icp_index != null
                                      ? `Best fit ICP-${selectedLead.matched_icp_index}`
                                      : `Best fit: ${selectedLead.matched_icp_name}`}
                                  </span>
                                )}
                                {typeof selectedLead.fit_score === 'number' && (
                                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                                    ICP fit {formatPercentValue(selectedLead.fit_score)}
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
                                className="w-16 h-16 rounded-xl object-cover"
                              />
                            ) : (
                              <div className="w-16 h-16 rounded-xl bg-gray-200 flex items-center justify-center text-lg font-medium text-gray-500">
                                {(
                                  selectedLead.first_name?.[0] ||
                                  selectedLead.full_name?.[0] ||
                                  '?'
                                ).toUpperCase()}
                              </div>
                            )
                          ) : selectedPreview === 'company' ? (
                            /* Company logo */
                            selectedCompanyFirmographics?.logo_url ? (
                              <img
                                src={selectedCompanyFirmographics.logo_url}
                                alt=""
                                className="w-16 h-16 rounded-xl object-contain bg-gray-50 border border-gray-100 p-1"
                              />
                            ) : (
                              <div className="w-16 h-16 rounded-xl bg-gray-100 flex items-center justify-center text-xl font-semibold text-gray-400">
                                {(
                                  selectedCompanyFirmographics?.name?.[0] ||
                                  selectedLead.resolved_current_company_name?.[0] ||
                                  selectedLead.company_name?.[0] ||
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
                            className="text-gray-400 hover:text-gray-700 transition-colors"
                            aria-label="Close details"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                      </div>

                      {/* Panel body */}
                      <div className="flex-1 overflow-auto px-5 py-4 space-y-5">
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
                            <div className="space-y-5">
                              {selectedLead.contact_bio && selectedLead.contact_bio.length > 0 && (
                                <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                                  <button
                                    type="button"
                                    onClick={() => setContactPanelOpen((s) => ({ ...s, about: !s.about }))}
                                    className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-100/60 transition-colors"
                                  >
                                    <span className="text-xs font-semibold text-gray-700">About</span>
                                    <ChevronDown
                                      className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${
                                        contactPanelOpen.about ? '' : '-rotate-90'
                                      }`}
                                    />
                                  </button>
                                  {contactPanelOpen.about && (
                                    <div className="px-3 pb-3">
                                      {selectedLead.contact_bio.length === 1 ? (
                                        <p className="text-sm text-gray-700 leading-relaxed">
                                          {selectedLead.contact_bio[0]}
                                        </p>
                                      ) : (
                                        <ul className="space-y-1.5">
                                          {selectedLead.contact_bio.map((bullet, i) => (
                                            <li key={i} className="flex gap-2 text-sm text-gray-700 leading-snug">
                                              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-arcova-teal flex-shrink-0" />
                                              {bullet}
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                                <button
                                  type="button"
                                  onClick={() => setContactPanelOpen((s) => ({ ...s, details: !s.details }))}
                                  className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-100/60 transition-colors"
                                >
                                  <span className="text-xs font-semibold text-gray-700">Role &amp; contact</span>
                                  <ChevronDown
                                    className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${
                                      contactPanelOpen.details ? '' : '-rotate-90'
                                    }`}
                                  />
                                </button>
                                {contactPanelOpen.details && (
                                  <div className="px-3 pb-3 space-y-3 text-sm">
                                    <div>
                                      <p className="text-gray-400 text-xs">Job title</p>
                                      <p className="text-gray-900 mt-0.5">
                                        {selectedLead.resolved_current_job_title ||
                                          selectedLead.job_title ||
                                          '—'}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-gray-400 text-xs">Location</p>
                                      <p className="text-gray-900 mt-0.5">
                                        {selectedLead.location || '—'}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-gray-400 text-xs">Email</p>
                                      <p className="text-gray-900 mt-0.5">{selectedLead.email || '—'}</p>
                                      {selectedLead.email &&
                                        (selectedLead.email_status === 'candidate' ||
                                          selectedLead.email_status === 'stale_suspected') && (
                                          <p className="text-xs text-gray-500 mt-1">
                                            This email may be outdated.
                                          </p>
                                        )}
                                    </div>
                                    <div>
                                      <p className="text-gray-400 text-xs">LinkedIn</p>
                                      {selectedLead.linkedin_url ? (
                                        <a
                                          href={selectedLead.linkedin_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 text-arcova-teal hover:underline text-xs break-all mt-0.5"
                                        >
                                          {selectedLead.linkedin_url}
                                          <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                        </a>
                                      ) : (
                                        <p className="text-gray-900 mt-0.5">—</p>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {selectedLead.resolved_employment_history &&
                                selectedLead.resolved_employment_history.length > 0 && (
                                  <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setContactPanelOpen((s) => ({ ...s, workHistory: !s.workHistory }))
                                      }
                                      className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-100/60 transition-colors"
                                    >
                                      <span className="text-xs font-semibold text-gray-700">Work history</span>
                                      <ChevronDown
                                        className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${
                                          contactPanelOpen.workHistory ? '' : '-rotate-90'
                                        }`}
                                      />
                                    </button>
                                    {contactPanelOpen.workHistory && (
                                      <div className="px-3 pb-3 space-y-3">
                                        <div className="space-y-3">
                                          {(isWorkHistoryExpanded
                                            ? selectedLead.resolved_employment_history
                                            : selectedLead.resolved_employment_history.slice(0, MAX_VISIBLE_WORK_HISTORY)
                                          ).map((job, i) => (
                                            <div key={i} className="flex gap-3">
                                              <div className="mt-1.5 flex-shrink-0">
                                                <div
                                                  className={`w-2 h-2 rounded-full ${
                                                    job.current ? 'bg-arcova-teal' : 'bg-gray-300'
                                                  }`}
                                                />
                                              </div>
                                              <div className="min-w-0">
                                                <p className="text-sm font-medium text-gray-900">
                                                  {job.title || '—'}
                                                </p>
                                                <p className="text-sm text-gray-600">
                                                  {job.company_name || '—'}
                                                </p>
                                                <p className="text-xs text-gray-400">
                                                  {[job.start_date, job.end_date]
                                                    .filter(Boolean)
                                                    .join(' → ')}
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
                                            className="inline-flex items-center gap-1.5 text-sm font-medium text-arcova-teal hover:text-arcova-teal/80 transition-colors"
                                          >
                                            <ChevronDown
                                              className={`w-4 h-4 transition-transform ${
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

                              {/* ── Tracked signals (catalog) ── */}
                              {(() => {
                                const categories = [
                                  'Career & Role Changes',
                                  'Activity & Network',
                                  'Publications & Recognition',
                                  'Hiring & Team',
                                  'First-Party Engagement',
                                  'CRM & Relationship',
                                ] as const;

                                const grouped = categories
                                  .map((cat) => ({
                                    category: cat,
                                    signals: CONTACT_SIGNALS.filter((s) => s.category === cat),
                                  }))
                                  .filter((g) => g.signals.length > 0);

                                return (
                                  <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                                    <button
                                      type="button"
                                      onClick={() => setContactPanelOpen((s) => ({ ...s, signals: !s.signals }))}
                                      className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-100/60 transition-colors"
                                    >
                                      <span className="text-xs font-semibold text-gray-700">
                                        Tracked signals
                                      </span>
                                      <ChevronDown
                                        className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${
                                          contactPanelOpen.signals ? '' : '-rotate-90'
                                        }`}
                                      />
                                    </button>
                                    {contactPanelOpen.signals && (
                                      <div className="px-3 pb-3 space-y-3">
                                        {showPremiumAddonNotice && (
                                          <div
                                            role="status"
                                            className="relative overflow-hidden rounded-xl border border-arcova-teal/25 bg-white shadow-sm"
                                          >
                                            <div
                                              className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-arcova-teal/50 via-arcova-teal to-arcova-teal/50"
                                              aria-hidden
                                            />
                                            <button
                                              type="button"
                                              onClick={() => setShowPremiumAddonNotice(false)}
                                              className="absolute right-2.5 top-2.5 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                                              aria-label="Dismiss"
                                            >
                                              <X className="h-4 w-4" />
                                            </button>
                                            <div className="flex gap-3 p-4 pr-11">
                                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-arcova-teal/12 ring-1 ring-arcova-teal/20">
                                                <Sparkles className="h-5 w-5 text-arcova-teal" />
                                              </div>
                                              <div className="min-w-0">
                                                <p className="text-sm font-semibold text-gray-900">
                                                  Premium add-on
                                                </p>
                                                <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
                                                  First-party and CRM-linked signals are delivered through managed
                                                  integrations and data feeds we turn on per customer. They are not part
                                                  of the core product — contact our team to discuss enablement, scope,
                                                  and pricing for your organization.
                                                </p>
                                              </div>
                                            </div>
                                          </div>
                                        )}
                                        {grouped.map(({ category, signals }) => (
                                          <div key={category}>
                                            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                                              {category}
                                            </p>
                                            <div className="flex flex-wrap gap-1.5">
                                              {signals.map((signal) => {
                                                const comingSoon = isContactSignalComingSoon(signal.id);
                                                const selected = requestedComingSoonContactSignals.has(signal.id);
                                                if (comingSoon) {
                                                  return (
                                                    <button
                                                      key={signal.id}
                                                      type="button"
                                                      onClick={() => toggleComingSoonContactSignalInterest(signal.id)}
                                                      title={
                                                        selected
                                                          ? 'Selected — we will use this to prioritize integrations'
                                                          : 'Not live yet — click to register interest'
                                                      }
                                                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                                                        selected
                                                          ? 'border-arcova-teal/40 bg-gray-200 text-gray-700'
                                                          : 'border-transparent bg-gray-100 text-gray-400 hover:bg-gray-200/80 hover:text-gray-500'
                                                      }`}
                                                    >
                                                      {signal.displayName}
                                                    </button>
                                                  );
                                                }
                                                return (
                                                  <span
                                                    key={signal.id}
                                                    className="inline-flex items-center rounded-full bg-arcova-teal px-2.5 py-0.5 text-xs font-medium text-white"
                                                  >
                                                    {signal.displayName}
                                                  </span>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          )
                        ) : selectedPreview === 'company' ? (
                          /* ── Company view ── */
                          (() => {
                            const f = selectedCompanyFirmographics;
                            const hqParts = [f?.hq_city, f?.hq_country].filter(Boolean);
                            const hq = hqParts.join(', ') || null;
                            const showPlatformCategory = f?.company_type === 'SaaS' && !!f?.platform_category;
                            const hasCriteria = !!(f?.company_type || showPlatformCategory || f?.therapeutic_areas?.length || f?.modalities?.length || f?.development_stages?.length);
                            const hasFunding = !!(f?.funding_status_label || f?.funding_stage || f?.total_funding_usd != null || f?.latest_funding_date);
                            const hasFirmographics = !!(f?.employee_count || f?.employee_range || f?.follower_count != null || f?.founded_year || hq);
                            const aboutText = f?.bio_summary || f?.description || null;
                            const hasProducts = (f?.products_services?.length ?? 0) > 0;
                            const hasServices = (f?.services?.length ?? 0) > 0;
                            const hasSpecialties = (f?.specialties?.length ?? 0) > 0;

                            return (
                              <div className="space-y-3">
                                {/* Summary */}
                                <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                                  <button
                                    type="button"
                                    onClick={() => setCompanyPanelOpen((s) => ({ ...s, summary: !s.summary }))}
                                    className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-100/60 transition-colors"
                                  >
                                    <span className="text-xs font-semibold text-gray-700">Summary</span>
                                    <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${companyPanelOpen.summary ? '' : '-rotate-90'}`} />
                                  </button>
                                  {companyPanelOpen.summary && (
                                    <div className="px-3 pb-3">
                                      {aboutText ? (
                                        <p className="text-sm text-gray-700 leading-relaxed">{aboutText}</p>
                                      ) : (
                                        <p className="text-xs text-gray-400 italic">Company bio will appear after enrichment runs.</p>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* Criteria — taxonomy + LI followers */}
                                {hasCriteria && (
                                  <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                                    <button
                                      type="button"
                                      onClick={() => setCompanyPanelOpen((s) => ({ ...s, criteria: !s.criteria }))}
                                      className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-100/60 transition-colors"
                                    >
                                      <span className="text-xs font-semibold text-gray-700">Criteria</span>
                                      <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${companyPanelOpen.criteria ? '' : '-rotate-90'}`} />
                                    </button>
                                    {companyPanelOpen.criteria && (
                                      <div className="px-3 pb-3 space-y-3">
                                        {(f?.company_type || showPlatformCategory) && (
                                          <div>
                                            <p className="text-gray-400 text-xs mb-1">Company type</p>
                                            <div className="flex flex-wrap gap-1.5">
                                              {f?.company_type && (
                                                <span className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2.5 py-0.5 text-xs font-medium text-arcova-teal">{f.company_type}</span>
                                              )}
                                              {showPlatformCategory && (
                                                <span className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2.5 py-0.5 text-xs font-medium text-arcova-teal">{f!.platform_category}</span>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                        {f?.therapeutic_areas?.length ? (
                                          <div>
                                            <p className="text-gray-400 text-xs mb-1">Therapeutic areas</p>
                                            {renderTaxonomyPills(f.therapeutic_areas)}
                                          </div>
                                        ) : null}
                                        {f?.modalities?.length ? (
                                          <div>
                                            <p className="text-gray-400 text-xs mb-1">Modalities</p>
                                            {renderTaxonomyPills(f.modalities)}
                                          </div>
                                        ) : null}
                                        {f?.development_stages?.length ? (
                                          <div>
                                            <p className="text-gray-400 text-xs mb-1">Development stage</p>
                                            {renderTaxonomyPills(f.development_stages)}
                                          </div>
                                        ) : null}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Firmographics — headcount, followers, HQ, founded */}
                                {hasFirmographics && (
                                  <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                                    <button
                                      type="button"
                                      onClick={() => setCompanyPanelOpen((s) => ({ ...s, firmographics: !s.firmographics }))}
                                      className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-100/60 transition-colors"
                                    >
                                      <span className="text-xs font-semibold text-gray-700">Firmographics</span>
                                      <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${companyPanelOpen.firmographics ? '' : '-rotate-90'}`} />
                                    </button>
                                    {companyPanelOpen.firmographics && (
                                      <div className="px-3 pb-3">
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                                          {(f?.employee_count || f?.employee_range) && (
                                            <div>
                                              <p className="text-gray-400 text-xs">Employees</p>
                                              <p className="text-gray-900 text-sm mt-0.5">
                                                {f.employee_count ? f.employee_count.toLocaleString() : f.employee_range}
                                              </p>
                                            </div>
                                          )}
                                          {f?.follower_count != null && (
                                            <div>
                                              <p className="text-gray-400 text-xs">LI followers</p>
                                              <p className="text-gray-900 text-sm mt-0.5">{f.follower_count.toLocaleString()}</p>
                                            </div>
                                          )}
                                          {f?.founded_year && (
                                            <div>
                                              <p className="text-gray-400 text-xs">Founded</p>
                                              <p className="text-gray-900 text-sm mt-0.5">{f.founded_year}</p>
                                            </div>
                                          )}
                                          {hq && (
                                            <div>
                                              <p className="text-gray-400 text-xs">HQ</p>
                                              <p className="text-gray-900 text-sm mt-0.5">{hq}</p>
                                            </div>
                                          )}
                                        </div>
                                        {selectedCompanyFirmographicsLastRefresh && (
                                          <p className="text-xs text-gray-400 mt-3">
                                            Refreshed {formatLastUpdated(selectedCompanyFirmographicsLastRefresh)}
                                          </p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Funding */}
                                {hasFunding && (
                                  <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                                    <button
                                      type="button"
                                      onClick={() => setCompanyPanelOpen((s) => ({ ...s, funding: !s.funding }))}
                                      className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-100/60 transition-colors"
                                    >
                                      <span className="text-xs font-semibold text-gray-700">Funding</span>
                                      <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${companyPanelOpen.funding ? '' : '-rotate-90'}`} />
                                    </button>
                                    {companyPanelOpen.funding && (
                                      <div className="px-3 pb-3 space-y-1.5">
                                        {(f.funding_stage || f.funding_status_label) && (
                                          <div className="flex items-baseline gap-2">
                                            <span className="text-xs text-gray-400 w-24 shrink-0">Stage</span>
                                            <span className="text-xs text-gray-900">{f.funding_stage ?? f.funding_status_label}</span>
                                          </div>
                                        )}
                                        {f.total_funding_usd != null && (
                                          <div className="flex items-baseline gap-2">
                                            <span className="text-xs text-gray-400 w-24 shrink-0">Total raised</span>
                                            <span className="text-xs text-gray-900">{formatCurrencyShort(f.total_funding_usd)}</span>
                                          </div>
                                        )}
                                        {f.latest_funding_date && (
                                          <div className="flex items-baseline gap-2">
                                            <span className="text-xs text-gray-400 w-24 shrink-0">Latest round</span>
                                            <span className="text-xs text-gray-900">{formatLastUpdated(f.latest_funding_date)}</span>
                                          </div>
                                        )}
                                        {f.funding_resolution_summary && (
                                          <p className="text-xs text-gray-500 leading-snug pt-1">{f.funding_resolution_summary}</p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Products */}
                                {(hasProducts || (!hasProducts && !hasServices && hasSpecialties)) && (
                                  <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                                    <button
                                      type="button"
                                      onClick={() => setCompanyPanelOpen((s) => ({ ...s, products: !s.products }))}
                                      className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-100/60 transition-colors"
                                    >
                                      <span className="text-xs font-semibold text-gray-700">Products</span>
                                      <ChevronDown
                                        className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${
                                          companyPanelOpen.products ? '' : '-rotate-90'
                                        }`}
                                      />
                                    </button>
                                    {companyPanelOpen.products && (
                                      <div className="px-3 pb-3">
                                        {hasProducts ? (
                                          <div className="flex flex-wrap gap-1.5">
                                            {f!.products_services!.map((p, i) => (
                                              <span
                                                key={i}
                                                className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600"
                                              >
                                                {p}
                                              </span>
                                            ))}
                                          </div>
                                        ) : (
                                          <div className="flex flex-wrap gap-1.5">
                                            {f!.specialties!.map((s, i) => (
                                              <span
                                                key={i}
                                                className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600"
                                              >
                                                {s}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Services */}
                                {hasServices && (
                                  <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                                    <button
                                      type="button"
                                      onClick={() => setCompanyPanelOpen((s) => ({ ...s, services: !s.services }))}
                                      className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-100/60 transition-colors"
                                    >
                                      <span className="text-xs font-semibold text-gray-700">Services</span>
                                      <ChevronDown
                                        className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${
                                          companyPanelOpen.services ? '' : '-rotate-90'
                                        }`}
                                      />
                                    </button>
                                    {companyPanelOpen.services && (
                                      <div className="px-3 pb-3">
                                        <div className="flex flex-wrap gap-1.5">
                                          {f!.services!.map((s, i) => (
                                            <span
                                              key={i}
                                              className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600"
                                            >
                                              {s}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Technology */}
                                {f?.technologies?.length ? (
                                  <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                                    <button
                                      type="button"
                                      onClick={() => setCompanyPanelOpen((s) => ({ ...s, technology: !s.technology }))}
                                      className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-100/60 transition-colors"
                                    >
                                      <span className="text-xs font-semibold text-gray-700">Technology</span>
                                      <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${companyPanelOpen.technology ? '' : '-rotate-90'}`} />
                                    </button>
                                    {companyPanelOpen.technology && (
                                      <div className="px-3 pb-3">
                                        <div className="flex flex-wrap gap-1.5">
                                          {f.technologies.map((t, i) => (
                                            <span key={i} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">{t}</span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ) : null}

                              </div>
                            );
                          })()
                        ) : (
                          /* ── Scoring view ── */
                          <div className="space-y-3">

                            {/* Priority score */}
                            {typeof selectedLead.overall_fit_score === 'number' && (
                              <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                                <button
                                  type="button"
                                  onClick={() => setScoringPanelOpen((s) => ({ ...s, priority: !s.priority }))}
                                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-100/60 transition-colors"
                                >
                                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Overall fit score</span>
                                  <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${scoringPanelOpen.priority ? '' : '-rotate-90'}`} />
                                </button>
                                {scoringPanelOpen.priority && (
                                  <div className="px-4 pb-3">
                                    <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                                      {formatPercentValue(selectedLead.overall_fit_score)}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* ICP fit scores card */}
                            <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                              <button
                                type="button"
                                onClick={() => setScoringPanelOpen((s) => ({ ...s, icpFit: !s.icpFit }))}
                                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-100/60 transition-colors"
                              >
                                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">ICP fit score</span>
                                <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${scoringPanelOpen.icpFit ? '' : '-rotate-90'}`} />
                              </button>
                              {scoringPanelOpen.icpFit && (
                                <div className="px-4 pb-4 space-y-3">

                              {selectedCompanyFitState?.loading ? (
                                <p className="text-xs text-gray-400">Loading ICP scores…</p>
                              ) : selectedCompanyFit?.icp_scores?.length ? (
                                (() => {
                                  const bestScore = selectedCompanyFit.icp_scores.find(s => s.icp_id === selectedCompanyFit.matched_icp_id) ?? selectedCompanyFit.icp_scores[0];
                                  const otherScores = selectedCompanyFit.icp_scores.filter(s => s.icp_id !== bestScore?.icp_id);
                                  const renderScore = (score: typeof bestScore, idx: number) => {
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
                                            {isBest ? 'Best fit' : 'Also scored'}{score.icp_index != null ? `: ICP ${score.icp_index}` : ''}
                                          </p>
                                          <p className="mt-0.5 text-sm font-semibold text-gray-900">
                                            {score.icp_name || 'Unnamed ICP'}
                                          </p>
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
                                                    className="w-full text-left"
                                                  >
                                                    <div className="flex items-center justify-between gap-2">
                                                      <p className="text-xs font-medium text-gray-700">{component.label}</p>
                                                      {componentPercent && (
                                                        <span className="text-[11px] text-slate-500 shrink-0">{componentPercent}</span>
                                                      )}
                                                    </div>
                                                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200">
                                                      <div
                                                        className={`h-full rounded-full ${component.available ? 'bg-arcova-teal' : 'bg-slate-300'}`}
                                                        style={{ width: `${Math.max(0, Math.min(100, Math.round(component.score01 * 100)))}%` }}
                                                      />
                                                    </div>
                                                  </button>
                                                  {isOpen && (
                                                    <div className="mt-1.5 space-y-1">
                                                      {component.matchedValues && component.matchedValues.length > 0 && (
                                                        <div className="flex flex-wrap gap-1">
                                                          {component.matchedValues.map(v => (
                                                            <span key={v} className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2 py-0.5 text-[11px] font-medium text-arcova-teal">{v}</span>
                                                          ))}
                                                        </div>
                                                      )}
                                                      {!(component.matchedValues && component.matchedValues.length > 0) && exactPillLabels.length > 0 && (
                                                        <div className="flex flex-wrap gap-1">
                                                          {exactPillLabels.map((label) => (
                                                            <span key={label} className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2 py-0.5 text-[11px] font-medium text-arcova-teal">{label}</span>
                                                          ))}
                                                        </div>
                                                      )}
                                                      {component.unmatchedValues && component.unmatchedValues.length > 0 && (
                                                        <div className="flex flex-wrap gap-1">
                                                          {component.unmatchedValues.map(v => (
                                                            <span key={v} className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">{v}</span>
                                                          ))}
                                                        </div>
                                                      )}
                                                      {key === 'company_type' && (
                                                        <p className="text-[11px] leading-relaxed text-gray-400">
                                                          {component.matchStatus === 'exact'
                                                            ? 'Company type match'
                                                            : component.matchStatus === 'unknown'
                                                              ? 'Company type not yet classified'
                                                              : component.matchStatus === 'not_applicable'
                                                                ? 'No company type gate'
                                                                : 'Company type not matched'}
                                                        </p>
                                                      )}
                                                      {key !== 'company_type' && getExactCompanyFitStatusLabel(key, component) && (
                                                        <p className="text-[11px] leading-relaxed text-gray-400">
                                                          {getExactCompanyFitStatusLabel(key, component)}
                                                        </p>
                                                      )}
                                                      {component.detail && !(
                                                        (component.matchStatus === 'exact' || exactPillLabels.length > 0) &&
                                                        (
                                                          (component.matchedValues && component.matchedValues.length > 0) ||
                                                          exactPillLabels.length > 0
                                                        )
                                                      ) && (
                                                        <p className="text-[11px] leading-relaxed text-gray-400">{component.detail}</p>
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
                                      {bestScore && renderScore(bestScore, 0)}
                                      {otherScores.length > 0 && (
                                        <div className="pt-3 border-t border-gray-100">
                                          <button
                                            type="button"
                                            onClick={() => setScoringPanelOpen(s => ({ ...s, otherIcps: !s.otherIcps }))}
                                            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                                          >
                                            <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${scoringPanelOpen.otherIcps ? '' : '-rotate-90'}`} />
                                            {scoringPanelOpen.otherIcps ? 'Hide' : `${otherScores.length} other ICP${otherScores.length > 1 ? 's' : ''}`}
                                          </button>
                                          {scoringPanelOpen.otherIcps && (
                                            <div className="mt-3 space-y-3">
                                              {otherScores.map((s, i) => renderScore(s, i + 1))}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()
                              ) : selectedLead.fit_score != null ? (
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

                            {/* Contact fit card */}
                            <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
                              <button
                                type="button"
                                onClick={() => setScoringPanelOpen((s) => ({ ...s, contactFit: !s.contactFit }))}
                                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-100/60 transition-colors"
                              >
                                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Contact fit score</span>
                                <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${scoringPanelOpen.contactFit ? '' : '-rotate-90'}`} />
                              </button>
                              {scoringPanelOpen.contactFit && (
                                <div className="px-4 pb-4 space-y-3">

                              {selectedContactFitState?.loading ? (
                                <p className="text-xs text-gray-400">Loading contact fit…</p>
                              ) : selectedContactFit?.winning_breakdown ? (() => {
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
                                              className="w-full text-left"
                                            >
                                              <div className="flex items-center justify-between gap-2">
                                                <p className="text-xs font-medium text-gray-700">{component.label}</p>
                                                {componentPercent && (
                                                  <span className="text-[11px] text-slate-500 shrink-0">{componentPercent}</span>
                                                )}
                                              </div>
                                              <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200">
                                                <div
                                                  className={`h-full rounded-full ${component.available ? 'bg-arcova-teal' : 'bg-slate-300'}`}
                                                  style={{ width: `${Math.max(0, Math.min(100, Math.round(component.score01 * 100)))}%` }}
                                                />
                                              </div>
                                            </button>
                                            {isOpen && (() => {
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
                                                      <span className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2 py-0.5 text-[11px] font-medium text-arcova-teal">{component.matchedValue}</span>
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
                              })() : (
                                <p className="text-xs text-gray-400">No contact fit yet.</p>
                              )}
                                </div>
                              )}
                            </div>

                          </div>
                        )}
                      </div>

                      {/* Panel footer */}
                      <div className="px-5 py-4 border-t border-gray-100 space-y-2">
                        <p className="text-xs text-gray-400">
                          Last updated{' '}
                          {formatLastUpdated(selectedLead.updated_at || selectedLead.created_at)}
                        </p>

                        <div className="space-y-2">
                          {selectedLeadRefreshStatus !== 'idle' && (
                            <div className={`rounded-lg border px-3 py-2 text-xs ${selectedLeadRefreshStatusMeta.className}`}>
                              <p className="font-medium">{selectedLeadRefreshStatusMeta.label}</p>
                              {selectedLeadRefreshStatus === 'running' && (
                                <p className="mt-1">
                                  Enrichment in progress. You don't need to wait on this page.
                                </p>
                              )}
                              {selectedLeadRefreshStatus === 'succeeded' && selectedLead.enrichment_refresh_finished_at && (
                                <p className="mt-1">
                                  Finished {formatLastUpdated(selectedLead.enrichment_refresh_finished_at)}.
                                </p>
                              )}
                              {selectedLeadRefreshStatus === 'failed' && selectedEnrichmentError && (
                                <p className="mt-1">{selectedEnrichmentError}</p>
                              )}
                            </div>
                          )}
                          <p className="text-xs text-gray-500">
                            If this enrichment looks stalled, you can manually run it again here.
                          </p>
                          <button
                            type="button"
                            onClick={() => rerunEnrichment(selectedLead.id)}
                            disabled={isRefreshingSelected || isEditingSelected || isSelectedLeadRefreshRunning}
                            className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-arcova-teal/30 bg-arcova-teal/5 px-4 py-2 text-sm font-medium text-arcova-teal hover:bg-arcova-teal/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            <RotateCw className={`w-4 h-4 ${(isRefreshingSelected || isSelectedLeadRefreshRunning) ? 'animate-spin' : ''}`} />
                            {isRefreshingSelected
                              ? 'Starting enrichment…'
                              : isSelectedLeadRefreshRunning
                                ? 'Enrichment running…'
                                : 'Refresh enrichment'}
                          </button>
                        </div>

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
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
