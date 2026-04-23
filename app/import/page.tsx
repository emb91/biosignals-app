'use client';

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import AppSidebar from '@/components/AppSidebar';

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
  highFitLeads: number;
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
};

const BATCH_ID_STORAGE_KEY = 'arcova_current_batch_id';
const HIDDEN_IMPORTS_STORAGE_KEY = 'arcova_hidden_import_batch_ids';
const CSV_PREVIEW_ROW_COUNT = 3;

const formatBatchDate = (iso: string) => {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const HIGH_FIT_TARGET = 200;

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
  const [batchDetails, setBatchDetails] = useState<ImportBatchDetails | null>(null);
  const [batchDetailsError, setBatchDetailsError] = useState<string | null>(null);
  const [isLoadingBatchDetails, setIsLoadingBatchDetails] = useState(false);
  const [expandedBatchSection, setExpandedBatchSection] = useState<'failed' | 'duplicate' | null>(null);

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
    }
  };

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
    fetchImportHistory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, hiddenBatchIds.join('|')]);

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
        highFitLeads: result.high_fit_leads || 0,
        batchStatus,
      });
      if (batchStatus === 'complete') {
        fetchImportHistory();
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

    const fetchBatchDetails = async () => {
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
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load import details.';
        setBatchDetailsError(message);
      } finally {
        setIsLoadingBatchDetails(false);
      }
    };

    void fetchBatchDetails();
  }, [currentBatchId]);

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
    const hasCompany = mappedTargets.includes('company_name');
    const hasAnyNameField =
      mappedTargets.includes('first_name') ||
      mappedTargets.includes('last_name') ||
      mappedTargets.includes('full_name');

    return hasCompany && hasAnyNameField;
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
        highFitLeads: 0,
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
          highFitLeads: prev?.highFitLeads || 0,
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
  const enoughHighFitLeads = (progress?.highFitLeads || 0) >= HIGH_FIT_TARGET;
  const processedCount = progress?.processed || 0;
  const totalCount = progress?.total || 0;
  const progressPercent = totalCount > 0 ? Math.min((processedCount / totalCount) * 100, 100) : 0;
  const visibleBatchRows =
    expandedBatchSection === 'failed'
      ? batchDetails?.failedRows || []
      : expandedBatchSection === 'duplicate'
      ? batchDetails?.duplicateRows || []
      : [];
  const expandedBatchTitle =
    expandedBatchSection === 'failed'
      ? 'Not enriched contacts'
      : expandedBatchSection === 'duplicate'
      ? 'Already in Arcova'
      : '';

  return (
    <div className="flex h-screen bg-gray-50">
      <AppSidebar />

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto bg-white rounded-lg shadow-sm border border-gray-200 p-8">
          {!currentBatchId ? (
            <>
              <h1 className="text-3xl font-bold text-gray-900">Import your existing contacts</h1>
              <p className="text-gray-600 mt-2">
                Upload your existing CRM contacts and we&apos;ll enrich them, score them against your ICP, and tell
                you who to prioritise this week.
              </p>

              <div className="mt-10">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Upload CSV</h2>

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
                  className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
                    isDragOver ? 'border-arcova-teal bg-arcova-teal/5' : 'border-gray-300 hover:border-arcova-teal/60'
                  }`}
                >
                  <p className="text-sm font-medium text-gray-900">Drag and drop your CSV here</p>
                  <p className="text-sm text-gray-500 mt-1">or click to browse</p>
                  <p className="text-xs text-gray-400 mt-3">Accepts .csv files only</p>
                </div>

                {errorMessage && <p className="mt-3 text-sm text-red-600">{errorMessage}</p>}

                {parsedCsv && (
                  <p className="mt-4 text-sm text-gray-600">
                    <span className="font-medium text-gray-900">{parsedCsv.fileName}</span> - {parsedCsv.rows.length}{' '}
                    rows
                  </p>
                )}
              </div>

              {parsedCsv && (
                <>
                  <div className="mt-10">
                    <h2 className="text-lg font-semibold text-gray-900 mb-2">Map your columns</h2>
                    <p className="text-sm text-gray-600 mb-3">
                      We&apos;ve made our best guess below — check each one and correct anything that looks off.
                      Columns set to &ldquo;Don&apos;t import&rdquo; will be ignored.
                    </p>
                    <p className="text-xs text-gray-400 mb-3">
                      Previewing the first {Math.min(parsedCsv.rows.length, CSV_PREVIEW_ROW_COUNT)} of {parsedCsv.rows.length}{' '}
                      rows.
                    </p>

                    {parsedCsv.headers.length > 4 && (
                      <p className="text-xs text-gray-400 mb-2">
                        {parsedCsv.headers.length} columns detected — scroll right to map all →
                      </p>
                    )}

                    <div className="relative">
                      <div
                        ref={tableScrollRef}
                        onScroll={handleTableScroll}
                        className="overflow-x-auto rounded-lg border border-gray-200"
                      >
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="bg-white">
                            {parsedCsv.headers.map((header) => (
                              <th
                                key={header}
                                className="px-3 py-4 border-b-2 border-gray-100 w-[170px] min-w-[170px] max-w-[170px] align-top text-left font-normal"
                              >
                                <div className="text-sm font-medium text-gray-900 mb-2.5 truncate" title={header}>
                                  {header || '(Unnamed column)'}
                                </div>
                                <select
                                  value={columnMappings[header] || 'ignore'}
                                  onChange={(event) =>
                                    setColumnMappings((prev) => ({
                                      ...prev,
                                      [header]: event.target.value as ImportField,
                                    }))
                                  }
                                  className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-arcova-teal"
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
                        <tbody className="divide-y divide-gray-100 bg-gray-50/50">
                          {rawPreviewRows.length === 0 ? (
                            <tr>
                              <td className="px-4 py-3 text-gray-500" colSpan={parsedCsv.headers.length}>
                                No preview rows available.
                              </td>
                            </tr>
                          ) : (
                            rawPreviewRows.map((row, index) => (
                              <tr key={`preview-${index}`}>
                                {parsedCsv.headers.map((header, columnIndex) => (
                                  <td key={`${header}-${index}`} className="px-3 py-2.5 text-gray-600 align-top max-w-[170px]">
                                    <div className="truncate text-xs" title={row[columnIndex] || ''}>
                                      {row[columnIndex] || <span className="text-gray-400">—</span>}
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
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 rounded-b-lg bg-gradient-to-t from-white via-white/85 to-transparent" />
                      )}
                      {!tableScrolledToEnd && (
                        <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-white to-transparent rounded-r-lg" />
                      )}
                    </div>

                    <div className="mt-8 flex justify-end">
                      <button
                        type="button"
                        disabled={!canConfirmImport || isSubmitting}
                        onClick={handleConfirmImport}
                        className="px-5 py-2.5 rounded-lg text-white text-sm font-medium bg-arcova-teal hover:bg-arcova-teal/90 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSubmitting ? 'Starting import...' : 'Confirm import'}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* Past imports — shown when no CSV is loaded yet */}
              {!parsedCsv && importHistory.length > 0 && (
                <div className="mt-12">
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Past imports</h2>
                  <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 overflow-hidden">
                    {importHistory.map((batch) => (
                      <div key={batch.id} className="flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 transition-colors">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate max-w-xs" title={batch.filename}>
                              {batch.filename}
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {formatBatchDate(batch.created_at)} · {(batch.total_rows || 0).toLocaleString()} rows
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 shrink-0 ml-4">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            batch.status === 'complete'
                              ? 'bg-green-50 text-green-700'
                              : batch.status === 'cancelled'
                              ? 'bg-gray-100 text-gray-700'
                              : batch.status === 'failed'
                              ? 'bg-red-50 text-red-600'
                              : 'bg-amber-50 text-amber-600'
                          }`}>
                            {batch.status === 'complete'
                              ? 'Complete'
                              : batch.status === 'cancelled'
                              ? 'Cancelled'
                              : batch.status === 'failed'
                              ? 'Failed'
                              : 'Processing'}
                          </span>
                          {batch.status === 'complete' && (
                            <button
                              type="button"
                              onClick={() => {
                                persistBatchId(batch.id);
                                setProgress(null);
                                setExpandedBatchSection(null);
                              }}
                              className="text-sm text-arcova-teal hover:underline whitespace-nowrap"
                            >
                              View results →
                            </button>
                          )}
                          {batch.status !== 'complete' && (
                            <button
                              type="button"
                              onClick={() => {
                                persistBatchId(batch.id);
                                setProgress(null);
                                setExpandedBatchSection(null);
                              }}
                              className="text-sm text-arcova-teal hover:underline whitespace-nowrap"
                            >
                              {batch.status === 'cancelled' ? 'View summary →' : 'View progress →'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleHideImport(batch.id)}
                            className="text-sm text-gray-400 hover:text-gray-700 whitespace-nowrap"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div>
              {importFinished ? (
                <>
                  <h1 className="text-3xl font-bold text-gray-900">
                    {importCancelled ? 'Import stopped' : 'Import complete'}
                  </h1>
                  <p className="text-gray-600 mt-2">
                    {importCancelled
                      ? 'We stopped processing this file. Only enriched, scored contacts were added to Leads.'
                      : 'We&apos;ve finished processing your file. Only enriched, scored contacts were added to Leads.'}
                  </p>

                  <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50 p-6">
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-6">
                        <div>
                          <p className="text-sm text-gray-500">Uploaded</p>
                          <p className="text-sm text-gray-400">Contacts in this CSV batch</p>
                        </div>
                        <p className="text-2xl font-semibold text-gray-900">{(progress?.total || 0).toLocaleString()}</p>
                      </div>

                      <div className="flex items-start justify-between gap-6 border-t border-gray-200 pt-4">
                        <div>
                          <p className="text-sm text-gray-500">Enriched</p>
                          <p className="text-sm text-gray-400">Added to your Leads view</p>
                        </div>
                        <p className="text-2xl font-semibold text-gray-900">{(progress?.enriched || 0).toLocaleString()}</p>
                      </div>

                      {(progress?.duplicates || 0) > 0 && (
                        <div className="flex items-start justify-between gap-6 border-t border-gray-200 pt-4">
                          <div>
                            <p className="text-sm text-gray-500">Already in Arcova</p>
                            <p className="text-sm text-gray-400">Skipped because these contacts already exist in your workspace</p>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedBatchSection((prev) => (prev === 'duplicate' ? null : 'duplicate'))
                              }
                              className="mt-2 text-sm text-arcova-teal hover:underline"
                            >
                              {expandedBatchSection === 'duplicate' ? 'Hide contacts' : 'View contacts'}
                            </button>
                          </div>
                          <p className="text-2xl font-semibold text-gray-900">
                            {(progress?.duplicates || 0).toLocaleString()}
                          </p>
                        </div>
                      )}

                      <div className="flex items-start justify-between gap-6 border-t border-gray-200 pt-4">
                        <div>
                          <p className="text-sm text-gray-500">Not enriched</p>
                          <p className="text-sm text-gray-400">
                            Insufficient data to identify
                          </p>
                          <p className="text-sm text-gray-400">
                            Old records, missing LinkedIn URLs, or incomplete profiles
                          </p>
                          {(progress?.notEnriched || 0) > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedBatchSection((prev) => (prev === 'failed' ? null : 'failed'))
                              }
                              className="mt-2 text-sm text-arcova-teal hover:underline"
                            >
                              {expandedBatchSection === 'failed' ? 'Hide contacts' : 'View contacts'}
                            </button>
                          )}
                        </div>
                        <p className="text-2xl font-semibold text-gray-900">
                          {(progress?.notEnriched || 0).toLocaleString()}
                        </p>
                      </div>

                      <div className="flex items-start justify-between gap-6 border-t border-gray-200 pt-4">
                        <div>
                          <p className="text-sm text-gray-500">High-fit leads</p>
                          <p className="text-sm text-gray-400">Enriched contacts above your fit threshold</p>
                        </div>
                        <p className="text-2xl font-semibold text-gray-900">
                          {(progress?.highFitLeads || 0).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>

                  {(expandedBatchSection || batchDetailsError) && (
                    <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h2 className="text-lg font-semibold text-gray-900">{expandedBatchTitle}</h2>
                          <p className="mt-1 text-sm text-gray-500">
                            {expandedBatchSection === 'failed'
                              ? 'These rows were uploaded but did not land in Leads.'
                              : 'These rows were uploaded but skipped because matching contacts already existed.'}
                          </p>
                        </div>
                        {expandedBatchSection && (
                          <button
                            type="button"
                            onClick={() => setExpandedBatchSection(null)}
                            className="text-sm text-gray-400 hover:text-gray-600"
                          >
                            Close
                          </button>
                        )}
                      </div>

                      {isLoadingBatchDetails ? (
                        <p className="mt-4 text-sm text-gray-500">Loading contact details…</p>
                      ) : batchDetailsError ? (
                        <p className="mt-4 text-sm text-red-600">{batchDetailsError}</p>
                      ) : visibleBatchRows.length === 0 ? (
                        <p className="mt-4 text-sm text-gray-500">No contacts to show here.</p>
                      ) : (
                        <div className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-200 overflow-hidden">
                          {visibleBatchRows.map((row) => (
                            <div key={row.id} className="bg-white px-4 py-3">
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-900 truncate">{row.full_name}</p>
                                  <p className="mt-0.5 text-sm text-arcova-teal truncate">
                                    {row.company_name || row.company_domain || 'Unknown company'}
                                  </p>
                                  {row.job_title && (
                                    <p className="mt-1 text-xs text-gray-500 truncate">{row.job_title}</p>
                                  )}
                                </div>
                                <div className="min-w-0 text-right">
                                  {row.email && <p className="text-sm text-gray-700 truncate">{row.email}</p>}
                                  {!row.email && <p className="text-sm text-gray-400">No email</p>}
                                  {row.linkedin_url && (
                                    <p className="mt-1 text-xs text-gray-400 truncate">LinkedIn URL provided</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-8 rounded-xl border border-gray-200 p-6">
                    <p className="text-lg font-semibold text-gray-900">
                      Your Leads view has {(progress?.highFitLeads || 0).toLocaleString()} contact
                      {(progress?.highFitLeads || 0) === 1 ? '' : 's'} ready to work with.
                    </p>
                    <p className="mt-2 text-sm text-gray-600">
                      {enoughHighFitLeads
                        ? 'You have enough high-fit leads to start working this team in outreach.'
                        : `Most outreach programs need ${HIGH_FIT_TARGET}+ high-fit leads to see consistent results.`}
                    </p>

                    <div className="mt-5 flex flex-wrap gap-3">
                      <Link
                        href="/results"
                        className="px-4 py-2 rounded-lg bg-arcova-teal text-white text-sm font-medium hover:bg-arcova-teal/90 transition-colors"
                      >
                        View Leads
                      </Link>
                      {!enoughHighFitLeads && (
                        <Link
                          href="/find-more-leads"
                          className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:border-gray-400 hover:text-gray-900 transition-colors"
                        >
                          Find more leads matching this team →
                        </Link>
                      )}
                    </div>
                  </div>

                  <div className="mt-8 flex items-center gap-6">
                    <button
                      type="button"
                      onClick={resetBatchView}
                      className="text-sm text-arcova-teal hover:underline"
                    >
                      Back to imports
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h1 className="text-3xl font-bold text-gray-900">We&apos;re enriching your contacts</h1>
                  <p className="text-gray-600 mt-2">
                    This may take a few minutes depending on the size of your list. We&apos;ll keep updating this
                    screen as we work through your file.
                  </p>

                  {errorMessage && <p className="mt-4 text-sm text-red-600">{errorMessage}</p>}

                  <div className="mt-8 rounded-xl border border-gray-200 bg-white p-6">
                    <div className="flex items-center justify-between gap-6">
                      <div>
                        <p className="text-sm font-medium text-gray-900">Enriching your contacts...</p>
                        <p className="mt-1 text-sm text-gray-500">
                          {processedCount.toLocaleString()} of {totalCount.toLocaleString()} processed
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-arcova-teal" />
                          Working through your file
                        </div>
                        <button
                          type="button"
                          onClick={handleCancelImport}
                          disabled={isCancelling}
                          className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:border-gray-400 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {isCancelling ? 'Stopping import...' : 'Cancel import'}
                        </button>
                      </div>
                    </div>

                    <div className="mt-5 h-3 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-arcova-teal transition-all duration-500"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                      <span>{Math.round(progressPercent)}% complete</span>
                      <span>{(progress?.remaining || 0).toLocaleString()} remaining</span>
                    </div>
                  </div>

                  <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-gray-200 p-4">
                      <p className="text-sm text-gray-500">Uploaded</p>
                      <p className="text-2xl font-semibold text-gray-900">{progress?.total ?? 0}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 p-4">
                      <p className="text-sm text-gray-500">Processed</p>
                      <p className="text-2xl font-semibold text-gray-900">{processedCount}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 p-4">
                      <p className="text-sm text-gray-500">Being enriched</p>
                      <p className="text-2xl font-semibold text-gray-900">{progress?.enriching ?? 0}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 p-4">
                      <p className="text-sm text-gray-500">Enriched</p>
                      <p className="text-2xl font-semibold text-gray-900">{progress?.enriched ?? 0}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 p-4">
                      <p className="text-sm text-gray-500">Already in Arcova</p>
                      <p className="text-2xl font-semibold text-gray-900">{progress?.duplicates ?? 0}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 p-4">
                      <p className="text-sm text-gray-500">Not enriched</p>
                      <p className="text-2xl font-semibold text-gray-900">{progress?.notEnriched ?? 0}</p>
                    </div>
                  </div>

                  <div className="mt-8 flex items-center gap-6">
                    <button
                      type="button"
                      onClick={() => { persistBatchId(null); setProgress(null); }}
                      className="text-sm text-arcova-teal hover:underline"
                    >
                      Start new import
                    </button>
                    <Link
                      href="/dashboard"
                      onClick={() => persistBatchId(null)}
                      className="text-sm text-gray-400 hover:text-gray-600"
                    >
                      I&apos;ll come back later
                    </Link>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
