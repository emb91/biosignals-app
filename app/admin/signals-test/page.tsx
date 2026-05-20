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
  const activeRunAbortRef = useRef<AbortController | null>(null);

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
                {signalsByDimension[dimension].map((entry) => (
                  (() => {
                    if (
                      CLINICAL_SINGLE_SIGNAL_KEYS.has(entry.signalKey as SignalKey) ||
                      FDA_SINGLE_SIGNAL_KEYS.has(entry.signalKey as SignalKey) ||
                      PATENT_SINGLE_SIGNAL_KEYS.has(entry.signalKey as SignalKey)
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
