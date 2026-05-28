'use client';

import AppSidebar from '@/components/AppSidebar';
import { useAuth } from '@/context/AuthContext';
import { isAdminEmail } from '@/lib/admin-access';
import { READINESS_SIGNAL_CATALOG, READINESS_SIGNAL_CATALOG_BY_KEY } from '@/lib/signals/readiness-catalog';
import type { SignalCatalogEntry, SignalKey } from '@/lib/signals/readiness-types';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

type CompanyRow = {
  id: string;
  company_name: string | null;
  domain: string | null;
};

type ContactRow = {
  id: string;
  full_name: string | null;
  company_id: string | null;
  company_name: string | null;
  job_title: string | null;
};

type TargetsResponse = {
  companies: CompanyRow[];
  contacts: ContactRow[];
};

type ExecutionStatus = 'active' | 'partial' | 'not_executed';

type HiringCategoryMatch = {
  key: string;
  count: number;
  titles: string[];
  buyer_functions: string[];
};

type HiringCompanyDetail = {
  company_id: string;
  company_name: string;
  postings_scraped: number;
  postings_matched: number;
  categories: HiringCategoryMatch[];
  hiring_expansion: boolean;
  buyer_functions_activated: string[];
};

type SecBackfillJob = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'halted_rate_limit' | 'cancelled';
  start_date: string;
  end_date: string;
  next_date: string;
  last_processed_date: string | null;
  days_processed: number;
  days_skipped_no_data: number;
  filings_upserted: number;
  form_d_upserted: number;
  form_8k_upserted: number;
  form_424b_upserted: number;
  chunks_completed: number;
  requested_chunk_business_days: number;
  rate_limit_halted: boolean;
  last_error: string | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  worker_claimed_at: string | null;
};

type SecBackfillLog = {
  id: number;
  created_at: string;
  level: string;
  message: string;
};

const READINESS_DIMENSIONS = [
  'new_budget',
  'new_needs',
  'new_people',
  'new_strategy',
  'caution',
] as const;

const CLINICAL_SINGLE_SIGNAL_KEYS = new Set<SignalKey>([
  'clinical_trial_registered',
  'clinical_trial_recruiting',
  'clinical_trial_completed',
  'clinical_trial_sponsor_change',
  'phase_transition',
  'trial_site_expansion',
  'indication_expansion',
  'trial_failure_or_halt',
  'program_discontinuation',
  // PI signal is emitted as a side-effect of the Clinical Trials All run
  // (see emitPrincipalInvestigatorSignal in run-clinical-trials-monitor.ts).
  // Listed here so the standalone button is hidden + direct API hits 400.
  'principal_investigator_new_trial',
]);

const FDA_SINGLE_SIGNAL_KEYS = new Set<SignalKey>([
  'fda_approval',
  'breakthrough_designation',
  'fast_track_designation',
  'priority_review',
  'orphan_designation',
  'complete_response_letter',
  'indication_expansion',
]);

const PATENT_SINGLE_SIGNAL_KEYS = new Set<SignalKey>([
  'patent_filed_or_granted',
  'patent_application_published',
  'patent_granted',
  'new_therapeutic_area_patent',
  'assignee_portfolio_acceleration',
]);

const FUNDING_SINGLE_SIGNAL_KEYS = new Set<SignalKey>([
  'funding_round',
  'ipo_or_follow_on',
  // SEC-derived signals — emitted by the funding/SEC pipeline
  'restructuring',
  'leadership_churn',
  'acquisition_distraction',
  'terminated_deal',
]);

const HIRING_SINGLE_SIGNAL_KEYS = new Set<SignalKey>([
  'cmc_hiring',
  'clinical_ops_hiring',
  'regulatory_hiring',
  'research_hiring',
  'quality_hiring',
  'medical_hiring',
  'bd_hiring',
  'commercial_hiring',
  'data_informatics_hiring',
  'executive_hiring',
  'hiring_expansion',
]);

const GRANTS_SINGLE_SIGNAL_KEYS = new Set<SignalKey>([
  'grant_award',
]);

const JOB_CHANGE_SINGLE_SIGNAL_KEYS = new Set<SignalKey>([
  'recently_changed_company',
  'recently_promoted',
  'new_internal_role',
  'title_change',
  'new_to_role',
  // Also emitted by the job-change monitor
  'key_contact_departed',
  'prior_customer_relationship',
  'prior_active_deal_relationship',
  'prior_pipeline_relationship',
]);

// First-party / HubSpot signals — not runnable from this page; displayed on contact/company pages.
const FIRST_PARTY_SIGNAL_KEYS = new Set<SignalKey>([
  'demo_requested',
  'inbound_enquiry',
  'open_opportunity_in_crm',
  'new_contact_added_in_crm',
  'closed_lost_in_crm',
  'lapsed_customer',
  'visited_your_website',
  'attended_your_webinar_or_event',
  'downloaded_your_content',
  'responded_to_previous_outreach',
]);

// Signals emitted exclusively (or primarily) by the press-release pipeline.
// These don't have dedicated single-signal run paths — use Press Releases (All).
const PRESS_RELEASE_SINGLE_SIGNAL_KEYS = new Set<SignalKey>([
  'licensing_deal',
  'partnership_deal',
  'partnership_with_upfront_economics',
  'co_development_deal',
  'milestone_payment',
  'commercialization_move',
  'ma_event',
  'new_facility',
  'facility_expansion',
]);

function buttonClassForStatus(status: ExecutionStatus): string {
  if (status === 'active') {
    return 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100';
  }
  if (status === 'partial') {
    return 'border-amber-300 bg-amber-50 hover:bg-amber-100';
  }
  return 'border-slate-300 bg-slate-50 hover:bg-slate-100';
}

function statusLabel(status: ExecutionStatus): string {
  if (status === 'active') return 'Active';
  if (status === 'partial') return 'Partial';
  return 'Not executed';
}

