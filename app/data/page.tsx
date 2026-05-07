'use client';

import { useAuth } from '@/context/AuthContext';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { AgentPanel } from '@/components/AgentPanel';
import { toast } from 'sonner';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Database,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BATCH_CONTACTS_KEY, type BatchCompany } from '@/lib/batch-contacts';

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
  const searchParams = useSearchParams();

  const [icps, setIcps] = useState<IcpCard[]>([]);
  const [jobs, setJobs] = useState<AcquisitionJob[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Batch companies from sessionStorage (set by agent navigation)
  const [batchCompanies, setBatchCompanies] = useState<BatchCompany[]>([]);

  // Auto-open trigger for the agent
  const [agentOpener, setAgentOpener] = useState<{ text: string; nonce: number } | null>(null);
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
    if (rawMode === 'contacts_at_companies' && batch.length > 0) {
      opener = '__OPEN__';
    } else if (rawMode === 'contacts_at_company' && companyId) {
      opener = '__OPEN__';
    } else if (rawMode === 'companies' && icpId) {
      opener = '__OPEN__';
    }

    if (opener) {
      openerFired.current = true;
      setAgentOpener({ text: opener, nonce: Date.now() });
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
          if (res.ok) succeeded++; else failed++;
        } catch { failed++; }
      }
      if (failed === 0) toast.success(`${succeeded} job${succeeded !== 1 ? 's' : ''} queued.`);
      else toast.warning(`${succeeded} queued, ${failed} failed.`);
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
        if (res.ok) toast.success('Job queued.');
        else toast.error('Failed to start job.');
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
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen bg-gray-50">
      <AppSidebar />

      {/* Main: centered agent + jobs rail */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 items-stretch justify-center overflow-hidden">
          <div className="flex min-h-0 w-full max-w-xl flex-col self-stretch">
            <AgentPanel
              page="data"
              pageContext={pageContext}
              wide
              hideHeader
              pendingMessage={agentOpener ? { text: agentOpener.text, nonce: agentOpener.nonce, isHidden: true } : undefined}
              onJobStarted={handleJobStarted}
            />
          </div>
        </div>

        {/* Recent jobs */}
        <div className="flex min-h-0 w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">Recent jobs</p>
                <p className="text-xs text-gray-400 mt-0.5">Jobs queued and in progress</p>
              </div>
              <button
                onClick={() => void loadData()}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                title="Refresh"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {jobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 px-4 text-center">
                  <Database className="h-6 w-6 text-gray-200" />
                  <p className="text-xs text-gray-400">No jobs yet. Start one with the agent.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {jobs.map((job) => {
                    const icpLabel = icps.find((icp) => icp.icp_id === job.icp_id)?.label ?? null;
                    return (
                      <div key={job.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-gray-900">
                              {formatRequestType(job.request_type)}
                              {icpLabel ? ` · ${icpLabel}` : ''}
                            </p>
                            <p className="mt-0.5 text-[11px] text-gray-400">{formatDate(job.requested_at)}</p>
                            {job.error && (
                              <p className="mt-1 text-[11px] text-red-600 truncate">{job.error}</p>
                            )}
                          </div>
                          <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', statusStyle(job.status))}>
                            <StatusIcon status={job.status} />
                            {formatStatusLabel(job.status)}
                          </span>
                        </div>

                        {/* Progress metrics */}
                        {(job.screened_company_count != null || job.imported_contact_count != null) && (
                          <div className="mt-2 flex gap-3 text-[11px] text-gray-500">
                            {job.screened_company_count != null && (
                              <span>{job.screened_company_count.toLocaleString()} screened</span>
                            )}
                            {job.qualified_company_count != null && (
                              <span>{job.qualified_company_count.toLocaleString()} qualified</span>
                            )}
                            {job.imported_contact_count != null && (
                              <span>{job.imported_contact_count.toLocaleString()} imported</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
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
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <Loader2 className="h-8 w-8 animate-spin text-arcova-teal" />
        </div>
      }
    >
      <DataPageContent />
    </Suspense>
  );
}
