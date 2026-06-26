'use client';

import { ChangeEvent, DragEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  FileText,
  Building2,
  Users,
  Check,
  ArrowRight,
  ChevronLeft,
  ChevronDown,
  RotateCw,
  Unlink,
  Coins,
  ShieldCheck,
  Sparkles,
  Info,
} from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCreditConfirm } from '@/context/CreditConfirmContext';
import AppSidebar from '@/components/AppSidebar';
import { AgentPanel, type AgentPendingMessage } from '@/components/AgentPanel';
import Nango from '@nangohq/frontend';
import { ROUTES } from '@/lib/routes';
import { getDisplayName } from '@/lib/auth-helpers';
import './import.css';

const HUBSPOT_INTEGRATION_ID = 'hubspot';

type ImportField =
  | 'first_name'
  | 'last_name'
  | 'full_name'
  | 'company_name'
  | 'company_domain'
  | 'job_title'
  | 'email_address'
  | 'linkedin_url'
  | 'location'
  | 'company_linkedin_url'
  | 'ignore';

type ParsedCsv = {
  fileName: string;
  headers: string[];
  rows: string[][];
};

type ImportProgress = {
  total: number;
  processed: number;
  remaining: number;
  duplicates: number;
  enriching: number;
  enriched: number;
  notEnriched: number;
  batchStatus: 'processing' | 'complete' | 'failed' | 'cancelled';
};

type ImportBatch = {
  id: string;
  filename: string;
  total_rows: number;
  processed_rows: number;
  duplicate_rows: number;
  failed_rows: number;
  status: string;
  created_at: string;
};

type HubspotSyncLog = {
  synced_at: string | null;
  auto_pull_at: string | null;
  auto_pull_count: number | null;
  contacts_synced: number | null;
  contacts_errors: number | null;
  contacts_skipped: number | null;
  skipped_contacts?: Array<{ name?: string; company?: string | null; reason?: string }>;
  last_error_details: string[];
  last_pull_batch: {
    total_rows: number;
    duplicate_rows: number;
    failed_rows: number;
    processed_rows: number;
  } | null;
};

type ImportBatchRow = {
  id: string;
  status: string;
  full_name: string;
  email: string;
  linkedin_url: string;
  company_name: string;
  company_domain: string;
  job_title: string;
  failure_reason?: string;
  triage_group?: string | null;
};

type ImportBatchDetails = {
  failedRows: ImportBatchRow[];
  duplicateRows: ImportBatchRow[];
  enrichedRows: ImportBatchRow[];
  allRows: ImportBatchRow[];
};

type CompanyPreview = {
  importable: number;
  credits: number;
  creditsPerCompany: number;
  duplicateRows: number;
  alreadyImported: number;
  invalid: number;
};

const BATCH_ID_STORAGE_KEY = 'arcova_current_batch_id';
const BATCH_MODE_STORAGE_KEY = 'arcova_current_batch_mode';
const HIDDEN_IMPORTS_STORAGE_KEY = 'arcova_hidden_import_batch_ids';
const CSV_PREVIEW_ROW_COUNT = 3;

const IMPORT_FIELD_OPTIONS: { value: ImportField; label: string }[] = [
  { value: 'first_name', label: 'First name' },
  { value: 'last_name', label: 'Last name' },
  { value: 'full_name', label: 'Full name' },
  { value: 'company_name', label: 'Company name' },
  { value: 'company_domain', label: 'Company domain' },
  { value: 'job_title', label: 'Job title' },
  { value: 'email_address', label: 'Email address' },
  { value: 'linkedin_url', label: 'LinkedIn URL' },
  { value: 'company_linkedin_url', label: 'Company LinkedIn URL' },
  { value: 'location', label: 'Location' },
  { value: 'ignore', label: "Don't import" },
];

const FIELD_LABELS: Record<ImportField, string> = IMPORT_FIELD_OPTIONS.reduce(
  (acc, option) => ({ ...acc, [option.value]: option.label }),
  {} as Record<ImportField, string>,
);

type ImportMode = 'contacts' | 'companies';

// What counts as a person identifier — if a file maps one of these, we treat it
// as a people list (everything runs through triage). Otherwise it's a company
// list and goes straight to enrichment after a cost confirmation.
const hasPersonIdentifier = (mapped: ImportField[]) =>
  (mapped.includes('first_name') && mapped.includes('last_name')) ||
  mapped.includes('full_name') ||
  mapped.includes('linkedin_url');

const parseCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
};

const parseCsvText = (text: string): { headers: string[]; rows: string[][] } => {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const parsedRows = lines.map(parseCsvLine);
  const headers = parsedRows[0].map((header) => header.trim());
  const rows = parsedRows.slice(1).filter((row) => row.some((cell) => cell.trim().length > 0));

  return { headers, rows };
};

const inferFieldFromHeader = (header: string): ImportField => {
  const normalized = header.trim().toLowerCase();

  if (!normalized) return 'ignore';

  if (normalized === 'first name' || normalized === 'firstname' || normalized.includes('first_name')) {
    return 'first_name';
  }
  if (
    normalized === 'last name' ||
    normalized === 'lastname' ||
    normalized.includes('last_name') ||
    normalized.includes('surname')
  ) {
    return 'last_name';
  }
  if (
    normalized === 'name' ||
    normalized === 'full name' ||
    normalized.includes('contact name') ||
    normalized.includes('fullname')
  ) {
    return 'full_name';
  }
  if (
    normalized === 'company domain' ||
    normalized === 'domain' ||
    normalized.includes('company_domain') ||
    normalized.includes('website')
  ) {
    return 'company_domain';
  }
  if (
    normalized.includes('company') ||
    normalized.includes('organisation') ||
    normalized.includes('organization') ||
    normalized === 'account'
  ) {
    return 'company_name';
  }
  if (normalized.includes('title') || normalized.includes('job title') || normalized.includes('role')) {
    return 'job_title';
  }
  if (normalized.includes('email') || normalized.includes('e-mail')) {
    return 'email_address';
  }
  if (normalized === 'location' || normalized.includes('city') || normalized.includes('country')) {
    return 'location';
  }
  if (normalized.includes('company linkedin')) {
    return 'company_linkedin_url';
  }
  if (normalized.includes('linkedin') || normalized.includes('linked in')) {
    return 'linkedin_url';
  }

  return 'ignore';
};