export default function AdminSignalsTestPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [targets, setTargets] = useState<TargetsResponse>({ companies: [], contacts: [] });
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [selectedContactId, setSelectedContactId] = useState<string>('');
  const [batchCompanyMode, setBatchCompanyMode] = useState<boolean>(false);
  const [batchLimit, setBatchLimit] = useState<number>(100);
  const [busySignal, setBusySignal] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [lastResponse, setLastResponse] = useState<{
    signalKey: string;
    ok: boolean;
    httpStatus: number;
    payload: unknown;
    at: string;
  } | null>(null);
  const [history, setHistory] = useState<
    Array<{ signalKey: string; ok: boolean; httpStatus: number; at: string }>
  >([]);
  const [statusBySignal, setStatusBySignal] = useState<Partial<Record<SignalKey, ExecutionStatus>>>({});
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [secBackfillProgressLog, setSecBackfillProgressLog] = useState<string[]>([]);
  const [secBackfillJob, setSecBackfillJob] = useState<SecBackfillJob | null>(null);
  const [secBackfillBusy, setSecBackfillBusy] = useState<boolean>(false);
  const [hiringDetails, setHiringDetails] = useState<HiringCompanyDetail[]>([]);
  const activeRunAbortRef = useRef<AbortController | null>(null);
  const lastSecBackfillLogIdRef = useRef<number>(0);
  const lastSecBackfillHeartbeatAtRef = useRef<number>(0);
  // Prevents the poll loop from firing /process while a previous call is still
  // running. Local dev has no Vercel cron, so the UI is the only thing that
  // advances chunks — this ref is what makes the backfill keep flowing
  // without the user clicking anything.
  const secBackfillProcessInFlightRef = useRef<boolean>(false);

  const isAdminUser = isAdminEmail(user?.email);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, router, user]);

  useEffect(() => {
    if (!user || !isAdminUser) return;
    void (async () => {
      const [targetsRes, statusesRes] = await Promise.all([
        fetch('/api/admin/readiness/test-targets'),
        fetch('/api/admin/readiness/signal-statuses'),
      ]);

      const targetsJson = (await targetsRes.json()) as TargetsResponse & { error?: string };
      if (!targetsRes.ok) {
        setStatus(targetsJson.error || 'Failed to load targets');
        return;
      }

      setTargets({ companies: targetsJson.companies ?? [], contacts: targetsJson.contacts ?? [] });
      if (!selectedContactId && (targetsJson.contacts?.[0]?.id ?? '')) {
        setSelectedContactId(targetsJson.contacts[0].id);
      }

      const statusesJson = (await statusesRes.json()) as {
        error?: string;
        statusBySignal?: Record<string, ExecutionStatus>;
      };
      if (statusesRes.ok && statusesJson.statusBySignal) {
        setStatusBySignal(statusesJson.statusBySignal as Partial<Record<SignalKey, ExecutionStatus>>);
      }
    })();
  }, [user, isAdminUser, selectedCompanyId, selectedContactId]);

  useEffect(() => {
    if (!user || !isAdminUser) return;
    void refreshSecBackfillStatus();
    const timer = window.setInterval(() => {
      void refreshSecBackfillStatus();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [user, isAdminUser]);

  const signalsByDimension = useMemo(
    () =>
      Object.fromEntries(
        READINESS_DIMENSIONS.map((dimension) => [
          dimension,
          READINESS_SIGNAL_CATALOG.filter((entry) => entry.dimensions.includes(dimension)),
        ])
      ) as Record<(typeof READINESS_DIMENSIONS)[number], SignalCatalogEntry[]>,
    []
  );

  function signalStatus(signalKey: SignalKey): ExecutionStatus {
    return statusBySignal[signalKey] ?? 'not_executed';
  }

  function appendLog(line: string) {
    const ts = new Date().toLocaleTimeString();
    setProgressLog((prev) => [...prev, `[${ts}] ${line}`].slice(-200));
  }

  function resetProgressLog() {
    setProgressLog([]);
  }

  function resetSecBackfillProgressLog() {
    setSecBackfillProgressLog([]);
    lastSecBackfillLogIdRef.current = 0;
    lastSecBackfillHeartbeatAtRef.current = 0;
  }

  function appendSecBackfillProgressLine(line: string) {
    const ts = new Date().toLocaleTimeString();
    setSecBackfillProgressLog((prev) => [...prev, `[${ts}] ${line}`].slice(-400));
  }

  function appendSecBackfillLogs(logs: SecBackfillLog[]) {
    for (const log of logs) {
      if (log.id <= lastSecBackfillLogIdRef.current) continue;
      const prefix = log.level === 'error' ? '[SEC backfill error]' : log.level === 'warn' ? '[SEC backfill warn]' : '[SEC backfill]';
      appendSecBackfillProgressLine(`${prefix} ${log.message}`);
      lastSecBackfillLogIdRef.current = log.id;
    }
  }

  function appendOptionalRunDiagnostics(result: Record<string, unknown>) {
    if (typeof result.records_scanned === 'number') {
      appendLog(`Records scanned=${String(result.records_scanned)}`);
    }
    if (typeof result.candidate_events_matched_before_dedupe === 'number') {
      appendLog(`Candidate events (pre-dedupe)=${String(result.candidate_events_matched_before_dedupe)}`);
    }
    if (typeof result.events_skipped_as_duplicates === 'number') {
      appendLog(`Duplicates skipped=${String(result.events_skipped_as_duplicates)}`);
    }
  }

  async function refreshSignalStatuses() {
    const statusesRes = await fetch('/api/admin/readiness/signal-statuses');
    const statusesJson = (await statusesRes.json()) as {
      error?: string;
      statusBySignal?: Record<string, ExecutionStatus>;
    };
    if (statusesRes.ok && statusesJson.statusBySignal) {
      setStatusBySignal(statusesJson.statusBySignal as Partial<Record<SignalKey, ExecutionStatus>>);
    }
  }

  async function refreshSecBackfillStatus() {
    try {
      const afterId = lastSecBackfillLogIdRef.current;
      const res = await fetch(`/api/admin/readiness/sec-backfill?after_id=${afterId}`);
      const json = (await res.json()) as {
        error?: string;
        job?: SecBackfillJob | null;
        logs?: SecBackfillLog[];
      };
      if (!res.ok) return;
      setSecBackfillJob(json.job ?? null);
      appendSecBackfillLogs(Array.isArray(json.logs) ? json.logs : []);
      const job = json.job ?? null;
      const inFlight = secBackfillProcessInFlightRef.current;
      if (job?.status === 'queued' || job?.status === 'running') {
        const now = Date.now();
        // Suppress heartbeat while we have a /process call in flight — the
        // server-side logs from that call tell a clearer story than "still
        // running" spam.
        if (!inFlight && now - lastSecBackfillHeartbeatAtRef.current >= 10_000) {
          appendSecBackfillProgressLine(
            `[SEC backfill] still ${job.status} — chunks=${job.chunks_completed} filings=${job.filings_upserted} next=${job.next_date}`,
          );
          lastSecBackfillHeartbeatAtRef.current = now;
        }
        // Auto-advance the queue. The /api/cron/funding-backfill cron only
        // fires in deployed environments; locally and during testing we rely
        // on this poller to keep claiming the next chunk. The DB-level claim
        // in processSecBackfillJobChunk (worker_claimed_at IS NULL or stale
        // beyond 30 min) makes this safe to race with the cron in production.
        const claimedAt = job.worker_claimed_at ? Date.parse(job.worker_claimed_at) : 0;
        // Match the server-side staleness window (30 min). A shorter UI
        // threshold (we previously used 4 min) caused log spam: the UI would
        // fire /process every 5s while a long chunk was in flight; the server
        // refused each call because the claim was still fresh, but each
        // refusal cleared the in-flight ref, so the next poll re-fired.
        // Now the UI trusts the server's claim: if worker_claimed_at is fresh
        // within 30 min, leave it alone.
        const isClaimLive = claimedAt > 0 && Date.now() - claimedAt < 30 * 60 * 1000;
        if (!inFlight && !secBackfillBusy && !isClaimLive) {
          secBackfillProcessInFlightRef.current = true;
          appendSecBackfillProgressLine('[SEC backfill] Auto-kicking next chunk...');
          void (async () => {
            try {
              const processRes = await fetch('/api/admin/readiness/sec-backfill/process', {
                method: 'POST',
              });
              const processJson = (await processRes.json().catch(() => ({}))) as {
                error?: string;
                job?: SecBackfillJob | null;
                logs?: SecBackfillLog[];
              };
              if (!processRes.ok) {
                appendSecBackfillProgressLine(
                  `[SEC backfill error] Auto-chunk failed: ${processJson.error || `HTTP ${processRes.status}`}`,
                );
              } else {
                if (processJson.job) setSecBackfillJob(processJson.job);
                if (Array.isArray(processJson.logs)) appendSecBackfillLogs(processJson.logs);
              }
            } catch (autoError) {
              const message = autoError instanceof Error ? autoError.message : 'Unknown error';
              appendSecBackfillProgressLine(`[SEC backfill error] Auto-chunk errored: ${message}`);
            } finally {
              secBackfillProcessInFlightRef.current = false;
              lastSecBackfillHeartbeatAtRef.current = 0;
            }
          })();
        }
      } else if (job) {
        lastSecBackfillHeartbeatAtRef.current = 0;
      }
    } catch {
      // Silent in the polling loop — avoid spamming the progress log.
    }
  }

  async function startSecBackfill() {
    if (secBackfillBusy) return;
    setSecBackfillBusy(true);
    setStatus('Queueing SEC 90-day backfill...');
    appendSecBackfillProgressLine('Queueing SEC 90-day backfill job.');
    lastSecBackfillHeartbeatAtRef.current = 0;
    try {
      const createRes = await fetch('/api/admin/readiness/sec-backfill?action=start&chunk_business_days=5');
      const createJson = (await createRes.json()) as {
        error?: string;
        job?: SecBackfillJob | null;
        logs?: SecBackfillLog[];
      };
      if (!createRes.ok) {
        appendLog(`SEC backfill queue failed: ${createJson.error || 'Unknown error'}`);
        setStatus(`SEC backfill queue failed: ${createJson.error || 'Unknown error'}`);
        return;
      }

      setSecBackfillJob(createJson.job ?? null);
      appendSecBackfillLogs(Array.isArray(createJson.logs) ? createJson.logs : []);
      appendSecBackfillProgressLine('Kicking first SEC backfill chunk now.');

      const processRes = await fetch('/api/admin/readiness/sec-backfill/process');
      const processJson = (await processRes.json()) as {
        error?: string;
        job?: SecBackfillJob | null;
        logs?: SecBackfillLog[];
      };
      if (!processRes.ok) {
        appendLog(`SEC backfill first chunk failed to start: ${processJson.error || 'Unknown error'}`);
        setStatus(`SEC backfill queued, but first chunk failed: ${processJson.error || 'Unknown error'}`);
        return;
      }

      setSecBackfillJob(processJson.job ?? createJson.job ?? null);
      appendSecBackfillLogs(Array.isArray(processJson.logs) ? processJson.logs : []);
      setStatus('SEC backfill is running. The cron worker will keep processing even if this page closes.');
      await refreshSecBackfillStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      appendSecBackfillProgressLine(`SEC backfill errored: ${message}`);
      setStatus(`SEC backfill failed: ${message}`);
    } finally {
      setSecBackfillBusy(false);
    }
  }

  async function cancelSecBackfill() {
    if (!secBackfillJob || secBackfillBusy) return;
    setSecBackfillBusy(true);
    appendSecBackfillProgressLine('Cancelling SEC backfill job...');
    try {
      const res = await fetch(`/api/admin/readiness/sec-backfill?action=cancel&job_id=${encodeURIComponent(secBackfillJob.id)}`);
      const json = (await res.json()) as {
        error?: string;
        job?: SecBackfillJob | null;
        logs?: SecBackfillLog[];
      };
      if (!res.ok) {
        appendSecBackfillProgressLine(`SEC backfill cancel failed: ${json.error || 'Unknown error'}`);
        setStatus(`SEC backfill cancel failed: ${json.error || 'Unknown error'}`);
        return;
      }
      setSecBackfillJob(json.job ?? null);
      appendSecBackfillLogs(Array.isArray(json.logs) ? json.logs : []);
      setStatus('SEC backfill cancelled. No more chunks will be started.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      appendSecBackfillProgressLine(`SEC backfill cancel errored: ${message}`);
      setStatus(`SEC backfill cancel failed: ${message}`);
    } finally {
      setSecBackfillBusy(false);
    }
  }

  async function runRealSignal(signalKey: SignalKey) {
    if (busySignal) {
      appendLog(`Run skipped: ${busySignal} is already in progress.`);
      setStatus(`A run is already in progress: ${busySignal}`);
      return;
    }

    setBusySignal(signalKey);
    const abortController = new AbortController();
    activeRunAbortRef.current = abortController;
    setStatus(`Running real ingestion for ${signalKey}...`);
    appendLog(`Starting run for ${signalKey}`);
    try {
      if (CLINICAL_SINGLE_SIGNAL_KEYS.has(signalKey)) {
        appendLog(`Skipped: ${signalKey} now runs only via Clinical Trials (All).`);
        setStatus(`${signalKey} is now bundled under Clinical Trials (All).`);
        return;
      }
      if (FDA_SINGLE_SIGNAL_KEYS.has(signalKey)) {
        appendLog(`Skipped: ${signalKey} now runs only via FDA Regulatory (All).`);
        setStatus(`${signalKey} is now bundled under FDA Regulatory (All).`);
        return;
      }
      if (PATENT_SINGLE_SIGNAL_KEYS.has(signalKey)) {
        appendLog(`Skipped: ${signalKey} now runs only via Patents (All).`);
        setStatus(`${signalKey} is now bundled under Patents (All).`);
        return;
      }
      if (FUNDING_SINGLE_SIGNAL_KEYS.has(signalKey)) {
        appendLog(`Skipped: ${signalKey} now runs only via Funding (All).`);
        setStatus(`${signalKey} is now bundled under Funding (All).`);
        return;
      }
      if (HIRING_SINGLE_SIGNAL_KEYS.has(signalKey)) {
        appendLog(`Skipped: ${signalKey} now runs only via Hiring (All).`);
        setStatus(`${signalKey} is now bundled under Hiring (All).`);
        return;
      }
      if (GRANTS_SINGLE_SIGNAL_KEYS.has(signalKey)) {
        appendLog(`Skipped: ${signalKey} now runs only via Grants (All).`);
        setStatus(`${signalKey} is now bundled under Grants (All).`);
        return;
      }
      if (PRESS_RELEASE_SINGLE_SIGNAL_KEYS.has(signalKey)) {
        appendLog(`Skipped: ${signalKey} now runs only via Press Releases (All).`);
        setStatus(`${signalKey} is now bundled under Press Releases (All).`);
        return;
      }

      const catalogEntry = READINESS_SIGNAL_CATALOG_BY_KEY[signalKey];
      const body: Record<string, unknown> = {
        limit: catalogEntry?.scope === 'company' && batchCompanyMode ? batchLimit : 25,
        only_signal_key: signalKey,
      };
      if (catalogEntry?.scope === 'company' && batchCompanyMode) {
        appendLog(`Batch company mode enabled (limit=${batchLimit}).`);
      } else if (catalogEntry?.scope === 'company' && selectedCompanyId) {
        body.company_ids = [selectedCompanyId];
        appendLog(`Target company scope set: ${selectedCompanyId}`);
      } else if (catalogEntry?.scope === 'contact' && selectedContactId) {
        body.contact_ids = [selectedContactId];
        appendLog(`Target contact scope set: ${selectedContactId}`);
      } else {
        appendLog('No scoped target selected; using default backend scope.');
      }
      const encodedSignalKey = encodeURIComponent(signalKey);
      appendLog(`Calling /api/signals/run/signal/${encodedSignalKey}...`);
      const res = await fetch(`/api/signals/run/signal/${encodedSignalKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
      const json = await res.json();
      appendLog(`Run completed with HTTP ${res.status}`);
      setLastResponse({
        signalKey,
        ok: res.ok,
        httpStatus: res.status,
        payload: json,
        at: new Date().toISOString(),
      });
      setHistory((prev) => [
        {
          signalKey,
          ok: res.ok,
          httpStatus: res.status,
          at: new Date().toISOString(),
        },
        ...prev.slice(0, 11),
      ]);
      if (!res.ok) {
        appendLog(`Run failed: ${json?.error || 'Unknown error'}`);
        setStatus(`${signalKey} failed: ${json?.error || 'Unknown error'}`);
      } else {
        const result = (json as { result?: Record<string, unknown> })?.result;
        if (result) {
          appendLog(`Processed=${String(result.processed ?? 0)} failed=${String(result.failed ?? 0)}`);
          appendOptionalRunDiagnostics(result);
          const failures = Array.isArray(result.failures)
            ? (result.failures as Array<Record<string, unknown>>)
            : [];
          if (failures.length > 0) {
            appendLog(`Failure entries returned: ${failures.length}`);
            for (const failure of failures.slice(0, 8)) {
              const entityType = String(failure.entity_type ?? 'entity');
              const entityId = String(failure.entity_id ?? 'unknown');
              const error = String(failure.error ?? 'Unknown error');
              appendLog(`${entityType}:${entityId} -> ${error}`);
            }
            if (failures.length > 8) {
              appendLog(`...and ${failures.length - 8} more failures`);
            }
          } else {
            appendLog('No failure entries returned.');
          }
        }
        appendLog('Refreshing signal status colors...');
        setStatusBySignal((prev) => ({ ...prev, [signalKey]: 'active' }));
        setStatus(`${signalKey} ingestion complete. Signal statuses refreshed.`);
      }
      await refreshSignalStatuses();
      appendLog('Signal status refresh complete.');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        appendLog('Run cancelled by user.');
        setStatus(`${signalKey} cancelled.`);
        return;
      }
      appendLog(`Run errored: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setStatus(`${signalKey} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      activeRunAbortRef.current = null;
      appendLog(`Run finished for ${signalKey}`);
      setBusySignal(null);
    }
  }

  async function runClinicalTrialsBundle() {
    const runKey = 'clinical_trials_all';
    if (busySignal) {
      appendLog(`Run skipped: ${busySignal} is already in progress.`);
      setStatus(`A run is already in progress: ${busySignal}`);
      return;
    }

    setBusySignal(runKey);
    const abortController = new AbortController();
    activeRunAbortRef.current = abortController;
    setStatus('Running full clinical trials bundle...');
    appendLog('Starting run for clinical_trials_all');
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    try {
      const startedAt = Date.now();
      const body: Record<string, unknown> = {
        limit: batchCompanyMode ? batchLimit : 25,
        sync_first: true,
      };
      if (!batchCompanyMode && selectedCompanyId) {
        body.company_ids = [selectedCompanyId];
        appendLog(`Target company scope set: ${selectedCompanyId}`);
      } else {
        body.run_all = true;
        body.batch_size = Math.min(500, Math.max(1, batchCompanyMode ? batchLimit : 200));
        if (batchCompanyMode) {
          appendLog(`Batch company mode enabled (run_all=true, batch_size=${body.batch_size}, limit=${batchLimit}).`);
        } else {
          appendLog(`No company selected; running all companies (run_all=true, batch_size=${body.batch_size}).`);
        }
      }

      appendLog('Calling /api/signals/run/clinical-trials...');
      heartbeat = setInterval(() => {
        const elapsedSec = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
        appendLog(`Run in progress... ${elapsedSec}s elapsed`);
      }, 5000);
      const res = await fetch('/api/signals/run/clinical-trials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
      clearInterval(heartbeat);
      heartbeat = null;
      const json = await res.json();
      appendLog(`Run completed with HTTP ${res.status}`);

      setLastResponse({
        signalKey: runKey,
        ok: res.ok,
        httpStatus: res.status,
        payload: json,
        at: new Date().toISOString(),
      });
      setHistory((prev) => [
        {
          signalKey: runKey,
          ok: res.ok,
          httpStatus: res.status,
          at: new Date().toISOString(),
        },
        ...prev.slice(0, 11),
      ]);

      if (!res.ok) {
        appendLog(`Run failed: ${json?.error || 'Unknown error'}`);
        setStatus(`clinical_trials_all failed: ${json?.error || 'Unknown error'}`);
      } else {
        const result = (json as { result?: Record<string, unknown> })?.result;
        if (result) {
          appendLog(`Processed=${String(result.processed ?? 0)} failed=${String(result.failed ?? 0)}`);
          appendOptionalRunDiagnostics(result);
        }
        appendLog('Refreshing signal status colors...');
        setStatus('clinical_trials_all ingestion complete. Signal statuses refreshed.');
      }
      await refreshSignalStatuses();
      appendLog('Signal status refresh complete.');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        appendLog('Run cancelled by user.');
        setStatus('clinical_trials_all cancelled.');
        return;
      }
      appendLog(`Run errored: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setStatus(`clinical_trials_all failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      activeRunAbortRef.current = null;
      if (heartbeat) clearInterval(heartbeat);
      appendLog('Run finished for clinical_trials_all');
      setBusySignal(null);
    }
  }

  async function runFdaRegulatoryBundle() {
    const runKey = 'fda_regulatory_all';
    if (busySignal) {
      appendLog(`Run skipped: ${busySignal} is already in progress.`);
      setStatus(`A run is already in progress: ${busySignal}`);
      return;
    }

    setBusySignal(runKey);
    const abortController = new AbortController();
    activeRunAbortRef.current = abortController;
    setStatus('Running full FDA regulatory bundle...');
    appendLog('Starting run for fda_regulatory_all');
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    try {
      const startedAt = Date.now();
      const body: Record<string, unknown> = {
        limit: batchCompanyMode ? batchLimit : 25,
        sync_first: true,
      };
      if (!batchCompanyMode && selectedCompanyId) {
        body.company_ids = [selectedCompanyId];
        appendLog(`Target company scope set: ${selectedCompanyId}`);
      } else {
        body.run_all = true;
        body.batch_size = Math.min(500, Math.max(1, batchCompanyMode ? batchLimit : 200));
        if (batchCompanyMode) {
          appendLog(`Batch company mode enabled (run_all=true, batch_size=${body.batch_size}, limit=${batchLimit}).`);
        } else {
          appendLog(`No company selected; running all companies (run_all=true, batch_size=${body.batch_size}).`);
        }
      }

      appendLog('Calling /api/signals/run/fda-regulatory...');
      heartbeat = setInterval(() => {
        const elapsedSec = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
        appendLog(`Run in progress... ${elapsedSec}s elapsed`);
      }, 5000);
      const res = await fetch('/api/signals/run/fda-regulatory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
      clearInterval(heartbeat);
      heartbeat = null;
      const json = await res.json();
      appendLog(`Run completed with HTTP ${res.status}`);

      setLastResponse({
        signalKey: runKey,
        ok: res.ok,
        httpStatus: res.status,
        payload: json,
        at: new Date().toISOString(),
      });
      setHistory((prev) => [
        {
          signalKey: runKey,
          ok: res.ok,
          httpStatus: res.status,
          at: new Date().toISOString(),
        },
        ...prev.slice(0, 11),
      ]);

      if (!res.ok) {
        appendLog(`Run failed: ${json?.error || 'Unknown error'}`);
        setStatus(`fda_regulatory_all failed: ${json?.error || 'Unknown error'}`);
      } else {
        const result = (json as { result?: Record<string, unknown> })?.result;
        if (result) {
          appendLog(`Processed=${String(result.processed ?? 0)} failed=${String(result.failed ?? 0)}`);
          appendOptionalRunDiagnostics(result);
        }
        appendLog('Refreshing signal status colors...');
        setStatus('fda_regulatory_all ingestion complete. Signal statuses refreshed.');
      }
      await refreshSignalStatuses();
      appendLog('Signal status refresh complete.');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        appendLog('Run cancelled by user.');
        setStatus('fda_regulatory_all cancelled.');
        return;
      }
      appendLog(`Run errored: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setStatus(`fda_regulatory_all failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      activeRunAbortRef.current = null;
      if (heartbeat) clearInterval(heartbeat);
      appendLog('Run finished for fda_regulatory_all');
      setBusySignal(null);
    }
  }

  async function runPatentsBundle() {
    const runKey = 'patents_all';
    if (busySignal) {
      appendLog(`Run skipped: ${busySignal} is already in progress.`);
      setStatus(`A run is already in progress: ${busySignal}`);
      return;
    }

    setBusySignal(runKey);
    const abortController = new AbortController();
    activeRunAbortRef.current = abortController;
    setStatus('Running full patents bundle...');
    appendLog('Starting run for patents_all');
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    try {
      const startedAt = Date.now();
      const body: Record<string, unknown> = {
        limit: batchCompanyMode ? batchLimit : 25,
      };
      body.run_all = true;
      body.batch_size = Math.min(500, Math.max(1, batchCompanyMode ? batchLimit : 2));
      body.sync_first = true;
      if (batchCompanyMode) {
        appendLog(`Batch company mode enabled (run_all=true, batch_size=${body.batch_size}, limit=${batchLimit}).`);
      } else {
        appendLog(`Running all companies (run_all=true, batch_size=${body.batch_size}).`);
      }
      appendLog('sync_first=true → will pull fresh patents from BigQuery before running monitor.');

      appendLog('Calling /api/signals/run/patents...');
      heartbeat = setInterval(() => {
        const elapsedSec = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
        appendLog(`Run in progress... ${elapsedSec}s elapsed`);
      }, 5000);
      const res = await fetch('/api/signals/run/patents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
      clearInterval(heartbeat);
      heartbeat = null;
      const json = await res.json();
      appendLog(`Run completed with HTTP ${res.status}`);

      setLastResponse({
        signalKey: runKey,
        ok: res.ok,
        httpStatus: res.status,
        payload: json,
        at: new Date().toISOString(),
      });
      setHistory((prev) => [
        {
          signalKey: runKey,
          ok: res.ok,
          httpStatus: res.status,
          at: new Date().toISOString(),
        },
        ...prev.slice(0, 11),
      ]);

      if (!res.ok) {
        appendLog(`Run failed: ${json?.error || 'Unknown error'}`);
        setStatus(`patents_all failed: ${json?.error || 'Unknown error'}`);
      } else {
        const sync = (json as { sync?: { ran?: boolean; ok?: boolean; result?: Record<string, unknown> | null; error?: string | null } })?.sync;
        if (sync?.ran) {
          if (sync.ok && sync.result) {
            const r = sync.result;
            const scanGb = typeof r.estimated_scan_gb === 'number' ? r.estimated_scan_gb.toFixed(3) : '?';
            appendLog(
              `Sync OK: ${String(r.publications_upserted ?? 0)} pubs + ${String(
                r.assignees_upserted ?? 0,
              )} assignees upserted (cutoff ${String(r.cutoff_date ?? '?')}, ${scanGb} GB scanned)`,
            );
          } else if (sync.error) {
            appendLog(`Sync FAILED (continuing with stale data): ${sync.error}`);
          }
        }
        const result = (json as { result?: Record<string, unknown> })?.result;
        if (result) {
          appendLog(`Processed=${String(result.processed ?? 0)} failed=${String(result.failed ?? 0)}`);
          appendOptionalRunDiagnostics(result);
        }
        appendLog('Refreshing signal status colors...');
        setStatus('patents_all ingestion complete. Signal statuses refreshed.');
      }
      await refreshSignalStatuses();
      appendLog('Signal status refresh complete.');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        appendLog('Run cancelled by user.');
        setStatus('patents_all cancelled.');
        return;
      }
      appendLog(`Run errored: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setStatus(`patents_all failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      activeRunAbortRef.current = null;
      if (heartbeat) clearInterval(heartbeat);
      appendLog('Run finished for patents_all');
      setBusySignal(null);
    }
  }

  async function runFundingBundle() {
    const runKey = 'funding_all';
    if (busySignal) {
      appendLog(`Run skipped: ${busySignal} is already in progress.`);
      setStatus(`A run is already in progress: ${busySignal}`);
      return;
    }

    setBusySignal(runKey);
    const abortController = new AbortController();
    activeRunAbortRef.current = abortController;
    setStatus('Running full funding bundle...');
    appendLog('Starting run for funding_all');
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    try {
      const startedAt = Date.now();
      const body: Record<string, unknown> = {
        limit: batchCompanyMode ? batchLimit : 25,
        sync_first: true,
      };
      if (!batchCompanyMode && selectedCompanyId) {
        body.company_ids = [selectedCompanyId];
        appendLog(`Target company scope set: ${selectedCompanyId}`);
      } else {
        body.run_all = true;
        body.batch_size = Math.min(500, Math.max(1, batchCompanyMode ? batchLimit : 200));
        if (batchCompanyMode) {
          appendLog(`Batch company mode enabled (run_all=true, batch_size=${body.batch_size}, limit=${batchLimit}).`);
        } else {
          appendLog(`No company selected; running all companies (run_all=true, batch_size=${body.batch_size}).`);
        }
      }
      appendLog('sync_first=true → will pull fresh SEC filings before running monitor.');

      appendLog('Calling /api/signals/run/funding...');
      heartbeat = setInterval(() => {
        const elapsedSec = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
        appendLog(`Run in progress... ${elapsedSec}s elapsed`);
      }, 5000);
      const res = await fetch('/api/signals/run/funding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
      clearInterval(heartbeat);
      heartbeat = null;
      const json = await res.json();
      appendLog(`Run completed with HTTP ${res.status}`);

      setLastResponse({
        signalKey: runKey,
        ok: res.ok,
        httpStatus: res.status,
        payload: json,
        at: new Date().toISOString(),
      });
      setHistory((prev) => [
        {
          signalKey: runKey,
          ok: res.ok,
          httpStatus: res.status,
          at: new Date().toISOString(),
        },
        ...prev.slice(0, 11),
      ]);

      if (!res.ok) {
        appendLog(`Run failed: ${json?.error || 'Unknown error'}`);
        setStatus(`funding_all failed: ${json?.error || 'Unknown error'}`);
      } else {
        const sync = (
          json as {
            sync?: {
              ran?: boolean;
              ok?: boolean;
              cik_priming_processed?: number;
              cik_priming_failed?: number;
              result?: Record<string, unknown> | null;
              error?: string | null;
            };
          }
        )?.sync;
        if (sync?.ran) {
          appendLog(
            `CIK priming: processed=${String(sync.cik_priming_processed ?? 0)} failed=${String(sync.cik_priming_failed ?? 0)}`,
          );
          if (sync.ok && sync.result) {
            const r = sync.result;
            appendLog(
              `Sync OK: filings=${String(r.filings_upserted ?? 0)} form_d=${String(r.form_d_upserted ?? 0)} 8k=${String(
                r.form_8k_upserted ?? 0,
              )} 424b=${String(r.form_424b_upserted ?? 0)} range=${String(r.start_date ?? '?')}..${String(r.end_date ?? '?')}`,
            );
          } else if (sync.error) {
            appendLog(`Sync FAILED (continuing with stale data): ${sync.error}`);
          }
        }
        const result = (json as { result?: Record<string, unknown> })?.result;
        if (result) {
          appendLog(`Processed=${String(result.processed ?? 0)} failed=${String(result.failed ?? 0)}`);
          appendOptionalRunDiagnostics(result);
        }
        appendLog('Refreshing signal status colors...');
        setStatus('funding_all ingestion complete. Signal statuses refreshed.');
      }
      await refreshSignalStatuses();
      appendLog('Signal status refresh complete.');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        appendLog('Run cancelled by user.');
        setStatus('funding_all cancelled.');
        return;
      }
      appendLog(`Run errored: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setStatus(`funding_all failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      activeRunAbortRef.current = null;
      if (heartbeat) clearInterval(heartbeat);
      appendLog('Run finished for funding_all');
      setBusySignal(null);
    }
  }

  async function runGrantsBundle() {
    const runKey = 'grants_all';
    if (busySignal) {
      appendLog(`Run skipped: ${busySignal} is already in progress.`);
      setStatus(`A run is already in progress: ${busySignal}`);
      return;
    }

    setBusySignal(runKey);
    const abortController = new AbortController();
    activeRunAbortRef.current = abortController;
    setStatus('Running full grants bundle...');
    appendLog('Starting run for grants_all');
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    try {
      const startedAt = Date.now();
      const body: Record<string, unknown> = {
        limit: batchCompanyMode ? batchLimit : 25,
        sync_first: true,
        sync_overlap_days: 90,
      };
      if (!batchCompanyMode && selectedCompanyId) {
        body.company_ids = [selectedCompanyId];
        appendLog(`Target company scope set: ${selectedCompanyId}`);
      } else {
        body.run_all = true;
        body.batch_size = Math.min(500, Math.max(1, batchCompanyMode ? batchLimit : 200));
        if (batchCompanyMode) {
          appendLog(`Batch company mode enabled (run_all=true, batch_size=${body.batch_size}, limit=${batchLimit}).`);
        } else {
          appendLog(`No company selected; running all companies (run_all=true, batch_size=${body.batch_size}).`);
        }
      }
      appendLog('sync_first=true → will pull fresh NIH RePORTER awards before running monitor.');

      appendLog('Calling /api/signals/run/grants...');
      heartbeat = setInterval(() => {
        const elapsedSec = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
        appendLog(`Run in progress... ${elapsedSec}s elapsed`);
      }, 5000);
      const res = await fetch('/api/signals/run/grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
      clearInterval(heartbeat);
      heartbeat = null;
      const json = await res.json();
      appendLog(`Run completed with HTTP ${res.status}`);

      setLastResponse({
        signalKey: runKey,
        ok: res.ok,
        httpStatus: res.status,
        payload: json,
        at: new Date().toISOString(),
      });
      setHistory((prev) => [
        {
          signalKey: runKey,
          ok: res.ok,
          httpStatus: res.status,
          at: new Date().toISOString(),
        },
        ...prev.slice(0, 11),
      ]);

      if (!res.ok) {
        appendLog(`Run failed: ${json?.error || 'Unknown error'}`);
        setStatus(`grants_all failed: ${json?.error || 'Unknown error'}`);
      } else {
        const sync = (
          json as {
            sync?: {
              ran?: boolean;
              ok?: boolean;
              result?: {
                awards_upserted?: number;
                sbir_pages_fetched?: number;
                for_profit_pages_fetched?: number;
                cutoff_date?: string;
              } | null;
              error?: string | null;
            };
          }
        )?.sync;
        if (sync?.ran) {
          if (sync.ok && sync.result) {
            const r = sync.result;
            appendLog(
              `NIH sync OK: awards=${String(r.awards_upserted ?? 0)} sbir_pages=${String(r.sbir_pages_fetched ?? 0)} for_profit_pages=${String(r.for_profit_pages_fetched ?? 0)} since=${String(r.cutoff_date ?? '?')}`,
            );
          } else if (sync.error) {
            appendLog(`NIH sync FAILED (continuing with stale data): ${sync.error}`);
          }
        }
        const result = (json as { result?: Record<string, unknown> })?.result;
        if (result) {
          appendLog(`Processed=${String(result.processed ?? 0)} failed=${String(result.failed ?? 0)}`);
          appendOptionalRunDiagnostics(result);
        }
        appendLog('Refreshing signal status colors...');
        setStatus('grants_all ingestion complete. Signal statuses refreshed.');
      }
      await refreshSignalStatuses();
      appendLog('Signal status refresh complete.');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        appendLog('Run cancelled by user.');
        setStatus('grants_all cancelled.');
        return;
      }
      appendLog(`Run errored: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setStatus(`grants_all failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      activeRunAbortRef.current = null;
      if (heartbeat) clearInterval(heartbeat);
      appendLog('Run finished for grants_all');
      setBusySignal(null);
    }
  }

  async function runPressReleasesBundle() {
    const runKey = 'press_releases_all';
    if (busySignal) {
      appendLog(`Run skipped: ${busySignal} is already in progress.`);
      setStatus(`A run is already in progress: ${busySignal}`);
      return;
    }

    setBusySignal(runKey);
    const abortController = new AbortController();
    activeRunAbortRef.current = abortController;
    setStatus('Running full press releases bundle...');
    appendLog('Starting run for press_releases_all');
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    try {
      const startedAt = Date.now();
      const body: Record<string, unknown> = {
        sync_first: true,
        cutoff_days: 3,
        lookback_days: 7,
      };
      if (selectedCompanyId) {
        body.company_ids = [selectedCompanyId];
        appendLog(`Target company scope set: ${selectedCompanyId}`);
      } else {
        appendLog('No company selected; matching against all companies.');
      }
      appendLog('sync_first=true → will fetch GNW + PRN RSS feeds and classify before matching.');

      appendLog('Calling /api/signals/run/press-releases...');
      heartbeat = setInterval(() => {
        const elapsedSec = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
        appendLog(`Run in progress... ${elapsedSec}s elapsed`);
      }, 5000);
      const res = await fetch('/api/signals/run/press-releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
      clearInterval(heartbeat);
      heartbeat = null;
      const json = await res.json();
      appendLog(`Run completed with HTTP ${res.status}`);

      setLastResponse({
        signalKey: runKey,
        ok: res.ok,
        httpStatus: res.status,
        payload: json,
        at: new Date().toISOString(),
      });
      setHistory((prev) => [
        {
          signalKey: runKey,
          ok: res.ok,
          httpStatus: res.status,
          at: new Date().toISOString(),
        },
        ...prev.slice(0, 11),
      ]);

      if (!res.ok) {
        appendLog(`Run failed: ${(json as { error?: string })?.error ?? 'Unknown error'}`);
        setStatus(`press_releases_all failed: ${(json as { error?: string })?.error ?? 'Unknown error'}`);
      } else {
        const sync = (
          json as {
            sync?: {
              ran?: boolean;
              ok?: boolean;
              result?: {
                feeds_fetched?: number;
                feeds_failed?: number;
                articles_upserted?: number;
                articles_pre_filtered_out?: number;
                articles_classified?: number;
                articles_classification_failed?: number;
              } | null;
              error?: string | null;
            };
          }
        )?.sync;
        if (sync?.ran) {
          if (sync.ok && sync.result) {
            const r = sync.result;
            appendLog(
              `RSS sync OK: feeds=${String(r.feeds_fetched ?? 0)} articles_upserted=${String(r.articles_upserted ?? 0)} pre_filtered_out=${String(r.articles_pre_filtered_out ?? 0)} classified=${String(r.articles_classified ?? 0)} classify_failed=${String(r.articles_classification_failed ?? 0)}`,
            );
          } else if (sync.error) {
            appendLog(`RSS sync FAILED (continuing with existing data): ${sync.error}`);
          }
        }
        const result = (json as { result?: Record<string, unknown> })?.result;
        if (result) {
          appendLog(`Processed=${String(result.processed ?? 0)} failed=${String(result.failed ?? 0)}`);
          appendOptionalRunDiagnostics(result);
        }
        appendLog('Refreshing signal status colors...');
        setStatus('press_releases_all ingestion complete. Signal statuses refreshed.');
      }
      await refreshSignalStatuses();
      appendLog('Signal status refresh complete.');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        appendLog('Run cancelled by user.');
        setStatus('press_releases_all cancelled.');
        return;
      }
      appendLog(`Run errored: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setStatus(`press_releases_all failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      activeRunAbortRef.current = null;
      if (heartbeat) clearInterval(heartbeat);
      appendLog('Run finished for press_releases_all');
      setBusySignal(null);
    }
  }

  async function runHiringBundle() {
    const runKey = 'hiring_all';
    if (busySignal) {
      appendLog(`Run skipped: ${busySignal} is already in progress.`);
      setStatus(`A run is already in progress: ${busySignal}`);
      return;
    }

    setBusySignal(runKey);
    setHiringDetails([]);
    const abortController = new AbortController();
    activeRunAbortRef.current = abortController;
    setStatus('Running full hiring bundle...');
    appendLog('Starting run for hiring_all');
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    try {
      const startedAt = Date.now();
      const body: Record<string, unknown> = {
        limit: batchCompanyMode ? batchLimit : 25,
      };
      if (!batchCompanyMode && selectedCompanyId) {
        body.company_ids = [selectedCompanyId];
        appendLog(`Target company scope set: ${selectedCompanyId}`);
      } else {
        body.run_all = true;
        body.batch_size = Math.min(500, Math.max(1, batchCompanyMode ? batchLimit : 200));
        if (batchCompanyMode) {
          appendLog(`Batch company mode enabled (run_all=true, batch_size=${body.batch_size}, limit=${batchLimit}).`);
        } else {
          appendLog(`No company selected; running all companies (run_all=true, batch_size=${body.batch_size}).`);
        }
      }
      appendLog('Scraping LinkedIn job listings via curious_coder/linkedin-jobs-scraper (one batch call for all companies).');

      appendLog('Calling /api/signals/run/hiring...');
      heartbeat = setInterval(() => {
        const elapsedSec = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
        appendLog(`Run in progress... ${elapsedSec}s elapsed`);
      }, 5000);
      const res = await fetch('/api/signals/run/hiring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
      clearInterval(heartbeat);
      heartbeat = null;
      const json = await res.json();
      appendLog(`Run completed with HTTP ${res.status}`);

      setLastResponse({
        signalKey: runKey,
        ok: res.ok,
        httpStatus: res.status,
        payload: json,
        at: new Date().toISOString(),
      });
      setHistory((prev) => [
        {
          signalKey: runKey,
          ok: res.ok,
          httpStatus: res.status,
          at: new Date().toISOString(),
        },
        ...prev.slice(0, 11),
      ]);

      if (!res.ok) {
        appendLog(`Run failed: ${json?.error || 'Unknown error'}`);
        setStatus(`hiring_all failed: ${json?.error || 'Unknown error'}`);
      } else {
        const result = (json as { result?: Record<string, unknown> })?.result;
        if (result) {
          appendLog(`Processed=${String(result.processed ?? 0)} failed=${String(result.failed ?? 0)}`);
          if (typeof result.postings_scanned === 'number') {
            appendLog(`Postings scanned=${String(result.postings_scanned)}`);
          }
          if (typeof result.candidate_events_before_dedupe === 'number') {
            appendLog(`Candidate events (pre-dedupe)=${String(result.candidate_events_before_dedupe)}`);
          }
          if (typeof result.events_skipped_as_duplicates === 'number') {
            appendLog(`Duplicates skipped=${String(result.events_skipped_as_duplicates)}`);
          }
          const failures = Array.isArray(result.failures)
            ? (result.failures as Array<Record<string, unknown>>)
            : [];
          if (failures.length > 0) {
            appendLog(`Failure entries returned: ${failures.length}`);
            for (const failure of failures.slice(0, 8)) {
              appendLog(`company:${String(failure.company_id ?? 'unknown')} -> ${String(failure.error ?? 'Unknown error')}`);
            }
            if (failures.length > 8) appendLog(`...and ${failures.length - 8} more failures`);
          }
          // Populate hiring drilldown
          const rawDetails = Array.isArray(result.details) ? result.details as HiringCompanyDetail[] : [];
          setHiringDetails(rawDetails);
          if (rawDetails.length > 0) {
            appendLog(`Hiring drilldown: ${rawDetails.length} company/companies with matched postings.`);
            for (const d of rawDetails.slice(0, 5)) {
              const catSummary = d.categories.map((c) => `${c.key}(${c.count})`).join(', ');
              appendLog(`  ${d.company_name}: ${d.postings_scraped} scraped, ${d.postings_matched} matched — ${catSummary}${d.hiring_expansion ? ' ⚡surge' : ''}`);
            }
            if (rawDetails.length > 5) appendLog(`  ...and ${rawDetails.length - 5} more`);
          }
        }
        appendLog('Refreshing signal status colors...');
        setStatus('hiring_all ingestion complete. Signal statuses refreshed.');
      }
      await refreshSignalStatuses();
      appendLog('Signal status refresh complete.');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        appendLog('Run cancelled by user.');
        setStatus('hiring_all cancelled.');
        return;
      }
      appendLog(`Run errored: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setStatus(`hiring_all failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      activeRunAbortRef.current = null;
      if (heartbeat) clearInterval(heartbeat);
      appendLog('Run finished for hiring_all');
      setBusySignal(null);
    }
  }

  async function runJobChangeBundle() {
    const runKey = 'job_change_all';
    if (busySignal) {
      appendLog(`Run skipped: ${busySignal} is already in progress.`);
      setStatus(`A run is already in progress: ${busySignal}`);
      return;
    }
    setBusySignal(runKey);
    const abortController = new AbortController();
    activeRunAbortRef.current = abortController;
    setStatus('Running job-change monitor...');
    appendLog('Starting run for job_change_all');
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    try {
      const startedAt = Date.now();
      const body: Record<string, unknown> = { limit: 20 };
      appendLog('Scraping LinkedIn profiles via harvestapi~linkedin-profile-scraper (20 contacts, oldest-checked-first).');
      appendLog('Calling /api/signals/run/job-change...');
      heartbeat = setInterval(() => {
        appendLog(`Run in progress... ${Math.max(1, Math.floor((Date.now() - startedAt) / 1000))}s elapsed`);
      }, 5000);
      const res = await fetch('/api/signals/run/job-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
      clearInterval(heartbeat);
      heartbeat = null;
      const json = await res.json();
      appendLog(`Run completed with HTTP ${res.status}`);
      setLastResponse({ signalKey: runKey, ok: res.ok, httpStatus: res.status, payload: json, at: new Date().toISOString() });
      setHistory((prev) => [{ signalKey: runKey, ok: res.ok, httpStatus: res.status, at: new Date().toISOString() }, ...prev.slice(0, 11)]);
      if (!res.ok) {
        appendLog(`Run failed: ${json?.error || 'Unknown error'}`);
        setStatus(`job_change_all failed: ${json?.error || 'Unknown error'}`);
      } else {
        const result = (json as { result?: Record<string, unknown> })?.result;
        if (result) {
          appendLog(`Processed=${String(result.processed ?? 0)} no_change=${String(result.no_change ?? 0)} signals_emitted=${String(result.signals_emitted ?? 0)} failed=${String(result.failed ?? 0)}`);
          if (Array.isArray(result.emitted_signal_types) && result.emitted_signal_types.length > 0) {
            appendLog(`Signal types: ${(result.emitted_signal_types as string[]).join(', ')}`);
          }
          const failures = Array.isArray(result.failures) ? (result.failures as Array<Record<string, unknown>>) : [];
          for (const f of failures.slice(0, 5)) {
            appendLog(`contact:${String(f.contact_id ?? 'unknown')} -> ${String(f.error ?? 'unknown')}`);
          }
        }
        setStatus('job_change_all complete.');
      }
      await refreshSignalStatuses();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        appendLog('Run cancelled by user.');
        setStatus('job_change_all cancelled.');
        return;
      }
      appendLog(`Run errored: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setStatus(`job_change_all failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      activeRunAbortRef.current = null;
      if (heartbeat) clearInterval(heartbeat);
      appendLog('Run finished for job_change_all');
      setBusySignal(null);
    }
  }

  async function runPatentsSelectedCompany() {
    const runKey = 'patents_selected_company';
    if (!selectedCompanyId) {
      appendLog('No company selected; cannot run selected-company patents test.');
      setStatus('Please select a company first.');
      return;
    }
    if (busySignal) {
      appendLog(`Run skipped: ${busySignal} is already in progress.`);
      setStatus(`A run is already in progress: ${busySignal}`);
      return;
    }

    setBusySignal(runKey);
    const abortController = new AbortController();
    activeRunAbortRef.current = abortController;
    setStatus('Running patents bundle for selected company...');
    appendLog('Starting run for patents_selected_company');
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    try {
      const startedAt = Date.now();
      const body: Record<string, unknown> = {
        limit: 25,
        company_ids: [selectedCompanyId],
      };
      appendLog(`Target company scope set: ${selectedCompanyId}`);
      appendLog('Calling /api/signals/run/patents...');
      heartbeat = setInterval(() => {
        const elapsedSec = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
        appendLog(`Run in progress... ${elapsedSec}s elapsed`);
      }, 5000);
      const res = await fetch('/api/signals/run/patents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
      clearInterval(heartbeat);
      heartbeat = null;
      const json = await res.json();
      appendLog(`Run completed with HTTP ${res.status}`);

      setLastResponse({
        signalKey: runKey,
        ok: res.ok,
        httpStatus: res.status,
        payload: json,
        at: new Date().toISOString(),
      });
      setHistory((prev) => [
        {
          signalKey: runKey,
          ok: res.ok,
          httpStatus: res.status,
          at: new Date().toISOString(),
        },
        ...prev.slice(0, 11),
      ]);

      if (!res.ok) {
        appendLog(`Run failed: ${json?.error || 'Unknown error'}`);
        setStatus(`patents_selected_company failed: ${json?.error || 'Unknown error'}`);
      } else {
        const result = (json as { result?: Record<string, unknown> })?.result;
        if (result) {
          appendLog(`Processed=${String(result.processed ?? 0)} failed=${String(result.failed ?? 0)}`);
          appendOptionalRunDiagnostics(result);
        }
        appendLog('Refreshing signal status colors...');
        setStatus('patents_selected_company ingestion complete. Signal statuses refreshed.');
      }
      await refreshSignalStatuses();
      appendLog('Signal status refresh complete.');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        appendLog('Run cancelled by user.');
        setStatus('patents_selected_company cancelled.');
        return;
      }
      appendLog(`Run errored: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setStatus(`patents_selected_company failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      activeRunAbortRef.current = null;
      if (heartbeat) clearInterval(heartbeat);
      appendLog('Run finished for patents_selected_company');
      setBusySignal(null);
    }
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <Loader2 className="h-8 w-8 animate-spin text-arcova-teal" />
      </div>
    );
  }

  if (!isAdminUser) {
    return (
      <div className="flex h-screen bg-transparent">
        <AppSidebar />
        <main className="flex min-h-0 flex-1 items-center justify-center px-6">
          <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            This page is restricted to admin users.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-transparent">
      <AppSidebar />
      <main className="arcova-scroll-surface min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void refreshSignalStatuses()}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Refresh Status Colors
              </button>
              {busySignal !== null && (
                <button
                  type="button"
                  onClick={() => {
                    activeRunAbortRef.current?.abort();
                    activeRunAbortRef.current = null;
                    setBusySignal(null);
                    appendLog('Cancel requested by user.');
                  }}
                  className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100"
                >
                  Cancel Current Run
                </button>
              )}
              <p className="text-xs text-slate-500">
                Green = real source-backed events. Yellow = partial/source-limited. Grey = no execution.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-900">SEC Form D Backfill</p>
                <p className="text-xs text-slate-500">
                  Queues a durable 90-day SEC backfill job. It runs in 5-business-day chunks and continues on cron even if this page closes.
                </p>
                {secBackfillJob && (
                  <div className="text-xs text-slate-600">
                    {`Status=${secBackfillJob.status} chunks=${secBackfillJob.chunks_completed} filings=${secBackfillJob.filings_upserted} next=${secBackfillJob.next_date}`}
                  </div>
                )}
                {secBackfillJob?.last_error && (
                  <div className="text-xs text-red-600">{secBackfillJob.last_error}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => void startSecBackfill()}
                disabled={secBackfillBusy || secBackfillJob?.status === 'queued' || secBackfillJob?.status === 'running'}
                className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {secBackfillBusy ? 'Starting...' : 'Start 90-Day SEC Backfill'}
              </button>
              <button
                type="button"
                onClick={() => void cancelSecBackfill()}
                disabled={secBackfillBusy || !(secBackfillJob?.status === 'queued' || secBackfillJob?.status === 'running')}
                className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {secBackfillBusy ? 'Working...' : 'Cancel SEC Backfill'}
              </button>
            </div>
            <div className="mt-4 space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">SEC Backfill Log</p>
                <button
                  type="button"
                  onClick={resetSecBackfillProgressLog}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  Reset
                </button>
              </div>
              <pre className="max-h-52 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-emerald-200">
                {secBackfillProgressLog.length ? secBackfillProgressLog.join('\n') : 'No SEC backfill run yet.'}
              </pre>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="mb-2 text-sm font-medium text-slate-900">Target company</p>
              <div className="mb-3 flex items-center gap-2">
                <input
                  id="batch-company-mode"
                  type="checkbox"
                  checked={batchCompanyMode}
                  onChange={(e) => setBatchCompanyMode(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <label htmlFor="batch-company-mode" className="text-sm text-slate-700">
                  Batch mode (run across many companies)
                </label>
              </div>
              {batchCompanyMode && (
                <div className="mb-3">
                  <label htmlFor="batch-limit" className="mb-1 block text-xs font-medium text-slate-600">
                    Batch limit
                  </label>
                  <input
                    id="batch-limit"
                    type="number"
                    min={1}
                    max={1000}
                    value={batchLimit}
                    onChange={(e) => setBatchLimit(Math.min(1000, Math.max(1, Number(e.target.value) || 1)))}
                    className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                </div>
              )}
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={selectedCompanyId}
                onChange={(e) => setSelectedCompanyId(e.target.value)}
                disabled={batchCompanyMode}
              >
                <option value="">Select company</option>
                {targets.companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.company_name || company.domain || company.id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setBatchCompanyMode(false);
                  void runPatentsSelectedCompany();
                }}
                disabled={!selectedCompanyId || busySignal !== null}
                className="mt-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Test Patents On Selected Company
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="mb-2 text-sm font-medium text-slate-900">Target contact</p>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={selectedContactId}
                onChange={(e) => setSelectedContactId(e.target.value)}
              >
                <option value="">Select contact</option>
                {targets.contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {(contact.full_name || 'Unnamed contact') + (contact.company_name ? ` — ${contact.company_name}` : '')}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {status && (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {status}
            </div>
          )}

          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Response inspector</h2>
              {lastResponse && (
                <span className="text-xs text-slate-500">
                  {lastResponse.signalKey} • HTTP {lastResponse.httpStatus}
                </span>
              )}
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Progress log</p>
                <button
                  type="button"
                  onClick={resetProgressLog}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  Reset
                </button>
              </div>
              <pre className="max-h-52 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-emerald-200">
                {progressLog.length ? progressLog.join('\n') : 'No run yet.'}
              </pre>
            </div>
            {lastResponse ? (
              <pre className="max-h-72 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
                {JSON.stringify(lastResponse.payload, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-slate-500">Click a signal button to inspect the returned payload.</p>
            )}
            {history.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent runs</p>
                <div className="space-y-1">
                  {history.map((item, idx) => (
                    <div
                      key={`${item.signalKey}-${item.at}-${idx}`}
                      className="flex items-center justify-between rounded-md border border-slate-200 px-2 py-1 text-xs"
                    >
                      <span className="font-medium text-slate-700">{item.signalKey}</span>
                      <span className={item.ok ? 'text-emerald-700' : 'text-red-700'}>
                        {item.ok ? 'OK' : 'ERR'} • HTTP {item.httpStatus}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* ── Hiring drilldown ── */}
          {hiringDetails.length > 0 && (
            <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50 p-4">
              <h2 className="text-lg font-semibold text-violet-900">
                Hiring drilldown — {hiringDetails.length} {hiringDetails.length !== 1 ? 'companies' : 'company'} with matches
              </h2>
              <div className="space-y-3">
                {hiringDetails.map((d) => (
                  <div key={d.company_id} className="rounded-lg border border-violet-200 bg-white p-3 space-y-3">
                    {/* Header row */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{d.company_name}</span>
                      <span className="text-xs text-slate-400">
                        {d.postings_scraped} scraped · {d.postings_matched} matched
                      </span>
                      {d.hiring_expansion && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800">
                          ⚡ surge
                        </span>
                      )}
                    </div>

                    {/* Buying team activated */}
                    {d.buyer_functions_activated.length > 0 && (
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Buying team activated</p>
                        <div className="flex flex-wrap gap-1">
                          {d.buyer_functions_activated.map((fn) => (
                            <span
                              key={fn}
                              className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-800"
                            >
                              {fn.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Per-category breakdown */}
                    <div className="space-y-2 border-t border-slate-100 pt-2">
                      {d.categories.map((cat) => (
                        <div key={cat.key}>
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800">
                              {cat.key.replace(/_/g, ' ')}
                            </span>
                            <span className="text-xs text-slate-400">{cat.count} role{cat.count !== 1 ? 's' : ''}</span>
                            {cat.buyer_functions.map((fn) => (
                              <span
                                key={fn}
                                className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                              >
                                {fn.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>
                          <ul className="ml-2 space-y-0.5">
                            {cat.titles.map((title, i) => (
                              <li key={i} className="text-xs text-slate-600">
                                · {title}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {READINESS_DIMENSIONS.map((dimension) => (
            <section key={dimension} className="space-y-3">
              <h2 className="text-lg font-semibold text-slate-900">{dimension}</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {dimension === 'new_needs' && (
                  <button
                    type="button"
                    onClick={() => void runClinicalTrialsBundle()}
                    disabled={busySignal !== null}
                    className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-left text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    <div className="font-medium">clinical_trials_all</div>
                    <div className="text-xs text-emerald-700">Company family</div>
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                      {busySignal === 'clinical_trials_all' ? 'Running...' : 'Active'}
                    </div>
                  </button>
                )}
                {dimension === 'new_budget' && (
                  <button
                    type="button"
                    onClick={() => void runFundingBundle()}
                    disabled={busySignal !== null}
                    className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-left text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    <div className="font-medium">funding_all</div>
                    <div className="text-xs text-emerald-700">Company family</div>
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                      {busySignal === 'funding_all' ? 'Running...' : 'Active'}
                    </div>
                  </button>
                )}
                {dimension === 'new_budget' && (
                  <button
                    type="button"
                    onClick={() => void runGrantsBundle()}
                    disabled={busySignal !== null}
                    className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-left text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    <div className="font-medium">grants_all</div>
                    <div className="text-xs text-emerald-700">Company family · NIH RePORTER</div>
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                      {busySignal === 'grants_all' ? 'Running...' : 'Active'}
                    </div>
                  </button>
                )}
                {dimension === 'new_budget' && (
                  <button
                    type="button"
                    onClick={() => void runFdaRegulatoryBundle()}
                    disabled={busySignal !== null}
                    className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-left text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    <div className="font-medium">fda_regulatory_all</div>
                    <div className="text-xs text-emerald-700">Company family</div>
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                      {busySignal === 'fda_regulatory_all' ? 'Running...' : 'Active'}
                    </div>
                  </button>
                )}
                {dimension === 'new_strategy' && (
                  <button
                    type="button"
                    onClick={() => void runPatentsBundle()}
                    disabled={busySignal !== null}
                    className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-left text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    <div className="font-medium">patents_all</div>
                    <div className="text-xs text-emerald-700">Company family</div>
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                      {busySignal === 'patents_all' ? 'Running...' : 'Active'}
                    </div>
                  </button>
                )}
                {dimension === 'new_strategy' && (
                  <button
                    type="button"
                    onClick={() => void runPressReleasesBundle()}
                    disabled={busySignal !== null}
                    className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-left text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    <div className="font-medium">press_releases_all</div>
                    <div className="text-xs text-emerald-700">Company family · GNW + PRN RSS</div>
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                      {busySignal === 'press_releases_all' ? 'Running...' : 'Active'}
                    </div>
                  </button>
                )}

                {dimension === 'new_people' && (
                  <button
                    type="button"
                    onClick={() => void runHiringBundle()}
                    disabled={busySignal !== null}
                    className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-left text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    <div className="font-medium">hiring_all</div>
                    <div className="text-xs text-emerald-700">Company family · LinkedIn via Apify</div>
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                      {busySignal === 'hiring_all' ? 'Running...' : 'Active'}
                    </div>
                  </button>
                )}
                {dimension === 'new_people' && (
                  <button
                    type="button"
                    onClick={() => void runJobChangeBundle()}
                    disabled={busySignal !== null}
                    className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-left text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    <div className="font-medium">job_change_all</div>
                    <div className="text-xs text-emerald-700">Contact · LinkedIn profile via Apify</div>
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                      {busySignal === 'job_change_all' ? 'Running...' : 'Active'}
                    </div>
                  </button>
                )}
                {signalsByDimension[dimension].map((entry) => (
                  (() => {
                    if (
                      CLINICAL_SINGLE_SIGNAL_KEYS.has(entry.signalKey as SignalKey) ||
                      FDA_SINGLE_SIGNAL_KEYS.has(entry.signalKey as SignalKey) ||
                      PATENT_SINGLE_SIGNAL_KEYS.has(entry.signalKey as SignalKey) ||
                      FUNDING_SINGLE_SIGNAL_KEYS.has(entry.signalKey as SignalKey) ||
                      HIRING_SINGLE_SIGNAL_KEYS.has(entry.signalKey as SignalKey) ||
                      GRANTS_SINGLE_SIGNAL_KEYS.has(entry.signalKey as SignalKey) ||
                      JOB_CHANGE_SINGLE_SIGNAL_KEYS.has(entry.signalKey as SignalKey) ||
                      PRESS_RELEASE_SINGLE_SIGNAL_KEYS.has(entry.signalKey as SignalKey) ||
                      FIRST_PARTY_SIGNAL_KEYS.has(entry.signalKey as SignalKey)
                    ) {
                      return null;
                    }
                    const status = signalStatus(entry.signalKey as SignalKey);
                    return (
                  <button
                    key={`${dimension}-${entry.signalKey}`}
                    type="button"
                    onClick={() => void runRealSignal(entry.signalKey as SignalKey)}
                    disabled={busySignal === entry.signalKey}
                    className={`rounded-md border px-3 py-2 text-left text-sm disabled:opacity-50 ${buttonClassForStatus(status)}`}
                  >
                    <div className="font-medium text-slate-900">{entry.signalKey}</div>
                    <div className="text-xs text-slate-500">
                      {entry.scope === 'company' ? 'Company' : 'Contact'}
                    </div>
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                      {busySignal === entry.signalKey ? 'Running...' : statusLabel(status)}
                    </div>
                  </button>
                    );
                  })()
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
