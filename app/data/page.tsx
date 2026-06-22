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
  Activity,
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock3,
  Database,
  Filter,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Target,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BATCH_CONTACTS_KEY, type BatchCompany } from '@/lib/batch-contacts';
import { ROUTES, withQuery } from '@/lib/routes';
import { getDisplayName } from '@/lib/auth-helpers';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import '@/app/today/briefing-today.css';

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
  /** Where the job's ICP landed after this run (counts the runner snapshots on completion). */
  coverage_after: { company_count: number; contact_count: number } | null;
  error: string | null;
  requested_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

type AcquisitionMode = 'companies' | 'contacts_at_company' | 'contacts_at_companies' | 'contacts_for_icp';

type AcquisitionRequest = {
  requestType: string;
  icpId?: string;
  companyId?: string;
  batchCompanies?: BatchCompany[];
  quantity: number;
};

type PendingPurchase = {
  job: AcquisitionRequest;
  operationId: string;
  leadCount: number;
  requiredCredits: number;
  availableCredits: number;
  planKey: string;
  canManageBilling: boolean;
  billingAvailable: boolean;
  creditPackAvailable: boolean;
  starterPlanAvailable: boolean;
  creditPackCredits: number | null;
  creditPackUsd: number | null;
};

type BillingSummarySnapshot = {
  available?: boolean;
  role?: 'owner' | 'admin' | 'member';
  plan?: { key?: string };
  credits?: { available?: number };
  catalog?: {
    pack?: { available?: boolean; credits?: number; usd?: number } | null;
    plans?: Array<{ key?: string; available?: boolean }>;
  };
};

/** sessionStorage handoff for the Coverage "Fix blind spots" batch CTA: a
 *  pre-built agent prompt that stages sourcing across all gap ICPs at once. */
const COVERAGE_STAGE_GAPS_KEY = 'arcova_coverage_stage_gaps';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const COMPLETE_JOB_VISIBLE_MS = 72 * 60 * 60 * 1000;
const FAILED_JOB_VISIBLE_MS = 12 * 60 * 60 * 1000;

const fmt = (n: number) => Math.round(n).toLocaleString();

function jobIsActive(status: string): boolean {
  return !['complete', 'completed', 'failed', 'cancelled', 'queued'].includes(status);
}

function jobIsDone(status: string): boolean {
  return status === 'complete' || status === 'completed';
}

