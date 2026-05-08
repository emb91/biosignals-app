/**
 * Derives HS / CSV / Arcova labels from import batch metadata and contact row.
 */

export type DataProvenanceChannel = 'hubspot' | 'csv' | 'arcova';

const CHANNEL_ORDER: DataProvenanceChannel[] = ['hubspot', 'csv', 'arcova'];

type BatchRow = { filename?: string | null; created_at?: string | null } | null | undefined;

function normalizeBatch(batch: unknown): BatchRow {
  if (batch == null) return null;
  if (Array.isArray(batch)) return (batch[0] as BatchRow) ?? null;
  if (typeof batch === 'object') return batch as BatchRow;
  return null;
}

export function resolveContactDataProvenance(row: {
  upload_batches?: unknown;
  created_at?: string | null;
  source?: string | null;
}): { channels: DataProvenanceChannel[]; importedAt: string | null } {
  const batchRow = normalizeBatch(row.upload_batches);
  const filename = batchRow?.filename ?? null;
  const batchCreated = batchRow?.created_at ?? null;
  const contactCreated = typeof row.created_at === 'string' ? row.created_at : null;
  const importedAt = batchCreated?.trim() || contactCreated?.trim() || null;

  const fn = (filename || '').toLowerCase();
  if (fn.startsWith('arcova-pipeline-') || fn.includes('arcova')) {
    return { channels: ['arcova'], importedAt };
  }
  if (fn.startsWith('hubspot-auto-') || fn.includes('hubspot')) {
    return { channels: ['hubspot'], importedAt };
  }
  if (filename != null && String(filename).trim().length > 0) {
    return { channels: ['csv'], importedAt };
  }

  return { channels: ['arcova'], importedAt: contactCreated };
}

export function sortProvenanceChannels(channels: Iterable<DataProvenanceChannel>): DataProvenanceChannel[] {
  return [...new Set(channels)].sort((a, b) => CHANNEL_ORDER.indexOf(a) - CHANNEL_ORDER.indexOf(b));
}

function channelToAbbrev(ch: DataProvenanceChannel): string {
  switch (ch) {
    case 'hubspot':
      return 'HS';
    case 'csv':
      return 'CSV';
    case 'arcova':
      return 'Arcova';
  }
}

export function formatDataProvenanceTypeOnly(channels: DataProvenanceChannel[]): string {
  const sorted = sortProvenanceChannels(channels);
  if (sorted.length === 0) return '—';
  return sorted.map(channelToAbbrev).join(', ');
}

export function formatDataSourceLabel(channels: DataProvenanceChannel[]): string {
  const sorted = sortProvenanceChannels(channels);
  if (sorted.includes('arcova')) return 'Arcova purchased data';
  if (sorted.includes('hubspot')) return 'Imported by HubSpot';
  if (sorted.includes('csv')) return 'Imported by CSV';
  return 'Imported data';
}

export function formatProvenanceImportedAt(iso: string | null | undefined): string {
  if (!iso || typeof iso !== 'string' || !iso.trim()) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** @deprecated Prefer formatDataProvenanceTypeOnly + formatProvenanceImportedAt */
export function formatDataProvenanceLabel(channels: DataProvenanceChannel[], importedAt: string | null): string {
  return `${formatDataProvenanceTypeOnly(channels)} · ${formatProvenanceImportedAt(importedAt)}`;
}
