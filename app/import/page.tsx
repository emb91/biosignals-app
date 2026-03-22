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
  | 'job_title'
  | 'email_address'
  | 'linkedin_url'
  | 'ignore';

type ParsedCsv = {
  fileName: string;
  headers: string[];
  rows: string[][];
};

type PreviewRow = {
  contact_name: string;
  first_name: string;
  last_name: string;
  company_name: string;
  job_title: string;
  email: string;
  linkedin_url: string;
};

type ImportProgress = {
  total: number;
  duplicates: number;
  enriching: number;
  complete: number;
};

const IMPORT_FIELD_OPTIONS: { value: ImportField; label: string }[] = [
  { value: 'first_name', label: 'First name' },
  { value: 'last_name', label: 'Last name' },
  { value: 'full_name', label: 'Full name' },
  { value: 'company_name', label: 'Company name' },
  { value: 'job_title', label: 'Job title' },
  { value: 'email_address', label: 'Email address' },
  { value: 'linkedin_url', label: 'LinkedIn URL' },
  { value: 'ignore', label: "Don't import this column" },
];

const PREVIEW_FIELDS: { key: keyof PreviewRow; label: string }[] = [
  { key: 'contact_name', label: 'Contact name' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'company_name', label: 'Company name' },
  { key: 'job_title', label: 'Job title' },
  { key: 'email', label: 'Email address' },
  { key: 'linkedin_url', label: 'LinkedIn URL' },
];

const splitFullName = (fullName: string): { first: string; last: string } => {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { first: '', last: '' };
  if (tokens.length === 1) return { first: tokens[0], last: '' };
  return {
    first: tokens[0],
    last: tokens.slice(1).join(' '),
  };
};

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
  if (normalized.includes('linkedin') || normalized.includes('linked in')) {
    return 'linkedin_url';
  }

  return 'ignore';
};

const normalizePreviewRow = (
  row: string[],
  headers: string[],
  columnMappings: Record<string, ImportField>
): PreviewRow => {
  const byField: Record<ImportField, string[]> = {
    first_name: [],
    last_name: [],
    full_name: [],
    company_name: [],
    job_title: [],
    email_address: [],
    linkedin_url: [],
    ignore: [],
  };

  headers.forEach((header, index) => {
    const mappedField = columnMappings[header] || 'ignore';
    const value = (row[index] || '').trim();
    if (value) byField[mappedField].push(value);
  });

  const explicitFirst = byField.first_name[0] || '';
  const explicitLast = byField.last_name[0] || '';
  const explicitFull = byField.full_name.join(' ').trim();

  let firstName = explicitFirst;
  let lastName = explicitLast;
  let contactName = explicitFull;

  if (!contactName && (firstName || lastName)) {
    contactName = `${firstName} ${lastName}`.trim();
  }
  if (contactName && (!firstName || !lastName)) {
    const split = splitFullName(contactName);
    firstName = firstName || split.first;
    lastName = lastName || split.last;
  }

  return {
    contact_name: contactName,
    first_name: firstName,
    last_name: lastName,
    company_name: byField.company_name[0] || '',
    job_title: byField.job_title[0] || '',
    email: byField.email_address[0] || '',
    linkedin_url: byField.linkedin_url[0] || '',
  };
};

export default function ImportPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [parsedCsv, setParsedCsv] = useState<ParsedCsv | null>(null);
  const [columnMappings, setColumnMappings] = useState<Record<string, ImportField>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentBatchId, setCurrentBatchId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [loading, router, user]);

  useEffect(() => {
    if (!currentBatchId) return;

    const fetchProgress = async () => {
      const response = await fetch(`/api/import-status?batchId=${encodeURIComponent(currentBatchId)}`);
      if (!response.ok) return;
      const result = await response.json();
      setProgress({
        total: result.total || 0,
        duplicates: result.duplicates || 0,
        enriching: result.enriching || 0,
        complete: result.complete || 0,
      });
    };

    fetchProgress();
    const interval = setInterval(fetchProgress, 5000);
    return () => clearInterval(interval);
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

  const mappedPreviewRows = useMemo(() => {
    if (!parsedCsv) return [];
    return parsedCsv.rows.slice(0, 3).map((row) => normalizePreviewRow(row, parsedCsv.headers, columnMappings));
  }, [columnMappings, parsedCsv]);

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
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to start import.');
      }

      setCurrentBatchId(result.batchId);
      setProgress({
        total: result.totalUploaded || 0,
        duplicates: result.duplicatesRemoved || 0,
        enriching: result.beingEnriched || 0,
        complete: result.complete || 0,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start import.';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
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
                <div className="mt-10">
                  <h2 className="text-lg font-semibold text-gray-900 mb-3">Step 3 - Column mapping</h2>

                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium text-gray-700">CSV column</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-700">Map to</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {parsedCsv.headers.map((header) => (
                          <tr key={header}>
                            <td className="px-4 py-3 text-gray-900">{header || '(Unnamed column)'}</td>
                            <td className="px-4 py-3">
                              <select
                                value={columnMappings[header] || 'ignore'}
                                onChange={(event) =>
                                  setColumnMappings((prev) => ({
                                    ...prev,
                                    [header]: event.target.value as ImportField,
                                  }))
                                }
                                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-arcova-teal"
                              >
                                {IMPORT_FIELD_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-6">
                    <h3 className="text-sm font-semibold text-gray-900 mb-2">Preview (first 3 rows)</h3>
                    <div className="overflow-hidden rounded-lg border border-gray-200">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            {PREVIEW_FIELDS.map((field) => (
                              <th key={field.key} className="px-4 py-3 text-left font-medium text-gray-700">
                                {field.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {mappedPreviewRows.length === 0 ? (
                            <tr>
                              <td className="px-4 py-3 text-gray-500" colSpan={PREVIEW_FIELDS.length}>
                                No preview rows available.
                              </td>
                            </tr>
                          ) : (
                            mappedPreviewRows.map((row, index) => (
                              <tr key={`preview-${index}`}>
                                {PREVIEW_FIELDS.map((field) => (
                                  <td key={`${field.key}-${index}`} className="px-4 py-3 text-gray-900">
                                    {row[field.key] || <span className="text-gray-400">-</span>}
                                  </td>
                                ))}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
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
              )}
            </>
          ) : (
            <div>
              <h1 className="text-3xl font-bold text-gray-900">We&apos;re enriching your contacts</h1>
              <p className="text-gray-600 mt-2">This may take a few minutes depending on the size of your list.</p>

              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-lg border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">Total contacts uploaded</p>
                  <p className="text-2xl font-semibold text-gray-900">{progress?.total ?? 0}</p>
                </div>
                <div className="rounded-lg border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">Duplicates removed</p>
                  <p className="text-2xl font-semibold text-gray-900">{progress?.duplicates ?? 0}</p>
                </div>
                <div className="rounded-lg border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">Being enriched</p>
                  <p className="text-2xl font-semibold text-gray-900">{progress?.enriching ?? 0}</p>
                </div>
                <div className="rounded-lg border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">Complete</p>
                  <p className="text-2xl font-semibold text-gray-900">{progress?.complete ?? 0}</p>
                </div>
              </div>

              <div className="mt-8">
                <Link href="/dashboard" className="text-sm text-arcova-teal hover:underline">
                  I&apos;ll come back later
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
