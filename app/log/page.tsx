'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { PageHeader } from '@/components/PageHeader';
import { AgentPanel } from '@/components/AgentPanel';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

type EventType = 'push' | 'pull' | 'full';

interface SyncEvent {
  id: string;
  created_at: string;
  event_type: EventType;
  contacts_synced: number | null;
  contacts_errors: number | null;
  contacts_skipped: number | null;
  skipped_contacts: unknown[];
  error_details: string[];
  companies_updated: number | null;
  pull_count: number | null;
  deals_fetched: number | null;
  deals_mirrored: number | null;
  deal_events_emitted: number | null;
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

function eventLabel(type: EventType): string {
  if (type === 'push') return 'Push to HubSpot';
  if (type === 'pull') return 'Pull from HubSpot';
  return 'Full sync';
}

function eventSublabel(event: SyncEvent): string {
  const parts: string[] = [];
  if (event.event_type === 'push' || event.event_type === 'full') {
    if (event.contacts_synced != null) parts.push(`${event.contacts_synced} contacts pushed`);
    if (event.companies_updated != null && event.companies_updated > 0)
      parts.push(`${event.companies_updated} companies updated`);
  }
  if (event.event_type === 'pull' || event.event_type === 'full') {
    if (event.pull_count != null) parts.push(`${event.pull_count} contacts pulled`);
  }
  if (event.event_type === 'full') {
    if (event.deals_mirrored != null && event.deals_mirrored > 0)
      parts.push(`${event.deals_mirrored} deals synced`);
  }
  return parts.join(' · ') || 'No data';
}

function hasErrors(event: SyncEvent): boolean {
  return (event.contacts_errors ?? 0) > 0 || event.error_details.length > 0;
}

// ── SyncEventCard ──────────────────────────────────────────────────────────

function SyncEventCard({
  event,
  index,
  collapsed,
  onToggle,
}: {
  event: SyncEvent;
  index: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const errored = hasErrors(event);

  const TypeIcon =
    event.event_type === 'push'
      ? ArrowUpFromLine
      : event.event_type === 'pull'
      ? ArrowDownToLine
      : RefreshCw;

  return (
    <div
      className={`rounded-[1.25rem] border border-white/80 bg-white/55 backdrop-blur-xl transition-shadow ${
        collapsed
          ? 'shadow-[0_18px_40px_-28px_rgba(13,53,71,0.15),0_1px_3px_rgba(13,53,71,0.04)]'
          : 'shadow-[0_32px_80px_-36px_rgba(13,53,71,0.22),0_1px_3px_rgba(13,53,71,0.05)]'
      }`}
    >
      {/* Header */}
      <div
        className={`flex items-center gap-3.5 px-5 py-4 cursor-pointer transition-colors hover:bg-white/35 ${
          !collapsed ? 'border-b border-[rgba(13,53,71,0.07)]' : ''
        }`}
        onClick={onToggle}
      >
        {/* Numbered badge */}
        <div
          className={`w-9 h-9 shrink-0 rounded-[10px] grid place-items-center font-manrope text-xs font-bold tracking-[0.04em] transition-all ${
            !collapsed
              ? 'bg-gradient-to-br from-arcova-teal to-[#007e8b] text-white shadow-[0_6px_18px_-8px_rgba(0,164,180,0.5)]'
              : 'bg-gradient-to-br from-arcova-teal/18 to-arcova-teal/8 border border-arcova-teal/22 text-arcova-teal'
          }`}
        >
          #{index}
        </div>

        {/* Title + sublabel */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <TypeIcon className="h-3.5 w-3.5 shrink-0 text-[#4a6470]" />
            <span className="block min-w-0 truncate font-manrope text-[15.5px] font-semibold text-[#0d3547] tracking-[-0.018em]">
              {eventLabel(event.event_type)}
            </span>
            {errored && (
              <span className="shrink-0 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.12em] text-red-600">
                Errors
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Clock className="h-[11px] w-[11px] shrink-0 text-[#7d909a]" />
            <span className="text-[11.5px] text-[#7d909a]">
              {absoluteTime(event.created_at)}
              <span className="text-[#b6c2c8]"> · </span>
              {relativeTime(event.created_at)}
            </span>
          </div>
        </div>

        {/* Summary pill (collapsed only) */}
        {collapsed && (
          <span className="hidden sm:inline-flex shrink-0 items-center text-[11px] px-2.5 py-1 rounded-full bg-white/60 border border-[rgba(13,53,71,0.07)] text-[#4a6470]">
            {eventSublabel(event)}
          </span>
        )}

        {/* Caret */}
        <span
          className={`w-7 h-7 shrink-0 grid place-items-center rounded-[8px] border transition-all ${
            !collapsed
              ? 'bg-[#0d3547] border-[#0d3547] text-white'
              : 'bg-white/60 border-[rgba(13,53,71,0.07)] text-[#7d909a] hover:text-[#0d3547]'
          }`}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ${!collapsed ? 'rotate-180' : ''}`}
          />
        </span>
      </div>

      {/* Expanded body */}
      {!collapsed && (
        <div className="px-5 py-5 space-y-4">
          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(event.event_type === 'push' || event.event_type === 'full') && (
              <>
                <Stat label="Contacts pushed" value={event.contacts_synced} />
                <Stat label="Companies updated" value={event.companies_updated} />
                <Stat label="Contacts skipped" value={event.contacts_skipped} />
                <Stat label="Push errors" value={event.contacts_errors} highlight={errored} />
              </>
            )}
            {(event.event_type === 'pull' || event.event_type === 'full') && (
              <Stat label="Contacts pulled" value={event.pull_count} />
            )}
            {event.event_type === 'full' && (
              <>
                <Stat label="Deals fetched" value={event.deals_fetched} />
                <Stat label="Deals mirrored" value={event.deals_mirrored} />
                <Stat label="Deal events" value={event.deal_events_emitted} />
              </>
            )}
          </div>

          {/* Skipped contacts */}
          {Array.isArray(event.skipped_contacts) && event.skipped_contacts.length > 0 && (
            <Section title="Skipped contacts">
              <ul className="space-y-1">
                {(event.skipped_contacts as { name?: string; company?: string; reason?: string }[]).map(
                  (c, i) => (
                    <li key={i} className="text-[12.5px] text-[#4a6470]">
                      <span className="font-medium text-[#0d3547]">{c.name || 'Unknown'}</span>
                      {c.company && <span className="text-[#7d909a]"> · {c.company}</span>}
                      {c.reason && <span className="text-[#b6c2c8]"> — {c.reason}</span>}
                    </li>
                  ),
                )}
              </ul>
            </Section>
          )}

          {/* Error details */}
          {event.error_details.length > 0 && (
            <Section title="Errors" icon={<AlertTriangle className="h-3 w-3 text-red-400" />}>
              <ul className="space-y-1">
                {event.error_details.map((e, i) => (
                  <li key={i} className="text-[12.5px] text-red-600 font-mono break-all">
                    {e}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Clean state */}
          {!errored &&
            !(Array.isArray(event.skipped_contacts) && event.skipped_contacts.length > 0) && (
              <div className="flex items-center gap-2 text-[12.5px] text-[#7d909a]">
                <CheckCircle2 className="h-3.5 w-3.5 text-arcova-teal shrink-0" />
                No errors or skipped contacts
              </div>
            )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | null | undefined;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white/50 border border-[rgba(13,53,71,0.06)] px-3.5 py-3">
      <div
        className={`font-manrope text-xl font-bold tracking-tight ${
          highlight && (value ?? 0) > 0 ? 'text-red-500' : 'text-[#0d3547]'
        }`}
      >
        {value ?? 0}
      </div>
      <div className="mt-0.5 text-[11px] text-[#7d909a]">{label}</div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7d909a]">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function LogPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, router, user]);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/hubspot/sync-events');
      if (!res.ok) return;
      const json = await res.json() as { data: SyncEvent[] };
      setEvents(
        (json.data ?? []).map((e) => ({
          ...e,
          skipped_contacts: Array.isArray(e.skipped_contacts) ? e.skipped_contacts : [],
          error_details: Array.isArray(e.error_details)
            ? (e.error_details as unknown[]).filter((x): x is string => typeof x === 'string')
            : [],
        })),
      );
    } finally {
      setLoadingData(false);
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

      <div className="flex min-h-0 flex-1 overflow-hidden min-[1280px]:flex-row flex-col">
        <div className="arcova-scroll-surface flex-1 overflow-auto px-6 py-8 lg:px-10">
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

            {events.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="w-16 h-16 rounded-full bg-[rgba(13,53,71,0.05)] flex items-center justify-center mb-4">
                  <RefreshCw className="w-8 h-8 text-[#b6c2c8]" />
                </div>
                <h3 className="font-manrope text-lg font-semibold text-[#0d3547] mb-2">
                  No sync events yet
                </h3>
                <p className="text-[#7d909a] text-sm max-w-xs">
                  Push or pull data to HubSpot and events will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {events.map((event, i) => (
                  <SyncEventCard
                    key={event.id}
                    event={event}
                    index={events.length - i}
                    collapsed={!expandedIds.has(event.id)}
                    onToggle={() => toggle(event.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <AgentPanel page="log" pageContext={{}} />
      </div>
    </div>
  );
}
