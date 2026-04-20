'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import AppSidebar from '@/components/AppSidebar';
import {
  Users,
  Search,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  X,
  ExternalLink,
  ChevronRight as ChevronRightIcon,
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

const formatLastUpdated = (iso: string | null): string => {
  if (!iso) return '—';

  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const getEmailStatusBadge = (lead: Lead): { label: string; className: string } | null => {
  switch (lead.email_status) {
    case 'aligned_current':
      return {
        label: 'Current',
        className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    case 'candidate':
      return {
        label: 'Candidate',
        className: 'bg-slate-50 text-slate-700 border-slate-200',
      };
    case 'stale_suspected':
      return {
        label: 'Old email',
        className: 'bg-amber-50 text-amber-800 border-amber-200',
      };
    case 'missing':
      return {
        label: 'Missing',
        className: 'bg-gray-50 text-gray-500 border-gray-200',
      };
    default:
      return null;
  }
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
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<'contact' | 'company'>('contact');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  const fetchLeads = useCallback(async () => {
    if (!user) return;
    setLoadingLeads(true);
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
      setLoadingLeads(false);
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

      if (editingLeadId === leadId) {
        cancelEditingLead();
      }
      if (selectedLeadId === leadId) {
        setSelectedLeadId(null);
      }
    } catch (error) {
      console.error('Error deleting lead:', error);
    } finally {
      setDeletingLeadId(null);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) || null;

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
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
                <p className="text-gray-600 mt-1">
                  {total > 0
                    ? `${total.toLocaleString()} contact${total !== 1 ? 's' : ''} ready to review`
                    : 'Your imported contacts will appear here once they are ready to review'}
                </p>
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
                  placeholder="Search by name or email…"
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
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  <div className="grid grid-cols-[2rem_1fr_1.1fr_2fr_1.05fr_1.05fr_0.55fr] gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
                    <span></span>
                    <span>First name</span>
                    <span>Last name</span>
                    <span>Email</span>
                    <span>Contact details</span>
                    <span>Company details</span>
                    <span></span>
                  </div>

                  <div className="divide-y divide-gray-100">
                    {leads.map((lead) => {
                      const isEditing = editingLeadId === lead.id;
                      const isSaving = savingLeadId === lead.id;
                      const isDeleting = deletingLeadId === lead.id;
                      const isSelected = selectedLeadId === lead.id;

                      return (
                        <div
                          key={lead.id}
                          className={`grid grid-cols-[2rem_1fr_1.1fr_2fr_1.05fr_1.05fr_0.55fr] gap-3 px-4 py-3 items-center transition-colors ${
                            isSelected ? 'bg-arcova-teal/5' : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center justify-center">
                            {lead.profile_photo_url ? (
                              <img
                                src={lead.profile_photo_url}
                                alt=""
                                className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                              />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-gray-200 flex-shrink-0 flex items-center justify-center text-[10px] font-medium text-gray-500">
                                {(lead.first_name?.[0] || lead.full_name?.[0] || '?').toUpperCase()}
                              </div>
                            )}
                          </div>

                          <div className="min-w-0">
                            {isEditing ? (
                              <input
                                value={editingFields?.first_name || ''}
                                onChange={(e) => updateEditingField('first_name', e.target.value)}
                                className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
                                placeholder="First name"
                              />
                            ) : (
                              <p className="font-medium text-gray-900 truncate text-sm">
                                {lead.first_name || '—'}
                              </p>
                            )}
                          </div>

                          <div className="min-w-0">
                            {isEditing ? (
                              <input
                                value={editingFields?.last_name || ''}
                                onChange={(e) => updateEditingField('last_name', e.target.value)}
                                className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
                                placeholder="Last name"
                              />
                            ) : (
                              <p className="font-medium text-gray-900 truncate text-sm">
                                {lead.last_name || '—'}
                              </p>
                            )}
                          </div>

                          <div className="min-w-0">
                            {isEditing ? (
                              <input
                                value={editingFields?.email || ''}
                                onChange={(e) => updateEditingField('email', e.target.value)}
                                className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-700"
                              />
                            ) : (
                              <div className="min-w-0">
                                <p className="text-sm text-gray-700 truncate">
                                  {lead.email || '—'}
                                </p>
                                {getEmailStatusBadge(lead) && (
                                  <span
                                    className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                                      getEmailStatusBadge(lead)?.className
                                    }`}
                                  >
                                    {getEmailStatusBadge(lead)?.label}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedLeadId(lead.id);
                                setSelectedPreview('contact');
                              }}
                              className={`inline-flex w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm transition-colors ${
                                isSelected && selectedPreview === 'contact'
                                  ? 'border-arcova-teal bg-arcova-teal/10 text-arcova-teal'
                                  : 'border-gray-200 text-gray-700 hover:border-arcova-teal/40 hover:text-arcova-teal'
                              }`}
                            >
                              <span className="truncate">Contact details</span>
                              <ChevronRightIcon className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedLeadId(lead.id);
                                setSelectedPreview('company');
                              }}
                              className={`inline-flex w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm transition-colors ${
                                isSelected && selectedPreview === 'company'
                                  ? 'border-arcova-teal bg-arcova-teal/10 text-arcova-teal'
                                  : 'border-gray-200 text-gray-700 hover:border-arcova-teal/40 hover:text-arcova-teal'
                              }`}
                            >
                              <span className="truncate">Company details</span>
                              <ChevronRightIcon className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="flex items-center justify-end gap-2">
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => saveLead(lead.id)}
                                  disabled={isSaving}
                                  className="text-xs font-medium text-arcova-teal hover:underline disabled:opacity-50"
                                >
                                  {isSaving ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditingLead}
                                  className="text-xs text-gray-400 hover:text-gray-600"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => startEditingLead(lead)}
                                  className="text-gray-400 hover:text-arcova-teal transition-colors"
                                  title="Edit lead"
                                  aria-label="Edit lead"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteLead(lead.id)}
                                  disabled={isDeleting}
                                  className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                                  title="Delete lead"
                                  aria-label="Delete lead"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
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

                <aside className="bg-white rounded-lg shadow-sm border border-gray-200 min-h-[520px]">
                  {selectedLead ? (
                    <div className="h-full flex flex-col">
                      <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200">
                        <div className="flex items-start gap-3 min-w-0">
                          {selectedPreview === 'contact' && (
                            selectedLead.profile_photo_url ? (
                              <img
                                src={selectedLead.profile_photo_url}
                                alt=""
                                className="w-10 h-10 rounded-full object-cover flex-shrink-0 mt-1"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-gray-200 flex-shrink-0 mt-1 flex items-center justify-center text-sm font-medium text-gray-500">
                                {(selectedLead.first_name?.[0] || selectedLead.full_name?.[0] || '?').toUpperCase()}
                              </div>
                            )
                          )}
                          <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-arcova-teal">
                            {selectedPreview === 'contact' ? 'Contact details' : 'Company details'}
                          </p>
                          <h2 className="text-lg font-semibold text-gray-900 mt-1">
                            {selectedPreview === 'contact'
                              ? [selectedLead.first_name, selectedLead.last_name].filter(Boolean).join(' ') ||
                                selectedLead.full_name ||
                                'Selected contact'
                              : selectedLead.company_name || 'Selected company'}
                          </h2>
                          <p className="text-sm text-gray-500 mt-1">
                            {selectedPreview === 'contact'
                              ? 'Richer contact and background context lives here.'
                              : 'Richer company and firmographic context lives here.'}
                          </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedLeadId(null)}
                          className="text-gray-400 hover:text-gray-700 transition-colors"
                          aria-label="Close details"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="flex-1 overflow-auto px-5 py-4 space-y-6">
                        {selectedPreview === 'contact' ? (
                          <>
                            <section className="space-y-3">
                              <h3 className="text-sm font-semibold text-gray-900">Contact details</h3>
                              <div className="space-y-2 text-sm">
                                <div>
                                  <p className="text-gray-400">Job title</p>
                                  <p className="text-gray-900">{selectedLead.resolved_current_job_title || selectedLead.job_title || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-gray-400">Location</p>
                                  <p className="text-gray-900">{selectedLead.location || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-gray-400">Email</p>
                                  <p className="text-gray-900">{selectedLead.email || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-gray-400">Email assessment</p>
                                  {getEmailStatusBadge(selectedLead) ? (
                                    <div className="space-y-1">
                                      <span
                                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
                                          getEmailStatusBadge(selectedLead)?.className
                                        }`}
                                      >
                                        {getEmailStatusBadge(selectedLead)?.label}
                                      </span>
                                      <p className="text-gray-600 text-xs">{selectedLead.email_status_reasoning || '—'}</p>
                                    </div>
                                  ) : (
                                    <p className="text-gray-900">—</p>
                                  )}
                                </div>
                                <div>
                                  <p className="text-gray-400">LinkedIn</p>
                                  {selectedLead.linkedin_url ? (
                                    <a
                                      href={selectedLead.linkedin_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-arcova-teal hover:underline text-xs break-all"
                                    >
                                      {selectedLead.linkedin_url}
                                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                    </a>
                                  ) : (
                                    <p className="text-gray-900">—</p>
                                  )}
                                </div>
                                <div>
                                  <p className="text-gray-400">Last updated</p>
                                  <p className="text-gray-900">{formatLastUpdated(selectedLead.updated_at || selectedLead.created_at)}</p>
                                </div>
                              </div>
                            </section>

                            {selectedLead.headline && (
                              <section className="space-y-2">
                                <h3 className="text-sm font-semibold text-gray-900">Headline</h3>
                                <p className="text-sm text-gray-700">{selectedLead.headline}</p>
                              </section>
                            )}

                            {selectedLead.resolved_employment_history && selectedLead.resolved_employment_history.length > 0 && (
                              <section className="space-y-3">
                                <h3 className="text-sm font-semibold text-gray-900">Work history</h3>
                                <div className="space-y-3">
                                  {selectedLead.resolved_employment_history.map((job, i) => (
                                    <div key={i} className="flex gap-3">
                                      <div className="mt-1 flex-shrink-0">
                                        <div className={`w-2 h-2 rounded-full ${job.current ? 'bg-arcova-teal' : 'bg-gray-300'}`} />
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-sm font-medium text-gray-900">{job.title || '—'}</p>
                                        <p className="text-sm text-gray-600">{job.company_name || '—'}</p>
                                        <p className="text-xs text-gray-400">
                                          {[job.start_date, job.end_date].filter(Boolean).join(' → ')}
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </section>
                            )}
                          </>
                        ) : (
                          <>
                            <section className="space-y-3">
                              <h3 className="text-sm font-semibold text-gray-900">Current company</h3>
                              <div className="space-y-2 text-sm">
                                <div>
                                  <p className="text-gray-400">Company</p>
                                  <p className="text-gray-900">{selectedLead.resolved_current_company_name || selectedLead.company_name || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-gray-400">Domain</p>
                                  <p className="text-gray-900">{selectedLead.resolved_current_company_domain || selectedLead.company_domain || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-gray-400">LinkedIn</p>
                                  {selectedLead.company_linkedin_url ? (
                                    <a
                                      href={selectedLead.company_linkedin_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-arcova-teal hover:underline text-xs break-all"
                                    >
                                      {selectedLead.company_linkedin_url}
                                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                    </a>
                                  ) : (
                                    <p className="text-gray-900">—</p>
                                  )}
                                </div>
                              </div>
                            </section>
                          </>
                        )}

                        <div className="pt-2">
                          <button
                            type="button"
                            className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-50 cursor-not-allowed"
                            disabled
                          >
                            Fit and intent scoring coming soon
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center px-8 text-center">
                      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                        <ChevronRightIcon className="w-5 h-5 text-gray-400" />
                      </div>
                      <h2 className="text-lg font-semibold text-gray-900">Open details</h2>
                      <p className="text-sm text-gray-500 mt-2 max-w-xs">
                        Click <span className="font-medium text-gray-700">View contact details</span> or{' '}
                        <span className="font-medium text-gray-700">View company details</span> on any contact to
                        preview the richer details for that lead.
                      </p>
                    </div>
                  )}
                </aside>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
