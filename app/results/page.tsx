'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { Users, Search, ExternalLink, ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react';

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
  email: string | null;
  linkedin_url: string | null;
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
  job_title: string;
  company_name: string;
  email: string;
};

const PAGE_SIZE = 50;

const ScoreBar = ({ score, colour }: { score: number | null; colour: string }) => {
  const pct = score !== null ? Math.round(score * 100) : null;
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${colour}`}
          style={{ width: `${pct ?? 0}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 w-7 text-right">
        {pct !== null ? `${pct}` : '—'}
      </span>
    </div>
  );
};

const displayTitle = (lead: Lead): string =>
  lead.job_title_standardised || lead.job_title || '—';

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
        setLeads(result.data || []);
        setTotal(result.total || 0);
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

  // Search with debounce
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
      job_title: lead.job_title || '',
      company_name: lead.company_name || '',
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
                job_title: result.data.job_title,
                company_name: result.data.company_name,
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
    } catch (error) {
      console.error('Error deleting lead:', error);
    } finally {
      setDeletingLeadId(null);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

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
          <div className="w-full max-w-[1600px] mx-auto">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
                <p className="text-gray-600 mt-1">
                  {total > 0
                    ? `${total.toLocaleString()} contact${total !== 1 ? 's' : ''}, ranked by fit`
                    : 'Your ranked contacts will appear here after importing'}
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

            {/* Search */}
            {total > 0 && (
              <div className="mb-4 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name, company or title…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-arcova-teal/30 bg-white"
                />
              </div>
            )}

            {/* Table */}
            {loadingLeads ? (
              <div className="flex items-center justify-center py-24">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-arcova-teal" />
              </div>
            ) : leads.length === 0 && !search ? (
              /* Empty state */
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-16 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No leads yet</h3>
                <p className="text-gray-500 mb-6 max-w-sm mx-auto">
                  Import a CSV of contacts to start seeing your leads ranked by fit score.
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
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                {/* Column headers */}
                <div className="grid grid-cols-[1.2fr_1.2fr_1.9fr_1.5fr_1.1fr_0.9fr_0.9fr_0.9fr_0.8fr_1fr] gap-4 px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  <span>First name</span>
                  <span>Last name</span>
                  <span>Title / Company</span>
                  <span>Email</span>
                  <span>Last updated</span>
                  <span>Fit</span>
                  <span>Intent</span>
                  <span>Priority</span>
                  <span>LinkedIn</span>
                  <span></span>
                </div>

                <div className="divide-y divide-gray-100">
                  {leads.map((lead, idx) => (
                    (() => {
                      const isEditing = editingLeadId === lead.id;
                      const isSaving = savingLeadId === lead.id;
                      const isDeleting = deletingLeadId === lead.id;
                      return (
                    <div
                      key={lead.id}
                      className="grid grid-cols-[1.2fr_1.2fr_1.9fr_1.5fr_1.1fr_0.9fr_0.9fr_0.9fr_0.8fr_1fr] gap-4 px-4 py-3 items-center hover:bg-gray-50 transition-colors"
                    >
                      {/* Rank + First name */}
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs text-gray-400 w-6 shrink-0 text-right">
                          {(page - 1) * PAGE_SIZE + idx + 1}
                        </span>
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
                          {lead.seniority_level && (
                            <p className="text-xs text-gray-400 truncate">{lead.seniority_level}</p>
                          )}
                        </div>
                      </div>

                      {/* Last name */}
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

                      {/* Title + Company */}
                      <div className="min-w-0">
                        {isEditing ? (
                          <div className="space-y-1">
                            <input
                              value={editingFields?.job_title || ''}
                              onChange={(e) => updateEditingField('job_title', e.target.value)}
                              className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-700"
                            />
                            <input
                              value={editingFields?.company_name || ''}
                              onChange={(e) => updateEditingField('company_name', e.target.value)}
                              className="w-full rounded border border-gray-300 px-2 py-1 text-xs text-arcova-teal"
                            />
                          </div>
                        ) : (
                          <>
                            <p className="text-sm text-gray-700 truncate">{displayTitle(lead)}</p>
                            {lead.company_name && (
                              <p className="text-xs text-arcova-teal truncate">{lead.company_name}</p>
                            )}
                          </>
                        )}
                      </div>

                      {/* Email */}
                      <div className="min-w-0">
                        {isEditing ? (
                          <input
                            value={editingFields?.email || ''}
                            onChange={(e) => updateEditingField('email', e.target.value)}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-700"
                          />
                        ) : (
                          <p className="text-sm text-gray-700 truncate">
                            {lead.email || '—'}
                          </p>
                        )}
                      </div>

                      {/* Last updated */}
                      <div className="min-w-0">
                        <p className="text-sm text-gray-600 truncate">{formatLastUpdated(lead.updated_at || lead.created_at)}</p>
                      </div>

                      {/* Fit score */}
                      <ScoreBar score={lead.fit_score} colour="bg-arcova-teal" />

                      {/* Intent score */}
                      <ScoreBar score={lead.intent_score} colour="bg-blue-400" />

                      {/* Priority score */}
                      <ScoreBar score={lead.priority_score} colour="bg-emerald-500" />

                      {/* LinkedIn link */}
                      <div className="flex justify-center">
                        {lead.linkedin_url ? (
                          <a
                            href={lead.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-400 hover:text-arcova-teal transition-colors"
                            title="View on LinkedIn"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </div>

                      {/* Actions */}
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
                    })()
                  ))}
                </div>

                {/* Pagination */}
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
