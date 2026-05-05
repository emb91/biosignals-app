'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import {
  Building2,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Search,
  Users,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;

type AccountRow = {
  id: string;
  company_name: string | null;
  domain: string | null;
  company_website: string | null;
  logo_url: string | null;
  company_fit_score: number | null;
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
  contact_count: number;
  best_contact_fit: number | null;
  worst_contact_fit: number | null;
  avg_contact_fit: number | null;
};

const formatPercentValue = (value: number | null | undefined): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return `${Math.round(value <= 1 ? value * 100 : value)}%`;
};

function externalCompanyUrl(account: AccountRow): string | null {
  const raw = account.company_website?.trim() || account.domain?.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw.replace(/^\/+/, '')}`;
}

function formatJoinedList(value: string[] | null | undefined, maxItems = 3): string {
  const list = (value || []).filter(Boolean);
  if (list.length === 0) return '—';
  const shown = list.slice(0, maxItems);
  const suffix = list.length > maxItems ? ` +${list.length - maxItems}` : '';
  return `${shown.join(', ')}${suffix}`;
}

function renderTaxonomyPills(items: string[] | null | undefined) {
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

/** Same rhythm as leads table: 7rem details column, padded centered action column */
const TABLE_GRID =
  'grid grid-cols-[minmax(0,1.15fr)_minmax(0,0.95fr)_minmax(0,0.9fr)_minmax(0,5.5rem)_minmax(0,6rem)_7rem_minmax(10rem,1.25fr)] gap-x-6';

export default function AccountsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  const fetchAccounts = useCallback(async () => {
    if (!user) return;
    setLoadingAccounts(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (search) params.set('search', search);

      const res = await fetch(`/api/accounts?${params}`);
      if (res.ok) {
        const result = await res.json();
        const next: AccountRow[] = result.data || [];
        setAccounts(next);
        setTotal(result.total || 0);
        setSelectedAccountId((current) => {
          if (current && next.some((a) => a.id === current)) return current;
          return next[0]?.id ?? null;
        });
      }
    } catch (err) {
      console.error('Error fetching accounts:', err);
    } finally {
      setLoadingAccounts(false);
    }
  }, [user, page, search]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const showSearch = total > 0 || searchInput.trim().length > 0 || search.trim().length > 0;
  const selectedAccount = selectedAccountId
    ? accounts.find((a) => a.id === selectedAccountId) ?? null
    : null;
  const leadsHrefFor = (account: AccountRow) =>
    `/results?search=${encodeURIComponent(account.company_name || account.domain || '')}`;

  return (
    <div className="flex h-screen bg-gray-50">
      <AppSidebar />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-6">
          <div className="w-full max-w-none">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
                <p className="text-gray-600 mt-1 max-w-3xl">
                  One row per company that appears on your imported contacts, with firmographics and fit at a
                  glance. Select a row for details or open Leads to work people at that account.
                </p>
              </div>
            </div>

            {showSearch && (
              <div className="mb-4 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by company, domain, therapeutic area, modality, funding, or company type…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-arcova-teal/30 bg-white"
                />
              </div>
            )}

            {loadingAccounts ? (
              <div className="flex items-center justify-center py-24">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-arcova-teal" />
              </div>
            ) : accounts.length === 0 && !search ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-16 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Building2 className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No companies yet</h3>
                <p className="text-gray-500 mb-6 max-w-md mx-auto">
                  Accounts are built from your imported contacts. After you import leads with a resolved
                  company, companies appear here.
                </p>
                <button
                  type="button"
                  onClick={() => router.push('/results')}
                  className="px-6 py-3 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors inline-flex items-center gap-2"
                >
                  <Users className="w-4 h-4" />
                  Review leads
                </button>
              </div>
            ) : accounts.length === 0 && search ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                <p className="text-gray-500">No accounts matching &ldquo;{search}&rdquo;</p>
              </div>
            ) : (
              <div className={cn('grid gap-4', selectedAccountId ? 'xl:grid-cols-[minmax(0,1fr)_360px]' : '')}>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  <div
                    className={cn(
                      TABLE_GRID,
                      'px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide',
                    )}
                  >
                    <span>Company</span>
                    <span>Therapeutic areas</span>
                    <span>Modalities</span>
                    <span className="leading-tight">Funding</span>
                    <span className="leading-tight">Development</span>
                    <span className="text-center leading-tight whitespace-nowrap">Company details</span>
                    <span className="block w-full pl-12 text-center">Action</span>
                  </div>

                  <div className="divide-y divide-gray-100">
                    {accounts.map((account) => {
                      const isSelected = selectedAccountId === account.id;
                      const href = externalCompanyUrl(account);
                      const companyLabel = account.company_name || account.domain || '—';
                      const truncated = companyLabel.length > 34 ? `${companyLabel.slice(0, 34)}…` : companyLabel;
                      const fundingDisplay =
                        account.funding_stage || account.funding_status_label || '—';
                      const devDisplay = formatJoinedList(account.development_stages, 2);

                      return (
                        <div
                          key={account.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedAccountId(account.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedAccountId(account.id);
                            }
                          }}
                          className={cn(
                            TABLE_GRID,
                            'px-4 py-3 items-center cursor-pointer transition-all duration-150 border-l-2',
                            isSelected
                              ? 'bg-arcova-teal/10 border-arcova-teal'
                              : 'border-transparent hover:bg-arcova-teal/5 hover:border-arcova-teal/30',
                          )}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              {href ? (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-sm font-medium text-arcova-teal hover:underline truncate"
                                  title={companyLabel}
                                >
                                  {truncated}
                                </a>
                              ) : (
                                <span className="text-sm font-medium text-gray-900 truncate" title={companyLabel}>
                                  {truncated}
                                </span>
                              )}
                              {href && (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-arcova-teal hover:text-arcova-teal/70 shrink-0"
                                  aria-label="Company website"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span className="text-[11px] text-gray-500">
                                {account.contact_count} contact{account.contact_count !== 1 ? 's' : ''}
                              </span>
                              {formatPercentValue(account.company_fit_score) && (
                                <span className="inline-flex rounded-full border border-arcova-teal/30 bg-white px-2 py-0.5 text-[11px] font-semibold text-arcova-teal">
                                  ICP {formatPercentValue(account.company_fit_score)}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="min-w-0">
                            <p className="text-xs text-gray-700 truncate leading-snug" title={formatJoinedList(account.therapeutic_areas, 99)}>
                              {formatJoinedList(account.therapeutic_areas)}
                            </p>
                          </div>

                          <div className="min-w-0">
                            <p className="text-xs text-gray-700 truncate leading-snug" title={formatJoinedList(account.modalities, 99)}>
                              {formatJoinedList(account.modalities)}
                            </p>
                          </div>

                          <div className="min-w-0">
                            <p className="text-xs text-gray-700 truncate leading-snug">{fundingDisplay}</p>
                          </div>

                          <div className="min-w-0">
                            <p className="text-xs text-gray-700 truncate leading-snug">{devDisplay}</p>
                          </div>

                          <div className="min-w-0 flex justify-center justify-self-center w-full max-w-[7rem]">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedAccountId(account.id);
                              }}
                              className={cn(
                                'inline-flex items-center justify-center rounded-md border p-1.5 transition-colors',
                                isSelected
                                  ? 'border-arcova-teal bg-arcova-teal text-white'
                                  : 'border-arcova-teal/40 bg-arcova-teal/10 text-arcova-teal hover:bg-arcova-teal hover:text-white hover:border-arcova-teal',
                              )}
                              title="Company details"
                            >
                              <Briefcase className="w-5 h-5" />
                            </button>
                          </div>

                          <div className="min-w-0 flex items-center justify-center pl-12">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(leadsHrefFor(account));
                              }}
                              className="inline-flex items-center rounded-full border border-arcova-teal/30 bg-white px-2.5 py-1 text-xs font-semibold text-arcova-teal hover:border-arcova-teal hover:bg-arcova-teal/10 transition-colors"
                            >
                              In leads
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
                          type="button"
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
                          type="button"
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

                {selectedAccountId && selectedAccount && (
                  <aside className="bg-white rounded-lg shadow-sm border border-gray-200 min-h-[520px] flex flex-col">
                    <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-200">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium uppercase tracking-wide text-arcova-teal">Company</p>
                        <h2 className="text-lg font-semibold text-gray-900 mt-1 leading-tight break-words">
                          {selectedAccount.company_name || selectedAccount.domain || 'Company'}
                        </h2>
                        {selectedAccount.matched_icp_label && (
                          <p className="text-xs text-gray-500 mt-1">{selectedAccount.matched_icp_label}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {formatPercentValue(selectedAccount.company_fit_score) && (
                            <span className="inline-flex rounded-full bg-arcova-teal px-2 py-0.5 text-xs font-semibold text-white">
                              ICP {formatPercentValue(selectedAccount.company_fit_score)}
                            </span>
                          )}
                          <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                            {selectedAccount.contact_count} contact{selectedAccount.contact_count !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedAccountId(null)}
                        className="text-gray-400 hover:text-gray-700 transition-colors"
                        aria-label="Close details"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="flex-1 overflow-auto px-5 py-4 space-y-3">
                      {(() => {
                        const ext = externalCompanyUrl(selectedAccount);
                        const domain = selectedAccount.domain;
                        return (
                          <div className="space-y-2">
                            {domain && ext && (
                              <a
                                href={ext}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-arcova-teal hover:underline"
                              >
                                {domain}
                                <ExternalLink className="w-3 h-3 shrink-0" />
                              </a>
                            )}
                            {selectedAccount.linkedin_url && (
                              <a
                                href={selectedAccount.linkedin_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-arcova-teal hover:underline"
                              >
                                {selectedAccount.linkedin_url.replace(/^https?:\/\/(www\.)?/, '')}
                                <ExternalLink className="w-3 h-3 shrink-0" />
                              </a>
                            )}
                          </div>
                        );
                      })()}

                      {(selectedAccount.bio_summary || selectedAccount.description) && (
                        <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5">
                          <p className="text-xs font-semibold text-gray-700 mb-1.5">Summary</p>
                          <p className="text-sm text-gray-700 leading-relaxed">
                            {selectedAccount.bio_summary || selectedAccount.description}
                          </p>
                        </div>
                      )}

                      <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5 space-y-2">
                        <p className="text-xs font-semibold text-gray-700">Coverage</p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <p className="text-gray-400">Best contact fit</p>
                            <p className="font-medium text-gray-900">
                              {formatPercentValue(selectedAccount.best_contact_fit) ?? '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-gray-400">Avg contact fit</p>
                            <p className="font-medium text-gray-900">
                              {formatPercentValue(selectedAccount.avg_contact_fit) ?? '—'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {(selectedAccount.company_type ||
                        selectedAccount.employee_count != null ||
                        selectedAccount.employee_range ||
                        selectedAccount.headquarters_city ||
                        selectedAccount.headquarters_country) && (
                        <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5 space-y-2">
                          <p className="text-xs font-semibold text-gray-700">Firmographics</p>
                          <div className="space-y-1.5 text-xs">
                            {selectedAccount.company_type && (
                              <p>
                                <span className="text-gray-400">Type </span>
                                <span className="text-gray-900">{selectedAccount.company_type}</span>
                              </p>
                            )}
                            {(selectedAccount.employee_count != null || selectedAccount.employee_range) && (
                              <p>
                                <span className="text-gray-400">Employees </span>
                                <span className="text-gray-900">
                                  {selectedAccount.employee_count != null
                                    ? selectedAccount.employee_count.toLocaleString()
                                    : selectedAccount.employee_range}
                                </span>
                              </p>
                            )}
                            {(selectedAccount.headquarters_city || selectedAccount.headquarters_country) && (
                              <p>
                                <span className="text-gray-400">HQ </span>
                                <span className="text-gray-900">
                                  {[selectedAccount.headquarters_city, selectedAccount.headquarters_country]
                                    .filter(Boolean)
                                    .join(', ')}
                                </span>
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5 space-y-2">
                        <p className="text-xs font-semibold text-gray-700">Criteria</p>
                        <div className="space-y-2">
                          <div>
                            <p className="text-gray-400 text-xs mb-1">Therapeutic areas</p>
                            {renderTaxonomyPills(selectedAccount.therapeutic_areas)}
                          </div>
                          <div>
                            <p className="text-gray-400 text-xs mb-1">Modalities</p>
                            {renderTaxonomyPills(selectedAccount.modalities)}
                          </div>
                          <div>
                            <p className="text-gray-400 text-xs mb-1">Development stage</p>
                            {renderTaxonomyPills(selectedAccount.development_stages)}
                          </div>
                        </div>
                      </div>

                      {(selectedAccount.funding_stage ||
                        selectedAccount.funding_status_label) && (
                        <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5">
                          <p className="text-xs font-semibold text-gray-700 mb-1">Funding</p>
                          <p className="text-sm text-gray-900">
                            {selectedAccount.funding_stage || selectedAccount.funding_status_label}
                          </p>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => router.push(leadsHrefFor(selectedAccount))}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-arcova-teal/30 bg-arcova-teal/5 px-4 py-2 text-sm font-medium text-arcova-teal hover:bg-arcova-teal/10 transition-colors"
                      >
                        <Users className="w-4 h-4" />
                        View contacts in Leads
                      </button>
                    </div>
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