const formatRelative = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const day = 86_400_000;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < day) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 7 * day) return `${Math.round(diff / day)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const HubSpotLogo = ({ size = 22 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
    <path d="M18.164 7.932V5.085a2.198 2.198 0 0 0 1.268-1.978V3.06A2.199 2.199 0 0 0 17.235.862h-.047a2.199 2.199 0 0 0-2.197 2.197v.047a2.199 2.199 0 0 0 1.268 1.978v2.847a6.232 6.232 0 0 0-2.962 1.302L5.028 3.617a2.44 2.44 0 0 0 .072-.573A2.455 2.455 0 1 0 2.645 5.5a2.43 2.43 0 0 0 1.194-.315l8.122 4.707a6.248 6.248 0 0 0 0 4.208L4.123 18.5a2.432 2.432 0 0 0-1.478-.498 2.455 2.455 0 1 0 2.455 2.455 2.43 2.43 0 0 0-.388-1.337l7.91-4.583a6.266 6.266 0 0 0 8.976-5.628 6.25 6.25 0 0 0-3.434-5.977zm-1.023 9.565a3.59 3.59 0 1 1 0-7.181 3.59 3.59 0 0 1 0 7.181z" />
  </svg>
);

// Reading/parsing animation — purely cosmetic feedback while the file is staged
// for column mapping. The CSV is already parsed before this renders.
function ReadingStage({ csv, mode, onDone }: { csv: ParsedCsv; mode: ImportMode; onDone: () => void }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [
      setTimeout(() => setStep(1), 520),
      setTimeout(() => setStep(2), 1150),
      setTimeout(() => setStep(3), 1750),
      setTimeout(() => setStep(4), 2350),
      setTimeout(onDone, 2850),
    ];
    return () => timers.forEach((t) => clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const steps = [
    { t: 'Uploading file', m: 'transfer complete' },
    { t: 'Reading rows', m: `${csv.rows.length.toLocaleString()} rows` },
    { t: 'Detecting columns', m: `${csv.headers.length} found` },
    { t: mode === 'companies' ? 'Companies-only list' : 'People and companies', m: 'matched to fields' },
  ];
  const status = (i: number) => (i < step ? 'is-done' : i === step ? 'is-active' : '');
  const pct = Math.min(100, Math.round((step / 4) * 100));

  return (
    <>
      <div className="page-head" style={{ paddingTop: 22 }}>
        <p className="page-eyebrow"><Upload /> Import</p>
        <h1 className="page-title" style={{ fontSize: 32 }}>Reading your file</h1>
        <p className="page-sub">One sec — we&apos;re parsing your upload and working out what&apos;s inside.</p>
      </div>
      <div className="read glass">
        <div className="read-file">
          <div className="read-file-ic"><FileText /></div>
          <div>
            <div className="read-file-name">{csv.fileName}</div>
            <div className="read-file-meta">CSV · {csv.rows.length.toLocaleString()} rows</div>
          </div>
          <div className="read-file-badge">{pct}%</div>
        </div>
        <div className="read-steps">
          {steps.map((s, i) => (
            <div key={s.t}>
              <div className={`read-step ${status(i)}`}>
                <span className="read-step-dot">
                  {i < step ? <Check /> : i === step ? <span className="read-spin" /> : <span className="dotlet" />}
                </span>
                <span>{s.t}</span>
                {i <= step && <span className="read-step-meta">{s.m}</span>}
              </div>
              {i === 2 && step >= 2 && (
                <div className="read-cols">
                  {csv.headers.map((h, j) => (
                    <span key={`${h}-${j}`} className="read-col-chip" style={{ animationDelay: `${j * 60}ms` }}>
                      {h || '(unnamed)'}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

type Stage = 'landing' | 'reading' | 'map' | 'confirm';

export default function ImportPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const confirmCredits = useCreditConfirm();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [stage, setStage] = useState<Stage>('landing');
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [parsedCsv, setParsedCsv] = useState<ParsedCsv | null>(null);
  const [batchMode, setBatchMode] = useState<ImportMode>('contacts');
  const [columnMappings, setColumnMappings] = useState<Record<string, ImportField>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [companyPreview, setCompanyPreview] = useState<CompanyPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [currentBatchId, setCurrentBatchId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [hiddenBatchIds, setHiddenBatchIds] = useState<string[]>([]);
  const [importHistory, setImportHistory] = useState<ImportBatch[]>([]);
  const [importHistoryLoaded, setImportHistoryLoaded] = useState(false);
  const [batchDetails, setBatchDetails] = useState<ImportBatchDetails | null>(null);
  const [billingActionBusy, setBillingActionBusy] = useState(false);
  const [batchDetailsError, setBatchDetailsError] = useState<string | null>(null);
  const [isLoadingBatchDetails, setIsLoadingBatchDetails] = useState(false);
  const [expandedBatchSection, setExpandedBatchSection] = useState<'failed' | 'duplicate' | 'enriched' | 'uploaded' | null>(null);
  const [hubspotConnected, setHubspotConnected] = useState(false);
  const [hubspotDomain, setHubspotDomain] = useState<string | null>(null);
  const [hubspotSyncLog, setHubspotSyncLog] = useState<HubspotSyncLog | null>(null);
  const [hubspotConnecting, setHubspotConnecting] = useState(false);
  const [hubspotConnectError, setHubspotConnectError] = useState<string | null>(null);
  const [hubspotSyncing, setHubspotSyncing] = useState(false);
  const [hubspotDisconnecting, setHubspotDisconnecting] = useState(false);
  const [agentOpener, setAgentOpener] = useState<AgentPendingMessage | undefined>();

  const persistBatchId = (id: string | null, mode: ImportMode = 'contacts') => {
    setCurrentBatchId(id);
    if (id) {
      localStorage.setItem(BATCH_ID_STORAGE_KEY, id);
      localStorage.setItem(BATCH_MODE_STORAGE_KEY, mode);
      setBatchMode(mode);
    } else {
      localStorage.removeItem(BATCH_ID_STORAGE_KEY);
      localStorage.removeItem(BATCH_MODE_STORAGE_KEY);
    }
  };

  const resetToLanding = () => {
    persistBatchId(null);
    setProgress(null);
    setBatchDetails(null);
    setBatchDetailsError(null);
    setExpandedBatchSection(null);
    setParsedCsv(null);
    setColumnMappings({});
    setCompanyPreview(null);
    setErrorMessage(null);
    setStage('landing');
  };

  const fetchImportHistory = async () => {
    try {
      const res = await fetch('/api/import-history');
      if (!res.ok) return;
      const data = await res.json();
      const hiddenIds = new Set(hiddenBatchIds);
      setImportHistory((data.batches || []).filter((batch: ImportBatch) => !hiddenIds.has(batch.id)));
    } catch {
      // non-critical, fail silently
    } finally {
      setImportHistoryLoaded(true);
    }
  };

  const fetchHubspotSyncLog = useCallback(async () => {
    try {
      const res = await fetch('/api/hubspot/sync-log');
      if (!res.ok) {
        setHubspotSyncLog(null);
        return;
      }
      const json = await res.json();
      setHubspotSyncLog((json.data as HubspotSyncLog | null) ?? null);
    } catch {
      setHubspotSyncLog(null);
    }
  }, []);

  const refreshCreditBalance = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/summary');
      if (!res.ok) {
        setCreditBalance(null);
        return;
      }
      const json = await res.json();
      const value =
        typeof json?.available === 'number'
          ? json.available
          : typeof json?.credits?.available === 'number'
            ? json.credits.available
            : null;
      setCreditBalance(value);
    } catch {
      setCreditBalance(null);
    }
  }, []);

  const fetchBatchDetails = useCallback(async () => {
    if (!currentBatchId) return;
    setIsLoadingBatchDetails(true);
    setBatchDetailsError(null);
    try {
      const response = await fetch(`/api/import-history/${encodeURIComponent(currentBatchId)}`);
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to load import details.');
      }
      setBatchDetails({
        failedRows: result.failedRows || [],
        duplicateRows: result.duplicateRows || [],
        enrichedRows: result.enrichedRows || [],
        allRows: result.allRows || [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load import details.';
      setBatchDetailsError(message);
    } finally {
      setIsLoadingBatchDetails(false);
    }
  }, [currentBatchId]);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [loading, router, user]);

  // On batch completion, default the expanded section to whichever bucket the
  // user most needs to see: enriched (the success story) if it's the bigger
  // bucket, otherwise the failure list (so they can investigate reasons).
  useEffect(() => {
    if (progress?.batchStatus !== 'complete') return;
    if (expandedBatchSection !== null) return;
    const enriched = progress.enriched ?? 0;
    const notEnriched = progress.notEnriched ?? 0;
    if (enriched === 0 && notEnriched === 0) return;
    setExpandedBatchSection(enriched > notEnriched ? 'enriched' : 'failed');
  }, [progress?.batchStatus, progress?.enriched, progress?.notEnriched, expandedBatchSection]);

  // On mount: restore any in-progress/completed batch and load history
  useEffect(() => {
    if (!user) return;
    const savedBatchId = localStorage.getItem(BATCH_ID_STORAGE_KEY);
    const savedBatchMode = localStorage.getItem(BATCH_MODE_STORAGE_KEY);
    const savedHiddenBatchIds = localStorage.getItem(HIDDEN_IMPORTS_STORAGE_KEY);
    if (savedBatchId) {
      setCurrentBatchId(savedBatchId);
      setBatchMode(savedBatchMode === 'companies' ? 'companies' : 'contacts');
    }
    if (savedHiddenBatchIds) {
      try {
        setHiddenBatchIds(JSON.parse(savedHiddenBatchIds));
      } catch {
        localStorage.removeItem(HIDDEN_IMPORTS_STORAGE_KEY);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void fetchImportHistory();
    void fetchHubspotSyncLog();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, hiddenBatchIds.join('|')]);

  useEffect(() => {
    if (!user || agentOpener || !importHistoryLoaded) return;

    const firstName = getDisplayName(user);
    const stateContext = currentBatchId || progress
      ? `The user has an import batch in progress or recently active. Open with "Hey ${firstName}" or similar, say you can see an import is underway, and tell them you'll help keep an eye on it or explain what happens next.`
      : parsedCsv
        ? `The user has selected a CSV and is mapping columns. Open with "Hey ${firstName}" or similar, say the file is ready to map, and guide them to match the key columns before starting the import.`
        : importHistory.length > 0
          ? `The user has imported data before and has ${importHistory.length} past import ${importHistory.length === 1 ? 'batch' : 'batches'}. Open with "Hey ${firstName}, welcome back" or similar, and ask whether they are looking to import more data today, sync HubSpot, or check a previous batch.`
          : `The user has just finished setup and landed on Import. Open with "Hey ${firstName}" or similar, congratulate them on finishing setup, then explain the next step: bring in contacts so Arcova can enrich and score them. Tell them to use Import from HubSpot if their contacts live in HubSpot, or upload a CSV if they have a file.`;

    setAgentOpener({
      text: `The Import page just loaded. The user's first name is ${firstName}. ${stateContext} Keep it conversational, helpful, and under 90 words. Do not say "try asking" or list generic sample questions.`,
      nonce: Date.now(),
      threadPreview: 'Help me with imports',
    });
  }, [agentOpener, currentBatchId, importHistory.length, importHistoryLoaded, parsedCsv, progress, user]);

  useEffect(() => {
    if (!currentBatchId) return;

    const fetchProgress = async () => {
      const response = await fetch(`/api/import-status?batchId=${encodeURIComponent(currentBatchId)}`);
      if (!response.ok) return;
      const result = await response.json();
      const batchStatus = result.batch_status || 'processing';
      setProgress({
        total: result.total || 0,
        processed: result.processed || 0,
        remaining: result.remaining || 0,
        duplicates: result.duplicates || 0,
        enriching: (result.enriching || 0) + (result.pending || 0),
        enriched: result.enriched || 0,
        notEnriched: result.not_enriched || 0,
        batchStatus,
      });
      if (batchStatus === 'complete') {
        void fetchImportHistory();
        void fetchHubspotSyncLog();
        // Clear from localStorage so future page loads show the main import screen.
        // The in-session state still holds so the result renders for the current visit.
        localStorage.removeItem(BATCH_ID_STORAGE_KEY);
      } else if (batchStatus === 'failed' || batchStatus === 'cancelled') {
        localStorage.removeItem(BATCH_ID_STORAGE_KEY);
      }
    };

    fetchProgress();
    const interval = setInterval(fetchProgress, 5000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBatchId]);

  useEffect(() => {
    if (!currentBatchId) {
      setBatchDetails(null);
      setBatchDetailsError(null);
      setExpandedBatchSection(null);
      return;
    }
    void fetchBatchDetails();
  }, [currentBatchId, fetchBatchDetails]);

  useEffect(() => {
    if (!currentBatchId || progress?.batchStatus !== 'complete') return;
    void fetchBatchDetails();
  }, [currentBatchId, progress?.batchStatus, fetchBatchDetails]);

  const fetchHubspotStatus = useCallback(async () => {
    const res = await fetch('/api/hubspot/status');
    if (!res.ok) return;
    const { connected, hubDomain } = await res.json();
    setHubspotConnected(connected);
    setHubspotDomain(hubDomain ?? null);
  }, []);

  useEffect(() => {
    if (!user) return;
    void fetchHubspotStatus();
  }, [user, fetchHubspotStatus]);

  const handleConnectHubSpot = async () => {
    if (!user) return;

    setHubspotConnectError(null);
    setHubspotConnecting(true);
    try {
      // Get a short-lived session token from our backend
      const sessionRes = await fetch('/api/nango/session', { method: 'POST' });
      const sessionBody = (await sessionRes.json().catch(() => ({}))) as { sessionToken?: string; error?: string };
      if (!sessionRes.ok) {
        throw new Error(sessionBody.error ?? 'Could not start the HubSpot connection.');
      }
      if (!sessionBody.sessionToken) {
        throw new Error('HubSpot connection is not configured. Add Nango credentials and try again.');
      }

      const nangoClient = new Nango();
      const connectUI = nangoClient.openConnectUI({
        onEvent: async (event) => {
          if (event.type === 'ready') {
            setHubspotConnecting(false);
            return;
          }
          if (event.type === 'close') {
            setHubspotConnecting(false);
            return;
          }
          if (event.type === 'error') {
            setHubspotConnectError(event.payload.errorMessage || 'Could not connect HubSpot.');
            setHubspotConnecting(false);
            return;
          }
          if (event.type === 'connect') {
            const { connectionId, providerConfigKey } = event.payload;
            // Persist the Nango connectionId to our DB
            await fetch('/api/nango/connection', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ integrationId: providerConfigKey, connectionId }),
            });
            setHubspotConnected(true);
            setHubspotConnecting(false);
            setHubspotConnectError(null);
            void fetchHubspotStatus();
            void fetchHubspotSyncLog();
          }
        },
      });
      connectUI.setSessionToken(sessionBody.sessionToken);
    } catch (error) {
      setHubspotConnectError(error instanceof Error ? error.message : 'Could not start the HubSpot connection.');
      setHubspotConnecting(false);
    }
  };

  const handleHubspotSync = async () => {
    setHubspotSyncing(true);
    try {
      const res = await fetch('/api/hubspot/sync', { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? 'Sync failed');
      persistBatchId(result.batchId, 'contacts');
      setProgress({
        total: result.total,
        processed: 0,
        remaining: result.total,
        duplicates: 0,
        enriching: result.total,
        enriched: 0,
        notEnriched: 0,
        batchStatus: 'processing',
      });
    } finally {
      setHubspotSyncing(false);
    }
  };

  const handleHubspotDisconnect = async () => {
    setHubspotDisconnecting(true);
    try {
      await fetch('/api/hubspot/disconnect', { method: 'DELETE' });
      setHubspotConnected(false);
      setHubspotDomain(null);
      setHubspotSyncLog(null);
      setHubspotConnectError(null);
    } finally {
      setHubspotDisconnecting(false);
    }
  };

  const detectedMode: ImportMode = useMemo(
    () => (hasPersonIdentifier(Object.values(columnMappings)) ? 'contacts' : 'companies'),
    [columnMappings],
  );

  const handleParsedFile = (file: File, text: string) => {
    const { headers, rows } = parseCsvText(text);

    if (headers.length === 0) {
      setErrorMessage('Could not read CSV headers. Please upload a valid CSV file.');
      return;
    }

    const mappings: Record<string, ImportField> = {};
    headers.forEach((header) => {
      mappings[header] = inferFieldFromHeader(header);
    });

    setParsedCsv({ fileName: file.name, headers, rows });
    setColumnMappings(mappings);
    setErrorMessage(null);
    setCompanyPreview(null);
    setBatchDetails(null);
    setBatchDetailsError(null);
    setExpandedBatchSection(null);
    setCurrentBatchId(null);
    setProgress(null);
    setStage('reading');
  };

  const processFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setErrorMessage('Only .csv files are supported.');
      return;
    }
    const text = await file.text();
    handleParsedFile(file, text);
  };

  const handleFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await processFile(file);
    event.target.value = '';
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const canConfirmImport = useMemo(() => {
    const mappedTargets = Object.values(columnMappings);
    if (detectedMode === 'companies') {
      // A company list just needs a company name or domain to resolve each row.
      return mappedTargets.includes('company_name') || mappedTargets.includes('company_domain');
    }
    const hasCompanyIdentifier =
      mappedTargets.includes('company_name') ||
      mappedTargets.includes('company_domain') ||
      mappedTargets.includes('email_address') ||
      mappedTargets.includes('linkedin_url');

    return hasPersonIdentifier(mappedTargets) && hasCompanyIdentifier;
  }, [columnMappings, detectedMode]);

  const rawPreviewRows = useMemo(() => {
    if (!parsedCsv) return [];
    return parsedCsv.rows.slice(0, CSV_PREVIEW_ROW_COUNT);
  }, [parsedCsv]);

  const handleConfirmContacts = async () => {
    if (!parsedCsv || !canConfirmImport) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetch('/api/import-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headers: parsedCsv.headers,
          rows: parsedCsv.rows,
          columnMappings,
          filename: parsedCsv.fileName,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to start import.');
      }

      if (typeof result.warning === 'string' && result.warning) {
        setErrorMessage(result.warning);
      }

      persistBatchId(result.batchId, 'contacts');
      setParsedCsv(null);
      setColumnMappings({});
      setBatchDetails(null);
      setBatchDetailsError(null);
      setExpandedBatchSection(null);
      setStage('landing');
      setProgress({
        total: result.totalUploaded || 0,
        processed: (result.duplicatesRemoved || 0) + (result.complete || 0) + (result.failed || 0),
        remaining: (result.beingEnriched || 0) + (result.complete || 0) + (result.failed || 0) + (result.duplicatesRemoved || 0) > 0
          ? (result.totalUploaded || 0) - ((result.duplicatesRemoved || 0) + (result.complete || 0) + (result.failed || 0))
          : result.totalUploaded || 0,
        duplicates: result.duplicatesRemoved || 0,
        enriching: result.beingEnriched || 0,
        enriched: result.complete || 0,
        notEnriched: result.failed || 0,
        batchStatus: 'processing',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start import.';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Price a company list (no enrichment runs yet), then move to the cost
  // confirmation step. Nothing is charged until the user accepts there.
  const loadCompanyPreview = async () => {
    if (!parsedCsv || !canConfirmImport) return;
    setPreviewLoading(true);
    setErrorMessage(null);
    try {
      const previewRes = await fetch('/api/import-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headers: parsedCsv.headers,
          rows: parsedCsv.rows,
          columnMappings,
          filename: parsedCsv.fileName,
          preview: true,
        }),
      });
      const preview = await previewRes.json();
      if (!previewRes.ok) throw new Error(preview.error || 'Could not price this import.');

      const importable = Number(preview.importable ?? 0);
      const credits = Number(preview.estimatedCredits ?? 0);
      const creditsPerCompany = Number(
        preview.creditsPerCompany ?? (importable > 0 ? credits / importable : 0),
      );
      const duplicateRows = Number(preview.duplicateRows ?? 0);
      const alreadyImported = Number(preview.alreadyImported ?? 0);
      const invalid = Number(preview.invalid ?? 0);

      if (importable === 0) {
        setErrorMessage(
          alreadyImported > 0 || duplicateRows > 0
            ? 'Every company in this file is already in your companies.'
            : 'No companies with a usable name or domain to import.',
        );
        return;
      }

      setCompanyPreview({ importable, credits, creditsPerCompany, duplicateRows, alreadyImported, invalid });
      void refreshCreditBalance();
      setStage('confirm');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not price this import.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleEnrichCompanies = async () => {
    if (!parsedCsv || !companyPreview) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetch('/api/import-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headers: parsedCsv.headers,
          rows: parsedCsv.rows,
          columnMappings,
          filename: parsedCsv.fileName,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to start import.');

      persistBatchId(result.batchId, 'companies');
      setParsedCsv(null);
      setColumnMappings({});
      setCompanyPreview(null);
      setBatchDetails(null);
      setBatchDetailsError(null);
      setExpandedBatchSection(null);
      setStage('landing');
      setProgress({
        total: result.totalUploaded || 0,
        processed: result.totalUploaded || 0,
        remaining: 0,
        duplicates: result.duplicatesRemoved || 0,
        enriching: result.beingEnriched || 0,
        enriched: result.beingEnriched || 0,
        notEnriched: result.failed || 0,
        batchStatus: 'complete',
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to start import.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelImport = async () => {
    if (!currentBatchId || isCancelling) return;

    setIsCancelling(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/import-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: currentBatchId }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to stop import.');
      }

      setProgress((prev) => {
        const total = prev?.total || 0;
        const duplicates = result.duplicate_rows || prev?.duplicates || 0;
        const notEnriched = result.failed_rows || prev?.notEnriched || 0;
        const enriched = prev?.enriched || 0;
        const processed = result.processed_rows || duplicates + notEnriched + enriched;
        return {
          total,
          processed,
          remaining: Math.max(total - processed, 0),
          duplicates,
          enriching: 0,
          enriched,
          notEnriched,
          batchStatus: 'cancelled',
        };
      });

      fetchImportHistory();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop import.';
      setErrorMessage(message);
    } finally {
      setIsCancelling(false);
    }
  };

  const runImportBillingAction = async (
    path: '/api/import-contacts/triage' | '/api/import-contacts/enrich',
    ids: string[],
    label: string,
  ) => {
    if (!ids.length || billingActionBusy) return;
    setBillingActionBusy(true);
    setErrorMessage('');
    try {
      const operationId = crypto.randomUUID();
      const preflightResponse = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawUploadIds: ids, operationId }),
      });
      const preflight = await preflightResponse.json();
      if (!preflightResponse.ok) throw new Error(preflight.error || 'Could not price this action.');
      const credits = Number(preflight.preflight?.estimatedCredits ?? 0);
      const ok = await confirmCredits({
        title: label,
        cost: credits,
        upTo: true,
        confirmLabel: 'Continue',
      });
      if (!ok) return;
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawUploadIds: ids, operationId, confirm: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || result.error || 'Action could not be started.');
      await fetchBatchDetails();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Action failed.');
    } finally {
      setBillingActionBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal"></div>
      </div>
    );
  }

  if (!user) return null;

  const importComplete = progress?.batchStatus === 'complete';
  const importCancelled = progress?.batchStatus === 'cancelled';
  const importFinished = importComplete || importCancelled;
  const isCompaniesBatch = batchMode === 'companies';
  const processedCount = progress?.processed || 0;
  const totalCount = progress?.total || 0;
  const progressPercent = totalCount > 0 ? Math.min((processedCount / totalCount) * 100, 100) : 0;
  const visibleBatchRows =
    expandedBatchSection === 'failed' ? batchDetails?.failedRows || []
    : expandedBatchSection === 'duplicate' ? batchDetails?.duplicateRows || []
    : expandedBatchSection === 'enriched' ? batchDetails?.enrichedRows || []
    : expandedBatchSection === 'uploaded' ? batchDetails?.allRows || []
    : [];
  const awaitingTriageRows = batchDetails?.allRows.filter((row) => row.status === 'awaiting_triage') ?? [];
  const awaitingEnrichmentRows = batchDetails?.allRows.filter(
    (row) => row.status === 'awaiting_enrichment' && row.triage_group !== 'low',
  ) ?? [];
  const contactTriageReviewCount =
    batchMode === 'contacts' ? awaitingTriageRows.length + awaitingEnrichmentRows.length : 0;
  const expandedBatchTitle =
    expandedBatchSection === 'failed' ? 'Not enriched'
    : expandedBatchSection === 'duplicate' ? 'Duplicates'
    : expandedBatchSection === 'enriched' ? (isCompaniesBatch ? 'Enriched companies' : 'Enriched contacts')
    : expandedBatchSection === 'uploaded' ? (isCompaniesBatch ? 'All uploaded companies' : 'All uploaded contacts')
    : '';

  const recents = importHistory.slice(0, 3);

  const renderLanding = () => (
    <>
      <div className="page-head">
        <p className="page-eyebrow"><Upload /> Import</p>
        <h1 className="page-title">
          Bring your people<br />into <span className="accent">Arcova</span>.
        </h1>
        <p className="page-sub">
          Connect HubSpot or drop in a CSV. Arcova runs <strong>everything through triage</strong> — enriching each record
          and ranking it against your ICP — so you land on a scored list to pick from, not a spreadsheet.
        </p>
      </div>

      <div className="method-grid">
        {/* HubSpot — recommended onboarding path */}
        <div className={`method is-hub ${hubspotConnected ? 'is-connected' : ''}`}>
          {!hubspotConnected && <span className="method-flag">Recommended</span>}
          <div className="method-top">
            <div className="method-logo hub"><HubSpotLogo /></div>
            <div>
              <div className="method-name">HubSpot</div>
              {hubspotConnected ? (
                <span className="method-status">
                  <span className="dot" /> Connected{hubspotDomain ? ` · ${hubspotDomain}` : ''}
                </span>
              ) : (
                <div className="method-kicker">Sync your CRM both ways</div>
              )}
            </div>
          </div>
          <p className="method-desc">
            {hubspotConnected ? (
              <>Pull your contacts and companies straight in. Arcova <strong>triages the lot</strong> and pushes enrichment back to HubSpot.</>
            ) : (
              <>Most teams start here. We pull contacts and companies, <strong>score the relationships</strong>, and bring your best fits in — included.</>
            )}
          </p>
          <div className="method-foot">
            {hubspotConnected ? (
              <>
                <button type="button" className="btn btn-hub btn-lg" disabled={hubspotSyncing} onClick={() => void handleHubspotSync()}>
                  <RotateCw className={hubspotSyncing ? 'spin' : undefined} /> {hubspotSyncing ? 'Importing…' : 'Import from HubSpot'}
                </button>
                <button type="button" className="btn btn-ghost" disabled={hubspotDisconnecting} onClick={() => void handleHubspotDisconnect()}>
                  <Unlink /> {hubspotDisconnecting ? '…' : 'Disconnect'}
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-hub btn-lg btn-block" disabled={hubspotConnecting} onClick={() => void handleConnectHubSpot()}>
                {hubspotConnecting ? <><RotateCw className="spin" /> Connecting…</> : <><HubSpotLogo size={18} /> Connect HubSpot</>}
              </button>
            )}
          </div>
          {hubspotConnectError && <p className="method-error">{hubspotConnectError}</p>}
        </div>

        {/* Upload CSV */}
        <div className="method">
          <div className="method-top">
            <div className="method-logo csv"><Upload /></div>
            <div>
              <div className="method-name">Upload a CSV</div>
              <div className="method-kicker">Contacts or companies</div>
            </div>
          </div>
          <p className="method-desc">
            Drop in any export. We detect what&apos;s inside — <strong>people get triaged</strong>, a company-only list gets enriched after you OK the cost.
          </p>
          <div style={{ marginTop: 'auto' }}>
            <div
              className={`csv-zone ${isDragOver ? 'is-drag' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="csv-zone-ic"><FileText /></div>
              <div>
                <div className="csv-zone-t">{isDragOver ? 'Drop to upload' : 'Drag a CSV here, or browse'}</div>
                <div className="csv-zone-s">.csv up to 50,000 rows</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* How it works */}
      <div className="flow glass">
        <div className="flow-head">
          <div className="flow-title">What happens after you import</div>
          <div className="flow-note">Triage is included · enrichment of a company-only list costs credits</div>
        </div>
        <div className="flow-steps">
          <div className="flow-step">
            <div className="flow-num">1</div>
            <div className="flow-step-t">Bring it in</div>
            <div className="flow-step-d">Contacts and companies land in Arcova from HubSpot or your CSV.</div>
          </div>
          <div className="flow-step">
            <div className="flow-num">2</div>
            <div className="flow-step-t">Triage everything</div>
            <div className="flow-step-d">Every record runs through the Triage page, ranked against your ICP.</div>
            <span className="flow-badge"><Check /> Included</span>
          </div>
          <div className="flow-step">
            <div className="flow-num">3</div>
            <div className="flow-step-t">You select</div>
            <div className="flow-step-d">Review on the Triage page and bring your best fits into Leads.</div>
          </div>
        </div>
      </div>

      {/* Recents */}
      {recents.length > 0 && (
        <div className="recents glass">
          <div className="recents-head">
            <div className="recents-title">Recent imports</div>
          </div>
          {recents.map((batch) => {
            const kind = batch.filename?.toLowerCase().includes('hubspot') ? 'hub' : 'csv';
            return (
              <button
                key={batch.id}
                type="button"
                className="recent-row"
                onClick={() => { setExpandedBatchSection(null); persistBatchId(batch.id, 'contacts'); }}
              >
                <div className={`recent-ic ${kind}`}>{kind === 'hub' ? <HubSpotLogo size={16} /> : <FileText />}</div>
                <div>
                  <div className="recent-name">{batch.filename || 'Import'}</div>
                  <div className="recent-meta">{batch.total_rows.toLocaleString()} rows · {formatRelative(batch.created_at)}</div>
                </div>
                <div className="recent-stat"><b>{batch.processed_rows.toLocaleString()}</b> processed</div>
              </button>
            );
          })}
        </div>
      )}

      {errorMessage && <p className="imp-error">{errorMessage}</p>}
    </>
  );

  const renderMap = () => {
    if (!parsedCsv) return null;
    const isCompanies = detectedMode === 'companies';
    const cols = parsedCsv.headers.length;
    return (
      <>
        <button className="page-back" onClick={resetToLanding}><ChevronLeft /> Back to import</button>
        <div className="panel glass">
          <div className="panel-head">
            <div className="panel-title">Map your columns</div>
            <div className="panel-file">{parsedCsv.fileName} · {parsedCsv.rows.length.toLocaleString()} rows</div>
          </div>
          <p className="panel-sub">We matched these automatically — check each one and fix anything that looks off.</p>

          <div className={`detect ${isCompanies ? 'is-companies' : 'is-contacts'}`}>
            <div className="detect-ic">{isCompanies ? <Building2 /> : <Users />}</div>
            <div>
              {isCompanies ? (
                <>This file has <b>companies only</b> — no people to triage. Next you&apos;ll confirm the enrichment cost, then each company enriches in the background.</>
              ) : (
                <>This file has <b>people and companies</b>. Everything runs through the <b>Triage</b> page, ranked against your ICP — you pick who to bring in. <b>Included in your plan</b>.</>
              )}
            </div>
          </div>

          <div className="map-table">
            <div className="map-grid">
              <div className="map-hrow" style={{ gridTemplateColumns: `repeat(${cols}, minmax(180px, 1fr))` }}>
                {parsedCsv.headers.map((header, i) => {
                  const field = columnMappings[header] || 'ignore';
                  return (
                    <div key={`${header}-${i}`} className="map-h">
                      <div className="map-h-name" title={header}>{header || '(unnamed)'}</div>
                      <div className={`map-select ${field === 'ignore' ? 'is-ignore' : ''}`}>
                        <span>{FIELD_LABELS[field]}</span>
                        <ChevronDown />
                        <select
                          value={field}
                          aria-label={`Map column ${header || '(unnamed)'}`}
                          onChange={(event) =>
                            setColumnMappings((prev) => ({ ...prev, [header]: event.target.value as ImportField }))
                          }
                        >
                          {IMPORT_FIELD_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
              {rawPreviewRows.map((row, i) => (
                <div key={`preview-${i}`} className="map-row" style={{ gridTemplateColumns: `repeat(${cols}, minmax(180px, 1fr))` }}>
                  {parsedCsv.headers.map((header, j) => (
                    <div key={`${header}-${i}-${j}`} className={`map-cell ${(columnMappings[header] || 'ignore') === 'ignore' ? 'is-faint' : ''}`} title={row[j] || ''}>
                      {row[j] || '—'}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {!canConfirmImport && (
            <p className="panel-warn">
              {isCompanies
                ? 'Map a company name or company domain to continue.'
                : 'Map a person identifier (first + last name, full name, or LinkedIn URL) and a company identifier (company name, domain, email, or LinkedIn URL) to continue.'}
            </p>
          )}

          {errorMessage && <p className="imp-error" style={{ marginTop: 14 }}>{errorMessage}</p>}

          <div className="panel-foot">
            <button className="btn btn-ghost" onClick={resetToLanding}>Cancel</button>
            <button
              className="btn btn-accent btn-lg"
              disabled={!canConfirmImport || isSubmitting || previewLoading}
              onClick={() => (isCompanies ? void loadCompanyPreview() : void handleConfirmContacts())}
            >
              {isCompanies
                ? <>{previewLoading ? 'Pricing…' : 'Review enrichment cost'} <ArrowRight /></>
                : <>{isSubmitting ? 'Starting…' : 'Confirm & triage'} <ArrowRight /></>}
            </button>
          </div>
        </div>
      </>
    );
  };

  const renderConfirm = () => {
    if (!companyPreview) return null;
    const { importable, credits, creditsPerCompany, duplicateRows, alreadyImported, invalid } = companyPreview;
    const dup = duplicateRows + alreadyImported;
    const remaining = creditBalance != null ? creditBalance - credits : null;
    return (
      <>
        <button className="page-back" onClick={() => { setStage('map'); setErrorMessage(null); }}><ChevronLeft /> Back to columns</button>
        <div className="confirm glass">
          <div className="confirm-ic"><Coins /></div>
          <div className="confirm-title">Enrich {importable.toLocaleString()} {importable === 1 ? 'company' : 'companies'}?</div>
          <p className="confirm-sub">
            No triage needed for a company-only list — we go straight to enrichment. Here&apos;s the cost before anything is charged.
          </p>

          <div className="confirm-rows">
            <div className="confirm-r"><span className="confirm-r-k"><Building2 /> Valid companies</span><span className="confirm-r-v">{importable.toLocaleString()}</span></div>
            <div className="confirm-r"><span className="confirm-r-k"><Coins /> Credits per company</span><span className="confirm-r-v">{creditsPerCompany.toLocaleString()}</span></div>
            {dup > 0 && (
              <div className="confirm-r is-skip"><span className="confirm-r-k">Duplicates · not charged</span><span className="confirm-r-v">{dup.toLocaleString()}</span></div>
            )}
            {invalid > 0 && (
              <div className="confirm-r is-skip"><span className="confirm-r-k">Incomplete rows · not charged</span><span className="confirm-r-v">{invalid.toLocaleString()}</span></div>
            )}
            <div className="confirm-r is-total"><span className="confirm-r-k">Total</span><span className="confirm-r-v">{credits.toLocaleString()} credits</span></div>
          </div>

          <p className="confirm-note">
            <ShieldCheck />
            {creditBalance != null ? (
              <span>You have <strong>{creditBalance.toLocaleString()} credits</strong> · this leaves {remaining!.toLocaleString()}.</span>
            ) : (
              <span>Credits are only spent as each company enriches.</span>
            )}
          </p>

          {remaining != null && remaining < 0 && (
            <p className="panel-warn" style={{ marginTop: -6, marginBottom: 14 }}>
              This is more than your remaining balance — you can still proceed, then top up.
            </p>
          )}

          {errorMessage && <p className="imp-error" style={{ marginBottom: 14 }}>{errorMessage}</p>}

          <div className="confirm-foot">
            <button className="btn btn-accent btn-lg" disabled={isSubmitting} onClick={() => void handleEnrichCompanies()}>
              <Sparkles /> {isSubmitting ? 'Starting…' : `Enrich ${importable.toLocaleString()} ${importable === 1 ? 'company' : 'companies'} · ${credits.toLocaleString()} credits`}
            </button>
            <button className="btn btn-ghost" onClick={() => { setStage('map'); setErrorMessage(null); }}>Cancel</button>
          </div>
        </div>
      </>
    );
  };

  const renderProgress = () => (
    <>
      <div className="page-head" style={{ paddingTop: 22 }}>
        <p className="page-eyebrow"><Upload /> Import</p>
        <h1 className="page-title" style={{ fontSize: 32 }}>
          {isCompaniesBatch ? 'Enriching your companies' : 'Enriching your contacts'}
        </h1>
        <p className="page-sub">This takes a few minutes — you don&apos;t need to stay on this page.</p>
      </div>

      {errorMessage && <p className="imp-error">{errorMessage}</p>}

      <div className="prog glass">
        <div className="prog-head">
          <div>
            <div className="prog-title"><span className="prog-pulse" /> {isCompaniesBatch ? 'Enriching your companies' : 'Enriching your contacts'}</div>
            <div className="prog-sub">Arcova is working through your records.</div>
          </div>
          <button type="button" className="btn btn-quiet" style={{ padding: '7px 13px', fontSize: 12.5 }} disabled={isCancelling} onClick={handleCancelImport}>
            {isCancelling ? 'Stopping…' : 'Cancel'}
          </button>
        </div>
        <div className="prog-bar"><div className="prog-fill" style={{ width: `${progressPercent}%` }} /></div>
        <div className="prog-meta">
          <span>{Math.round(progressPercent)}% complete</span>
          <span className="mono">{processedCount.toLocaleString()} of {totalCount.toLocaleString()}</span>
        </div>
        <div className="prog-pills">
          <span className="pill is-good is-static"><b>{(progress?.enriched ?? 0).toLocaleString()}</b> enriched</span>
          <span className="pill is-static"><b>{(progress?.enriching ?? 0).toLocaleString()}</b> in queue</span>
          <span className="pill is-static"><b>{((progress?.duplicates ?? 0) + (progress?.notEnriched ?? 0)).toLocaleString()}</b> skipped</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <button type="button" className="recents-link" onClick={resetToLanding}>Start new import</button>
        <Link href={ROUTES.today} onClick={() => persistBatchId(null)} style={{ fontSize: 12.5, color: 'var(--ink-mute)', textDecoration: 'none' }}>
          I&apos;ll check back later
        </Link>
      </div>
    </>
  );

  const renderResult = () => {
    const enrichedCount = progress?.enriched ?? 0;
    const skippedCount = (progress?.duplicates ?? 0) + (progress?.notEnriched ?? 0);
    return (
      <>
        <button className="page-back" onClick={resetToLanding}><ChevronLeft /> New import</button>

        <div className="page-head" style={{ paddingTop: 4, maxWidth: 680 }}>
          <div className="result-hero">
            <div className={`result-check${isCompaniesBatch ? ' is-pending' : ''}`}>
              {isCompaniesBatch ? <RotateCw /> : <Check />}
            </div>
            <div>
              <p className="page-eyebrow" style={{ margin: '2px 0 8px' }}>
                <Upload /> {importCancelled ? 'Import stopped' : isCompaniesBatch ? 'Enrichment started' : 'Sent to triage'}
              </p>
              <h1 className="page-title" style={{ fontSize: 30 }}>
                {importCancelled
                  ? 'Import stopped'
                  : isCompaniesBatch
                    ? `${enrichedCount.toLocaleString()} companies enriching`
                    : `${totalCount.toLocaleString()} ${totalCount === 1 ? 'contact' : 'contacts'} sent to triage`}
              </h1>
              <p className="page-sub" style={{ marginTop: 10 }}>
                {isCompaniesBatch ? (
                  <>They&apos;re on your <strong>Companies</strong> page now, enriching in the background. We&apos;ll fill in firmographics and ICP fit as each one completes — no need to wait here.</>
                ) : (
                  <>Everything gets triaged — your contacts are on the <strong>Triage</strong> page, ready to be scored against your ICP. Review them there and pick who to bring into Leads. Nothing&apos;s auto-selected.</>
                )}
              </p>
              {!importCancelled && (isCompaniesBatch ? (
                skippedCount > 0 && <span className="result-incl is-amber"><Coins /> {skippedCount.toLocaleString()} rows skipped · not charged</span>
              ) : (
                <span className="result-incl"><Check /> Triage is included — no credits spent</span>
              ))}
            </div>
          </div>
        </div>

        {batchMode === 'contacts' && contactTriageReviewCount > 0 && (
          <div className="flow glass" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <div className="flow-title">Ready to review in triage</div>
              <div className="flow-step-d" style={{ marginTop: 4 }}>
                {contactTriageReviewCount.toLocaleString()} {contactTriageReviewCount === 1 ? 'record is' : 'records are'} prioritized against your ICP. Review or adjust fit before choosing who to bring into Leads.
              </div>
            </div>
            <Link href={ROUTES.triage} className="btn btn-accent" style={{ flexShrink: 0 }}>Review triaged leads</Link>
          </div>
        )}

        {awaitingTriageRows.length > 0 && (
          <div>
            <button
              type="button"
              className="btn"
              disabled={billingActionBusy}
              onClick={() => void runImportBillingAction(
                '/api/import-contacts/triage',
                awaitingTriageRows.map((row) => row.id),
                `Triage ${awaitingTriageRows.length} additional records`,
              )}
            >
              Triage {awaitingTriageRows.length.toLocaleString()} more
            </button>
          </div>
        )}

        {/* Summary pills */}
        <div className="pills">
          {([
            { label: 'enriched', value: progress?.enriched ?? 0, section: 'enriched' as const, cls: 'is-good' },
            { label: 'uploaded', value: progress?.total ?? 0, section: 'uploaded' as const, cls: '' },
            { label: 'duplicates', value: progress?.duplicates ?? 0, section: 'duplicate' as const, cls: '' },
            { label: 'not enriched', value: progress?.notEnriched ?? 0, section: 'failed' as const, cls: (progress?.notEnriched ?? 0) > 0 ? 'is-warn' : '' },
          ]).map(({ label, value, section, cls }) => (
            <button
              key={label}
              type="button"
              className={`pill ${cls} ${expandedBatchSection === section ? 'is-on' : ''}`}
              onClick={() => setExpandedBatchSection((prev) => (prev === section ? null : section))}
            >
              <b>{value.toLocaleString()}</b> {label}
            </button>
          ))}
        </div>

        {/* Expanded list */}
        {(expandedBatchSection || batchDetailsError) && (
          <div className="list">
            <div className="list-head">
              <div className="list-head-t">{expandedBatchTitle}</div>
              <button type="button" className="list-head-x" onClick={() => setExpandedBatchSection(null)}>Close</button>
            </div>
            {isLoadingBatchDetails ? (
              <div className="list-note" style={{ justifyContent: 'center' }}>Loading…</div>
            ) : batchDetailsError ? (
              <div className="list-note" style={{ justifyContent: 'center', color: '#9a4453' }}>{batchDetailsError}</div>
            ) : visibleBatchRows.length === 0 ? (
              <div className="list-note" style={{ justifyContent: 'center' }}>
                No {isCompaniesBatch ? 'companies' : 'contacts'} to show.
              </div>
            ) : (
              visibleBatchRows.map((row) => {
                const showReason = !!row.failure_reason && (expandedBatchSection === 'failed' || expandedBatchSection === 'duplicate');
                const name = isCompaniesBatch
                  ? row.company_name || row.company_domain || 'Unknown company'
                  : row.full_name || 'Unknown contact';
                const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '—';
                return (
                  <div key={row.id} className="row">
                    <div className="row-av" style={{ background: '#4a6470' }}>{initials}</div>
                    <div>
                      <div className="row-name">{name}</div>
                      <div className="row-meta">
                        {row.company_name || row.company_domain || (isCompaniesBatch ? '' : 'Unknown company')}
                        {row.job_title ? ` · ${row.job_title}` : ''}
                        {showReason && row.failure_reason ? ` · ${row.failure_reason}` : ''}
                      </div>
                    </div>
                    <div className="row-right">{isCompaniesBatch ? 'Company' : row.email || 'No email'}</div>
                  </div>
                );
              })
            )}
            {expandedBatchSection === 'duplicate' && (
              <div className="list-note"><Info /> Duplicates and incomplete rows are skipped automatically — you&apos;re never charged for them.</div>
            )}
            {!isCompaniesBatch && expandedBatchSection === 'enriched' && (
              <div className="list-note"><Info /> Every contact is triaged on the Triage page — selection happens there, not here.</div>
            )}
          </div>
        )}

        {/* CTA */}
        <div className="result-cta">
          <Link
            href={isCompaniesBatch ? ROUTES.companies : contactTriageReviewCount > 0 ? ROUTES.triage : ROUTES.contacts}
            className="btn btn-accent btn-lg"
          >
            {isCompaniesBatch ? <>View companies <ArrowRight /></> : contactTriageReviewCount > 0 ? <>Review triaged leads <ArrowRight /></> : <>View Leads <ArrowRight /></>}
          </Link>
          {!isCompaniesBatch && contactTriageReviewCount === 0 && (
            <span className="result-more">Contacts land in <Link href={ROUTES.contacts}>Leads</Link> as they enrich.</span>
          )}
          {isCompaniesBatch && (
            <span className="result-more">Contacts at these accounts land in <Link href={ROUTES.contacts}>Leads</Link> as they enrich.</span>
          )}
        </div>
      </>
    );
  };

  let content: ReactNode;
  if (currentBatchId) {
    content = importFinished ? renderResult() : renderProgress();
  } else if (stage === 'reading' && parsedCsv) {
    content = (
      <ReadingStage
        csv={parsedCsv}
        mode={detectedMode}
        onDone={() => setStage('map')}
      />
    );
  } else if (stage === 'confirm') {
    content = renderConfirm();
  } else if (stage === 'map' && parsedCsv) {
    content = renderMap();
  } else {
    content = renderLanding();
  }

  return (
    <div className="flex h-screen bg-transparent">
      <AppSidebar />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <div className="bg-transparent flex-1 overflow-auto px-6 py-8 lg:px-10">
          {/* Hidden file input shared by the CSV dropzone + browse */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFileInputChange}
          />
          <div className="imp-root stagger mx-auto w-full max-w-[1180px]" key={`${currentBatchId ?? 'new'}-${stage}-${importFinished ? 'done' : 'live'}`}>
            {content}
          </div>
        </div>

        <AgentPanel page="imports" pendingMessage={agentOpener} suppressPrompts />
      </div>
    </div>
  );
}