function jobFailed(status: string): boolean {
  return status === 'failed' || status === 'cancelled';
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

/** Rough progress when we have no imported/target ratio yet — keeps the bar alive. */
function statusProgress(status: string): number {
  const map: Record<string, number> = {
    discovering: 0.1,
    processing: 0.3,
    enriching: 0.6,
    importing: 0.85,
  };
  return map[status] ?? 0.05;
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

function jobTimestamp(job: AcquisitionJob): string | null {
  return job.completed_at || job.started_at || job.requested_at;
}

function jobAgeMs(job: AcquisitionJob, nowMs: number): number {
  const timestamp = jobTimestamp(job);
  if (!timestamp) return Number.POSITIVE_INFINITY;
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) ? nowMs - parsed : Number.POSITIVE_INFINITY;
}

function jobBelongsInLivePipeline(job: AcquisitionJob, nowMs = Date.now()): boolean {
  if (job.status === 'queued' || jobIsActive(job.status)) return true;
  if (jobIsDone(job.status)) return jobAgeMs(job, nowMs) <= COMPLETE_JOB_VISIBLE_MS;
  if (jobFailed(job.status)) return jobAgeMs(job, nowMs) <= FAILED_JOB_VISIBLE_MS;
  return false;
}

function userFacingJobError(job: AcquisitionJob): string | null {
  if (!jobFailed(job.status)) return null;
  const error = job.error?.toLowerCase() ?? '';

  // Raw provider/API errors are useful in logs, but they are not product copy.
  // Keep this surface calm and action-oriented.
  if (error.includes('workspace lead capacity') || error.includes('workspace capacity')) {
    return 'This sourcing run would exceed your workspace lead capacity. Upgrade your plan or reduce the request size.';
  }
  if (error.includes('insufficient credits')) {
    return 'This sourcing run needs more credits. Add credits, then start a new sourcing request.';
  }
  return 'This sourcing run could not complete. Start a new sourcing request to try again.';
}

/** Normalize a raw job into the funnel view the rail renders. */
interface JobView {
  isCompanies: boolean;
  unit: string;
  title: string;
  subtitle: string | null;
  target: number;
  imported: number;
  screened: number;
  matched: number;
  skipped: number;
  progress: number;
  pct: number;
  resultsHref: string | null;
}

function deriveJobView(job: AcquisitionJob, icpLabel: string | null): JobView {
  const isCompanies = jobTargetsCompanies(job.request_type);
  const unit = isCompanies ? 'companies' : 'contacts';
  const target = (isCompanies ? job.target_company_count : job.target_contact_count) ?? 0;
  const imported = (isCompanies ? job.imported_company_count : job.imported_contact_count) ?? 0;
  const screened = job.screened_company_count ?? 0;
  const matched = job.qualified_company_count ?? 0;
  const skipped = (job.skipped_duplicate_count ?? 0) + (job.skipped_existing_count ?? 0);

  let progress: number;
  if (jobIsDone(job.status)) progress = 1;
  else if (target > 0 && imported > 0) progress = Math.min(0.99, imported / target);
  else progress = statusProgress(job.status);

  const resultsHref = jobIsDone(job.status)
    ? isCompanies
      ? withQuery(
          ROUTES.accounts,
          `agentTask=arcova_companies_for_icp${job.icp_id ? `&icpId=${encodeURIComponent(job.icp_id)}` : ''}`,
        )
      : withQuery(ROUTES.contacts, 'agentTask=arcova_contacts_today')
    : null;

  return {
    isCompanies,
    unit,
    title: formatRequestType(job.request_type),
    subtitle: job.company_name || icpLabel,
    target,
    imported,
    screened,
    matched,
    skipped,
    progress,
    pct: Math.round(progress * 100),
    resultsHref,
  };
}

// ─── Pipeline simulation ──────────────────────────────────────────────────────

const SIM_STEPS: Array<Partial<AcquisitionJob> & { _delayMs: number }> = [
  { _delayMs: 0,    status: 'discovering', screened_company_count: 0,  qualified_company_count: 0,  imported_contact_count: 0, imported_company_count: 0 },
  { _delayMs: 1800, status: 'discovering', screened_company_count: 22, qualified_company_count: 0,  imported_contact_count: 0, imported_company_count: 0 },
  { _delayMs: 1500, status: 'processing',  screened_company_count: 58, qualified_company_count: 21, imported_contact_count: 0, imported_company_count: 0 },
  { _delayMs: 1800, status: 'enriching',   screened_company_count: 91, qualified_company_count: 34, imported_contact_count: 0, imported_company_count: 0 },
  { _delayMs: 1600, status: 'importing',   screened_company_count: 91, qualified_company_count: 34, imported_contact_count: 8, imported_company_count: 8,  skipped_duplicate_count: 3 },
  { _delayMs: 1400, status: 'importing',   screened_company_count: 91, qualified_company_count: 34, imported_contact_count: 17, imported_company_count: 17, skipped_duplicate_count: 7 },
  { _delayMs: 1200, status: 'importing',   screened_company_count: 91, qualified_company_count: 34, imported_contact_count: 25, imported_company_count: 25, skipped_duplicate_count: 9 },
  { _delayMs: 1000, status: 'complete',    screened_company_count: 91, qualified_company_count: 34, imported_contact_count: 25, imported_company_count: 25, skipped_duplicate_count: 9, completion_note: 'All matching companies imported — net-new only.' },
];

// Job templates cycled as the user adds demo jobs
const SIM_JOB_TEMPLATES: Array<{
  request_type: string;
  target_company_count: number | null;
  target_contact_count: number | null;
  company_name: string;
}> = [
  { request_type: 'expand_companies',       target_company_count: 25,   target_contact_count: null, company_name: 'Multi-Modality Biologics CDMO' },
  { request_type: 'contacts_at_company',    target_company_count: null, target_contact_count: 500,  company_name: 'Clinical-Stage Cell Therapy' },
  { request_type: 'expand_companies',       target_company_count: 300,  target_contact_count: null, company_name: 'Gene Therapy Contract Mfg' },
  { request_type: 'more_contacts_at_accounts', target_company_count: null, target_contact_count: 200, company_name: 'Genomics & Seq Platforms' },
];

function usePipelineSim(): { simJobs: AcquisitionJob[]; addSimJob: () => void; clearSim: () => void } {
  const [simJobs, setSimJobs] = useState<AcquisitionJob[]>([]);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  const counter = useRef(0);
  // Mutable ref so inner timeout closures always call the latest version
  const runJobRef = useRef<(id: string) => void>(() => { /* populated below */ });

  runJobRef.current = (id: string) => {
    const now = new Date().toISOString();
    setSimJobs((prev) =>
      prev.map((j) => (j.id === id ? { ...j, status: 'discovering', started_at: now } : j)),
    );

    let elapsed = 0;
    SIM_STEPS.forEach((step) => {
      elapsed += step._delayMs;
      const t = setTimeout(() => {
        const { _delayMs: _, ...patch } = step;
        setSimJobs((prev) =>
          prev.map((j) => {
            if (j.id !== id) return j;
            return { ...j, ...patch, completed_at: step.status === 'complete' ? new Date().toISOString() : j.completed_at };
          }),
        );
        if (step.status === 'complete') {
          // After a short pause, kick off the next queued job
          const promote = setTimeout(() => {
            setSimJobs((prev) => {
              const next = prev.find((j) => j.status === 'queued');
              if (next) runJobRef.current!(next.id);
              return prev;
            });
          }, 1500);
          timeouts.current.push(promote);
          // Completed jobs stay in the list — no auto-clear
        }
      }, elapsed);
      timeouts.current.push(t);
    });
  };

  const addSimJob = useCallback(() => {
    const idx = counter.current++;
    const id = `__sim__${idx}`;
    const now = new Date().toISOString();
    const template = SIM_JOB_TEMPLATES[idx % SIM_JOB_TEMPLATES.length];

    setSimJobs((prev) => {
      const hasActive = prev.some((j) => jobIsActive(j.status));
      const newJob: AcquisitionJob = {
        upload_batch_id: null,
        screened_company_count: 0,
        qualified_company_count: 0,
        imported_company_count: 0,
        imported_contact_count: 0,
        skipped_duplicate_count: 0,
        skipped_existing_count: 0,
        completion_note: null,
        coverage_after: null,
        error: null,
        completed_at: null,
        id,
        icp_id: `__sim_icp__${idx}`,
        requested_at: now,
        started_at: hasActive ? null : now,
        status: 'queued',
        ...template,
      };
      if (!hasActive) setTimeout(() => runJobRef.current!(id), 0);
      return [...prev, newJob];
    });
  }, []);

  const clearSim = useCallback(() => {
    timeouts.current.forEach(clearTimeout);
    timeouts.current = [];
    setSimJobs([]);
    counter.current = 0;
  }, []);

  useEffect(() => () => { timeouts.current.forEach(clearTimeout); }, []);

  return { simJobs, addSimJob, clearSim };
}

// ─── Animated counter ───────────────────────────────────────────────────────

function useCountUp(target: number): number {
  const [val, setVal] = useState(target);
  const valRef = useRef(target);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    const start = valRef.current;
    const t0 = performance.now();
    const dur = 650;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      const next = start + (target - start) * e;
      valRef.current = next;
      setVal(next);
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target]);
  return val;
}

