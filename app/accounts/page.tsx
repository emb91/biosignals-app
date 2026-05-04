'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Search,
  Users,
} from 'lucide-react';

const PAGE_SIZE = 50;

type AccountRow = {
  id: string;
  company_name: string | null;
  domain: string | null;
  company_website: string | null;
  company_fit_score: number | null;
  matched_icp_id: string | null;
  matched_icp_label: string | null;
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

export default function AccountsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loadingAccounts, setLoadingAccounts] = useState(true);

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
        setAccounts(result.data || []);
        setTotal(result.total || 0);
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

  return (
    <div className="flex h-screen bg-gray-50">
      <AppSidebar />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-6">
          <div className="w-full max-w-none">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
                <p className="mt-1 text-gray-600 max-w-3xl">
                  Strong ICP matches where your existing contacts still score low on persona fit.
                  Prioritize net-new outreach or enrichment so strong accounts get better coverage.
                </p>
              </div>

              <button
                type="button"
                onClick={() => router.push('/results')}
                className="shrink-0 self-start px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:border-gray-400 hover:text-gray-900 transition-colors"
              >
                View leads
              </button>
            </div>

            {showSearch && (
              <div className="mb-4 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by company name or domain…"
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
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No coverage gaps match</h3>
                <p className="text-gray-500 mb-6 max-w-md mx-auto">
                  Either every imported contact already aligns well with your personas at strong
                  accounts, or company and contact scores need another scoring pass after import.
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
              <>
                <div className="overflow-x-auto">
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden min-w-[860px]">
                  <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_5rem_5.5rem_5.5rem_5.5rem_7rem] gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
                    <span>Company</span>
                    <span>ICP</span>
                    <span className="text-right">Leads</span>
                    <span className="text-right">ICP fit</span>
                    <span className="text-right">Best contact</span>
                    <span className="text-right">Avg contact</span>
                    <span className="text-right sr-only">Open</span>
                  </div>

                  <div className="divide-y divide-gray-100">
                    {accounts.map((account) => {
                      const href = externalCompanyUrl(account);
                      const companyLabel = account.company_name || account.domain || '—';
                      const truncated =
                        companyLabel.length > 42 ? `${companyLabel.slice(0, 42)}…` : companyLabel;
                      const leadsHref = `/results?search=${encodeURIComponent(
                        account.company_name || account.domain || '',
                      )}`;

                      return (
                        <div
                          key={account.id}
                          className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_5rem_5.5rem_5.5rem_5.5rem_7rem] gap-2 px-4 py-3 items-center border-l-2 border-transparent hover:bg-arcova-teal/5 hover:border-arcova-teal/30 transition-colors"
                        >
                          <div className="min-w-0 flex items-center gap-2">
                            {href ? (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
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
                                className="text-arcova-teal hover:text-arcova-teal/70 shrink-0"
                                aria-label="Company website"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>

                          <div className="min-w-0">
                            <p className="text-xs text-gray-600 truncate leading-snug">
                              {account.matched_icp_label || '—'}
                            </p>
                          </div>

                          <div className="text-right text-sm tabular-nums text-gray-800">
                            {account.contact_count}
                          </div>

                          <div className="text-right">
                            <span className="inline-flex min-w-[3.25rem] justify-end rounded-full border border-arcova-teal/30 bg-white px-2 py-0.5 text-xs font-semibold text-arcova-teal">
                              {formatPercentValue(account.company_fit_score) ?? '—'}
                            </span>
                          </div>

                          <div className="text-right">
                            <span className="inline-flex min-w-[3.25rem] justify-end rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">
                              {formatPercentValue(account.best_contact_fit) ?? '—'}
                            </span>
                          </div>

                          <div className="text-right">
                            <span className="text-xs font-medium tabular-nums text-gray-600">
                              {formatPercentValue(account.avg_contact_fit) ?? '—'}
                            </span>
                          </div>

                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => router.push(leadsHref)}
                              className="text-xs font-semibold text-arcova-teal hover:text-arcova-teal/80 whitespace-nowrap"
                            >
                              In leads
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  </div>
                </div>

                {totalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-sm text-gray-600">
                      {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}{' '}
                      account{total !== 1 ? 's' : ''}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="p-2 rounded-lg border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        className="p-2 rounded-lg border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
