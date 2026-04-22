'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { ArcovaLoader } from '@/components/ArcovaLoader';
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
  linkedin_url?: string | null;
  funding_stage?: string | null;
  total_funding_usd?: number | null;
  latest_funding_date?: string | null;
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
  fit_score: number | null;
  intent_score: number | null;
  priority_score: number | null;
  source: string;
  created_at: string;
  updated_at: string | null;
  company_id: string | null;
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
    therapeutic_areas: string[] | null;
    modalities: string[] | null;
    clinical_stage: string | null;
    employee_count: number | null;
    employee_range: string | null;
    industry: string | null;
    latest_funding_date: string | null;
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

type EnrichmentVisualState = {
  stageKey: EnrichmentStageKey;
  startedAt: number;
  startPercent: number;
};

const PAGE_SIZE = 50;
const MAX_VISIBLE_WORK_HISTORY = 5;

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

const getDisplayedCompanyFirmographics = (lead: Lead | null): CompanyFirmographics | null => {
  if (!lead) return null;

  const company = lead.companies;
  if (!company && !lead.resolved_current_company_name && !lead.company_name) {
    return null;
  }

  return {
    name: company?.company_name || lead.resolved_current_company_name || lead.company_name || null,
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
    linkedin_url: company?.linkedin_url || lead.company_linkedin_url || null,
    funding_stage: company?.funding_stage || null,
    total_funding_usd: company?.total_funding_usd ?? null,
    latest_funding_date: company?.latest_funding_date || null,
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

export default function LeadsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

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
  const [selectedPreview, setSelectedPreview] = useState<'contact' | 'company'>('contact');
  const [isWorkHistoryExpanded, setIsWorkHistoryExpanded] = useState(false);
  const [enrichmentVisuals, setEnrichmentVisuals] = useState<Record<string, EnrichmentVisualState>>({});
  const [progressNow, setProgressNow] = useState(() => Date.now());

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

        setSelectedLeadId((current) =>
          current && !nextLeads.some((lead: Lead) => lead.id === current) ? null : current
        );
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
    setRefreshingLeadId(leadId);
    setLeads((prev) =>
      prev.map((lead) =>
        lead.id === leadId
          ? {
              ...lead,
              linkedin_resolution_status: 'processing',
              profile_enrichment_status: 'pending',
            }
          : lead
      )
    );

    try {
      const response = await fetch(`/api/enrich/${leadId}`, {
        method: 'POST',
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to refresh enrichment.');
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
    if (!anyEnriching) return;
    const interval = setInterval(() => { fetchLeads(true); }, 5000);
    return () => clearInterval(interval);
  }, [anyEnriching, fetchLeads]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) || null;
  const selectedCompanyFirmographics = getDisplayedCompanyFirmographics(selectedLead);
  const selectedCompanyFirmographicsLastRefresh = getCompanyFirmographicsLastRefresh(selectedLead);
  const isEditingSelected = selectedLead ? editingLeadId === selectedLead.id : false;
  const isSavingSelected = selectedLead ? savingLeadId === selectedLead.id : false;
  const isDeletingSelected = selectedLead ? deletingLeadId === selectedLead.id : false;
  const isRefreshingSelected = selectedLead ? refreshingLeadId === selectedLead.id : false;

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

            {total > 0 && (
              <div className="mb-4 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name, company or job title…"
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
                  <div className="grid grid-cols-[0.8fr_1fr_1.65fr_3.5rem] gap-1 px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
                    <span>Name</span>
                    <span>Job title</span>
                    <span>Company</span>
                    <span></span>
                  </div>

                  <div className="divide-y divide-gray-100">
                    {leads.map((lead) => {
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
                            className={`grid grid-cols-[0.8fr_1fr_1.65fr_3.5rem] gap-1 px-4 py-3 items-center cursor-pointer transition-all duration-150 border-b border-gray-50 last:border-0 ${
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
                              <p className="mt-1 text-[11px] text-gray-400 truncate">
                                {enrichmentProgress.label}
                              </p>
                            </div>

                            <div className="col-span-2 min-w-0 pr-3">
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

                            <div className="flex items-center justify-center">
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
                          className={`grid grid-cols-[0.8fr_1fr_1.65fr_3.5rem] gap-1 px-4 py-3 items-center cursor-pointer transition-all duration-150 opacity-100 ${
                            isSelected
                              ? 'bg-arcova-teal/10 border-l-2 border-arcova-teal'
                              : 'border-l-2 border-transparent hover:bg-arcova-teal/5 hover:border-arcova-teal/30'
                          }`}
                        >
                          {/* Full name + LinkedIn icon */}
                          <div className="min-w-0 flex items-center gap-2">
                            <p className="font-medium text-gray-900 truncate text-sm">
                              {lead.full_name ||
                                [lead.first_name, lead.last_name].filter(Boolean).join(' ') ||
                                '—'}
                            </p>
                            {lead.linkedin_url && (
                              <a
                                href={lead.linkedin_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-arcova-teal hover:text-arcova-teal/70 transition-colors flex-shrink-0"
                                title="View LinkedIn profile"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>

                          {/* Job title */}
                          <div className="min-w-0">
                            <p className="text-xs text-gray-700 truncate leading-snug">
                              {((t) => t.length > 30 ? t.slice(0, 30) + '…' : t)(lead.resolved_current_job_title || lead.job_title || '—')}
                            </p>
                          </div>

                          {/* Company */}
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
                                <a href={href} target="_blank" rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-sm text-arcova-teal hover:underline truncate max-w-full inline-block">
                                  {truncated}
                                </a>
                              ) : (
                                <p className="text-sm text-gray-700 truncate">{truncated}</p>
                              );
                            })()}
                          </div>

                          {/* Company details button */}
                          <div className="min-w-0 pl-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedLeadId(lead.id);
                                setSelectedPreview('company');
                                cancelEditingLead();
                              }}
                              className={`inline-flex w-full items-center justify-center rounded-md border p-1.5 transition-colors ${
                                isSelected && selectedPreview === 'company'
                                  ? 'border-arcova-teal bg-arcova-teal text-white'
                                  : 'border-arcova-teal/40 bg-arcova-teal/10 text-arcova-teal hover:bg-arcova-teal hover:text-white hover:border-arcova-teal'
                              }`}
                              title="Company details"
                            >
                              <Briefcase className="w-5 h-5" />
                            </button>
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
                            {selectedPreview === 'contact' ? 'Contact details' : 'Company details'}
                          </p>
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
                            return domain && href ? (
                              <a href={href} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-arcova-teal hover:underline mt-1 inline-block">
                                {domain}
                              </a>
                            ) : null;
                          })()}
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
                          ) : (
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
                          )}
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
                            <>
                              {selectedLead.contact_bio && selectedLead.contact_bio.length > 0 && (
                                <ul className="space-y-1.5 pb-1">
                                  {selectedLead.contact_bio.map((bullet, i) => (
                                    <li key={i} className="flex gap-2 text-sm text-gray-700 leading-snug">
                                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-arcova-teal flex-shrink-0" />
                                      {bullet}
                                    </li>
                                  ))}
                                </ul>
                              )}

                              <div className="space-y-3 text-sm">
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
                                      <p className="text-xs text-amber-700 mt-1">
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

                              {selectedLead.resolved_employment_history &&
                                selectedLead.resolved_employment_history.length > 0 && (
                                  <section className="space-y-3">
                                    <h3 className="text-sm font-semibold text-gray-900">
                                      Work history
                                    </h3>
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
                                    {selectedLead.resolved_employment_history.length > MAX_VISIBLE_WORK_HISTORY && (
                                      <button
                                        type="button"
                                        onClick={() => setIsWorkHistoryExpanded((prev) => !prev)}
                                        className="inline-flex items-center gap-1.5 text-sm font-medium text-arcova-teal hover:text-arcova-teal/80 transition-colors"
                                      >
                                        <ChevronDown
                                          className={`w-4 h-4 transition-transform ${isWorkHistoryExpanded ? 'rotate-180' : ''}`}
                                        />
                                        {isWorkHistoryExpanded
                                          ? 'Show fewer roles'
                                          : `Show ${
                                              selectedLead.resolved_employment_history.length - MAX_VISIBLE_WORK_HISTORY
                                            } more roles`}
                                      </button>
                                    )}
                                  </section>
                                )}
                            </>
                          )
                        ) : (
                          /* ── Company view ── */
                          (() => {
                            const f = selectedCompanyFirmographics;
                            const website = f?.website || null;
                            const companyLinkedIn = f?.linkedin_url || selectedLead.company_linkedin_url;
                            const hqParts = [f?.hq_city, f?.hq_country].filter(Boolean);
                            const hq = hqParts.join(', ') || null;
                            const fundingStatus = getFundingStatusDisplay(selectedLead.companies);

                            return (
                              <div className="space-y-4">
                                {/* Bio — LLM summary preferred, raw description as fallback */}
                                {(f?.bio_summary || f?.description) ? (
                                  <div>
                                    <p className="text-gray-400 text-xs mb-1">About</p>
                                    <ul className="space-y-1.5 pb-1">
                                      {(f.bio_summary ?? f.description ?? '')
                                        .split('\n')
                                        .map((s: string) => s.trim())
                                        .filter(Boolean)
                                        .slice(0, 3)
                                        .map((bullet: string, i: number) => (
                                          <li key={i} className="flex gap-2 text-sm text-gray-700 leading-snug">
                                            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-arcova-teal flex-shrink-0" />
                                            {bullet}
                                          </li>
                                        ))}
                                    </ul>
                                  </div>
                                ) : (
                                  <p className="text-xs text-gray-400 italic">Company bio will appear after enrichment runs.</p>
                                )}

                                {/* Key stats */}
                                <div className="grid grid-cols-2 gap-3">
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
                                      <p className="text-gray-400 text-xs">Followers</p>
                                      <p className="text-gray-900 text-sm mt-0.5">{f.follower_count.toLocaleString()}</p>
                                    </div>
                                  )}
                                  {fundingStatus && (
                                    <div>
                                      <p className="text-gray-400 text-xs">{fundingStatus.heading}</p>
                                      <p className="text-gray-900 text-sm mt-0.5">{fundingStatus.value}</p>
                                    </div>
                                  )}
                                  {f?.total_funding_usd != null && (
                                    <div>
                                      <p className="text-gray-400 text-xs">Total funding</p>
                                      <p className="text-gray-900 text-sm mt-0.5">
                                        {formatCurrencyShort(f.total_funding_usd)}
                                      </p>
                                    </div>
                                  )}
                                  {f?.founded_year && (
                                    <div>
                                      <p className="text-gray-400 text-xs">Founded</p>
                                      <p className="text-gray-900 text-sm mt-0.5">{f.founded_year}</p>
                                    </div>
                                  )}
                                  {f?.latest_funding_date && (
                                    <div>
                                      <p className="text-gray-400 text-xs">Latest Funding Round</p>
                                      <p className="text-gray-900 text-sm mt-0.5">
                                        {formatLastUpdated(f.latest_funding_date)}
                                      </p>
                                    </div>
                                  )}
                                  {hq && (
                                    <div>
                                      <p className="text-gray-400 text-xs">HQ</p>
                                      <p className="text-gray-900 text-sm mt-0.5">{hq}</p>
                                    </div>
                                  )}
                                </div>

                                {/* Links */}
                                {website && (
                                  <div>
                                    <p className="text-gray-400 text-xs">Website</p>
                                    <a href={website} target="_blank" rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-arcova-teal hover:underline text-xs break-all mt-0.5">
                                      {website}
                                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                    </a>
                                  </div>
                                )}

                                {companyLinkedIn && (
                                  <div>
                                    <p className="text-gray-400 text-xs">LinkedIn</p>
                                    <a href={companyLinkedIn} target="_blank" rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-arcova-teal hover:underline text-xs break-all mt-0.5">
                                      {companyLinkedIn}
                                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                    </a>
                                  </div>
                                )}

                                {selectedCompanyFirmographicsLastRefresh && (
                                  <p className="text-xs text-gray-400">
                                    Firmographics refreshed {formatLastUpdated(selectedCompanyFirmographicsLastRefresh)}
                                  </p>
                                )}
                              </div>
                            );
                          })()
                        )}
                      </div>

                      {/* Panel footer */}
                      <div className="px-5 py-4 border-t border-gray-100 space-y-2">
                        <p className="text-xs text-gray-400">
                          Last updated{' '}
                          {formatLastUpdated(selectedLead.updated_at || selectedLead.created_at)}
                        </p>

                        <div className="space-y-2">
                          <p className="text-xs text-gray-500">
                            If this enrichment looks stalled, you can manually run it again here.
                          </p>
                          <button
                            type="button"
                            onClick={() => rerunEnrichment(selectedLead.id)}
                            disabled={isRefreshingSelected || isEditingSelected}
                            className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-arcova-teal/30 bg-arcova-teal/5 px-4 py-2 text-sm font-medium text-arcova-teal hover:bg-arcova-teal/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            <RotateCw className={`w-4 h-4 ${isRefreshingSelected ? 'animate-spin' : ''}`} />
                            {isRefreshingSelected ? 'Refreshing enrichment…' : 'Refresh enrichment'}
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
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
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
      <style jsx>{`
        .arcova-enrichment-progress {
          min-width: 1.25rem;
          background: linear-gradient(90deg, rgba(12, 205, 205, 0.24) 0%, rgba(12, 205, 205, 0.78) 68%, rgba(13, 53, 71, 0.9) 100%);
          box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.12),
            0 0 0.35rem rgba(12, 205, 205, 0.16);
          animation: arcova-row-throb 2.2s ease-in-out infinite;
          will-change: opacity, filter, box-shadow;
        }

        .arcova-enrichment-glow {
          background: linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.82) 50%, rgba(255, 255, 255, 0) 100%);
          animation: arcova-row-glow 1.8s ease-in-out infinite;
        }

        @keyframes arcova-row-throb {
          0% {
            opacity: 0.82;
            filter: saturate(0.96) brightness(0.98);
            box-shadow:
              inset 0 0 0 1px rgba(255, 255, 255, 0.12),
              0 0 0.25rem rgba(12, 205, 205, 0.14);
          }

          50% {
            opacity: 1;
            filter: saturate(1.08) brightness(1.08);
            box-shadow:
              inset 0 0 0 1px rgba(255, 255, 255, 0.16),
              0 0 0.65rem rgba(12, 205, 205, 0.28);
          }

          100% {
            opacity: 0.82;
            filter: saturate(0.96) brightness(0.98);
            box-shadow:
              inset 0 0 0 1px rgba(255, 255, 255, 0.12),
              0 0 0.25rem rgba(12, 205, 205, 0.14);
          }
        }

        @keyframes arcova-row-glow {
          0% {
            opacity: 0.22;
            transform: translateX(-0.85rem);
          }

          50% {
            opacity: 0.8;
            transform: translateX(0);
          }

          100% {
            opacity: 0.22;
            transform: translateX(0.85rem);
          }
        }
      `}</style>
    </div>
  );
}
