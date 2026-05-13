'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { AgentPanel } from '@/components/AgentPanel';
import { PageHeader } from '@/components/PageHeader';
import { toast } from 'sonner';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Database,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BATCH_CONTACTS_KEY, type BatchCompany } from '@/lib/batch-contacts';
import { ROUTES, withQuery } from '@/lib/routes';

// ─── Types ────────────────────────────────────────────────────────────────────

interface IcpCard {
  icp_id: string;
  icp_index: number;
  label: string;
  company_count: number;
  avg_contact_fit: number | null;
  avg_contacts_per_company: number | null;
}

interface AcquisitionJob {
  id: string;
  icp_id: string | null;
  upload_batch_id: string | null;
  request_type: string;
  status: string;
  target_company_count: number | null;
  target_contact_count: number | null;
  screened_company_count: number | null;
  qualified_company_count: number | null;
  imported_company_count: number | null;
  imported_contact_count: number | null;
  error: string | null;
  requested_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

type PendingAcquisitionRoute =
  | {
      kind: 'companies_for_icp';
      jobIds: string[];
      icpId: string;
    }
  | {
      kind: 'contacts_at_company';
      jobIds: string[];
      companyId: string;
    }
  | {
      kind: 'contacts_at_companies';
      jobIds: string[];
    };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jobIsActive(status: string): boolean {
  return !['complete', 'completed', 'failed', 'cancelled'].includes(status);
}

function statusStyle(status: string): string {
  if (status === 'complete' || status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'failed') return 'border-red-200 bg-red-50 text-red-700';
  if (jobIsActive(status)) return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-amber-200 bg-amber-50 text-amber-700';
}

function formatStatusLabel(status: string): string {
  const map: Record<string, string> = {
    queued: 'Queued',
    processing: 'Processing',
    discovering: 'Discovering',
    enriching: 'Enriching',
    importing: 'Importing',
    complete: 'Complete',
    completed: 'Complete',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
  return map[status] ?? status.replace(/_/g, ' ');
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'complete' || status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === 'failed') return <AlertCircle className="h-3.5 w-3.5" />;
  if (jobIsActive(status)) return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  return <Clock3 className="h-3.5 w-3.5" />;
}

function formatDate(value: string | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

function formatRequestType(type: string): string {
  if (type === 'expand_companies') return 'Companies for ICP';
  if (type === 'contacts_at_company') return 'Contacts at account';
  if (type === 'better_contacts') return 'Better contacts';
  if (type === 'more_contacts_at_accounts') return 'More contacts';
  return type.replace(/_/g, ' ');
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function DataPageContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [icps, setIcps] = useState<IcpCard[]>([]);
  const [jobs, setJobs] = useState<AcquisitionJob[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [recentJobsExpanded, setRecentJobsExpanded] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<PendingAcquisitionRoute | null>(null);

  // Batch companies from sessionStorage (set by agent navigation)
  const [batchCompanies, setBatchCompanies] = useState<BatchCompany[]>([]);

  // Auto-open trigger for the agent
  const [agentOpener, setAgentOpener] = useState<{ text: string; nonce: number; threadPreview: string } | null>(null);
  const openerFired = useRef(false);

  // ── Load ICP cards + jobs ──────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [icpRes, jobsRes] = await Promise.all([
        fetch('/api/pipeline/icp-cards'),
        fetch('/api/data-acquisition/jobs'),
      ]);
      const [icpPayload, jobsPayload] = await Promise.all([
        icpRes.json().catch(() => ({})),
        jobsRes.json().catch(() => ({})),
      ]);
      if (icpRes.ok) setIcps((icpPayload.cards ?? []) as IcpCard[]);
      if (jobsRes.ok) setJobs((jobsPayload.jobs ?? []) as AcquisitionJob[]);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadData();
  }, [user, loadData]);

  const anyJobActive = jobs.some((j) => jobIsActive(j.status));

  useEffect(() => {
    if (!user || !anyJobActive) return;
    const interval = setInterval(() => void loadData(), 8000);
    return () => clearInterval(interval);
  }, [user, anyJobActive, loadData]);

  useEffect(() => {
    if (!pendingRoute) return;

    const watchedJobs = pendingRoute.jobIds
      .map((jobId) => jobs.find((job) => job.id === jobId))
      .filter((job): job is AcquisitionJob => Boolean(job));
    if (watchedJobs.length !== pendingRoute.jobIds.length) return;
    if (watchedJobs.some((job) => jobIsActive(job.status))) return;

    const completedJobs = watchedJobs.filter((job) => job.status === 'complete' || job.status === 'completed');
    if (completedJobs.length === 0) {
      toast.error('Acquisition finished, but no rows were imported.');
      setPendingRoute(null);
      return;
    }

    setPendingRoute(null);

    if (pendingRoute.kind === 'companies_for_icp') {
      router.push(
        withQuery(
          ROUTES.leads.accounts,
          `agentTask=arcova_companies_for_icp&icpId=${encodeURIComponent(pendingRoute.icpId)}`,
        ),
      );
      return;
    }

    if (pendingRoute.kind === 'contacts_at_company') {
      router.push(
        withQuery(
          ROUTES.leads.contacts,
          `agentTask=arcova_contacts_at_company&companyId=${encodeURIComponent(pendingRoute.companyId)}`,
        ),
      );
      return;
    }

    router.push(withQuery(ROUTES.leads.contacts, 'agentTask=arcova_contacts_today'));
  }, [jobs, pendingRoute, router]);

  // ── Read URL/sessionStorage context and fire agent opener ─────────────────

  useEffect(() => {
    if (openerFired.current) return;
    const rawMode = searchParams.get('mode') as 'companies' | 'contacts_at_company' | 'contacts_at_companies' | null;
    const companyId = searchParams.get('companyId') ?? '';
    const companyName = searchParams.get('companyName') ?? '';
    const icpId = searchParams.get('icpId') ?? '';

    let batch: BatchCompany[] = [];
    if (rawMode === 'contacts_at_companies') {
      try {
        const raw = sessionStorage.getItem(BATCH_CONTACTS_KEY);
        if (raw) {
          batch = JSON.parse(raw) as BatchCompany[];
          sessionStorage.removeItem(BATCH_CONTACTS_KEY);
          setBatchCompanies(batch);
        }
      } catch { /* ignore */ }
    }

    // Build opener — agent will respond as if it started the conversation
    let opener = '';
    let threadPreview = '';
    if (rawMode === 'contacts_at_companies' && batch.length > 0) {
      opener = '__OPEN__';
      threadPreview = 'Help me find contacts at these companies';
    } else if (rawMode === 'contacts_at_company' && companyId) {
      opener = '__OPEN__';
      const trimmedName = companyName.trim();
      threadPreview = trimmedName
        ? `Help me find contacts at ${trimmedName}`
        : 'Help me find contacts at this company';
    } else if (rawMode === 'companies' && icpId) {
      opener = '__OPEN__';
      threadPreview = 'Help me find more companies for this ICP';
    }

    if (opener) {
      openerFired.current = true;
      setAgentOpener({ text: opener, nonce: Date.now(), threadPreview });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ── Handle job start from agent ────────────────────────────────────────────

  const handleJobStarted = useCallback(async (job: {
    requestType: string;
    icpId?: string;
    companyId?: string;
    batchCompanies?: BatchCompany[];
    quantity: number;
  }) => {
    const companies = job.batchCompanies ?? (batchCompanies.length > 0 ? batchCompanies : []);

    if (job.requestType === 'contacts_at_companies' && companies.length > 0) {
      let succeeded = 0;
      let failed = 0;
      const jobIds: string[] = [];
      for (const company of companies) {
        try {
          const res = await fetch('/api/pipeline/data-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              companyId: company.id,
              icpId: company.icpId || job.icpId || undefined,
              requestType: 'contacts_at_company',
              targetContactCount: job.quantity,
            }),
          });
          if (res.ok) {
            const payload = await res.json().catch(() => ({}));
            if (typeof payload.jobId === 'string') jobIds.push(payload.jobId);
            succeeded++;
          } else failed++;
        } catch { failed++; }
      }
      if (failed === 0) toast.success(`${succeeded} job${succeeded !== 1 ? 's' : ''} queued.`);
      else toast.warning(`${succeeded} queued, ${failed} failed.`);
      if (jobIds.length > 0) {
        setPendingRoute({ kind: 'contacts_at_companies', jobIds });
      }
    } else {
      const body =
        job.requestType === 'contacts_at_company'
          ? { companyId: job.companyId, icpId: job.icpId, requestType: 'contacts_at_company', targetContactCount: job.quantity }
          : { icpId: job.icpId, requestType: 'expand_companies', targetCompanyCount: job.quantity };

      try {
        const res = await fetch('/api/pipeline/data-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const payload = await res.json().catch(() => ({}));
          toast.success('Job queued.');
          if (typeof payload.jobId === 'string') {
            if (job.requestType === 'contacts_at_company' && job.companyId) {
              setPendingRoute({
                kind: 'contacts_at_company',
                jobIds: [payload.jobId],
                companyId: job.companyId,
              });
            } else if (job.icpId) {
              setPendingRoute({
                kind: 'companies_for_icp',
                jobIds: [payload.jobId],
                icpId: job.icpId,
              });
            }
          }
        } else toast.error('Failed to start job.');
      } catch { toast.error('Failed to start job.'); }
    }

    void loadData();
  }, [batchCompanies, loadData]);

  // ── Build page context for agent ──────────────────────────────────────────

  const rawMode = searchParams.get('mode') as 'companies' | 'contacts_at_company' | 'contacts_at_companies' | null;
  const companyId = searchParams.get('companyId') ?? '';
  const companyName = searchParams.get('companyName') ?? '';
  const icpIdParam = searchParams.get('icpId') ?? '';
  const selectedIcp = icps.find((i) => i.icp_id === icpIdParam) ?? icps[0] ?? null;

  const pageContext: Record<string, unknown> = {
    acquisitionMode: rawMode ?? undefined,
    acquisitionIcpId: icpIdParam || selectedIcp?.icp_id || undefined,
    acquisitionIcpLabel: selectedIcp?.label || undefined,
    acquisitionCompanyId: companyId || undefined,
    acquisitionCompanyName: companyName || undefined,
    acquisitionBatchCompanies: batchCompanies.length > 0 ? batchCompanies : undefined,
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (authLoading || loadingData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <Loader2 className="h-8 w-8 animate-spin text-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen bg-transparent">
      <AppSidebar />

      {/* Main: centered agent + recent jobs log */}
      <div className="arcova-scroll-surface min-h-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10">
        <div className="mx-auto flex min-h-0 w-full max-w-[1180px] flex-col gap-4">
          <PageHeader
            eyebrow="Data"
            eyebrowIcon={<Database className="h-3 w-3" />}
            title="Source companies and contacts"
            subtitle="Tell Arcova what gap to fill, then queue the right acquisition job."
          />

          <div className="h-[min(70vh,720px)] min-h-[520px]">
            <AgentPanel
              page="data"
              pageContext={pageContext}
              wide
              pendingMessage={
                agentOpener
                  ? { text: agentOpener.text, nonce: agentOpener.nonce, threadPreview: agentOpener.threadPreview }
                  : undefined
              }
              onJobStarted={handleJobStarted}
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-4 border-b border-gray-100 px-4 py-3.5">
              <button
                type="button"
                onClick={() => setRecentJobsExpanded((value) => !value)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="text-sm font-semibold text-gray-700">
                  Recent jobs
                  <span className="ml-2 text-xs font-normal text-gray-400">({jobs.length})</span>
                </p>
                <p className="mt-0.5 text-xs text-gray-400">Jobs queued, completed, and in progress</p>
              </button>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadData()}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-400 transition-colors hover:border-gray-300 hover:text-gray-600"
                  aria-label="Refresh recent jobs"
                  title="Refresh"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setRecentJobsExpanded((value) => !value)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-arcova-teal/10 text-arcova-teal transition-colors hover:bg-arcova-teal/15"
                  aria-label={recentJobsExpanded ? 'Collapse recent jobs' : 'Expand recent jobs'}
                >
                  <ChevronDown className={cn('h-4 w-4 transition-transform', recentJobsExpanded ? 'rotate-180' : '')} />
                </button>
              </div>
            </div>

            {recentJobsExpanded && (
              <div>
                {jobs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
                    <Database className="h-6 w-6 text-gray-200" />
                    <p className="text-xs text-gray-400">No jobs yet. Start one with the agent.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="min-w-[42rem]">
                      <div className="grid grid-cols-[minmax(0,1.2fr)_7rem_8rem_1fr] border-b border-gray-100 bg-gray-50/90 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                        <span>Request</span>
                        <span>Date</span>
                        <span>Status</span>
                        <span>Progress</span>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {jobs.map((job) => {
                          const icpLabel = icps.find((icp) => icp.icp_id === job.icp_id)?.label ?? null;
                          const progressParts = [
                            job.screened_company_count != null ? `${job.screened_company_count.toLocaleString()} screened` : null,
                            job.qualified_company_count != null ? `${job.qualified_company_count.toLocaleString()} qualified` : null,
                            job.imported_contact_count != null ? `${job.imported_contact_count.toLocaleString()} imported` : null,
                          ].filter(Boolean);

                          return (
                            <div
                              key={job.id}
                              className="grid grid-cols-[minmax(0,1.2fr)_7rem_8rem_1fr] items-center gap-3 px-4 py-3"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-gray-900">
                                  {formatRequestType(job.request_type)}
                                </p>
                                {icpLabel && <p className="mt-0.5 truncate text-xs text-gray-400">{icpLabel}</p>}
                                {job.error && <p className="mt-1 truncate text-xs text-red-600">{job.error}</p>}
                              </div>
                              <div className="text-xs tabular-nums text-gray-500">{formatDate(job.requested_at) || '-'}</div>
                              <div>
                                <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', statusStyle(job.status))}>
                                  <StatusIcon status={job.status} />
                                  {formatStatusLabel(job.status)}
                                </span>
                              </div>
                              <div className="truncate text-xs text-gray-500">
                                {progressParts.length > 0 ? progressParts.join(' - ') : '-'}
                              </div>
                            </div>
                          );
                        })}
                      </div>
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

export default function DataPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-transparent">
          <Loader2 className="h-8 w-8 animate-spin text-arcova-teal" />
        </div>
      }
    >
      <DataPageContent />
    </Suspense>
  );
}
