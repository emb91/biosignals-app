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
  resolved_company_firmographics: {
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
  } | null;
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
}

type EditableLeadFields = {
  first_name: string;
  last_name: string;
  email: string;
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

  // Auto-poll every 5s while any contact is still being enriched
  useEffect(() => {
    if (!anyEnriching) return;
    const interval = setInterval(() => { fetchLeads(true); }, 5000);
    return () => clearInterval(interval);
  }, [anyEnriching, fetchLeads]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) || null;
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
                  <div className="grid grid-cols-[0.95fr_0.8fr_1.65fr_3.5rem] gap-1 px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
                    <span>Name</span>
                    <span>Job title</span>
                    <span>Company</span>
                    <span></span>
                  </div>

                  <div className="divide-y divide-gray-100">
                    {leads.map((lead) => {
                      const isSelected = selectedLeadId === lead.id;
                      const enriching = isEnriching(lead);

                      if (enriching) {
                        return (
                          <div
                            key={lead.id}
                            onClick={() => {
                              setSelectedLeadId(lead.id);
                              setSelectedPreview('contact');
                              cancelEditingLead();
                            }}
                            className={`grid grid-cols-[0.95fr_0.8fr_1.65fr_3.5rem] gap-1 px-4 py-3 items-center cursor-pointer transition-all duration-150 border-b border-gray-50 last:border-0 ${
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

                            <div className="col-span-2 min-w-0 pr-3">
                              <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-200/80">
                                <div className="arcova-enrichment-progress absolute inset-y-0 left-0 rounded-full" />
                                <div className="arcova-enrichment-glow absolute inset-y-0 left-0 w-16 rounded-full" />
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
                          className={`grid grid-cols-[0.95fr_0.8fr_1.65fr_3.5rem] gap-1 px-4 py-3 items-center cursor-pointer transition-all duration-150 opacity-100 ${
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
                            <p className="text-xs text-gray-700 line-clamp-2 leading-snug">
                              {lead.resolved_current_job_title || lead.job_title || '—'}
                            </p>
                          </div>

                          {/* Company */}
                          <div className="min-w-0">
                            <p className="text-sm text-gray-700 truncate">
                              {((n) => n.length > 30 ? n.slice(0, 30) + '…' : n)(lead.resolved_current_company_name || lead.company_name || '—')}
                            </p>
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
                              : selectedLead.resolved_current_company_name ||
                                selectedLead.company_name ||
                                'Selected company'}
                          </h2>
                          {selectedPreview === 'contact' && selectedLead.headline && (
                            <p className="text-sm text-gray-500 mt-1 leading-snug line-clamp-2">
                              {selectedLead.headline}
                            </p>
                          )}
                        </div>

                        {/* Photo / logo + close (right side) */}
                        <div className="flex items-start gap-2 flex-shrink-0">
                          {selectedPreview === 'contact' ? (
                            selectedLead.profile_photo_url ? (
                              <img
                                src={selectedLead.profile_photo_url}
                                alt=""
                                className="w-16 h-16 rounded-full object-cover"
                              />
                            ) : (
                              <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center text-lg font-medium text-gray-500">
                                {(
                                  selectedLead.first_name?.[0] ||
                                  selectedLead.full_name?.[0] ||
                                  '?'
                                ).toUpperCase()}
                              </div>
                            )
                          ) : (
                            /* Company logo */
                            selectedLead.resolved_company_firmographics?.logo_url ? (
                              <img
                                src={selectedLead.resolved_company_firmographics.logo_url}
                                alt=""
                                className="w-16 h-16 rounded-xl object-contain bg-gray-50 border border-gray-100 p-1"
                              />
                            ) : (
                              <div className="w-16 h-16 rounded-xl bg-gray-100 flex items-center justify-center text-xl font-semibold text-gray-400">
                                {(
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
                            const f = selectedLead.resolved_company_firmographics;
                            // Domain: only show what Apify actually returned — never the Apollo/CSV-imported domain
                            const apifyDomain = f?.domain || null;
                            const website = f?.website || null;
                            const companyLinkedIn = f?.linkedin_url || selectedLead.company_linkedin_url;
                            const hqParts = [f?.hq_city, f?.hq_country].filter(Boolean);
                            const hq = hqParts.join(', ') || null;

                            return (
                              <div className="space-y-4">
                                {/* Bio — LLM summary preferred, raw description as fallback */}
                                {(f?.bio_summary || f?.description) ? (
                                  <div>
                                    <p className="text-gray-400 text-xs mb-1">About</p>
                                    <p className="text-sm text-gray-700 leading-relaxed">
                                      {f.bio_summary || f.description}
                                    </p>
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
                                  {f?.industry && (
                                    <div>
                                      <p className="text-gray-400 text-xs">Industry</p>
                                      <p className="text-gray-900 text-sm mt-0.5">{f.industry}</p>
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
                                  {apifyDomain && (
                                    <div>
                                      <p className="text-gray-400 text-xs">Domain</p>
                                      <p className="text-gray-900 text-sm mt-0.5">{apifyDomain}</p>
                                    </div>
                                  )}
                                </div>

                                {/* Links */}
                                {(website || companyLinkedIn) && (
                                  <div className="flex flex-col gap-1.5">
                                    {website && (
                                      <a href={website} target="_blank" rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 text-arcova-teal hover:underline text-xs">
                                        <ExternalLink className="w-3 h-3" />
                                        {website.replace(/^https?:\/\//, '')}
                                      </a>
                                    )}
                                    {companyLinkedIn && (
                                      <a href={companyLinkedIn} target="_blank" rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 text-arcova-teal hover:underline text-xs">
                                        <Link className="w-3 h-3" />
                                        LinkedIn page
                                      </a>
                                    )}
                                  </div>
                                )}

                                {/* Specialties */}
                                {f?.specialties && f.specialties.length > 0 && (
                                  <div>
                                    <p className="text-gray-400 text-xs mb-1.5">Specialties</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {f.specialties.slice(0, 8).map((s, i) => (
                                        <span key={i} className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{s}</span>
                                      ))}
                                    </div>
                                  </div>
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
          width: 100%;
          background: linear-gradient(90deg, rgba(12, 205, 205, 0.16) 0%, rgba(12, 205, 205, 0.72) 72%, rgba(13, 53, 71, 0.85) 100%);
          transform-origin: left center;
          animation: arcova-row-progress 2.9s ease-in-out infinite;
        }

        .arcova-enrichment-glow {
          background: linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.72) 48%, rgba(255, 255, 255, 0) 100%);
          animation: arcova-row-glow 2.9s ease-in-out infinite;
        }

        @keyframes arcova-row-progress {
          0% {
            opacity: 0.28;
            transform: scaleX(0.04);
          }

          55% {
            opacity: 0.9;
            transform: scaleX(0.62);
          }

          82% {
            opacity: 0.95;
            transform: scaleX(1);
          }

          100% {
            opacity: 0.22;
            transform: scaleX(0.04);
          }
        }

        @keyframes arcova-row-glow {
          0% {
            opacity: 0;
            transform: translateX(-4rem);
          }

          20% {
            opacity: 0.7;
          }

          82% {
            opacity: 0.85;
            transform: translateX(calc(100% - 4rem));
          }

          100% {
            opacity: 0;
            transform: translateX(calc(100% - 4rem));
          }
        }
      `}</style>
    </div>
  );
}