function Counter({ value, className }: { value: number; className?: string }) {
  const v = useCountUp(value);
  return <span className={className}>{fmt(v)}</span>;
}

// ─── Funnel stage row ────────────────────────────────────────────────────────

type FunnelTone = 'screen' | 'match' | 'import';

function FunnelStage({
  icon: Icon,
  label,
  value,
  widthPct,
  tone,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  widthPct: number;
  tone: FunnelTone;
  sub?: string;
}) {
  const tones: Record<FunnelTone, string> = {
    screen: 'from-arcova-navy/15 to-arcova-navy/10',
    match: 'from-arcova-blue/30 to-arcova-blue/20',
    import: 'from-arcova-teal/85 to-arcova-mint/70',
  };
  const isImport = tone === 'import';
  return (
    <div className="relative">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-arcova-navy/60">
          <Icon className="h-3.5 w-3.5 text-arcova-navy/35" />
          {label}
        </span>
        <span className="flex items-baseline gap-1">
          <Counter
            value={value}
            className={cn('font-manrope text-[16px] font-bold tabular-nums', isImport ? 'text-arcova-teal' : 'text-arcova-navy')}
          />
          {sub && <span className="text-[10.5px] text-arcova-navy/35">{sub}</span>}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-arcova-navy/[0.06]">
        <div
          className={cn('h-full rounded-full bg-gradient-to-r transition-[width] duration-700 ease-out', tones[tone])}
          style={{ width: Math.max(4, widthPct) + '%' }}
        >
          {isImport && (
            <div className="h-full w-full animate-shimmer bg-[linear-gradient(110deg,transparent_30%,rgba(255,255,255,0.45)_50%,transparent_70%)] bg-[length:200%_100%]" />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Batched activity feed (summarized from real counts, never per-lead) ─────

function buildActivityLines(view: JobView, completionNote: string | null): string[] {
  const lines: string[] = [];
  if (view.imported > 0) lines.push(`+${fmt(view.imported)} ${view.unit} imported to your base`);
  if (view.matched > 0) lines.push(`Matched ${fmt(view.matched)} companies — strong ICP fit`);
  if (view.screened > 0) lines.push(`Screened ${fmt(view.screened)} companies so far`);
  if (view.skipped > 0) lines.push(`${fmt(view.skipped)} duplicates skipped — already in your base`);
  if (lines.length === 0 && completionNote) lines.push(completionNote);
  return lines.slice(0, 4);
}

function ActivityFeed({ lines }: { lines: string[] }) {
  return (
    <div className="mt-3 border-t border-arcova-navy/[0.08] pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-arcova-navy/40">
        <Activity className="h-3 w-3" /> Activity
      </p>
      <div className="flex flex-col gap-2">
        {lines.map((text, i) => (
          <div key={text} className="flex items-start gap-2.5">
            <span className="relative mt-1 flex h-1.5 w-1.5 shrink-0">
              {i === 0 && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-arcova-teal/70" />}
              <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', i === 0 ? 'bg-arcova-teal' : 'bg-arcova-navy/20')} />
            </span>
            <p className={cn('flex-1 text-[12px] leading-snug', i === 0 ? 'text-arcova-navy/75' : 'text-arcova-navy/45')}>
              {text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Active job — the star of the rail ───────────────────────────────────────

function ActiveJobCard({ job, view }: { job: AcquisitionJob; view: JobView }) {
  const base = Math.max(view.screened, view.matched, view.imported, 1);
  const lines = buildActivityLines(view, job.completion_note);

  return (
    <div className="rounded-2xl border border-arcova-teal/35 bg-white p-4 shadow-[0_18px_50px_-30px_rgba(0,164,180,0.45)] ring-1 ring-arcova-teal/10">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-manrope text-[14px] font-bold text-arcova-navy">
            {view.isCompanies ? (
              <Building2 className="h-4 w-4 shrink-0 text-arcova-teal" />
            ) : (
              <Users className="h-4 w-4 shrink-0 text-arcova-teal" />
            )}
            <span className="truncate">{view.title}</span>
          </p>
          {view.subtitle && <p className="mt-0.5 truncate text-[12px] text-arcova-navy/50">{view.subtitle}</p>}
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-arcova-teal/30 bg-arcova-teal/10 px-2.5 py-1 text-[10.5px] font-semibold text-arcova-teal">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-arcova-teal" />
          {formatStatusLabel(job.status)}
        </span>
      </div>

      {/* Overall progress */}
      <div className="mt-4 flex items-end justify-between">
        <div>
          <span className="font-manrope text-[34px] font-extrabold leading-none tabular-nums text-arcova-navy">
            {view.pct}
            <span className="text-[20px] text-arcova-navy/40">%</span>
          </span>
          <p className="mt-1 text-[12px] text-arcova-navy/50">
            <Counter value={view.imported} className="font-semibold tabular-nums text-arcova-navy/70" />
            {view.target > 0 ? ` of ${fmt(view.target)} ${view.unit}` : ` ${view.unit}`} imported
          </p>
        </div>
        {jobTimestamp(job) && (
          <div className="flex items-center gap-1.5 rounded-full bg-arcova-navy/[0.04] px-2.5 py-1 text-[11px] font-medium text-arcova-navy/55">
            <Clock3 className="h-3.5 w-3.5 text-arcova-navy/35" />
            {formatDate(jobTimestamp(job))}
          </div>
        )}
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-arcova-navy/[0.06]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-arcova-teal to-arcova-mint transition-[width] duration-700 ease-out"
          style={{ width: Math.max(2, view.pct) + '%' }}
        />
      </div>

      {/* Funnel — only the stages we actually have data for */}
      {(view.screened > 0 || view.matched > 0) && (
        <>
          <div className="mt-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-arcova-navy/40">
            <Filter className="h-3 w-3" /> Funnel
          </div>
          <div className="mt-2.5 flex flex-col gap-3">
            {view.screened > 0 && (
              <FunnelStage icon={Search} label="Screened" value={view.screened} widthPct={(view.screened / base) * 100} tone="screen" sub="companies" />
            )}
            {view.matched > 0 && (
              <FunnelStage icon={Target} label="Matched ICP" value={view.matched} widthPct={(view.matched / base) * 100} tone="match" sub="strong fit" />
            )}
            <FunnelStage icon={CheckCircle2} label="Imported" value={view.imported} widthPct={(view.imported / base) * 100} tone="import" sub={view.unit} />
          </div>
        </>
      )}

      {/* Net-new reassurance (the calm upsell) */}
      {view.skipped > 0 && (
        <div className="mt-3.5 flex items-center gap-2 rounded-xl bg-arcova-teal/[0.05] px-3 py-2">
          <ShieldCheck className="h-4 w-4 shrink-0 text-arcova-teal" />
          <p className="text-[11.5px] leading-snug text-arcova-navy/60">
            <Counter value={view.skipped} className="font-semibold tabular-nums text-arcova-navy/80" /> duplicates skipped — net-new only, never billed twice.
          </p>
        </div>
      )}

      {lines.length > 0 && <ActivityFeed lines={lines} />}
    </div>
  );
}

// ─── Queued / completed / failed rows ────────────────────────────────────────

function QueuedRow({ job, view, index }: { job: AcquisitionJob; view: JobView; index: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-arcova-navy/10 bg-white/60 px-3.5 py-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-arcova-navy/[0.06] text-[11px] font-bold tabular-nums text-arcova-navy/50">
        {index}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-arcova-navy">
          {view.isCompanies ? (
            <Building2 className="h-3.5 w-3.5 shrink-0 text-arcova-navy/35" />
          ) : (
            <Users className="h-3.5 w-3.5 shrink-0 text-arcova-navy/35" />
          )}
          <span className="truncate">{view.title}</span>
        </p>
        {view.subtitle && <p className="truncate text-[11.5px] text-arcova-navy/45">{view.subtitle}</p>}
      </div>
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200/70">
        <Clock3 className="h-3 w-3" /> Queued
      </span>
    </div>
  );
}

function CompletedRow({ job, view }: { job: AcquisitionJob; view: JobView }) {
  const stats = [
    view.imported > 0 ? { label: 'imported', value: view.imported } : null,
    view.matched > 0 ? { label: 'matched', value: view.matched } : null,
    view.skipped > 0 ? { label: 'dupes skipped', value: view.skipped } : null,
  ].filter((s): s is { label: string; value: number } => s != null);

  return (
    <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/40 px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-arcova-navy">
            {view.isCompanies ? (
              <Building2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            ) : (
              <Users className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            )}
            <span className="truncate">{view.title}</span>
          </p>
          {view.subtitle && <p className="mt-0.5 truncate text-[11.5px] text-arcova-navy/50">{view.subtitle}</p>}
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
          <CheckCircle2 className="h-3 w-3" /> Done
        </span>
      </div>
      {stats.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {stats.map((s) => (
            <span key={s.label} className="text-[11px] text-arcova-navy/50">
              <span className="font-semibold tabular-nums text-arcova-navy/75">{fmt(s.value)}</span> {s.label}
            </span>
          ))}
        </div>
      )}
      {job.coverage_after && (
        <p className="mt-2 text-[11px] leading-snug text-arcova-navy/55">
          ICP coverage now:{' '}
          <span className="font-semibold tabular-nums text-arcova-navy/75">
            {fmt(job.coverage_after.company_count)}
          </span>{' '}
          companies ·{' '}
          <span className="font-semibold tabular-nums text-arcova-navy/75">
            {fmt(job.coverage_after.contact_count)}
          </span>{' '}
          contacts
        </p>
      )}
      {job.completion_note && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-arcova-navy/55">
          <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600/70" />
          {job.completion_note}
        </p>
      )}
      {view.resultsHref && (
        <Link
          href={view.resultsHref}
          className="mt-2.5 inline-flex items-center gap-1 rounded-lg bg-arcova-teal px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-arcova-teal/90"
        >
          {view.isCompanies ? 'View accounts' : 'View contacts'}
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

function FailedRow({ job, view }: { job: AcquisitionJob; view: JobView }) {
  const message = userFacingJobError(job);
  return (
    <div className="rounded-xl border border-red-200/70 bg-red-50/40 px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 truncate text-[13px] font-semibold text-arcova-navy">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
          <span className="truncate">{view.title}</span>
        </p>
        <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
          {formatStatusLabel(job.status)}
        </span>
      </div>
      {message && <p className="mt-2 text-[11px] leading-snug text-red-700/90">{message}</p>}
    </div>
  );
}

function SectionHead({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="flex items-center gap-2 px-0.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-arcova-navy/40">{children}</p>
      {count != null && (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-arcova-navy/[0.07] px-1 text-[10px] font-bold tabular-nums text-arcova-navy/50">
          {count}
        </span>
      )}
      <span className="h-px flex-1 bg-arcova-navy/[0.08]" />
    </div>
  );
}

// ─── Pipeline rail ───────────────────────────────────────────────────────────

function PipelineRail({
  jobs,
  icpFor,
  onRefresh,
  onSimulate,
  onClearSim,
}: {
  jobs: AcquisitionJob[];
  icpFor: (job: AcquisitionJob) => string | null;
  onRefresh: () => void;
  onSimulate: () => void;
  onClearSim: () => void;
}) {
  const active = jobs.filter((j) => jobIsActive(j.status));
  const queued = jobs.filter((j) => j.status === 'queued');
  const completed = jobs.filter((j) => jobIsDone(j.status));
  const failed = jobs.filter((j) => jobFailed(j.status));
  const empty = jobs.length === 0;

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-white/85 bg-white/55 shadow-[0_24px_60px_-32px_rgba(13,53,71,0.18),0_2px_6px_-2px_rgba(13,53,71,0.06)] backdrop-blur-[28px] backdrop-saturate-150">
      <div className="flex items-center justify-between gap-2 border-b border-arcova-navy/[0.08] px-4 py-3.5">
        <div>
          <p className="flex items-center gap-1.5 font-manrope text-[14px] font-bold text-arcova-navy">
            <Layers className="h-4 w-4 text-arcova-teal" /> Sourcing pipeline
          </p>
          <p className="mt-0.5 text-[11px] text-arcova-navy/45">Screened, enriched, then routed to your base.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onSimulate}
            className="flex items-center gap-1 rounded-full border border-arcova-navy/[0.12] px-2.5 py-1 text-[10.5px] font-medium text-arcova-navy/40 transition hover:border-arcova-teal/40 hover:text-arcova-teal"
            title="Add a demo sourcing job"
          >
            <Activity className="h-3 w-3" />
            + Demo job
          </button>
          <button
            type="button"
            onClick={onRefresh}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-arcova-navy/[0.12] text-arcova-navy/35 transition hover:border-arcova-navy/25 hover:text-arcova-navy/55"
            aria-label="Refresh jobs"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-arcova-navy/15 text-arcova-navy/20">
              <Filter className="h-6 w-6" />
            </div>
            <p className="max-w-[15rem] text-[12.5px] leading-relaxed text-arcova-navy/45">
              No active jobs. Ask Arcova to source companies or contacts and watch them flow through here.
            </p>
            <button
              type="button"
              onClick={onSimulate}
              className="mt-1 flex items-center gap-1.5 rounded-full border border-arcova-teal/40 bg-arcova-teal/8 px-3.5 py-1.5 text-[11.5px] font-semibold text-arcova-teal transition hover:bg-arcova-teal/15"
            >
              <Activity className="h-3.5 w-3.5" />
              + Add demo job
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {active.length > 0 && (
              <div className="flex flex-col gap-2.5">
                <SectionHead count={active.length > 1 ? active.length : undefined}>In progress</SectionHead>
                {active.map((job) => (
                  <ActiveJobCard key={job.id} job={job} view={deriveJobView(job, icpFor(job))} />
                ))}
              </div>
            )}
            {queued.length > 0 && (
              <div className="flex flex-col gap-2.5">
                <SectionHead count={queued.length}>Up next</SectionHead>
                <p className="-mt-1 px-0.5 text-[11px] text-arcova-navy/40">Starts automatically when the current job finishes.</p>
                <div className="flex flex-col gap-2">
                  {queued.map((job, i) => (
                    <QueuedRow key={job.id} job={job} view={deriveJobView(job, icpFor(job))} index={i + 1} />
                  ))}
                </div>
              </div>
            )}
            {completed.length > 0 && (
              <div className="flex flex-col gap-2.5">
                <SectionHead count={completed.length}>Completed</SectionHead>
                <div className="flex flex-col gap-2">
                  {completed.map((job) => (
                    <CompletedRow key={job.id} job={job} view={deriveJobView(job, icpFor(job))} />
                  ))}
                </div>
              </div>
            )}
            {failed.length > 0 && (
              <div className="flex flex-col gap-2.5">
                <SectionHead count={failed.length}>Couldn&apos;t complete</SectionHead>
                <div className="flex flex-col gap-2">
                  {failed.map((job) => (
                    <FailedRow key={job.id} job={job} view={deriveJobView(job, icpFor(job))} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function DataPageContent() {
  const { user, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();

  const [icps, setIcps] = useState<IcpCard[]>([]);
  const [jobs, setJobs] = useState<AcquisitionJob[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const { simJobs, addSimJob, clearSim } = usePipelineSim();

  // Batch companies from sessionStorage (set by agent navigation)
  const [batchCompanies, setBatchCompanies] = useState<BatchCompany[]>([]);

  // Auto-open trigger for the agent
  const [agentOpener, setAgentOpener] = useState<{ text: string; nonce: number; threadPreview: string } | null>(null);
  const openerFired = useRef(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [pendingPurchase, setPendingPurchase] = useState<PendingPurchase | null>(null);
  const [purchaseSubmitting, setPurchaseSubmitting] = useState(false);
  const [billingSubmitting, setBillingSubmitting] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

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
    if (authLoading) return;
    if (!user) {
      setLoadingData(false);
      return;
    }
    void loadData();
  }, [authLoading, user, loadData]);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const anyJobActive = jobs.some((j) => jobIsActive(j.status) || j.status === 'queued');

  useEffect(() => {
    if (!user || !anyJobActive) return;
    const interval = setInterval(() => void loadData(), 2000);
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
    // Coverage "Fix blind spots" batch: a fully-formed prompt staged in
    // sessionStorage that asks the agent to source across every gap ICP.
    if (searchParams.get('mode') === 'stage_gaps') {
      try {
        const raw = sessionStorage.getItem(COVERAGE_STAGE_GAPS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { text: string; threadPreview: string };
          sessionStorage.removeItem(COVERAGE_STAGE_GAPS_KEY);
          opener = parsed.text;
          threadPreview = parsed.threadPreview;
        } else {
          opener = '__OPEN__';
          threadPreview = 'Help me fill my coverage blind spots';
        }
      } catch {
        opener = '__OPEN__';
        threadPreview = 'Help me fill my coverage blind spots';
      }
    } else if (rawMode === 'contacts_at_companies') {
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

  const submitAcquisitionJob = useCallback(async (
    job: AcquisitionRequest,
    operationId: string,
  ) => {
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
              operationId: `${operationId}:${company.id}`,
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
          ? { companyId: job.companyId, icpId: job.icpId, requestType: 'contacts_at_company', targetContactCount: job.quantity, operationId }
          : job.requestType === 'more_contacts_at_accounts'
            ? { icpId: job.icpId, requestType: 'more_contacts_at_accounts', targetContactCount: job.quantity, operationId }
            : { icpId: job.icpId, requestType: 'expand_companies', targetCompanyCount: job.quantity, operationId };

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
        } else {
          const payload = await res.json().catch(() => ({}));
          toast.error(payload.message || payload.error || 'Failed to start job.');
        }
      } catch { toast.error('Failed to start job.'); }
    }

    void loadData();
  }, [batchCompanies, loadData]);

  const handleJobStarted = useCallback(async (job: AcquisitionRequest) => {
    const companies = job.batchCompanies ?? (batchCompanies.length > 0 ? batchCompanies : []);
    if (job.requestType === 'contacts_at_companies' && companies.length === 0) {
      toast.error('Select at least one account before sourcing contacts.');
      return;
    }
    const leadCount =
      job.requestType === 'contacts_at_companies'
        ? job.quantity * companies.length
        : job.requestType === 'expand_companies'
          ? job.quantity * 2
          : job.quantity;

    try {
      const response = await fetch('/api/billing/summary');
      const summary = (await response.json().catch(() => ({}))) as BillingSummarySnapshot & { error?: string };
      if (!response.ok) throw new Error(summary.error || 'Could not load your credit balance.');
      const planKey = summary.plan?.key ?? 'free';
      const canManageBilling = summary.role === 'owner' || summary.role === 'admin';
      const creditPack = summary.catalog?.pack ?? null;

      setBillingError(null);
      setPendingPurchase({
        job,
        operationId: crypto.randomUUID(),
        leadCount,
        requiredCredits: leadCount * 4,
        availableCredits: Number(summary.credits?.available ?? 0),
        planKey,
        canManageBilling,
        billingAvailable: Boolean(summary.available),
        creditPackAvailable: Boolean(creditPack?.available),
        starterPlanAvailable: Boolean(summary.catalog?.plans?.some((plan) => plan.key === 'starter' && plan.available)),
        creditPackCredits: typeof creditPack?.credits === 'number' ? creditPack.credits : null,
        creditPackUsd: typeof creditPack?.usd === 'number' ? creditPack.usd : null,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load your credit balance.');
    }
  }, [batchCompanies]);

  const confirmPurchase = useCallback(async () => {
    if (!pendingPurchase || purchaseSubmitting) return;
    setPurchaseSubmitting(true);
    try {
      await submitAcquisitionJob(pendingPurchase.job, pendingPurchase.operationId);
      setPendingPurchase(null);
    } finally {
      setPurchaseSubmitting(false);
    }
  }, [pendingPurchase, purchaseSubmitting, submitAcquisitionJob]);

  const openBillingSettings = useCallback(() => {
    window.location.href = '/settings?billing=credits';
  }, []);

  const startBillingCheckout = useCallback(async () => {
    if (!pendingPurchase || billingSubmitting) return;
    if (!pendingPurchase.canManageBilling || !pendingPurchase.billingAvailable) {
      openBillingSettings();
      return;
    }

    const checkoutBody =
      pendingPurchase.planKey === 'free'
        ? { kind: 'plan', planKey: 'starter', billing: 'monthly' }
        : { kind: 'pack' };

    if (pendingPurchase.planKey === 'free' && !pendingPurchase.starterPlanAvailable) {
      openBillingSettings();
      return;
    }
    if (pendingPurchase.planKey !== 'free' && !pendingPurchase.creditPackAvailable) {
      openBillingSettings();
      return;
    }

    setBillingSubmitting(true);
    setBillingError(null);
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkoutBody),
      });
      const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (response.ok && payload.url) {
        window.location.href = payload.url;
        return;
      }
      setBillingError(payload.error || 'Could not open billing checkout. Please try from Settings.');
    } catch {
      setBillingError('Could not open billing checkout. Please try from Settings.');
    } finally {
      setBillingSubmitting(false);
    }
  }, [billingSubmitting, openBillingSettings, pendingPurchase]);

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
  const pipelineJobs = jobs.filter((job) => jobBelongsInLivePipeline(job));
  const icpFor = useCallback(
    (job: AcquisitionJob) => icps.find((icp) => icp.icp_id === job.icp_id)?.label ?? null,
    [icps],
  );

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
      pipelineJobs.length > 0
        ? pipelineJobs.slice(0, 5).map((job) => ({
            request_type: job.request_type,
            status: job.status,
            target: job.company_name || icpFor(job),
            imported_contact_count: job.imported_contact_count,
            qualified_company_count: job.qualified_company_count,
            duplicates_skipped: (job.skipped_duplicate_count ?? 0) + (job.skipped_existing_count ?? 0),
            icp_coverage_after: job.coverage_after,
            completion_note: job.completion_note,
            error: userFacingJobError(job),
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

  const visibleJobs = [
    ...simJobs,
    ...pipelineJobs.filter((j) => !j.id.startsWith('__sim__')).slice(0, 12),
  ];

  // Today-briefing-style idle greeting for the sourcing agent.
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const agentWelcome = {
    greeting: `${timeGreeting}, ${getDisplayName(user)}.`,
    body: 'What should we source today? Name an ICP to grow or accounts to expand — I’ll bring back only net-new companies and contacts, never duplicates you already have.',
  };

  const agentIdleChips = [
    {
      label: '+ Source 1,000 contacts for ICP 2',
      threadPreview: 'Source 1,000 contacts for ICP 2',
      prompt: 'Source 1,000 contacts for ICP 2',
    },
    {
      label: '+ Find new companies for ICP 4',
      threadPreview: 'Find new companies for ICP 4',
      prompt: 'Find new companies for ICP 4',
    },
    {
      label: '+ More contacts at my top accounts',
      threadPreview: 'More contacts at my top accounts',
      prompt: 'More contacts at my top accounts',
    },
  ];

  const BT_ACCENT = '#00a4b4';
  const purchaseWithinCredits = pendingPurchase
    ? pendingPurchase.availableCredits >= pendingPurchase.requiredCredits
    : false;
  const purchaseAllowed = purchaseWithinCredits;
  const blockedPurchaseCtaLabel = !pendingPurchase
    ? 'Open billing settings'
    : !purchaseWithinCredits
      ? pendingPurchase.canManageBilling && pendingPurchase.billingAvailable
        ? pendingPurchase.planKey === 'free'
          ? 'Upgrade to Starter'
          : pendingPurchase.creditPackCredits && pendingPurchase.creditPackUsd
            ? `Buy ${fmt(pendingPurchase.creditPackCredits)} credits · $${fmt(pendingPurchase.creditPackUsd)}`
            : 'Buy credits'
        : 'Open billing settings'
      : 'Review plan options';

  return (
    <>
      <div className="flex h-screen bg-transparent">
        <AppSidebar />

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10">
          <div className="mx-auto w-full max-w-[1320px]">
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

            <div className="grid grid-cols-1 items-stretch gap-6 xl:grid-cols-[minmax(0,1fr)_388px]">
              {/* Agent tile — same briefing bento embed as /today (orb top, welcome bottom). */}
              <div
                className="briefing-today flex h-[min(72vh,760px)] min-h-[540px] flex-col [--bt-agent-tile-h:100%]"
              >
                <section className="bt-bento bt-agent-tile min-h-0 flex-1">
                  <div className="bt-agent-meta">
                    <span className="bt-agent-status">
                      <span className="bt-agent-status-dot" style={{ background: BT_ACCENT }} />
                      <span>Agent · {agentBusy ? 'thinking' : 'ready'}</span>
                    </span>
                    <span className="bt-agent-time">
                      {clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} local
                    </span>
                  </div>
                  <div className="bt-agent-panel-host bt-agent-panel-host--fill">
                    <AgentPanel
                      page="data"
                      pageContext={pageContext}
                      variant="central"
                      wide
                      hideHeader
                      suppressPrompts
                      embedInBriefingBento
                      briefingWelcome={agentWelcome}
                      briefingIdleChips={agentIdleChips}
                      onBusyChange={setAgentBusy}
                      className="min-h-0 flex-1 overflow-hidden"
                      pendingMessage={
                        agentOpener
                          ? { text: agentOpener.text, nonce: agentOpener.nonce, threadPreview: agentOpener.threadPreview }
                          : undefined
                      }
                      onJobStarted={handleJobStarted}
                    />
                  </div>
                </section>
              </div>

              {/* Side column: live pipeline */}
              <div className="hidden h-[min(72vh,760px)] min-h-[540px] xl:block">
                <PipelineRail jobs={visibleJobs} icpFor={icpFor} onRefresh={() => void loadData()} onSimulate={addSimJob} onClearSim={clearSim} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <AlertDialog
        open={Boolean(pendingPurchase)}
        onOpenChange={(open) => {
          if (!open && !purchaseSubmitting && !billingSubmitting) {
            setPendingPurchase(null);
            setBillingError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm data purchase</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Arcova will source up to {fmt(pendingPurchase?.leadCount ?? 0)} net-new enriched
                  lead{pendingPurchase?.leadCount === 1 ? '' : 's'}.
                </p>
                <div className="rounded-lg border border-arcova-navy/10 bg-arcova-sage/35 p-3 text-arcova-navy">
                  <div className="flex items-center justify-between">
                    <span>Maximum charge</span>
                    <strong>{fmt(pendingPurchase?.requiredCredits ?? 0)} credits</strong>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-arcova-navy/60">
                    <span>Your current balance</span>
                    <span>{fmt(pendingPurchase?.availableCredits ?? 0)} credits</span>
                  </div>
                </div>
                {!purchaseWithinCredits && (
                  <p className="text-red-600">
                    You need more credits before starting this purchase. Add credits or upgrade, then come back to start the run.
                  </p>
                )}
                {billingError && <p className="text-red-600">{billingError}</p>}
                <p className="text-xs">
                  You are charged only for genuinely new enriched leads delivered. Duplicates,
                  cache hits, and undelivered records are refunded automatically.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purchaseSubmitting || billingSubmitting}>Cancel</AlertDialogCancel>
            {!purchaseAllowed && (
              <button
                type="button"
                disabled={billingSubmitting}
                onClick={() => {
                  if (!purchaseWithinCredits) {
                    void startBillingCheckout();
                  } else {
                    openBillingSettings();
                  }
                }}
                className="inline-flex h-10 items-center justify-center rounded-md bg-arcova-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-arcova-navy/90 disabled:pointer-events-none disabled:opacity-50"
              >
                {billingSubmitting ? 'Opening…' : blockedPurchaseCtaLabel}
              </button>
            )}
            {purchaseAllowed && (
              <AlertDialogAction
                disabled={purchaseSubmitting}
                onClick={(event) => {
                  event.preventDefault();
                  void confirmPurchase();
                }}
              >
                {purchaseSubmitting
                  ? 'Starting…'
                  : `Use up to ${fmt(pendingPurchase?.requiredCredits ?? 0)} credits`}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
