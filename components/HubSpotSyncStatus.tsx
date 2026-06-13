'use client';

/**
 * Settings → HubSpot sync status. Surfaces the sync history that already lands in
 * hubspot_sync_events (last push/pull/full runs, counts, errors) — previously
 * invisible to users. Read-only; renders only when HubSpot is connected. Sits
 * under the existing "Connect HubSpot" card in Settings.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';

type SyncEvent = {
  id: string;
  event_type: 'push' | 'pull' | 'full' | string;
  contacts_synced: number | null;
  contacts_errors: number | null;
  contacts_skipped: number | null;
  companies_updated: number | null;
  pull_count: number | null;
  created_at: string;
};

const CARD =
  'mt-3 rounded-2xl border border-white/80 bg-white/70 p-5 shadow-[0_8px_24px_-12px_rgba(13,53,71,0.15)] backdrop-blur-xl';

const EVENT_LABEL: Record<string, string> = {
  push: 'Pushed to HubSpot',
  pull: 'Pulled from HubSpot',
  full: 'Full sync',
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function HubSpotSyncStatus() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const statusRes = await fetch('/api/hubspot/status');
      const status = statusRes.ok ? await statusRes.json() : { connected: false };
      if (!status.connected) {
        setConnected(false);
        return;
      }
      setConnected(true);
      const evRes = await fetch('/api/hubspot/sync-events');
      if (evRes.ok) {
        const json = (await evRes.json()) as { data?: SyncEvent[] };
        setEvents(json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Only relevant once HubSpot is connected; otherwise the connect card covers it.
  if (loading) {
    return (
      <div className={`${CARD} flex items-center gap-2 text-sm text-[#7d909a]`}>
        <Loader2 className="h-4 w-4 animate-spin" /> Checking HubSpot sync…
      </div>
    );
  }
  if (!connected) return null;

  const latest = events[0];
  const totalErrors = events.reduce((n, e) => n + (e.contacts_errors ?? 0), 0);

  return (
    <div className={CARD}>
      <div className="flex items-center gap-2">
        <RefreshCw className="h-4 w-4 text-[#0d3547]" />
        <span className="text-sm font-semibold text-slate-950">HubSpot sync</span>
      </div>

      {!latest ? (
        <p className="mt-2 text-sm text-[#7d909a]">
          Connected — no sync has run yet. Arcova syncs automatically each day.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-[#7d909a]">
            Last sync <span className="text-slate-700">{relativeTime(latest.created_at)}</span> ·{' '}
            {(latest.contacts_synced ?? 0).toLocaleString()} contacts
            {latest.companies_updated ? `, ${latest.companies_updated.toLocaleString()} companies` : ''}
            {latest.pull_count ? `, ${latest.pull_count.toLocaleString()} pulled in` : ''}
          </p>
          {totalErrors > 0 && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              {totalErrors.toLocaleString()} contact {totalErrors === 1 ? 'error' : 'errors'} in recent syncs
            </p>
          )}

          <div className="mt-3 space-y-1.5">
            {events.slice(0, 5).map((e) => (
              <div key={e.id} className="flex items-baseline justify-between text-xs text-[#7d909a]">
                <span className="text-slate-600">{EVENT_LABEL[e.event_type] ?? e.event_type}</span>
                <span>
                  {(e.contacts_synced ?? e.pull_count ?? 0).toLocaleString()}
                  {e.contacts_errors ? ` · ${e.contacts_errors} err` : ''} · {relativeTime(e.created_at)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
