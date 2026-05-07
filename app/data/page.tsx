'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock3,
  Database,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PipelineDataRequestType } from '@/lib/pipeline-icp-health';

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
  request_type: PipelineDataRequestType | string;
  source_strategy: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | string;
  target_company_count: number | null;
  target_contact_count: number | null;
  max_credit_units: number | null;
  estimated_min_credit_units: number | null;
  estimated_max_credit_units: number | null;
  actual_credit_units: number | null;
  screened_company_count: number | null;
  qualified_company_count: number | null;
  imported_company_count: number | null;
  discovered_contact_count: number | null;
  imported_contact_count: number | null;
  skipped_duplicate_count: number | null;
  rejected_low_fit_count: number | null;
  error: string | null;
  requested_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

type AcquisitionMode = 'companies' | 'contacts_at_company' | 'contacts_for_icp';

const MIN_QUANTITY = 1;
const MAX_QUANTITY = 1000;
const DEFAULT_QUANTITY = 50;
const SCREENING_MULTIPLIER_MIN = 3;
const SCREENING_MULTIPLIER_MAX = 6;

const MODES: Array<{
  id: AcquisitionMode;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}> = [
  {
    id: 'companies',
    label: 'Companies for ICP',
    icon: Building2,
    description: 'Find ICP-fit companies, enrich them, then import matching contacts.',
  },
  {
    id: 'contacts_at_company',
    label: 'Contacts at company',
    icon: Users,
    description: 'Find the right buyer personas at a specific account.',
  },
  {
    id: 'contacts_for_icp',
    label: 'Contacts for ICP',
    icon: Search,
    description: 'Improve persona coverage across a set of ICP-matched accounts.',
  },
];

function clampQuantity(value: number): number {
  const next = Number.isFinite(value) ? Math.round(value) : DEFAULT_QUANTITY;
  return Math.min(MAX_QUANTITY, Math.max(MIN_QUANTITY, next));
}

function statusClass(status: string): string {
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'failed') return 'border-red-200 bg-red-50 text-red-700';
  if (status === 'running') return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-amber-200 bg-amber-50 text-amber-700';
}

function statusIcon(status: string) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === 'failed') return <AlertCircle className="h-3.5 w-3.5" />;
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  return <Clock3 className="h-3.5 w-3.5" />;
}

function formatDate(value: string | null): string {
  if (!value) return 'Not started';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatRequestType(type: string): string {
  if (type === 'expand_companies') return 'Companies for ICP';
  if (type === 'better_contacts') return 'Better contacts';
  if (type === 'more_contacts_at_accounts') return 'More contacts at accounts';
  return type.replace(/_/g, ' ');
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold tabular-nums text-gray-900">{value}</p>
    </div>
  );
}

function DataPageContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [icps, setIcps] = useState<IcpCard[]>([]);
  const [jobs, setJobs] = useState<AcquisitionJob[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<AcquisitionMode>('companies');
  const [selectedIcpId, setSelectedIcpId] = useState<string>('');
  const [quantity, setQuantity] = useState(DEFAULT_QUANTITY);

  const companyId = searchParams.get('companyId') ?? '';
  const companyName = searchParams.get('companyName') ?? '';

  useEffect(() => {
    const rawMode = searchParams.get('mode') as AcquisitionMode | null;
    if (rawMode && MODES.some((item) => item.id === rawMode)) setMode(rawMode);
    const rawIcpId = searchParams.get('icpId');
    if (rawIcpId) setSelectedIcpId(rawIcpId);
    const rawQuantity = searchParams.get('quantity');
    if (rawQuantity) setQuantity(clampQuantity(Number(rawQuantity)));
  }, [searchParams]);

  const loadData = useCallback(async () => {
    setLoadError(null);
    try {
      const [icpRes, jobsRes] = await Promise.all([
        fetch('/api/pipeline/icp-cards'),
        fetch('/api/data-acquisition/jobs'),
      ]);
      const [icpPayload, jobsPayload] = await Promise.all([
        icpRes.json().catch(() => ({})),
        jobsRes.json().catch(() => ({})),
      ]);
      if (!icpRes.ok) {
        throw new Error(typeof icpPayload.error === 'string' ? icpPayload.error : 'Failed to load ICPs');
      }
      if (!jobsRes.ok) {
        throw new Error(typeof jobsPayload.error === 'string' ? jobsPayload.error : 'Failed to load jobs');
      }
      const nextIcps = (icpPayload.cards ?? []) as IcpCard[];
      setIcps(nextIcps);
      setJobs((jobsPayload.jobs ?? []) as AcquisitionJob[]);
      setSelectedIcpId((current) => current || nextIcps[0]?.icp_id || '');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load data workspace');
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (user) void loadData();
  }, [user, loadData]);

  const selectedIcp = useMemo(
    () => icps.find((icp) => icp.icp_id === selectedIcpId) ?? null,
    [icps, selectedIcpId],
  );

  const estimate = useMemo(() => {
    const screenedMin = quantity * SCREENING_MULTIPLIER_MIN;
    const screenedMax = quantity * SCREENING_MULTIPLIER_MAX;
    const contacts = quantity * 2;
    const creditsMin = screenedMin + contacts;
    const creditsMax = screenedMax + contacts;
    return { screenedMin, screenedMax, contacts, creditsMin, creditsMax };
  }, [quantity]);

  const startAcquisition = async () => {
    if (mode !== 'companies') {
      toast.message('This acquisition mode is not wired to the Apollo runner yet.');
      return;
    }
    if (!selectedIcpId) {
      toast.error('Choose an ICP first.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/pipeline/data-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          icpId: selectedIcpId,
          requestType: 'expand_companies',
          targetCompanyCount: quantity,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Failed to start acquisition');
      }
      toast.success('Acquisition job started.');
      void loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to start acquisition');
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || loadingData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  const canStart = mode === 'companies' && Boolean(selectedIcpId) && !submitting;

  return (
    <div className="flex h-screen bg-gray-50">
      <AppSidebar />
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-arcova-teal/20 bg-white px-3 py-1 text-xs font-semibold text-arcova-teal">
                <Database className="h-3.5 w-3.5" />
                Data acquisition
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Data</h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">
                Start Apollo-first sourcing jobs, size the batch, and track what was screened, qualified, and imported.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadData()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>

          {loadError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {loadError}
            </div>
          )}

          <section className="grid gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-5 py-4">
                <h2 className="text-sm font-semibold text-gray-900">New acquisition</h2>
                <p className="mt-1 text-xs leading-5 text-gray-500">
                  Choose what gap you want Arcova to fill. Context from Accounts or Pipeline lands here.
                </p>
              </div>

              <div className="space-y-5 p-5">
                <div className="grid gap-2">
                  {MODES.map((item) => {
                    const Icon = item.icon;
                    const active = mode === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setMode(item.id)}
                        className={cn(
                          'flex items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors',
                          active
                            ? 'border-arcova-teal bg-arcova-teal/5'
                            : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50',
                        )}
                      >
                        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-arcova-teal' : 'text-gray-400')} />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-gray-900">{item.label}</span>
                          <span className="mt-0.5 block text-xs leading-5 text-gray-500">{item.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                {mode === 'companies' ? (
                  <div className="space-y-4">
                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">ICP</span>
                      <select
                        value={selectedIcpId}
                        onChange={(event) => setSelectedIcpId(event.target.value)}
                        className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-900 outline-none focus:border-arcova-teal focus:ring-2 focus:ring-arcova-teal/20"
                      >
                        {icps.length === 0 ? (
                          <option value="">No ICPs found</option>
                        ) : (
                          icps.map((icp) => (
                            <option key={icp.icp_id} value={icp.icp_id}>
                              {icp.label}
                            </option>
                          ))
                        )}
                      </select>
                    </label>

                    <div className="rounded-lg border border-gray-100 bg-gray-50/70 px-4 py-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-gray-700">Companies to add</p>
                          <p className="mt-1 text-xs text-gray-500">Any number from 1 to 1,000.</p>
                        </div>
                        <input
                          type="number"
                          min={MIN_QUANTITY}
                          max={MAX_QUANTITY}
                          value={quantity}
                          onChange={(event) => setQuantity(clampQuantity(Number(event.target.value)))}
                          className="h-10 w-24 rounded-md border border-gray-200 bg-white px-2 text-right text-xl font-semibold tabular-nums text-gray-900 outline-none focus:border-arcova-teal focus:ring-2 focus:ring-arcova-teal/20"
                        />
                      </div>
                      <Slider
                        className="mt-4"
                        min={MIN_QUANTITY}
                        max={MAX_QUANTITY}
                        step={1}
                        value={[quantity]}
                        onValueChange={(value) => setQuantity(clampQuantity(value[0] ?? DEFAULT_QUANTITY))}
                      />
                      <div className="mt-3 flex justify-between text-[11px] tabular-nums text-gray-400">
                        <span>{MIN_QUANTITY}</span>
                        <span>{MAX_QUANTITY}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                    {mode === 'contacts_at_company' && companyId
                      ? `This will source buyer-persona contacts at ${companyName || 'the selected company'}. The UI is ready, and the Apollo runner for this mode is next.`
                      : 'This workflow is ready as a destination, and the Apollo runner for contact-only acquisition is next.'}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <Metric label="Screening estimate" value={`${estimate.screenedMin.toLocaleString()}-${estimate.screenedMax.toLocaleString()}`} />
                  <Metric label="Contact target" value={estimate.contacts.toLocaleString()} />
                  <Metric label="Credit estimate" value={`${estimate.creditsMin.toLocaleString()}-${estimate.creditsMax.toLocaleString()}`} />
                  <Metric label="Source" value="Apollo first" />
                </div>

                <button
                  type="button"
                  disabled={!canStart}
                  onClick={() => void startAcquisition()}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-arcova-teal px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-arcova-teal/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Start acquisition
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-5 py-4">
                <h2 className="text-sm font-semibold text-gray-900">Selected target</h2>
                <p className="mt-1 text-xs leading-5 text-gray-500">
                  The job uses this context to build Apollo searches and screen candidates.
                </p>
              </div>
              <div className="p-5">
                {mode === 'companies' ? (
                  selectedIcp ? (
                    <div className="space-y-4">
                      <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">ICP</p>
                        <p className="mt-1 text-base font-semibold text-gray-900">{selectedIcp.label}</p>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <Metric label="Current companies" value={selectedIcp.company_count} />
                        <Metric
                          label="Avg contact fit"
                          value={selectedIcp.avg_contact_fit == null ? '-' : `${Math.round(selectedIcp.avg_contact_fit * 100)}%`}
                        />
                        <Metric
                          label="Depth"
                          value={selectedIcp.avg_contacts_per_company == null ? '-' : selectedIcp.avg_contacts_per_company.toFixed(1)}
                        />
                      </div>
                      <p className="text-xs leading-5 text-gray-500">
                        New records go through the same enrichment and import processing, then appear in Accounts and Leads.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-8 text-center">
                      <p className="text-sm font-semibold text-gray-900">No ICP selected</p>
                      <p className="mt-1 text-xs text-gray-500">Create an ICP before starting acquisition.</p>
                      <button
                        type="button"
                        onClick={() => router.push('/company-criteria/new')}
                        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        Create ICP
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                ) : (
                  <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Account context</p>
                    <p className="mt-1 text-base font-semibold text-gray-900">{companyName || 'Company-specific contact search'}</p>
                    <p className="mt-2 text-xs leading-5 text-gray-500">
                      This is where account-level CTAs will land when the contact acquisition runner is enabled.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-4 border-b border-gray-100 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Recent jobs</h2>
                <p className="mt-1 text-xs leading-5 text-gray-500">Metering for screened, qualified, imported, and credit usage.</p>
              </div>
            </div>

            {jobs.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <Database className="mx-auto h-8 w-8 text-gray-300" />
                <p className="mt-3 text-sm font-semibold text-gray-900">No acquisition jobs yet</p>
                <p className="mt-1 text-xs text-gray-500">Start a job above and it will appear here.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {jobs.map((job) => {
                  const icpLabel = icps.find((icp) => icp.icp_id === job.icp_id)?.label ?? 'ICP';
                  const actualCredits = job.actual_credit_units ?? 0;
                  const estimatedCredits =
                    job.estimated_min_credit_units != null && job.estimated_max_credit_units != null
                      ? `${Math.round(job.estimated_min_credit_units)}-${Math.round(job.estimated_max_credit_units)}`
                      : '-';
                  return (
                    <article key={job.id} className="px-5 py-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize', statusClass(job.status))}>
                              {statusIcon(job.status)}
                              {job.status}
                            </span>
                            <span className="text-xs text-gray-400">{formatDate(job.requested_at)}</span>
                          </div>
                          <h3 className="mt-2 text-sm font-semibold text-gray-900">
                            {formatRequestType(job.request_type)} - {icpLabel}
                          </h3>
                          {job.error && <p className="mt-1 text-xs leading-5 text-red-600">{job.error}</p>}
                        </div>
                        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[34rem]">
                          <Metric label="Screened" value={(job.screened_company_count ?? 0).toLocaleString()} />
                          <Metric label="Qualified" value={(job.qualified_company_count ?? 0).toLocaleString()} />
                          <Metric label="Imported" value={(job.imported_company_count ?? 0).toLocaleString()} />
                          <Metric label="Credits" value={actualCredits > 0 ? actualCredits.toLocaleString() : estimatedCredits} />
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
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
