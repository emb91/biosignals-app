import { looksLikeEmail } from './contact-emails';
import type { NormalisedRow } from './import-queue';

export const PENDING_IMPORT_DEDUP_STATUSES = [
  'pending',
  'enriching',
  'awaiting_triage',
  'awaiting_enrichment',
] as const;

export type DuplicateMatchKind = 'linkedin' | 'email' | 'name+company';

export type DuplicateCandidate = {
  linkedin_url?: unknown;
  email?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  full_name?: unknown;
  company_name?: unknown;
  raw_data?: unknown;
};

export type InsertedImportRow = {
  id: unknown;
  full_name: unknown;
  email: unknown;
  linkedin_url: unknown;
  company_name: unknown;
  raw_data: unknown;
};

type MutableInsertedImportRow = InsertedImportRow & { email: string | null };

const normalize = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const splitFullName = (fullName: string): { first: string; last: string } => {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { first: '', last: '' };
  if (tokens.length === 1) return { first: tokens[0], last: '' };
  return { first: tokens[0], last: tokens.slice(1).join(' ') };
};

const candidateNameParts = (candidate: DuplicateCandidate): { first: string; last: string } => {
  const raw = asRecord(candidate.raw_data);
  let first = normalize(candidate.first_name ?? raw.first_name);
  let last = normalize(candidate.last_name ?? raw.last_name);
  const fullName = normalize(candidate.full_name ?? raw.full_name);

  if ((!first || !last) && fullName) {
    const split = splitFullName(fullName);
    first = first || normalize(split.first);
    last = last || normalize(split.last);
  }

  return { first, last };
};

export const duplicateReasonForMatch = (match: DuplicateMatchKind): string =>
  match === 'linkedin'
    ? 'Duplicate LinkedIn URL'
    : match === 'email'
      ? 'Duplicate email'
      : 'Duplicate name + company';

export const duplicateMatch = (
  row: NormalisedRow,
  existing: DuplicateCandidate,
): DuplicateMatchKind | null => {
  const rowLinkedin = normalize(row.linkedin_url);
  const rowEmail = normalize(row.email);
  const rowFirst = normalize(row.first_name);
  const rowLast = normalize(row.last_name);
  const rowCompany = normalize(row.company_name);

  const raw = asRecord(existing.raw_data);
  const exLinkedin = normalize(existing.linkedin_url ?? raw.linkedin_url);
  const exEmail = normalize(existing.email ?? raw.email);
  const { first: exFirst, last: exLast } = candidateNameParts(existing);
  const exCompany = normalize(existing.company_name ?? raw.company_name);

  if (rowLinkedin && exLinkedin && rowLinkedin === exLinkedin) return 'linkedin';
  if (rowEmail && exEmail && rowEmail === exEmail) return 'email';
  if (
    rowFirst &&
    rowLast &&
    rowCompany &&
    exFirst &&
    exLast &&
    exCompany &&
    rowFirst === exFirst &&
    rowLast === exLast &&
    rowCompany === exCompany
  ) {
    return 'name+company';
  }

  return null;
};

export const normalisedRowFromRawUpload = (row: InsertedImportRow): NormalisedRow => {
  const rawData = asRecord(row.raw_data);
  const fullName = (rawData.full_name as string) || (row.full_name as string) || '';
  const split = splitFullName(fullName);

  return {
    full_name: fullName,
    first_name: (rawData.first_name as string) || split.first,
    last_name: (rawData.last_name as string) || split.last,
    company_name: (row.company_name as string) || (rawData.company_name as string) || '',
    company_domain: (rawData.company_domain as string) || '',
    job_title: (rawData.job_title as string) || '',
    email: (row.email as string) || (rawData.email as string) || '',
    linkedin_url: (row.linkedin_url as string) || (rawData.linkedin_url as string) || '',
    location: (rawData.location as string) || '',
    company_linkedin_url: (rawData.company_linkedin_url as string) || '',
  };
};

export function classifyImportRowsForDedup(params: {
  insertedRows: InsertedImportRow[];
  existingContacts: DuplicateCandidate[];
  pendingRawUploads: DuplicateCandidate[];
}): {
  pendingRows: InsertedImportRow[];
  duplicateIds: string[];
  duplicateReasons: Map<string, string>;
  clearedEmailIds: string[];
} {
  const pendingRows: InsertedImportRow[] = [];
  const duplicateIds: string[] = [];
  const duplicateReasons = new Map<string, string>();
  const clearedEmailIds: string[] = [];
  const acceptedCandidates: DuplicateCandidate[] = [];

  for (const row of params.insertedRows) {
    const rowNorm = normalisedRowFromRawUpload(row);

    if (rowNorm.email && !looksLikeEmail(rowNorm.email)) {
      rowNorm.email = '';
      (row as MutableInsertedImportRow).email = null;
      clearedEmailIds.push(row.id as string);
    }

    let match: DuplicateMatchKind | null = null;
    for (const contact of params.existingContacts) {
      match = duplicateMatch(rowNorm, contact);
      if (match) break;
    }
    if (!match) {
      for (const pending of params.pendingRawUploads) {
        match = duplicateMatch(rowNorm, pending);
        if (match) break;
      }
    }
    if (!match) {
      for (const accepted of acceptedCandidates) {
        match = duplicateMatch(rowNorm, accepted);
        if (match) break;
      }
    }

    if (match) {
      duplicateIds.push(row.id as string);
      duplicateReasons.set(row.id as string, duplicateReasonForMatch(match));
      continue;
    }

    pendingRows.push(row);
    acceptedCandidates.push({
      linkedin_url: rowNorm.linkedin_url,
      email: rowNorm.email,
      first_name: rowNorm.first_name,
      last_name: rowNorm.last_name,
      full_name: rowNorm.full_name,
      company_name: rowNorm.company_name,
    });
  }

  return { pendingRows, duplicateIds, duplicateReasons, clearedEmailIds };
}
