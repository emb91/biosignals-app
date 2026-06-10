'use client';

import { useAuth } from '@/context/AuthContext';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { AgentPanel } from '@/components/AgentPanel';
import { GradientWord, PageHeader } from '@/components/PageHeader';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock3,
  Database,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Users,
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
  skipped_duplicate_count: number | null;
  skipped_existing_count: number | null;
  completion_note: string | null;
  company_name: string | null;
  error: string | null;
  requested_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

type AcquisitionMode = 'companies' | 'contacts_at_company' | 'contacts_at_companies' | 'contacts_for_icp';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jobIsActive(status: string): boolean {
  return !['complete', 'completed', 'failed', 'cancelled', 'queued'].includes(status);
}

function jobIsDone(status: string): boolean {
  return status === 'complete' || status === 'completed';
}

function formatStatusLabel(status: string): string {
  const map: Record<string, string> = {
    queued: 'Waiting in queue',
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

function statusStyle(status: string): string {
  if (jobIsDone(status)) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'failed') return 'border-red-200 bg-red-50 text-red-700';
  if (jobIsActive(status)) return 'border-arcova-teal/30 bg-arcova-teal/10 text-arcova-teal';
  return 'border-amber-200 bg-amber-50 text-amber-700';
}

function StatusIcon({ status }: { status: string }) {
  if (jobIsDone(status)) return <CheckCircle2 className="h-3.5 w-3.5" />;
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
  if (type === 'expand_companies') return 'New companies for ICP';
  if (type === 'contacts_at_company') return 'Contacts at account';
  if (type === 'better_contacts') return 'More contacts at accounts';
  if (type === 'more_contacts_at_accounts') return 'More contacts at accounts';
  return type.replace(/_/g, ' ');
}

function jobTargetsCompanies(type: string): boolean {
  return type === 'expand_companies';
}

// ─── Job card ─────────────────────────────────────────────────────────────────

function JobCard({ job, icpLabel }: { job: AcquisitionJob; icpLabel: string | null }) {
  const active = jobIsActive(job.status);
  const done = jobIsDone(job.status);
  const target = job.company_name || icpLabel;
  const skipped = (job.skipped_duplicate_count ?? 0) + (job.skipped_existing_count ?? 0);

  const counts = [
    job.screened_company_count != null && job.screened_company_count > 0
      ? { label: 'screened', value: job.screened_company_count }
      : null,
    job.qualified_company_count != null && job.qualified_company_count > 0
      ? { label: 'qualified', value: job.qualified_company_count }
      : null,
    job.imported_contact_count != null && job.imported_contact_count > 0
      ? { label: 'contacts imported', value: job.imported_contact_count }
      : null,
    skipped > 0 ? { label: 'duplicates skipped', value: skipped } : null,
  ].filter((c): c is { label: string; value: number } => c != null);

  const resultsHref = done
    ? jobTargetsCompanies(job.request_type)
      ? withQuery(
          ROUTES.accounts,
          `agentTask=arcova_companies_for_icp${job.icp_id ? `&icpId=${encodeURIComponent(job.icp_id)}` : ''}`,
        )
      : withQuery(ROUTES.contacts, 'agentTask=arcova_contacts_today')
    : null;

  return (
    <div
      className={cn(
        'rounded-xl border bg-white p-3.5 shadow-sm transition-colors',
        active ? 'border-arcova-teal/40' : 'border-gray-200',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-arcova-navy">
            {jobTargetsCompanies(job.request_type) ? (
              <Building2 className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            ) : (
              <Users className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            )}
            <span className="truncate">{formatRequestType(job.request_type)}</span>
          </p>
          {target && <p className="mt-0.5 truncate text-xs text-gray-500">{target}</p>}
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
            statusStyle(job.status),
            active && 'animate-pulse',
          )}
        >
          <StatusIcon status={job.status} />
          {formatStatusLabel(job.status)}
        </span>
      </div>

      {counts.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
          {counts.map((count) => (
            <span key={count.label} className="text-[11px] text-gray-500">
              <span className="font-semibold tabular-nums text-gray-700">{count.value.toLocaleString()}</span>{' '}
              {count.label}
            </span>
          ))}
        </div>
      )}

      {job.completion_note && (
        <p className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-arcova-teal/5 px-2.5 py-2 text-[11px] leading-snug text-arcova-navy/70">
          <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-arcova-teal" />
          {job.completion_note}
        </p>
      )}

      {job.error && (
        <p className="mt-2.5 rounded-lg bg-red-50 px-2.5 py-2 text-[11px] leading-snug text-red-700">{job.error}</p>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="text-[11px] tabular-nums text-gray-400">{formatDate(job.requested_at)}</span>
        {resultsHref && (
          <Link
            href={resultsHref}
            className="inline-flex items-center gap-1 rounded-lg bg-arcova-teal px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-arcova-teal/90"
          >
            {jobTargetsCompanies(job.request_type) ? 'View accounts' : 'View contacts'}
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    </div>
  );
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

  const anyJobActive = jobs.some((j) => jobIsActive(j.status) || j.status === 'queued');

  useEffect(() => {
    if (!user || !anyJobActive) return;
    const interval = setInterval(() => void loadData(), 8000);
    return () => clearInterval(interval);
  }, [user, anyJobActive, loadData]);

  // ── Read URL/sessionStorage context and fire agent opener ─────────────────

  useEffect(() => {
    if (openerFired.current) return;
    const rawMode = searchParams.get('mode') as AcquisitionMode | null;
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

    // Build opener: the agent responds as if it started the conversation.
    let opener = '';
    let threadPreview = '';
    if (rawMode === 'contacts_at_companies') {
      opener = '__OPEN__';
      // With no batch in sessionStorage (direct link or refresh) the agent
      // degrades gracefully and asks which companies to target.
      threadPreview = batch.length > 0
        ? 'Help me find contacts at these companies'
        : 'Help me source contacts at some of my accounts';
    } else if (rawMode === 'contacts_at_company' && companyId) {
      opener = '__OPEN__';
      const trimmedName = companyName.trim();
      threadPreview = trimmedName
        ? `Help me find contacts at ${trimmedName}`
        : 'Help me find contacts at this company';
    } else if (rawMode === 'contacts_for_icp' && icpId) {
      opener = '__OPEN__';
      threadPreview = 'Help me find more contacts at my existing accounts for this ICP';
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
          if (res.ok) succeeded++;
          else failed++;
        } catch { failed++; }
      }
      if (failed === 0) toast.success(`${succeeded} job${succeeded !== 1 ? 's' : ''} started. They run one at a time.`);
      else toast.warning(`${succeeded} started, ${failed} failed.`);
    } else {
      const body =
        job.requestType === 'contacts_at_company'
          ? { companyId: job.companyId, icpId: job.icpId, requestType: 'contacts_at_company', targetContactCount: job.quantity }
          : job.requestType === 'more_contacts_at_accounts'
            ? { icpId: job.icpId, requestType: 'more_contacts_at_accounts', targetContactCount: job.quantity }
            : { icpId: job.icpId, requestType: 'expand_companies', targetCompanyCount: job.quantity };

      try {
        const res = await fetch('/api/pipeline/data-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const payload = await res.json().catch(() => ({}));
          if (payload.queued) {
            toast.success('Job added to the queue. It starts as soon as the current job finishes.');
          } else {
            toast.success('Job started. Watch its progress on the right.');
          }
        } else toast.error('Failed to start job.');
      } catch { toast.error('Failed to start job.'); }
    }

    void loadData();
  }, [batchCompanies, loadData]);

  // ── Build page context for agent ──────────────────────────────────────────

  const rawMode = searchParams.get('mode') as AcquisitionMode | null;
  const companyId = searchParams.get('companyId') ?? '';
  const companyName = searchParams.get('companyName') ?? '';
  const icpIdParam = searchParams.get('icpId') ?? '';
  const sourceParam = searchParams.get('source') ?? '';
  const selectedIcp = icps.find((i) => i.icp_id === icpIdParam) ?? icps[0] ?? null;
  // Pre-scoped quantities from the Coverage plan ("source N contacts ≈ M companies").
  const suggestedContacts = Number(searchParams.get('count') ?? '') || 0;
  const suggestedCompanies = Number(searchParams.get('companyCount') ?? '') || 0;

  const pageContext: Record<string, unknown> = {
    acquisitionMode: rawMode ?? undefined,
    acquisitionIcpId: icpIdParam || selectedIcp?.icp_id || undefined,
    acquisitionIcpLabel: selectedIcp?.label || undefined,
    acquisitionCompanyId: companyId || undefined,
    acquisitionCompanyName: companyName || undefined,
    acquisitionBatchCompanies: batchCompanies.length > 0 ? batchCompanies : undefined,
    acquisitionSource: sourceParam || undefined,
    acquisitionSuggestedContacts: suggestedContacts > 0 ? suggestedContacts : undefined,
    acquisitionSuggestedCompanies: suggestedCompanies > 0 ? suggestedCompanies : undefined,
    acquisitionJobActive: anyJobActive || undefined,
    acquisitionRecentJobs:
      jobs.length > 0
        ? jobs.slice(0, 5).map((job) => ({
            request_type: job.request_type,
            status: job.status,
            target: job.company_name || icps.find((icp) => icp.icp_id === job.icp_id)?.label || null,
            imported_contact_count: job.imported_contact_count,
            qualified_company_count: job.qualified_company_count,
            duplicates_skipped: (job.skipped_duplicate_count ?? 0) + (job.skipped_existing_count ?? 0),
            completion_note: job.completion_note,
            error: job.error,
            requested_at: job.requested_at,
          }))
        : undefined,
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

  const visibleJobs = jobs.slice(0, 12);

  return (
    <div className="flex h-screen bg-transparent">
      <AppSidebar />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10">
        <div className="mx-auto w-full max-w-[1280px]">
          <PageHeader
            eyebrow="Data"
            eyebrowIcon={<Database className="h-3 w-3" />}
            title={
              <>
                Source <GradientWord>companies and contacts</GradientWord>
              </>
            }
            subtitle="Tell Arcova what gap to fill. Jobs run one at a time and only ever add people and companies you don't already have."
          />

          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            {/* Agent: center stage */}
            <div className="h-[min(72vh,760px)] min-h-[540px]">
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

            {/* Side column: live pipeline */}
            <aside className="flex max-h-[min(72vh,760px)] min-h-0 flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-arcova-navy">Sourcing pipeline</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-gray-400">
                    Sourced data is screened, enriched, and lands in your Accounts and Contacts.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadData()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-400 transition-colors hover:border-gray-300 hover:text-gray-600"
                  aria-label="Refresh jobs"
                  title="Refresh"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>

              {visibleJobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 bg-white/60 px-4 py-10 text-center">
                  <Database className="h-6 w-6 text-gray-200" />
                  <p className="text-xs text-gray-400">No jobs yet. Ask Arcova to source companies or contacts.</p>
                </div>
              ) : (
                <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto pb-1 pr-0.5">
                  {visibleJobs.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      icpLabel={icps.find((icp) => icp.icp_id === job.icp_id)?.label ?? null}
                    />
                  ))}
                  {jobs.length > visibleJobs.length && (
                    <p className="px-1 py-1 text-center text-[11px] text-gray-400">
                      Showing the {visibleJobs.length} most recent jobs
                    </p>
                  )}
                </div>
              )}
            </aside>
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
