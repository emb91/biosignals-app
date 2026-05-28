'use client';

/**
 * OutreachPanel — contact-side-panel surface for picking a signal-anchored
 * hook and generating a 7-message outreach sequence.
 *
 * Two views, swapped in-place:
 *   PICKER  — shows recent signals (last 14d) for this contact + their
 *             company, ordered with contact-level signals first. No LLM —
 *             pure DB query. User picks one as the anchor.
 *   EDITOR  — Sonnet generates 7 editable messages anchored to the picked
 *             signal. User can edit each, then "Save & download CSV" or
 *             "Save & copy clipboard". Either persists to outreach_sequences.
 *
 * Cost model:
 *   - Picker is free (DB query only)
 *   - Sequence is one Sonnet call (~$0.04). Re-clicking the same signal
 *     anchor returns the cached draft from outreach_sequences (no re-run).
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Download, Copy, ChevronLeft, Sparkles } from 'lucide-react';
import { invalidateCache } from '@/lib/page-fetch-cache';

type Hook = {
  // Source: 'signal' (a signal_source_events row) or 'derived' (computed
  // from contact state, e.g. recent role change captured outside the signals
  // table).
  source_type: 'signal' | 'derived';
  source_event_id: string | null;
  source_event_at: string | null;   // ISO timestamp
  signal_type: string | null;        // e.g. 'funding_round', 'phase_transition'
  is_contact_level: boolean;         // true → contact-specific; false → company
  title: string;                     // signal title (what gets shown)
  summary: string | null;            // signal summary (optional secondary line)
};

type Message = {
  day_offset: number;
  subject: string;
  body: string;
};

type Props = {
  contactId: string;
  contactName: string;
};

export function OutreachPanel({ contactId, contactName }: Props) {
  const [view, setView] = useState<'picker' | 'editor'>('picker');

  // Picker state
  const [hooks, setHooks] = useState<Hook[] | null>(null);
  const [hooksLoading, setHooksLoading] = useState(false);
  const [hooksError, setHooksError] = useState<string | null>(null);

  // Editor state
  const [anchorHook, setAnchorHook] = useState<Hook | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sequenceLoading, setSequenceLoading] = useState(false);
  const [sequenceError, setSequenceError] = useState<string | null>(null);

  // Export state
  const [exporting, setExporting] = useState<'csv' | 'clipboard' | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  // Reset when contact changes
  useEffect(() => {
    setView('picker');
    setHooks(null);
    setAnchorHook(null);
    setMessages([]);
    setSequenceError(null);
    setHooksError(null);
    setExportSuccess(null);
  }, [contactId]);

  // Auto-load signals on mount — cheap DB query, no LLM cost.
  useEffect(() => {
    if (hooks !== null || hooksLoading) return;
    let cancelled = false;
    setHooksLoading(true);
    setHooksError(null);
    (async () => {
      try {
        const res = await fetch(`/api/outreach/hooks?contactId=${encodeURIComponent(contactId)}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setHooks(json.hooks ?? []);
      } catch (e) {
        if (cancelled) return;
        setHooksError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setHooksLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contactId, hooks, hooksLoading]);

  const refreshHooks = useCallback(() => {
    setHooks(null);
    setHooksError(null);
  }, []);

  const pickHook = useCallback(
    async (hook: Hook) => {
      setAnchorHook(hook);
      setMessages([]);
      setSequenceError(null);
      setSequenceLoading(true);
      setView('editor');
      setExportSuccess(null);
      try {
        const res = await fetch('/api/outreach/sequence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contactId,
            anchorHookText: hook.title,
            anchorSignalEventId: hook.source_event_id,
            anchorSignalType: hook.signal_type,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setMessages(json.messages ?? []);
      } catch (e) {
        setSequenceError(e instanceof Error ? e.message : String(e));
      } finally {
        setSequenceLoading(false);
      }
    },
    [contactId],
  );

  const backToPicker = useCallback(() => {
    setView('picker');
    setAnchorHook(null);
    setMessages([]);
    setSequenceError(null);
    setExportSuccess(null);
  }, []);

  const updateMessage = useCallback((index: number, patch: Partial<Message>) => {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }, []);

  const exportSequence = useCallback(
    async (format: 'csv' | 'clipboard') => {
      if (!anchorHook || messages.length === 0) return;
      setExporting(format);
      setExportSuccess(null);
      try {
        const res = await fetch('/api/outreach/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contactId,
            anchorHookText: anchorHook.title,
            anchorSignalEventId: anchorHook.source_event_id,
            anchorSignalType: anchorHook.signal_type,
            messages,
            exportFormat: format,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

        if (format === 'csv' && typeof json.csv === 'string') {
          const blob = new Blob([json.csv], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const safeName = contactName.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
          const safeLabel = (anchorHook.signal_type ?? 'signal').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
          a.download = `outreach-${safeName}-${safeLabel}.csv`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          setExportSuccess('Saved + CSV downloaded.');
        } else if (format === 'clipboard' && typeof json.clipboardText === 'string') {
          await navigator.clipboard.writeText(json.clipboardText);
          setExportSuccess('Saved + copied to clipboard.');
        }
        invalidateCache('/api/outreach');
      } catch (e) {
        setExportSuccess(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setExporting(null);
      }
    },
    [anchorHook, messages, contactId, contactName],
  );

  // ── PICKER ──────────────────────────────────────────────────────────────
  if (view === 'picker') {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-gray-500">
            Pick a recent signal to anchor a 7-message sequence on.
          </p>
          <button
            type="button"
            onClick={refreshHooks}
            disabled={hooksLoading}
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-arcova-teal disabled:opacity-50"
            title="Re-query signals"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${hooksLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {hooksLoading && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading signals…
          </div>
        )}

        {hooksError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {hooksError}
          </div>
        )}

        {hooks && hooks.length > 0 && (
          <ul className="space-y-2">
            {hooks.map((h, i) => (
              <li
                key={`${h.source_event_id ?? 'derived'}-${i}`}
                className="rounded-lg border border-gray-150 bg-white px-3 py-2.5 hover:border-arcova-teal/40 transition-colors"
              >
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className={`text-[10px] font-semibold uppercase tracking-wide ${
                    h.is_contact_level ? 'text-arcova-teal' : 'text-gray-500'
                  }`}>
                    {h.is_contact_level ? 'Contact · ' : 'Company · '}
                    {h.signal_type ?? 'signal'}
                  </span>
                  {h.source_event_at && (
                    <span className="text-[10px] text-gray-400">
                      {new Date(h.source_event_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <p className="text-[13px] leading-snug text-gray-800">{h.title}</p>
                {h.summary && (
                  <p className="text-[11.5px] text-gray-500 leading-snug mt-1 line-clamp-2">{h.summary}</p>
                )}
                <button
                  type="button"
                  onClick={() => pickHook(h)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-arcova-teal text-white px-2.5 py-1 text-xs font-semibold hover:bg-arcova-teal/90 transition-colors"
                >
                  <Sparkles className="w-3 h-3" />
                  Generate sequence
                </button>
              </li>
            ))}
          </ul>
        )}

        {hooks && hooks.length === 0 && !hooksLoading && !hooksError && (
          <p className="text-xs text-gray-500">
            No signals in the last 14 days for this contact or their company. Check back when new activity lands, or pick a different contact.
          </p>
        )}
      </div>
    );
  }

  // ── EDITOR ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={backToPicker}
        className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-arcova-teal"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        Pick a different signal
      </button>

      {anchorHook && (
        <div className="rounded-lg border border-arcova-teal/30 bg-arcova-teal/5 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-arcova-teal">
            Anchor · {anchorHook.signal_type ?? 'signal'}
            {anchorHook.source_event_at && (
              <span className="ml-1 text-gray-400 font-normal normal-case tracking-normal">
                · {new Date(anchorHook.source_event_at).toLocaleDateString()}
              </span>
            )}
          </p>
          <p className="mt-1 text-[12px] leading-snug text-gray-700">{anchorHook.title}</p>
        </div>
      )}

      {sequenceLoading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Drafting 7-message sequence…
        </div>
      )}

      {sequenceError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {sequenceError}
        </div>
      )}

      {messages.length > 0 && (
        <>
          <ul className="space-y-3">
            {messages.map((m, i) => (
              <li key={i} className="rounded-xl border border-gray-150 bg-white p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                  {m.day_offset === 0 ? 'Day 0 · Initial' : `Day ${m.day_offset} · Follow-up`}
                </p>
                <input
                  type="text"
                  value={m.subject}
                  onChange={(e) => updateMessage(i, { subject: e.target.value })}
                  className="w-full rounded-md border border-gray-200 px-2 py-1 text-sm font-medium text-gray-900 focus:border-arcova-teal focus:outline-none focus:ring-1 focus:ring-arcova-teal/30"
                  placeholder="Subject"
                />
                <textarea
                  value={m.body}
                  onChange={(e) => updateMessage(i, { body: e.target.value })}
                  rows={Math.min(10, Math.max(3, m.body.split('\n').length + 1))}
                  className="mt-2 w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-700 leading-snug focus:border-arcova-teal focus:outline-none focus:ring-1 focus:ring-arcova-teal/30"
                  placeholder="Message body"
                />
              </li>
            ))}
          </ul>

          {exportSuccess && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                exportSuccess.startsWith('Export failed')
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-green-200 bg-green-50 text-green-800'
              }`}
            >
              {exportSuccess}
            </div>
          )}

          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              onClick={() => exportSequence('csv')}
              disabled={exporting !== null}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-arcova-teal text-white px-3 py-2 text-sm font-semibold hover:bg-arcova-teal/90 transition-colors disabled:opacity-60"
            >
              {exporting === 'csv' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              Save & download CSV
            </button>
            <button
              type="button"
              onClick={() => exportSequence('clipboard')}
              disabled={exporting !== null}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-arcova-teal/40 text-arcova-teal px-3 py-2 text-sm font-semibold hover:bg-arcova-teal/5 transition-colors disabled:opacity-60"
            >
              {exporting === 'clipboard' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              Save & copy to clipboard
            </button>
          </div>
        </>
      )}
    </div>
  );
}
