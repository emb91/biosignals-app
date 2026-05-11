'use client';

import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCw, Unlink, ChevronDown, Trash2, Upload } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import AppSidebar from '@/components/AppSidebar';
import { AgentPanel, type AgentPendingMessage } from '@/components/AgentPanel';
import Nango from '@nangohq/frontend';
import { ROUTES } from '@/lib/routes';
import { getDisplayName } from '@/lib/auth-helpers';

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
};

type ImportBatchDetails = {
  failedRows: ImportBatchRow[];
  duplicateRows: ImportBatchRow[];
  enrichedRows: ImportBatchRow[];
  allRows: ImportBatchRow[];
};

const BATCH_ID_STORAGE_KEY = 'arcova_current_batch_id';
const HIDDEN_IMPORTS_STORAGE_KEY = 'arcova_hidden_import_batch_ids';
/** When set, the HubSpot sync summary row is hidden from Past imports (local only). */
const HIDE_HUBSPOT_SYNC_ROW_STORAGE_KEY = 'arcova_hide_hubspot_sync_row';
/** Expanded row id for HubSpot sync in Past imports. */
const HUBSPOT_SYNC_HISTORY_ROW_ID = '__hubspot_sync__';
const CSV_PREVIEW_ROW_COUNT = 3;

const formatBatchDate = (iso: string) => {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatActivityTime = (iso: string) => {
  const date = new Date(iso);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

/** Grid: Source | Details | Date | Time | Status | Actions */
const IMPORT_HISTORY_TABLE_GRID =
  'grid grid-cols-[4.75rem_minmax(0,1fr)_6.75rem_4.75rem_5.5rem_4.75rem] gap-x-3 items-center';

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
  { value: 'ignore', label: "Don't import this column" },
];

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


export default function ImportPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [parsedCsv, setParsedCsv] = useState<ParsedCsv | null>(null);
  const [columnMappings, setColumnMappings] = useState<Record<string, ImportField>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentBatchId, setCurrentBatchId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [hiddenBatchIds, setHiddenBatchIds] = useState<string[]>([]);
  const [tableScrolledToEnd, setTableScrolledToEnd] = useState(false);
  const [importHistory, setImportHistory] = useState<ImportBatch[]>([]);
  const [importHistoryLoaded, setImportHistoryLoaded] = useState(false);
  const [batchDetails, setBatchDetails] = useState<ImportBatchDetails | null>(null);
  const [batchDetailsError, setBatchDetailsError] = useState<string | null>(null);
  const [isLoadingBatchDetails, setIsLoadingBatchDetails] = useState(false);
  const [expandedBatchSection, setExpandedBatchSection] = useState<'failed' | 'duplicate' | 'enriched' | 'uploaded' | null>(null);
  const [hubspotConnected, setHubspotConnected] = useState(false);
  const [hubspotDomain, setHubspotDomain] = useState<string | null>(null);
  const [hubspotSyncLog, setHubspotSyncLog] = useState<HubspotSyncLog | null>(null);
  const [hubspotSyncing, setHubspotSyncing] = useState(false);
  const [hubspotDisconnecting, setHubspotDisconnecting] = useState(false);
  const [pastImportsExpanded, setPastImportsExpanded] = useState(false);
  const [expandedHistoryBatchId, setExpandedHistoryBatchId] = useState<string | null>(null);
  const [agentOpener, setAgentOpener] = useState<AgentPendingMessage | undefined>();
  const [hubspotHistoryRowHidden, setHubspotHistoryRowHidden] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(HIDE_HUBSPOT_SYNC_ROW_STORAGE_KEY) === '1';
  });

  const persistBatchId = (id: string | null) => {
    setCurrentBatchId(id);
    if (id) {
      localStorage.setItem(BATCH_ID_STORAGE_KEY, id);
    } else {
      localStorage.removeItem(BATCH_ID_STORAGE_KEY);
    }
  };

  const resetBatchView = () => {
    persistBatchId(null);
    setProgress(null);
    setBatchDetails(null);
    setBatchDetailsError(null);
    setExpandedBatchSection(null);
  };

  const handleTableScroll = () => {
    const el = tableScrollRef.current;
    if (!el) return;
    setTableScrolledToEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 8);
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

  // On mount: restore any in-progress/completed batch and load history
  useEffect(() => {
    if (!user) return;
    const savedBatchId = localStorage.getItem(BATCH_ID_STORAGE_KEY);
    const savedHiddenBatchIds = localStorage.getItem(HIDDEN_IMPORTS_STORAGE_KEY);
    if (savedBatchId) {
      setCurrentBatchId(savedBatchId);
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
          : `The user has just finished setup and landed on Import. Open with "Hey ${firstName}" or similar, congratulate them on finishing setup, then explain the next step: bring in contacts so Arcova can enrich and score them. Tell them to use HubSpot Sync if their contacts live in HubSpot, or upload a CSV if they have a file.`;

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
        // The in-session state still holds so "Import complete" renders for the current visit.
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

    // Get a short-lived session token from our backend
    const sessionRes = await fetch('/api/nango/session', { method: 'POST' });
    if (!sessionRes.ok) return;
    const { sessionToken } = await sessionRes.json();

    const nangoClient = new Nango();
    const connectUI = nangoClient.openConnectUI({
      onEvent: async (event) => {
        if (event.type === 'connect') {
          const { connectionId, providerConfigKey } = event.payload;
          // Persist the Nango connectionId to our DB
          await fetch('/api/nango/connection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ integrationId: providerConfigKey, connectionId }),
          });
          setHubspotConnected(true);
          void fetchHubspotStatus();
          void fetchHubspotSyncLog();
        }
      },
    });
    connectUI.setSessionToken(sessionToken);
  };

  const handleHubspotSync = async () => {
    setHubspotSyncing(true);
    try {
      const res = await fetch('/api/hubspot/sync', { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? 'Sync failed');
      persistBatchId(result.batchId);
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
      localStorage.removeItem(HIDE_HUBSPOT_SYNC_ROW_STORAGE_KEY);
      setHubspotHistoryRowHidden(false);
    } finally {
      setHubspotDisconnecting(false);
    }
  };

  const initializeMappings = (headers: string[]) => {
    const nextMappings: Record<string, ImportField> = {};
    headers.forEach((header) => {
      nextMappings[header] = inferFieldFromHeader(header);
    });
    setColumnMappings(nextMappings);
  };

  const handleParsedFile = (file: File, text: string) => {
    const { headers, rows } = parseCsvText(text);

    if (headers.length === 0) {
      setErrorMessage('Could not read CSV headers. Please upload a valid CSV file.');
      setParsedCsv(null);
      setColumnMappings({});
      return;
    }

    setParsedCsv({
      fileName: file.name,
      headers,
      rows,
    });
    initializeMappings(headers);
    setErrorMessage(null);
    setBatchDetails(null);
    setBatchDetailsError(null);
    setExpandedBatchSection(null);
    setCurrentBatchId(null);
    setProgress(null);
  };

  const processFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setErrorMessage('Only .csv files are supported.');
      return;
    }

    const text = await file.text();
    handleParsedFile(file, text);
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
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
    const hasPersonIdentifier =
      (mappedTargets.includes('first_name') && mappedTargets.includes('last_name')) ||
      mappedTargets.includes('full_name') ||
      mappedTargets.includes('linkedin_url');
    const hasCompanyIdentifier =
      mappedTargets.includes('company_name') ||
      mappedTargets.includes('company_domain') ||
      mappedTargets.includes('email_address') ||
      mappedTargets.includes('linkedin_url');

    return hasPersonIdentifier && hasCompanyIdentifier;
  }, [columnMappings]);

  const rawPreviewRows = useMemo(() => {
    if (!parsedCsv) return [];
    return parsedCsv.rows.slice(0, CSV_PREVIEW_ROW_COUNT);
  }, [parsedCsv]);

  const handleConfirmImport = async () => {
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

      persistBatchId(result.batchId);
      setParsedCsv(null);
      setColumnMappings({});
      setBatchDetails(null);
      setBatchDetailsError(null);
      setExpandedBatchSection(null);
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

  const handleHideImport = (batchId: string) => {
    const nextHiddenBatchIds = Array.from(new Set([...hiddenBatchIds, batchId]));
    setHiddenBatchIds(nextHiddenBatchIds);
    localStorage.setItem(HIDDEN_IMPORTS_STORAGE_KEY, JSON.stringify(nextHiddenBatchIds));

    setImportHistory((prev) => prev.filter((batch) => batch.id !== batchId));

    if (currentBatchId === batchId) {
      resetBatchView();
    }
  };

  const handleHideHubspotHistoryRow = () => {
    localStorage.setItem(HIDE_HUBSPOT_SYNC_ROW_STORAGE_KEY, '1');
    setHubspotHistoryRowHidden(true);
    setExpandedHistoryBatchId((id) => (id === HUBSPOT_SYNC_HISTORY_ROW_ID ? null : id));
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
  const processedCount = progress?.processed || 0;
  const totalCount = progress?.total || 0;
  const progressPercent = totalCount > 0 ? Math.min((processedCount / totalCount) * 100, 100) : 0;
  const visibleBatchRows =
    expandedBatchSection === 'failed' ? batchDetails?.failedRows || []
    : expandedBatchSection === 'duplicate' ? batchDetails?.duplicateRows || []
    : expandedBatchSection === 'enriched' ? batchDetails?.enrichedRows || []
    : expandedBatchSection === 'uploaded' ? batchDetails?.allRows || []
    : [];
  const expandedBatchTitle =
    expandedBatchSection === 'failed' ? 'Not enriched'
    : expandedBatchSection === 'duplicate' ? 'Duplicates'
    : expandedBatchSection === 'enriched' ? 'Enriched contacts'
    : expandedBatchSection === 'uploaded' ? 'All uploaded contacts'
    : '';

  const HubSpotLogo = () => (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <path d="M18.164 7.932V5.085a2.198 2.198 0 0 0 1.268-1.978V3.06A2.199 2.199 0 0 0 17.235.862h-.047a2.199 2.199 0 0 0-2.197 2.197v.047a2.199 2.199 0 0 0 1.268 1.978v2.847a6.232 6.232 0 0 0-2.962 1.302L5.028 3.617a2.44 2.44 0 0 0 .072-.573A2.455 2.455 0 1 0 2.645 5.5a2.43 2.43 0 0 0 1.194-.315l8.122 4.707a6.248 6.248 0 0 0 0 4.208L4.123 18.5a2.432 2.432 0 0 0-1.478-.498 2.455 2.455 0 1 0 2.455 2.455 2.43 2.43 0 0 0-.388-1.337l7.91-4.583a6.266 6.266 0 0 0 8.976-5.628 6.25 6.25 0 0 0-3.434-5.977zm-1.023 9.565a3.59 3.59 0 1 1 0-7.181 3.59 3.59 0 0 1 0 7.181z"/>
    </svg>
  );

  return (
    <div className="flex h-screen bg-transparent">
      <AppSidebar />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden min-[1280px]:flex-row">
        <div className="arcova-scroll-surface flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-10">

          {!currentBatchId ? (
            <>
              <div className="mb-8">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-arcova-teal">
                  <Upload className="h-3.5 w-3.5" />
                  Import
                </div>
                <h1 className="mt-2 text-2xl font-semibold leading-tight text-slate-950 sm:text-3xl">Import contacts</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                  Connect your CRM or upload a CSV — Arcova will enrich, score against your ICP, and tell you who to prioritise.
                </p>
              </div>

              {/* Import methods */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                {/* HubSpot */}
                <div className={`rounded-xl border-2 p-5 flex flex-col gap-4 transition-colors ${hubspotConnected ? 'border-[#ff7a59]/40 bg-[#fff5f2]' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#ff7a59] text-white">
                        <HubSpotLogo />
                      </div>
                      <span className="text-sm font-semibold text-gray-900">HubSpot</span>
                    </div>
                    {hubspotConnected ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        Connected
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">CRM sync</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    {hubspotConnected
                      ? hubspotDomain
                        ? `Synced with ${hubspotDomain}. Pull contacts in and push enrichment data back.`
                        : 'Pull contacts in and push enrichment data back to HubSpot.'
                      : 'Connect your HubSpot account to pull contacts directly into Arcova.'}
                  </p>
                  <div className="flex gap-2 mt-auto">
                    {hubspotConnected ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleHubspotSync()}
                          disabled={hubspotSyncing}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#ff7a59] px-3 py-2 text-xs font-semibold text-white hover:bg-[#e8693f] disabled:opacity-50 transition-colors"
                        >
                          <RotateCw className={`w-3 h-3 ${hubspotSyncing ? 'animate-spin' : ''}`} />
                          {hubspotSyncing ? 'Syncing…' : 'Sync contacts'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleHubspotDisconnect()}
                          disabled={hubspotDisconnecting}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700 disabled:opacity-50 transition-colors"
                        >
                          <Unlink className="w-3 h-3" />
                          {hubspotDisconnecting ? '…' : 'Disconnect'}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleConnectHubSpot()}
                        className="flex-1 rounded-lg bg-[#ff7a59] px-3 py-2 text-xs font-semibold text-white hover:bg-[#e8693f] transition-colors text-center"
                      >
                        Connect HubSpot
                      </button>
                    )}
                  </div>
                </div>

                {/* CSV upload */}
                <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white hover:border-arcova-teal/50 transition-colors flex flex-col">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={handleFileInputChange}
                  />
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={handleBrowseClick}
                    className={`flex-1 flex flex-col items-center justify-center gap-3 p-6 cursor-pointer rounded-xl transition-colors ${isDragOver ? 'bg-arcova-teal/5' : ''}`}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100">
                      <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-gray-700">
                        {isDragOver ? 'Drop to upload' : 'Upload a CSV'}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">Drag and drop or click to browse</p>
                    </div>
                  </div>
                </div>
              </div>

              {errorMessage && (
                <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{errorMessage}</p>
              )}

              {/* Column mapping */}
              {parsedCsv && (
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-base font-semibold text-gray-900">Map your columns</h2>
                    <span className="text-xs text-gray-400">{parsedCsv.fileName} · {parsedCsv.rows.length.toLocaleString()} rows</span>
                  </div>
                  <p className="text-xs text-gray-500 mb-4">
                    We&apos;ve made our best guess — check each column and correct anything that looks off.
                    {parsedCsv.headers.length > 4 && ' Scroll right to see all columns.'}
                  </p>

                  <div className="relative">
                    <div
                      ref={tableScrollRef}
                      onScroll={handleTableScroll}
                      className="overflow-x-auto rounded-lg border border-gray-100"
                    >
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50">
                            {parsedCsv.headers.map((header) => (
                              <th
                                key={header}
                                className="px-3 py-3 border-b border-gray-100 w-[160px] min-w-[160px] max-w-[160px] align-top text-left font-normal"
                              >
                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 truncate" title={header}>
                                  {header || '(Unnamed)'}
                                </div>
                                <select
                                  value={columnMappings[header] || 'ignore'}
                                  onChange={(event) =>
                                    setColumnMappings((prev) => ({
                                      ...prev,
                                      [header]: event.target.value as ImportField,
                                    }))
                                  }
                                  className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-arcova-teal/30"
                                >
                                  {IMPORT_FIELD_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 bg-white">
                          {rawPreviewRows.length === 0 ? (
                            <tr>
                              <td className="px-4 py-3 text-xs text-gray-400" colSpan={parsedCsv.headers.length}>
                                No preview rows available.
                              </td>
                            </tr>
                          ) : (
                            rawPreviewRows.map((row, index) => (
                              <tr key={`preview-${index}`} className="hover:bg-gray-50/50">
                                {parsedCsv.headers.map((header, columnIndex) => (
                                  <td key={`${header}-${index}`} className="px-3 py-2 align-top max-w-[160px]">
                                    <div className="truncate text-xs text-gray-600" title={row[columnIndex] || ''}>
                                      {row[columnIndex] || <span className="text-gray-300">—</span>}
                                    </div>
                                  </td>
                                ))}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                    {parsedCsv.rows.length > CSV_PREVIEW_ROW_COUNT && (
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-lg bg-gradient-to-t from-white to-transparent" />
                    )}
                    {!tableScrolledToEnd && (
                      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-white to-transparent rounded-r-lg" />
                    )}
                  </div>

                  {!canConfirmImport && (
                    <p className="mt-3 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      Map a person identifier (first + last name, full name, or LinkedIn URL) and a company identifier (company name, domain, email, or LinkedIn URL) to continue.
                    </p>
                  )}

                  <div className="mt-5 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => { setParsedCsv(null); setColumnMappings({}); }}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!canConfirmImport || isSubmitting}
                      onClick={handleConfirmImport}
                      className="px-5 py-2 rounded-lg text-white text-sm font-medium bg-arcova-teal hover:bg-arcova-teal/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {isSubmitting ? 'Starting…' : 'Confirm import'}
                    </button>
                  </div>
                </div>
              )}

              {/* Past imports: single table (HubSpot + CSV) */}
              {!parsedCsv && (importHistory.length > 0 || hubspotConnected) && (
                <div className="mt-8">
                  <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
                    <button
                      type="button"
                      onClick={() => setPastImportsExpanded((v) => !v)}
                      className="flex items-center justify-between w-full px-4 py-3.5 hover:bg-gray-50 transition-colors group border-b border-gray-100"
                    >
                      <span className="text-sm font-semibold text-gray-700 group-hover:text-gray-900 transition-colors">
                        Past imports
                        <span className="ml-2 text-xs font-normal text-gray-400">
                          (
                          {importHistory.length +
                            (hubspotConnected && !hubspotHistoryRowHidden ? 1 : 0)}
                          )
                        </span>
                      </span>
                      <ChevronDown className={`w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-all shrink-0 ${pastImportsExpanded ? 'rotate-180' : ''}`} />
                    </button>

                    {pastImportsExpanded && (
                      <div className="overflow-x-auto">
                        <div className="min-w-[44rem]">
                          <div
                            className={`${IMPORT_HISTORY_TABLE_GRID} border-b border-gray-100 bg-gray-50/90 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500`}
                          >
                            <span>Source</span>
                            <span>Details</span>
                            <span>Date</span>
                            <span>Time</span>
                            <span>Status</span>
                            <span className="text-right pr-0.5" aria-hidden>
                              {'\u00a0'}
                            </span>
                          </div>

                          {hubspotConnected && !hubspotHistoryRowHidden && (() => {
                            const skipped = hubspotSyncLog?.contacts_skipped ?? 0;
                            const errs = hubspotSyncLog?.contacts_errors ?? 0;
                            const syncedAt = hubspotSyncLog?.synced_at;
                            const isHubspotOpen = expandedHistoryBatchId === HUBSPOT_SYNC_HISTORY_ROW_ID;
                            const pull = hubspotSyncLog?.last_pull_batch;
                            const uploaded = pull?.total_rows ?? 0;
                            const duplicates = pull?.duplicate_rows ?? 0;
                            const notEnriched = pull?.failed_rows ?? 0;
                            const processed = pull?.processed_rows ?? 0;
                            const enriched = Math.max(0, processed - duplicates - notEnriched);
                            const pushed = hubspotSyncLog?.contacts_synced ?? 0;
                            const hubspotStatusPill =
                              !syncedAt ? (
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200/80">
                                  No run yet
                                </span>
                              ) : errs > 0 ? (
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                                  Sync issue
                                </span>
                              ) : (
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100">
                                  Complete
                                </span>
                              );
                            return (
                              <div key="hubspot-sync-row" className="border-b border-gray-100 last:border-0">
                                <div
                                  className={`${IMPORT_HISTORY_TABLE_GRID} px-4 py-3 bg-[#fff5f2]/30 hover:bg-[#fff5f2]/50 transition-colors cursor-pointer`}
                                  onClick={() =>
                                    setExpandedHistoryBatchId(isHubspotOpen ? null : HUBSPOT_SYNC_HISTORY_ROW_ID)
                                  }
                                >
                                  <div>
                                    <span className="inline-flex items-center rounded-md border border-[#ff7a59]/35 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#c2410c]">
                                      HubSpot
                                    </span>
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-gray-900 truncate">CRM sync</p>
                                  </div>
                                  <div className="text-xs text-gray-600 tabular-nums whitespace-nowrap">
                                    {syncedAt ? formatBatchDate(syncedAt) : '-'}
                                  </div>
                                  <div className="text-xs text-gray-600 tabular-nums whitespace-nowrap">
                                    {syncedAt ? formatActivityTime(syncedAt) : '-'}
                                  </div>
                                  <div className="justify-self-start">{hubspotStatusPill}</div>
                                  <div className="flex items-center justify-end gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleHideHubspotHistoryRow();
                                      }}
                                      className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 transition-colors"
                                      aria-label="Remove HubSpot sync row from list"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                    <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-arcova-teal/10 text-arcova-teal pointer-events-none">
                                      <ChevronDown
                                        className={`w-4 h-4 transition-transform ${isHubspotOpen ? 'rotate-180' : ''}`}
                                      />
                                    </div>
                                  </div>
                                </div>
                                {isHubspotOpen && (
                                  <div className="px-4 pb-3 pt-2 bg-gray-50/60 border-b border-gray-100 space-y-2 sm:pl-6">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {[
                                        {
                                          label: 'enriched',
                                          value: enriched,
                                          className: 'bg-arcova-teal/10 text-arcova-teal',
                                        },
                                        {
                                          label: 'uploaded',
                                          value: uploaded,
                                          className: 'bg-gray-100 text-gray-600',
                                        },
                                        {
                                          label: 'duplicates',
                                          value: duplicates,
                                          className: 'bg-gray-100 text-gray-500',
                                        },
                                        {
                                          label: 'not enriched',
                                          value: notEnriched,
                                          className: 'bg-gray-100 text-gray-500',
                                        },
                                        {
                                          label: 'pushed',
                                          value: pushed,
                                          className: 'bg-[#fff5f2] text-[#c2410c] border border-[#ff7a59]/25',
                                        },
                                      ].map(({ label, value, className: pillClass }) => (
                                        <span
                                          key={label}
                                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${pillClass}`}
                                        >
                                          <span className="font-semibold tabular-nums">{value.toLocaleString()}</span>{' '}
                                          {label}
                                        </span>
                                      ))}
                                    </div>
                                    {(skipped > 0 || errs > 0) && (
                                      <div className="text-xs text-gray-700 space-y-1.5 tabular-nums">
                                        {skipped > 0 && (
                                          <p className="text-gray-600">Skipped {skipped.toLocaleString()} on push</p>
                                        )}
                                        {errs > 0 && (
                                          <p className="text-amber-800">
                                            {errs.toLocaleString()} push error{errs !== 1 ? 's' : ''}
                                          </p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {importHistory.length === 0 &&
                            (!hubspotConnected || hubspotHistoryRowHidden) && (
                              <p className="px-4 py-6 text-xs text-gray-400 text-center">
                                No import batches in this list.
                              </p>
                            )}

                          {importHistory.map((batch) => {
                            const isOpen = expandedHistoryBatchId === batch.id;
                            const enriched = Math.max(
                              0,
                              (batch.processed_rows || 0) -
                                (batch.duplicate_rows || 0) -
                                (batch.failed_rows || 0),
                            );
                            const statusPill =
                              batch.status === 'complete' ? (
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100">
                                  Complete
                                </span>
                              ) : batch.status === 'cancelled' ? (
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200/80">
                                  Cancelled
                                </span>
                              ) : batch.status === 'failed' ? (
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100">
                                  Failed
                                </span>
                              ) : (
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100">
                                  Processing
                                </span>
                              );
                            return (
                              <div key={batch.id} className="border-b border-gray-100 last:border-0">
                                <div
                                  className={`${IMPORT_HISTORY_TABLE_GRID} px-4 py-3 hover:bg-gray-50/80 transition-colors cursor-pointer`}
                                  onClick={() => setExpandedHistoryBatchId(isOpen ? null : batch.id)}
                                >
                                  <div>
                                    <span className="inline-flex items-center rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                                      CSV
                                    </span>
                                  </div>
                                  <div className="min-w-0">
                                    <p
                                      className="text-sm font-medium text-gray-900 truncate pr-1"
                                      title={batch.filename}
                                    >
                                      {batch.filename}
                                    </p>
                                    <p className="text-xs text-gray-400 mt-0.5 tabular-nums">
                                      {(batch.total_rows || 0).toLocaleString()} rows
                                    </p>
                                  </div>
                                  <div className="text-xs text-gray-600 tabular-nums whitespace-nowrap">
                                    {formatBatchDate(batch.created_at)}
                                  </div>
                                  <div className="text-xs text-gray-600 tabular-nums whitespace-nowrap">
                                    {formatActivityTime(batch.created_at)}
                                  </div>
                                  <div className="justify-self-start">{statusPill}</div>
                                  <div className="flex items-center justify-end gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleHideImport(batch.id);
                                      }}
                                      className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 transition-colors"
                                      aria-label={`Remove ${batch.filename} from list`}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                    <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-arcova-teal/10 text-arcova-teal pointer-events-none">
                                      <ChevronDown
                                        className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                                      />
                                    </div>
                                  </div>
                                </div>
                                {isOpen && (
                                  <div className="px-4 pb-3 pt-2 bg-gray-50/60 flex items-center gap-2 flex-wrap border-b border-gray-100 sm:pl-6">
                                    {[
                                      {
                                        label: 'enriched',
                                        value: enriched,
                                        className: 'bg-arcova-teal/10 text-arcova-teal',
                                      },
                                      {
                                        label: 'uploaded',
                                        value: batch.total_rows || 0,
                                        className: 'bg-gray-100 text-gray-600',
                                      },
                                      {
                                        label: 'duplicates',
                                        value: batch.duplicate_rows || 0,
                                        className: 'bg-gray-100 text-gray-500',
                                      },
                                      {
                                        label: 'not enriched',
                                        value: batch.failed_rows || 0,
                                        className: 'bg-gray-100 text-gray-500',
                                      },
                                    ].map(({ label, value, className: pillClass }) => (
                                      <span
                                        key={label}
                                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${pillClass}`}
                                      >
                                        <span className="font-semibold tabular-nums">{value.toLocaleString()}</span>{' '}
                                        {label}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {importFinished ? (
                <>
                  <div className="mb-8 flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-arcova-teal">
                        <Upload className="h-3.5 w-3.5" />
                        Import
                      </div>
                      <h1 className="mt-2 text-2xl font-semibold leading-tight text-slate-950 sm:text-3xl">
                        {importCancelled ? 'Import stopped' : 'Import complete'}
                      </h1>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                        {importCancelled
                          ? 'Enriched, scored contacts were added to Leads before stopping.'
                          : 'All enriched, scored contacts have been added to your Leads view.'}
                      </p>
                    </div>
                    <button type="button" onClick={resetBatchView} className="text-xs text-gray-400 hover:text-gray-600 whitespace-nowrap mt-1">
                      ← Back
                    </button>
                  </div>

                  {/* Summary pills */}
                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    {[
                      { label: 'enriched', value: progress?.enriched ?? 0, section: 'enriched' as const, className: 'bg-arcova-teal/10 text-arcova-teal' },
                      { label: 'uploaded', value: progress?.total ?? 0, section: 'uploaded' as const, className: 'bg-gray-100 text-gray-600' },
                      { label: 'duplicates', value: progress?.duplicates ?? 0, section: 'duplicate' as const, className: 'bg-gray-100 text-gray-500' },
                      { label: 'not enriched', value: progress?.notEnriched ?? 0, section: 'failed' as const, className: 'bg-gray-100 text-gray-500' },
                    ].map(({ label, value, section, className }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setExpandedBatchSection((prev) => (prev === section ? null : section))}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-opacity hover:opacity-70 ${className} ${expandedBatchSection === section ? 'ring-1 ring-current ring-offset-1' : ''}`}
                      >
                        <span className="font-semibold">{value.toLocaleString()}</span> {label}
                      </button>
                    ))}
                  </div>

                  {/* Expanded contact list */}
                  {(expandedBatchSection || batchDetailsError) && (
                    <div className="mb-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                        <p className="text-sm font-medium text-gray-900">{expandedBatchTitle}</p>
                        <button type="button" onClick={() => setExpandedBatchSection(null)} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
                      </div>
                      {isLoadingBatchDetails ? (
                        <p className="px-4 py-6 text-sm text-gray-400 text-center">Loading…</p>
                      ) : batchDetailsError ? (
                        <p className="px-4 py-6 text-sm text-red-600 text-center">{batchDetailsError}</p>
                      ) : visibleBatchRows.length === 0 ? (
                        <p className="px-4 py-6 text-sm text-gray-400 text-center">No contacts to show.</p>
                      ) : (
                        <div className="divide-y divide-gray-100">
                          {visibleBatchRows.map((row) => (
                            <div key={row.id} className="flex items-start justify-between gap-4 px-4 py-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{row.full_name}</p>
                                <p className="text-xs text-gray-500 mt-0.5">{row.company_name || row.company_domain || 'Unknown company'}{row.job_title ? ` · ${row.job_title}` : ''}</p>
                              </div>
                              <p className="text-xs text-gray-400 shrink-0">{row.email || 'No email'}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}


                  {/* CTA */}
                  <div className="rounded-xl border border-gray-200 bg-white p-5">
                    <Link href={ROUTES.leads.contacts} className="inline-flex px-4 py-2 rounded-lg bg-arcova-teal text-white text-sm font-medium hover:bg-arcova-teal/90 transition-colors">
                      View Leads
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  {errorMessage && (
                    <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{errorMessage}</p>
                  )}

                  {/* Main progress card */}
                  <div className="rounded-xl border border-gray-200 bg-white overflow-hidden mb-4">
                    {/* Header */}
                    <div className="px-5 pt-5 pb-4 border-b border-gray-100">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-arcova-teal" />
                            <span className="text-sm font-semibold text-gray-900">Enriching your contacts</span>
                          </div>
                          <p className="text-xs text-gray-400">This takes a few minutes — you don&apos;t need to stay on this page.</p>
                        </div>
                        <button
                          type="button"
                          onClick={handleCancelImport}
                          disabled={isCancelling}
                          className="shrink-0 text-xs font-medium text-gray-400 border border-gray-200 rounded-lg px-3 py-1.5 hover:border-gray-300 hover:text-gray-600 disabled:opacity-50 transition-colors"
                        >
                          {isCancelling ? 'Stopping…' : 'Cancel'}
                        </button>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="px-5 py-4">
                      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-arcova-teal transition-all duration-500"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                        <span>{Math.round(progressPercent)}% complete</span>
                        <span>{processedCount.toLocaleString()} of {totalCount.toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Live stat pills */}
                    <div className="px-5 pb-5 flex items-center gap-2">
                      {[
                        { label: 'enriched', value: progress?.enriched ?? 0, className: 'bg-arcova-teal/10 text-arcova-teal' },
                        { label: 'in queue', value: progress?.enriching ?? 0, className: 'bg-gray-100 text-gray-500' },
                        { label: 'skipped', value: (progress?.duplicates ?? 0) + (progress?.notEnriched ?? 0), className: 'bg-gray-100 text-gray-400' },
                      ].map(({ label, value, className }) => (
                        <span key={label} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${className}`}>
                          <span className="font-semibold">{value.toLocaleString()}</span> {label}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-5">
                    <button
                      type="button"
                      onClick={() => { persistBatchId(null); setProgress(null); }}
                      className="text-xs text-arcova-teal hover:opacity-70"
                    >
                      Start new import
                    </button>
                    <Link href={ROUTES.today} onClick={() => persistBatchId(null)} className="text-xs text-gray-400 hover:text-gray-600">
                      I&apos;ll check back later
                    </Link>
                  </div>
                </>
              )}
            </>
          )}
        </div>
        </div>

        <AgentPanel
          page="imports"
          pendingMessage={agentOpener}
          suppressPrompts
        />
      </div>
    </div>
  );
}
