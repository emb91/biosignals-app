'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { PageHeader } from '@/components/PageHeader';
import { AgentPanel } from '@/components/AgentPanel';
import {
  RefreshCw,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

type EventType = 'push' | 'pull' | 'full' | 'csv_import';

interface SyncEvent {
  id: string;
  created_at: string;
  event_type: EventType;
  // hubspot_sync_events fields
  contacts_synced: number | null;
  contacts_errors: number | null;
  contacts_skipped: number | null;
  skipped_contacts: unknown[];
  error_details: string[];
  companies_updated: number | null;
  pull_count: number | null;
  crm_contacts_fetched: number | null;
  crm_contacts_mirrored: number | null;
  contact_events_emitted: number | null;
  contact_context_only_events: number | null;
  crm_recomputed_companies: number | null;
  crm_unresolved_count: number | null;
  contact_signal_types: string[];
  contact_context_signal_types: string[];
  deal_signal_types: string[];
  deals_fetched: number | null;
  deals_mirrored: number | null;
  deal_events_emitted: number | null;
  // upload_batches fields
  filename: string | null;
  total_rows: number | null;
  processed_rows: number | null;
  duplicate_rows: number | null;
  failed_rows: number | null;
  batch_status: string | null;
}

interface ImportBatch {
  id: string;
  filename: string;
  total_rows: number | null;
  processed_rows: number | null;
  duplicate_rows: number | null;
  failed_rows: number | null;
  status: string | null;
  created_at: string;
}

interface SignalLogEvent {
  id: string;
  signalKey: string;
  scope: 'company' | 'contact';
  runner: 'clinical_trials' | 'external_contact' | 'external_company' | string;
  status: 'success' | 'failed' | string;
  createdAt: string;
  processed: number | null;
  failed: number | null;
  skippedRunning: number | null;
  companyIds: string[];
  contactIds: string[];
  limitValue: number | null;
}

function signalEventStatus(event: SignalLogEvent): StatusLevel {
  const failedCount = event.failed ?? 0;
  const statusText = (event.status || '').toLowerCase();
  if (statusText === 'failed' || failedCount > 0) return 'warning';
  return 'done';
}

function SignalEventCard({
  event,
  collapsed,
  onToggle,
}: {
  event: SignalLogEvent;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const status = signalEventStatus(event);
  return (
    <div
      className={`rounded-lg border border-white/80 bg-white/55 backdrop-blur-xl ${
        collapsed ? 'shadow-[0_2px_8px_-4px_rgba(13,53,71,0.1)]' : 'shadow-[0_8px_24px_-12px_rgba(13,53,71,0.15)]'
      }`}
    >
      <div
        className={`flex items-center gap-2.5 px-3.5 py-1.5 cursor-pointer transition-colors hover:bg-white/40 ${
          !collapsed ? 'border-b border-[rgba(13,53,71,0.07)]' : ''
        }`}
        onClick={onToggle}
      >
        <span
          className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold tracking-wide border ${
            event.scope === 'company'
              ? 'bg-arcova-teal/10 text-arcova-teal border-arcova-teal/20'
              : 'bg-[#0d3547]/8 text-[#0d3547] border-[#0d3547]/12'
          }`}
        >
          {event.scope === 'company' ? 'Company' : 'Contact'}
        </span>
        <span className="flex-1 min-w-0 truncate text-[12.5px] font-medium text-[#0d3547]">
          {formatSignalTypeLabel(event.signalKey)}
        </span>
        {collapsed && (
          <span className="hidden sm:block shrink-0 text-[11px] text-[#7d909a]">
            {formatSignalTypeLabel(event.runner)} · {event.processed ?? 0} processed
          </span>
        )}
        <span className="shrink-0 text-[10.5px] text-[#b6c2c8]">{relativeTime(event.createdAt)}</span>
        <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold ${STATUS_PILL[status]}`}>
          {STATUS_LABEL[status]}
        </span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-[#b6c2c8] transition-transform duration-200 ${!collapsed ? 'rotate-180' : ''}`}
        />
      </div>

      {!collapsed && (
        <div className="px-3.5 py-2.5 space-y-2">
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <InlineStat label="Processed" value={event.processed} />
            <InlineStat label="Failed" value={event.failed} highlight />
            <InlineStat label="Skipped running" value={event.skippedRunning} />
            <InlineStat label="Limit" value={event.limitValue} />
          </div>
          <p className="text-[11px] text-[#7d909a]">
            Runner: {formatSignalTypeLabel(event.runner)} · Status: {STATUS_LABEL[status]}
          </p>
          <p className="text-[11px] text-[#7d909a]">
            Scope IDs: {event.scope === 'company' ? event.companyIds.length : event.contactIds.length}
          </p>
          <p className="text-[11px] text-[#b6c2c8]">{absoluteTime(event.createdAt)}</p>
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function eventLabel(event: SyncEvent): string {
  if (event.event_type === 'push') return 'Push to HubSpot';
  if (event.event_type === 'pull') return 'Pull from HubSpot';
  if (event.event_type === 'csv_import') return event.filename ?? 'CSV upload';
  return 'Full sync';
}

function eventSublabel(event: SyncEvent): string {
  const parts: string[] = [];
  if (event.event_type === 'csv_import') {
    if (event.total_rows != null) parts.push(`${event.total_rows} rows`);
    if (event.processed_rows != null) parts.push(`${event.processed_rows} imported`);
    if (event.duplicate_rows != null && event.duplicate_rows > 0) parts.push(`${event.duplicate_rows} duplicates`);
    if (event.failed_rows != null && event.failed_rows > 0) parts.push(`${event.failed_rows} failed`);
    return parts.join(' · ') || 'No data';
  }
  if (event.event_type === 'push' || event.event_type === 'full') {
    if (event.contacts_synced != null) parts.push(`${event.contacts_synced} contacts pushed`);
    if (event.companies_updated != null && event.companies_updated > 0)
      parts.push(`${event.companies_updated} companies updated`);
  }
  if (event.event_type === 'pull' || event.event_type === 'full') {
    if (event.pull_count != null) parts.push(`${event.pull_count} contacts pulled`);
    if (event.contact_events_emitted != null && event.contact_events_emitted > 0)
      parts.push(`${event.contact_events_emitted} CRM contact signals`);
  }
  if (event.event_type === 'pull' || event.event_type === 'full') {
    if (event.deals_mirrored != null && event.deals_mirrored > 0)
      parts.push(`${event.deals_mirrored} deals synced`);
  }
  return parts.join(' · ') || 'No data';
}

function formatSignalTypeLabel(value: string | null | undefined): string {
  if (typeof value !== 'string' || !value.trim()) return 'Unknown';
  return value
    .replace(/_/g, ' ')
    .replace(/\bcrm\b/gi, 'CRM')
    .replace(/\bhs\b/gi, 'HS')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

type StatusLevel = 'done' | 'warning' | 'failed';

function eventStatus(event: SyncEvent): StatusLevel {
  if (event.event_type === 'csv_import') {
    const failed = event.failed_rows ?? 0;
    const processed = event.processed_rows ?? 0;
    if (failed === 0) return 'done';
    if (processed > 0) return 'warning';
    return 'failed';
  }
  const errors = event.contacts_errors ?? 0;
  const skipped = event.contacts_skipped ?? 0;
  const synced = event.contacts_synced ?? 0;
  const hasErrorDetails = event.error_details.length > 0;
  if (errors === 0 && !hasErrorDetails) return skipped > 0 ? 'warning' : 'done';
  if (synced > 0 && errors < synced) return 'warning';
  return 'failed';
}

const STATUS_PILL: Record<StatusLevel, string> = {
  done:    'bg-emerald-50 text-emerald-600 border border-emerald-200',
  warning: 'bg-amber-50 text-amber-600 border border-amber-200',
  failed:  'bg-red-50 text-red-500 border border-red-200',
};

const STATUS_LABEL: Record<StatusLevel, string> = {
  done:    'Done',
  warning: 'Warning',
  failed:  'Failed',
};

// ── Type pill ──────────────────────────────────────────────────────────────

// Direction pill — what kind of operation
const DIRECTION_STYLE: Record<EventType, string> = {
  push:       'bg-arcova-teal/10 text-arcova-teal border border-arcova-teal/20',
  pull:       'bg-[#0d3547]/8 text-[#0d3547] border border-[#0d3547]/12',
  full:       'bg-violet-50 text-violet-600 border border-violet-200',
  csv_import: 'bg-[#0d3547]/8 text-[#0d3547] border border-[#0d3547]/12',
};

const DIRECTION_LABEL: Record<EventType, string> = {
  push:       'Export',
  pull:       'Import',
  full:       'Sync',
  csv_import: 'Import',
};

// Method pill — how it happened
const METHOD_LABEL: Record<EventType, string> = {
  push:       'HubSpot',
  pull:       'HubSpot',
  full:       'HubSpot',
  csv_import: 'CSV',
};

const METHOD_STYLE = 'bg-white/60 text-[#7d909a] border border-[rgba(13,53,71,0.1)]';

// ── SyncEventCard ──────────────────────────────────────────────────────────

function SyncEventCard({
  event,
  collapsed,
  onToggle,
}: {
  event: SyncEvent;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const status = eventStatus(event);

  return (
    <div className={`rounded-lg border border-white/80 bg-white/55 backdrop-blur-xl ${
      collapsed ? 'shadow-[0_2px_8px_-4px_rgba(13,53,71,0.1)]' : 'shadow-[0_8px_24px_-12px_rgba(13,53,71,0.15)]'
    }`}>
      {/* Header row — very compact */}
      <div
        className={`flex items-center gap-2.5 px-3.5 py-1.5 cursor-pointer transition-colors hover:bg-white/40 ${
          !collapsed ? 'border-b border-[rgba(13,53,71,0.07)]' : ''
        }`}
        onClick={onToggle}
      >
        {/* Direction pill */}
        <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold tracking-wide ${DIRECTION_STYLE[event.event_type]}`}>
          {DIRECTION_LABEL[event.event_type]}
        </span>

        {/* Method pill */}
        <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold ${METHOD_STYLE}`}>
          {METHOD_LABEL[event.event_type]}
        </span>

        {/* Title */}
        <span className="flex-1 min-w-0 truncate text-[12.5px] font-medium text-[#0d3547]">
          {eventLabel(event)}
        </span>

        {/* Stats summary (collapsed) */}
        {collapsed && (
          <span className="hidden sm:block shrink-0 text-[11px] text-[#7d909a]">
            {eventSublabel(event)}
          </span>
        )}

        {/* Timestamp + status pill */}
        <span className="shrink-0 text-[10.5px] text-[#b6c2c8]">{relativeTime(event.created_at)}</span>
        <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold ${STATUS_PILL[status]}`}>
          {STATUS_LABEL[status]}
        </span>

        {/* Caret */}
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-[#b6c2c8] transition-transform duration-200 ${!collapsed ? 'rotate-180' : ''}`}
        />
      </div>

      {/* Expanded body */}
      {!collapsed && (
        <div className="px-3.5 py-2.5 space-y-2">
          {/* Inline stat row */}
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {event.event_type === 'csv_import' && (
              <>
                <InlineStat label="Total" value={event.total_rows} />
                <InlineStat label="Imported" value={event.processed_rows} />
                <InlineStat label="Duplicates" value={event.duplicate_rows} />
                <InlineStat label="Failed" value={event.failed_rows} highlight={status !== 'done'} />
              </>
            )}
            {(event.event_type === 'push' || event.event_type === 'full') && (
              <>
                <InlineStat label="Pushed" value={event.contacts_synced} />
                <InlineStat label="Companies" value={event.companies_updated} />
                <InlineStat label="Skipped" value={event.contacts_skipped} />
                <InlineStat label="Errors" value={event.contacts_errors} highlight={status !== 'done'} />
              </>
            )}
            {(event.event_type === 'pull' || event.event_type === 'full') && (
              <>
                <InlineStat label="Pulled" value={event.pull_count} />
                <InlineStat label="CRM fetched" value={event.crm_contacts_fetched} />
                <InlineStat label="CRM mirrored" value={event.crm_contacts_mirrored} />
                <InlineStat label="Contact signals" value={event.contact_events_emitted} />
                <InlineStat label="Context-only" value={event.contact_context_only_events} />
                <InlineStat label="Accounts updated" value={event.crm_recomputed_companies} />
                <InlineStat label="Unresolved" value={event.crm_unresolved_count} />
              </>
            )}
            {(event.event_type === 'pull' || event.event_type === 'full') && (
              <>
                <InlineStat label="Deals fetched" value={event.deals_fetched} />
                <InlineStat label="Deals mirrored" value={event.deals_mirrored} />
                <InlineStat label="Deal events" value={event.deal_events_emitted} />
              </>
            )}
          </div>

          {/* Timestamp full */}
          <p className="text-[11px] text-[#b6c2c8]">{absoluteTime(event.created_at)}</p>

          {/* Skipped contacts */}
          {Array.isArray(event.skipped_contacts) && event.skipped_contacts.length > 0 && (
            <div>
              <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Skipped</p>
              <ul className="space-y-0.5">
                {(event.skipped_contacts as { name?: string; company?: string; reason?: string }[]).map((c, i) => (
                  <li key={i} className="text-[12px] text-[#4a6470]">
                    <span className="font-medium text-[#0d3547]">{c.name || 'Unknown'}</span>
                    {c.company && <span className="text-[#7d909a]"> · {c.company}</span>}
                    {c.reason && <span className="text-[#b6c2c8]"> — {c.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Error details */}
          {event.error_details.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-red-400">
                <AlertTriangle className="h-3 w-3" /> Errors
              </p>
              <ul className="space-y-0.5">
                {event.error_details.map((e, i) => (
                  <li key={i} className="text-[11.5px] text-red-600 font-mono break-all">{e}</li>
                ))}
              </ul>
            </div>
          )}

          {event.contact_signal_types.length > 0 && (
            <div>
              <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Contact signals</p>
              <div className="flex flex-wrap gap-1.5">
                {event.contact_signal_types.map((signalType) => (
                  <span
                    key={signalType}
                    className="rounded-full border border-[rgba(45,138,138,0.18)] bg-[rgba(45,138,138,0.08)] px-2 py-0.5 text-[11px] font-medium text-[#2d8a8a]"
                  >
                    {formatSignalTypeLabel(signalType)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {event.contact_context_signal_types.length > 0 && (
            <div>
              <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Context only</p>
              <div className="flex flex-wrap gap-1.5">
                {event.contact_context_signal_types.map((signalType) => (
                  <span
                    key={signalType}
                    className="rounded-full border border-[rgba(13,53,71,0.12)] bg-[rgba(13,53,71,0.04)] px-2 py-0.5 text-[11px] font-medium text-[#4a6470]"
                  >
                    {formatSignalTypeLabel(signalType)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {event.deal_signal_types.length > 0 && (
            <div>
              <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Deal signals</p>
              <div className="flex flex-wrap gap-1.5">
                {event.deal_signal_types.map((signalType) => (
                  <span
                    key={signalType}
                    className="rounded-full border border-[rgba(240,127,90,0.22)] bg-[rgba(240,127,90,0.08)] px-2 py-0.5 text-[11px] font-medium text-[#f07f5a]"
                  >
                    {formatSignalTypeLabel(signalType)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Clean */}
          {status === 'done' && event.event_type !== 'csv_import' &&
            !(Array.isArray(event.skipped_contacts) && event.skipped_contacts.length > 0) && (
              <div className="flex items-center gap-1.5 text-[11.5px] text-[#7d909a]">
                <CheckCircle2 className="h-3 w-3 text-arcova-teal shrink-0" />
                No errors or skipped contacts
              </div>
            )}
        </div>
      )}
    </div>
  );
}

function InlineStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | null | undefined;
  highlight?: boolean;
}) {
  return (
    <span className="text-[12px] text-[#7d909a]">
      <span className={`font-semibold ${highlight && (value ?? 0) > 0 ? 'text-red-500' : 'text-[#0d3547]'}`}>
        {value ?? 0}
      </span>{' '}
      {label}
    </span>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

type FilterType = 'all' | 'import' | 'push' | 'full';

const FILTERS: { value: FilterType; label: string }[] = [
  { value: 'all',    label: 'All' },
  { value: 'import', label: 'Import' },
  { value: 'push',   label: 'Export' },
  { value: 'full',   label: 'Sync' },
];

function matchesFilter(event: SyncEvent, filter: FilterType): boolean {
  if (filter === 'all') return true;
  if (filter === 'import') return event.event_type === 'pull' || event.event_type === 'csv_import';
  return event.event_type === filter;
}

export default function LogPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadingSignals, setLoadingSignals] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedSignalIds, setExpandedSignalIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterType>('all');
  const [signalEvents, setSignalEvents] = useState<SignalLogEvent[]>([]);
  const [syncSectionOpen, setSyncSectionOpen] = useState<boolean>(false);
  const [signalsSectionOpen, setSignalsSectionOpen] = useState<boolean>(false);
  const [outreachErrors, setOutreachErrors] = useState<Array<{
    id: string;
    contact_name: string;
    anchor_hook_text: string;
    dispatch_channel: string | null;
    dispatch_error: string | null;
    last_status_at: string | null;
  }>>([]);
  const [outreachErrorsOpen, setOutreachErrorsOpen] = useState<boolean>(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const filteredEvents = events.filter((e) => matchesFilter(e, filter));

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, router, user]);

  const fetchEvents = useCallback(async () => {
    try {
      const [syncRes, importRes, logRes, signalsRes, outreachFailRes] = await Promise.all([
        fetch('/api/hubspot/sync-events'),
        fetch('/api/import-history'),
        fetch('/api/hubspot/sync-log'),
        fetch('/api/signals/run-history'),
        fetch('/api/outreach/failures'),
      ]);

      if (outreachFailRes.ok) {
        const j = (await outreachFailRes.json()) as { failures?: typeof outreachErrors };
        setOutreachErrors(j.failures ?? []);
      }

      const syncJson = syncRes.ok ? (await syncRes.json() as { data: SyncEvent[] }) : { data: [] };
      const importJson = importRes.ok ? (await importRes.json() as { batches: ImportBatch[] }) : { batches: [] };
      const logJson = logRes.ok ? (await logRes.json() as { data: { synced_at: string | null; contacts_synced: number | null; contacts_errors: number | null; contacts_skipped: number | null; skipped_contacts: unknown[]; last_error_details: string[]; last_pull_batch: { processed_rows: number } | null } | null }) : { data: null };
      const signalsJson = signalsRes.ok
        ? (await signalsRes.json() as { data: Array<Record<string, unknown>> })
        : { data: [] as Array<Record<string, unknown>> };

      const syncEvents: SyncEvent[] = (syncJson.data ?? []).map((e) => ({
        ...e,
        filename: null,
        total_rows: null,
        processed_rows: null,
        duplicate_rows: null,
        failed_rows: null,
        batch_status: null,
        skipped_contacts: Array.isArray(e.skipped_contacts) ? e.skipped_contacts : [],
        error_details: Array.isArray(e.error_details)
          ? (e.error_details as unknown[]).filter((x): x is string => typeof x === 'string')
          : [],
        contact_signal_types: Array.isArray((e as { contact_signal_types?: unknown[] }).contact_signal_types)
          ? ((e as { contact_signal_types?: unknown[] }).contact_signal_types as unknown[]).filter((x): x is string => typeof x === 'string')
          : [],
        contact_context_signal_types: Array.isArray((e as { contact_context_signal_types?: unknown[] }).contact_context_signal_types)
          ? ((e as { contact_context_signal_types?: unknown[] }).contact_context_signal_types as unknown[]).filter((x): x is string => typeof x === 'string')
          : [],
        deal_signal_types: Array.isArray((e as { deal_signal_types?: unknown[] }).deal_signal_types)
          ? ((e as { deal_signal_types?: unknown[] }).deal_signal_types as unknown[]).filter((x): x is string => typeof x === 'string')
          : [],
      }));

      const importEvents: SyncEvent[] = (importJson.batches ?? []).map((b) => ({
        id: b.id,
        created_at: b.created_at,
        event_type: b.filename?.startsWith('hubspot-auto-') ? 'pull' : 'csv_import',
        contacts_synced: null,
        contacts_errors: null,
        contacts_skipped: null,
        skipped_contacts: [],
        error_details: [],
        companies_updated: null,
        pull_count: b.filename?.startsWith('hubspot-auto-') ? (b.processed_rows ?? null) : null,
        crm_contacts_fetched: null,
        crm_contacts_mirrored: null,
        contact_events_emitted: null,
        contact_context_only_events: null,
        crm_recomputed_companies: null,
        crm_unresolved_count: null,
        contact_signal_types: [],
        contact_context_signal_types: [],
        deal_signal_types: [],
        deals_fetched: null,
        deals_mirrored: null,
        deal_events_emitted: null,
        filename: b.filename,
        total_rows: b.total_rows ?? null,
        processed_rows: b.processed_rows ?? null,
        duplicate_rows: b.duplicate_rows ?? null,
        failed_rows: b.failed_rows ?? null,
        batch_status: b.status ?? null,
      }));

      // Surface the legacy push from hubspot_sync_log if it predates the new events table
      const legacyPushEvents: SyncEvent[] = [];
      const log = logJson.data;
      if (log?.synced_at) {
        const alreadyCovered = syncEvents.some((e) => e.event_type === 'push' || e.event_type === 'full');
        if (!alreadyCovered) {
          legacyPushEvents.push({
            id: 'legacy-push',
            created_at: log.synced_at,
            event_type: 'push',
            contacts_synced: log.contacts_synced,
            contacts_errors: log.contacts_errors,
            contacts_skipped: log.contacts_skipped,
            skipped_contacts: Array.isArray(log.skipped_contacts) ? log.skipped_contacts : [],
            error_details: Array.isArray(log.last_error_details) ? log.last_error_details : [],
            companies_updated: null,
            pull_count: null,
            crm_contacts_fetched: null,
            crm_contacts_mirrored: null,
            contact_events_emitted: null,
            contact_context_only_events: null,
            crm_recomputed_companies: null,
            crm_unresolved_count: null,
            contact_signal_types: [],
            contact_context_signal_types: [],
            deal_signal_types: [],
            deals_fetched: null,
            deals_mirrored: null,
            deal_events_emitted: null,
            filename: null,
            total_rows: null,
            processed_rows: null,
            duplicate_rows: null,
            failed_rows: null,
            batch_status: null,
          });
        }
      }

      const merged = [...syncEvents, ...importEvents, ...legacyPushEvents].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      setEvents(merged.filter((e) => new Date(e.created_at).getTime() >= cutoff));
      setSignalEvents(
        (signalsJson.data ?? []).map((row) => ({
          id: String(row.id ?? ''),
          signalKey: String(row.signal_key ?? 'unknown_signal'),
          scope: row.scope === 'contact' ? 'contact' : 'company',
          runner: String(row.runner ?? 'unknown_runner'),
          status: String(row.status ?? 'unknown'),
          createdAt: String(row.created_at ?? new Date().toISOString()),
          processed: typeof row.processed === 'number' ? row.processed : null,
          failed: typeof row.failed === 'number' ? row.failed : null,
          skippedRunning: typeof row.skipped_running === 'number' ? row.skipped_running : null,
          companyIds: Array.isArray(row.company_ids)
            ? row.company_ids.filter((v): v is string => typeof v === 'string')
            : [],
          contactIds: Array.isArray(row.contact_ids)
            ? row.contact_ids.filter((v): v is string => typeof v === 'string')
            : [],
          limitValue: typeof row.limit_value === 'number' ? row.limit_value : null,
        })),
      );
    } finally {
      setLoadingData(false);
      setLoadingSignals(false);
    }
  }, []);

  useEffect(() => {
    if (user) void fetchEvents();
  }, [user, fetchEvents]);

  const toggle = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSignal = (id: string) =>
    setExpandedSignalIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (loading || loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen bg-transparent">
      <AppSidebar />

      <div className="flex min-h-0 flex-1 overflow-hidden md:flex-row flex-col">
        <div className="bg-transparent flex-1 overflow-auto px-6 py-8 lg:px-10">
          <div className="w-full max-w-[1180px] mx-auto">
            <PageHeader
              eyebrow="Activity"
              title="Sync log"
              subtitle={
                events.length > 0
                  ? `${events.length} sync ${events.length === 1 ? 'event' : 'events'} — click any to inspect.`
                  : 'A history of every HubSpot sync will appear here.'
              }
            />

            <div className="rounded-2xl border border-white/80 bg-white/45 p-3 shadow-[0_8px_24px_-16px_rgba(13,53,71,0.2)]">
              <button
                type="button"
                onClick={() => setSyncSectionOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-xl bg-white/60 px-3 py-2 text-left"
              >
                <div>
                  <p className="text-[15px] font-semibold text-[#0d3547]">Sync log</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[#7d909a]">{filteredEvents.length} items</span>
                  <ChevronDown
                    className={`h-4 w-4 text-[#7d909a] transition-transform ${syncSectionOpen ? 'rotate-180' : ''}`}
                  />
                </div>
              </button>

              {syncSectionOpen && (
                <div className="mt-3">
                  {events.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="w-16 h-16 rounded-full bg-[rgba(13,53,71,0.05)] flex items-center justify-center mb-4">
                  <RefreshCw className="w-8 h-8 text-[#b6c2c8]" />
                </div>
                <h3 className="font-manrope text-lg font-semibold text-[#0d3547] mb-2">No sync events yet</h3>
                <p className="text-[#7d909a] text-sm max-w-xs">Push or pull data to HubSpot and events will appear here.</p>
              </div>
                  ) : (
              <>
                {/* Filter pills */}
                <div className="mb-4 flex flex-wrap gap-2">
                  {FILTERS.map((f) => {
                    const count = events.filter((e) => matchesFilter(e, f.value)).length;
                    if (count === 0 && f.value !== 'all') return null;
                    return (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => setFilter(f.value)}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                          filter === f.value
                            ? 'bg-arcova-navy text-white'
                            : 'bg-white/70 border border-[rgba(13,53,71,0.1)] text-[#4a6470] hover:bg-white hover:text-[#0d3547]'
                        }`}
                      >
                        {f.label}
                        <span className={`text-[10px] ${filter === f.value ? 'text-white/70' : 'text-[#b6c2c8]'}`}>{count}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-2">
                  {events
                    .filter((e) => matchesFilter(e, filter))
                    .map((event) => (
                      <SyncEventCard
                        key={event.id}
                        event={event}
                        collapsed={!expandedIds.has(event.id)}
                        onToggle={() => toggle(event.id)}
                      />
                    ))}
                </div>
              </>
                  )}
                </div>
              )}
            </div>

            {/* ── Outreach errors ──────────────────────────────────────── */}
            <div className="mt-6 rounded-2xl border border-white/80 bg-white/45 p-3 shadow-[0_8px_24px_-16px_rgba(13,53,71,0.2)]">
              <button
                type="button"
                onClick={() => setOutreachErrorsOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-xl bg-white/60 px-3 py-2 text-left"
              >
                <div>
                  <p className="text-[15px] font-semibold text-[#0d3547]">Outreach errors</p>
                  <p className="text-[11px] text-[#7d909a]">
                    Sequences that failed to dispatch (lemlist API rejection, missing email, etc.).
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] ${outreachErrors.length > 0 ? 'text-red-600 font-semibold' : 'text-[#7d909a]'}`}>
                    {outreachErrors.length} items
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-[#7d909a] transition-transform ${outreachErrorsOpen ? 'rotate-180' : ''}`}
                  />
                </div>
              </button>

              {outreachErrorsOpen && (
                <div className="mt-3">
                  {outreachErrors.length === 0 ? (
                    <div className="rounded-lg border border-white/80 bg-white/55 p-4 text-sm text-[#7d909a]">
                      No failed dispatches. 🎉
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {outreachErrors.map((err) => (
                        <div
                          key={err.id}
                          className="rounded-lg border border-red-200 bg-red-50/50 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold text-[#0d3547]">{err.contact_name}</p>
                              <p className="mt-0.5 text-[11.5px] text-[#7d909a]">
                                Anchor: {err.anchor_hook_text}
                              </p>
                              <p className="mt-1.5 text-[12px] text-red-700 font-mono leading-snug break-all">
                                {err.dispatch_error ?? 'Unknown error'}
                              </p>
                            </div>
                            <div className="shrink-0 flex flex-col items-end gap-1">
                              <span className="text-[10.5px] text-[#b6c2c8]">
                                {err.last_status_at ? relativeTime(err.last_status_at) : ''}
                              </span>
                              <button
                                type="button"
                                onClick={async () => {
                                  setRetryingId(err.id);
                                  try {
                                    const res = await fetch('/api/outreach/lemlist/retry', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ sequenceIds: [err.id] }),
                                    });
                                    const j = (await res.json().catch(() => ({}))) as {
                                      results?: Array<{ ok: boolean; error?: string }>;
                                      error?: string;
                                    };
                                    const ok = res.ok && (j.results?.[0]?.ok ?? false);
                                    if (ok) {
                                      // Remove this row from the visible list — it's no longer failed.
                                      setOutreachErrors((prev) => prev.filter((e) => e.id !== err.id));
                                    } else {
                                      alert(j.results?.[0]?.error ?? j.error ?? 'Retry failed');
                                    }
                                  } finally {
                                    setRetryingId(null);
                                  }
                                }}
                                disabled={retryingId === err.id}
                                className="inline-flex items-center gap-1 rounded-md border border-arcova-teal/40 bg-white px-2 py-0.5 text-[11px] font-semibold text-arcova-teal hover:bg-arcova-teal/5 disabled:opacity-60"
                              >
                                {retryingId === err.id ? 'Retrying…' : 'Retry'}
                              </button>
                              <button
                                type="button"
                                onClick={() => router.push(`/outreach?status=failed&highlight=${encodeURIComponent(err.id)}`)}
                                className="text-[10.5px] text-[#7d909a] hover:text-arcova-teal underline-offset-2 hover:underline"
                              >
                                Open in /outreach
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-6 rounded-2xl border border-white/80 bg-white/45 p-3 shadow-[0_8px_24px_-16px_rgba(13,53,71,0.2)]">
              <button
                type="button"
                onClick={() => setSignalsSectionOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-xl bg-white/60 px-3 py-2 text-left"
              >
                <div>
                  <p className="text-[15px] font-semibold text-[#0d3547]">Signals log</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[#7d909a]">{signalEvents.length} items</span>
                  <ChevronDown
                    className={`h-4 w-4 text-[#7d909a] transition-transform ${signalsSectionOpen ? 'rotate-180' : ''}`}
                  />
                </div>
              </button>

              {signalsSectionOpen && (
                <div className="mt-3">
                  {loadingSignals ? (
                    <div className="py-6 text-sm text-[#7d909a]">Loading signals...</div>
                  ) : signalEvents.length === 0 ? (
                    <div className="rounded-lg border border-white/80 bg-white/55 p-4 text-sm text-[#7d909a]">
                      No signal events yet.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {signalEvents.map((event) => (
                        <SignalEventCard
                          key={event.id}
                          event={event}
                          collapsed={!expandedSignalIds.has(event.id)}
                          onToggle={() => toggleSignal(event.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <AgentPanel
          page="log"
          pageContext={{
            syncEvents: events.slice(0, 20).map((e) => ({
              id: e.id,
              created_at: e.created_at,
              event_type: e.event_type,
              contacts_synced: e.contacts_synced,
              contacts_errors: e.contacts_errors,
              contacts_skipped: e.contacts_skipped,
              error_details: e.error_details,
              companies_updated: e.companies_updated,
              pull_count: e.pull_count,
              deals_fetched: e.deals_fetched,
              deals_mirrored: e.deals_mirrored,
              deal_events_emitted: e.deal_events_emitted,
              filename: e.filename,
              total_rows: e.total_rows,
              processed_rows: e.processed_rows,
              duplicate_rows: e.duplicate_rows,
              failed_rows: e.failed_rows,
              batch_status: e.batch_status,
            })),
          }}
        />
      </div>
    </div>
  );
}
