export type TriageGroup = 'high' | 'medium' | 'low';

export type TriageResult = {
  group: TriageGroup;
  version: string;
  reason: string | null;
};

export type ParsedTriageDecision = {
  group: TriageGroup;
  reason: string;
};

export const TRIAGE_AUTO_FAILURE_REASON = 'Could not classify automatically';

const TRIAGE_GROUPS = new Set<TriageGroup>(['high', 'medium', 'low']);
const MAX_REASON_CHARS = 180;
const INTERNAL_REASON_PATTERN =
  /\b(ai|anthropic|claude|classifier|icp|llm|model|openai|prompt|system|taxonomy)\b/i;

export function isTriageGroupValue(value: unknown): value is TriageGroup {
  return typeof value === 'string' && TRIAGE_GROUPS.has(value as TriageGroup);
}

function fallbackReasonForGroup(group: TriageGroup): string {
  if (group === 'high') return 'Available company and role details look like a strong fit';
  if (group === 'medium') return 'Available details suggest a possible fit but need review';
  return 'Available company and role details do not show a clear fit';
}

function sanitizeReason(value: unknown, group: TriageGroup): string {
  if (typeof value !== 'string') return fallbackReasonForGroup(group);
  const cleaned = value
    .replace(/[`"'{}[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || INTERNAL_REASON_PATTERN.test(cleaned)) return fallbackReasonForGroup(group);
  return cleaned.length > MAX_REASON_CHARS
    ? `${cleaned.slice(0, MAX_REASON_CHARS - 1).trimEnd()}...`
    : cleaned;
}

function parseDecision(entry: unknown): ParsedTriageDecision {
  if (isTriageGroupValue(entry)) {
    return { group: entry, reason: fallbackReasonForGroup(entry) };
  }

  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const record = entry as Record<string, unknown>;
    const rawGroup = record.group ?? record.triage_group ?? record.triageGroup;
    if (isTriageGroupValue(rawGroup)) {
      return {
        group: rawGroup,
        reason: sanitizeReason(record.reason ?? record.rationale, rawGroup),
      };
    }
  }

  return { group: 'low', reason: TRIAGE_AUTO_FAILURE_REASON };
}

function firstJsonArray(text: string): string {
  const start = text.indexOf('[');
  if (start === -1) return text.trim();

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let idx = start; idx < text.length; idx += 1) {
    const char = text[idx];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(start, idx + 1);
    }
  }

  return text.trim();
}

export function parseTriageCompletion(text: string, expectedCount: number): ParsedTriageDecision[] {
  const parsed = JSON.parse(firstJsonArray(text)) as unknown;
  const entries = Array.isArray(parsed) ? parsed : [];

  return Array.from({ length: expectedCount }, (_, idx) => parseDecision(entries[idx]));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function withTriageReason(
  rawData: Record<string, unknown> | null | undefined,
  reason: string | null,
): Record<string, unknown> {
  const next = isPlainRecord(rawData) ? { ...rawData } : {};
  if (reason) {
    next.triage_reason = reason;
  } else {
    delete next.triage_reason;
  }
  return next;
}

export function readTriageReason(rawData: Record<string, unknown> | null | undefined): string | null {
  if (!isPlainRecord(rawData)) return null;
  const reason = rawData.triage_reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : null;
}
