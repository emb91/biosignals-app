'use client';

/**
 * /outreach — sequence editor + dispatch surface.
 *
 * Rows = staged contact-sequences (one per outreach_sequences row).
 * Cols = step 1..N of the sequence (subject + body + channel pill).
 *
 * Click a cell → side panel (mirrors /contacts detail-panel style) with
 * editable subject/body + per-step channel selector (Email / LinkedIn).
 * Save updates the messages jsonb in-place.
 *
 * Send to lemlist: per-row "Send" button OR bulk-select multiple → "Send
 * selected". Both open a campaign picker, then POST /api/outreach/lemlist/dispatch.
 */

import { useAuth } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Mail,
  Linkedin,
  Send,
  X,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Clock,
  MessageSquareReply,
} from 'lucide-react';
import AppSidebar from '@/components/AppSidebar';
import { PageHeader } from '@/components/PageHeader';
import { AgentPanel } from '@/components/AgentPanel';

// ── Types ──────────────────────────────────────────────────────────────────

type Channel = 'email' | 'linkedin';

interface Message {
  day_offset: number;
  subject: string;
  body: string;
  channel?: Channel;
}

interface Contact {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  job_title: string | null;
  company_name: string | null;
  linkedin_url: string | null;
}

interface Sequence {
  id: string;
  contact_id: string;
  company_id: string | null;
  anchor_hook_text: string;
  anchor_signal_type: string | null;
  anchor_signal_event_id: string | null;
  messages: Message[];
  dispatch_channel: string | null;
  dispatch_status: string | null;
  dispatch_error: string | null;
  external_ref: {
    lemlist_lead_id?: string | null;
    lemlist_campaign_id?: string | null;
    lemlist_lead_email?: string | null;
  } | null;
  last_status_at: string | null;
  created_at: string;
  contact: Contact | null;
}

interface LemlistCampaign {
  _id: string;
  name: string;
}

type StatusFilter = 'all' | 'draft' | 'sent' | 'replied' | 'failed';

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  replied: 'Replied',
  failed: 'Failed',
  exported: 'Exported',
  queued: 'Queued',
};

const STATUS_PILL: Record<string, string> = {
  draft: 'bg-[#0d3547]/8 text-[#0d3547] border-[#0d3547]/12',
  sent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  replied: 'bg-violet-50 text-violet-700 border-violet-200',
  failed: 'bg-red-50 text-red-500 border-red-200',
  exported: 'bg-slate-50 text-slate-600 border-slate-200',
  queued: 'bg-amber-50 text-amber-700 border-amber-200',
};

const STATUS_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  draft: Clock,
  sent: CheckCircle2,
  replied: MessageSquareReply,
  failed: AlertCircle,
  exported: CheckCircle2,
  queued: Clock,
};

function relTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function displayName(c: Contact | null): string {
  if (!c) return 'Unknown contact';
  return c.full_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Unknown';
}

function maxSteps(sequences: Sequence[]): number {
  return sequences.reduce((max, s) => Math.max(max, s.messages?.length ?? 0), 0);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function OutreachPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('highlight');

  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Cell editor side panel
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSequenceId, setEditingSequenceId] = useState<string | null>(null);
  const [editingStepIdx, setEditingStepIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Message | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Dispatch modal
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchRowIds, setDispatchRowIds] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<LemlistCampaign[] | null>(null);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, router, user]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/outreach/sequences');
      if (res.ok) {
        const json = (await res.json()) as { sequences: Sequence[] };
        setSequences(json.sequences ?? []);
      }
    } finally {
      setLoadingData(false);
    }
  }, []);

  // Poll lemlist for reply/failure status updates whenever the page mounts.
  // Acts as a fallback when the reply webhook isn't wired — slower than the
  // webhook (only fires on page open), but ensures /outreach shows reality
  // even if the customer hasn't done the lemlist webhook setup yet.
  const syncStatusThenRefresh = useCallback(async () => {
    try {
      await fetch('/api/outreach/lemlist/sync-status', { method: 'POST' });
    } catch {
      // best-effort
    }
    await refresh();
  }, [refresh]);

  useEffect(() => {
    if (user) void syncStatusThenRefresh();
  }, [user, syncStatusThenRefresh]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return sequences;
    return sequences.filter((s) => (s.dispatch_status ?? 'draft') === statusFilter);
  }, [sequences, statusFilter]);

  const steps = useMemo(() => maxSteps(filtered), [filtered]);

  // ── Selection ──────────────────────────────────────────────────────────
  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id));
  const toggleAll = () => {
    if (allFilteredSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((s) => s.id)));
  };

  // ── Cell editor ────────────────────────────────────────────────────────
  const openCellEditor = (sequenceId: string, stepIdx: number) => {
    const seq = sequences.find((s) => s.id === sequenceId);
    if (!seq) return;
    const msg = seq.messages?.[stepIdx];
    if (!msg) return;
    setEditingSequenceId(sequenceId);
    setEditingStepIdx(stepIdx);
    setEditDraft({ ...msg, channel: msg.channel ?? 'email' });
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingSequenceId(null);
    setEditingStepIdx(null);
    setEditDraft(null);
  };

  const saveEdit = async () => {
    if (!editingSequenceId || editingStepIdx === null || !editDraft) return;
    const seq = sequences.find((s) => s.id === editingSequenceId);
    if (!seq) return;

    const nextMessages = seq.messages.map((m, i) => (i === editingStepIdx ? editDraft : m));

    setSavingEdit(true);
    try {
      const res = await fetch(`/api/outreach/sequences/${editingSequenceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
      });
      if (res.ok) {
        setSequences((prev) =>
          prev.map((s) => (s.id === editingSequenceId ? { ...s, messages: nextMessages } : s)),
        );
        closeEditor();
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteSequence = async (id: string) => {
    if (!confirm('Delete this sequence? This does not remove it from lemlist.')) return;
    const res = await fetch(`/api/outreach/sequences/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setSequences((prev) => prev.filter((s) => s.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // ── Dispatch ───────────────────────────────────────────────────────────
  const openDispatch = async (ids: string[]) => {
    if (ids.length === 0) return;
    setDispatchRowIds(ids);
    setDispatchOpen(true);
    setDispatchError(null);
    setSelectedCampaignId('');
    setCampaignsLoading(true);
    try {
      const res = await fetch('/api/outreach/lemlist/campaigns');
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setDispatchError(j.error ?? 'Could not load campaigns');
        setCampaigns([]);
      } else {
        const json = (await res.json()) as { campaigns: LemlistCampaign[] };
        setCampaigns(json.campaigns ?? []);
      }
    } finally {
      setCampaignsLoading(false);
    }
  };

  const doDispatch = async () => {
    if (!selectedCampaignId || dispatchRowIds.length === 0) return;
    setDispatching(true);
    setDispatchError(null);
    try {
      const res = await fetch('/api/outreach/lemlist/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequenceIds: dispatchRowIds, campaignId: selectedCampaignId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        results?: Array<{ id: string; ok: boolean; error?: string }>;
        error?: string;
      };
      if (!res.ok) {
        setDispatchError(json.error ?? 'Dispatch failed');
        return;
      }
      const failed = (json.results ?? []).filter((r) => !r.ok);
      if (failed.length > 0) {
        setDispatchError(
          `${failed.length} of ${json.results?.length ?? 0} failed: ${failed[0].error ?? ''}`,
        );
      }
      await refresh();
      if (failed.length === 0) {
        setDispatchOpen(false);
        setSelectedIds(new Set());
      }
    } finally {
      setDispatching(false);
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────
  if (loading || loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-arcova-teal" />
      </div>
    );
  }
  if (!user) return null;

  const FILTERS: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'draft', label: 'Drafts' },
    { value: 'sent', label: 'Sent' },
    { value: 'replied', label: 'Replied' },
    { value: 'failed', label: 'Failed' },
  ];

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-transparent">
      <AppSidebar />

      <div className="flex min-h-0 flex-1 overflow-hidden md:flex-row flex-col">
        <div className="bg-transparent flex-1 overflow-auto px-6 py-8 lg:px-10">
          <div className="w-full max-w-[1600px] mx-auto">
            <PageHeader
              eyebrow="Outreach"
              title="Staged sequences"
              subtitle={
                sequences.length === 0
                  ? 'Generate a sequence from a contact and stage it here. Pick channel per step, then send to lemlist.'
                  : `${sequences.length} sequence${sequences.length === 1 ? '' : 's'} staged. Edit copy, pick channel per step, dispatch.`
              }
            />

            {/* Filters + bulk action bar */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {FILTERS.map((f) => {
                const count =
                  f.value === 'all'
                    ? sequences.length
                    : sequences.filter((s) => (s.dispatch_status ?? 'draft') === f.value).length;
                if (count === 0 && f.value !== 'all') return null;
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setStatusFilter(f.value)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                      statusFilter === f.value
                        ? 'bg-arcova-navy text-white'
                        : 'bg-white/70 border border-[rgba(13,53,71,0.1)] text-[#4a6470] hover:bg-white hover:text-[#0d3547]'
                    }`}
                  >
                    {f.label}
                    <span className={`text-[10px] ${statusFilter === f.value ? 'text-white/70' : 'text-[#b6c2c8]'}`}>
                      {count}
                    </span>
                  </button>
                );
              })}

              <div className="ml-auto flex items-center gap-2">
                {selectedIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => void openDispatch(Array.from(selectedIds))}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-navy px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0d3547]"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Send {selectedIds.size} to lemlist
                  </button>
                )}
              </div>
            </div>

            {/* Empty state */}
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center rounded-2xl border border-white/80 bg-white/55 backdrop-blur-xl">
                <div className="w-16 h-16 rounded-full bg-[rgba(13,53,71,0.05)] flex items-center justify-center mb-4">
                  <Send className="w-8 h-8 text-[#b6c2c8]" />
                </div>
                <h3 className="font-manrope text-lg font-semibold text-[#0d3547] mb-2">
                  Nothing here yet
                </h3>
                <p className="text-[#7d909a] text-sm max-w-sm">
                  Generate a sequence on a contact and click <span className="font-medium text-[#0d3547]">Stage for outreach</span>{' '}
                  to land it on this page.
                </p>
              </div>
            ) : (
              /* Table */
              <div className="rounded-2xl border border-white/80 bg-white/55 backdrop-blur-xl shadow-[0_8px_24px_-16px_rgba(13,53,71,0.2)] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-white/60 border-b border-[rgba(13,53,71,0.07)]">
                      <tr>
                        <th className="sticky left-0 z-10 bg-white/80 px-3 py-2 text-left w-10">
                          <input
                            type="checkbox"
                            checked={allFilteredSelected}
                            onChange={toggleAll}
                            className="rounded border-[rgba(13,53,71,0.2)]"
                          />
                        </th>
                        <th className="sticky left-10 z-10 bg-white/80 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[#7d909a] min-w-[220px]">
                          Contact
                        </th>
                        <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[#7d909a] min-w-[180px]">
                          Anchor signal
                        </th>
                        <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[#7d909a]">
                          Status
                        </th>
                        {Array.from({ length: steps }).map((_, i) => {
                          // Day label comes from whichever filtered row has a
                          // message at this step index — they should all
                          // share the same cadence, but fall back gracefully.
                          const dayOffset = filtered
                            .map((s) => s.messages?.[i]?.day_offset)
                            .find((d) => typeof d === 'number');
                          return (
                            <th
                              key={i}
                              className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[#7d909a] min-w-[200px]"
                            >
                              Step {i + 1}
                              {typeof dayOffset === 'number' && (
                                <span className="ml-1 normal-case text-[10.5px] text-[#b6c2c8]">
                                  (Day {dayOffset})
                                </span>
                              )}
                            </th>
                          );
                        })}
                        <th className="px-3 py-2 w-20" />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((seq) => {
                        const status = seq.dispatch_status ?? 'draft';
                        const StatusIcon = STATUS_ICON[status] ?? Clock;
                        const highlight = highlightId && seq.id === highlightId;
                        return (
                          <tr
                            key={seq.id}
                            className={`border-b border-[rgba(13,53,71,0.05)] hover:bg-white/40 ${
                              highlight ? 'bg-arcova-teal/8' : ''
                            }`}
                          >
                            <td className="sticky left-0 z-10 bg-white/80 px-3 py-2.5 align-top">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(seq.id)}
                                onChange={() => toggleSelected(seq.id)}
                                className="rounded border-[rgba(13,53,71,0.2)]"
                              />
                            </td>
                            <td className="sticky left-10 z-10 bg-white/80 px-3 py-2.5 align-top">
                              <div className="font-medium text-[#0d3547]">{displayName(seq.contact)}</div>
                              {seq.contact?.job_title && (
                                <div className="text-[11px] text-[#7d909a]">{seq.contact.job_title}</div>
                              )}
                              {seq.contact?.company_name && (
                                <div className="text-[11px] text-[#7d909a]">{seq.contact.company_name}</div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 align-top">
                              <div className="text-[#0d3547] leading-snug">
                                {truncate(seq.anchor_hook_text, 90)}
                              </div>
                              {seq.anchor_signal_type && (
                                <div className="mt-0.5 text-[11px] text-[#7d909a]">
                                  {seq.anchor_signal_type.replace(/_/g, ' ')}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 align-top">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${STATUS_PILL[status] ?? STATUS_PILL.draft}`}
                              >
                                <StatusIcon className="h-3 w-3" />
                                {STATUS_LABEL[status] ?? status}
                              </span>
                              {seq.last_status_at && (
                                <div className="mt-0.5 text-[10.5px] text-[#b6c2c8]">{relTime(seq.last_status_at)}</div>
                              )}
                              {seq.dispatch_error && (
                                <div className="mt-1 text-[10.5px] text-red-600 max-w-[200px] line-clamp-2">
                                  {seq.dispatch_error}
                                </div>
                              )}
                            </td>
                            {Array.from({ length: steps }).map((_, i) => {
                              const msg = seq.messages?.[i];
                              if (!msg) {
                                return <td key={i} className="px-3 py-2.5 align-top text-[#b6c2c8]">—</td>;
                              }
                              const ch = msg.channel ?? 'email';
                              const ChIcon = ch === 'linkedin' ? Linkedin : Mail;
                              // Tinted background (no left border — visually
                              // noisy with 7 stacked columns) + the pill
                              // carries the channel identity.
                              const cellChannelClass = ch === 'linkedin'
                                ? 'bg-[#0a66c2]/[0.04]'
                                : 'bg-arcova-teal/[0.04]';
                              return (
                                <td
                                  key={i}
                                  className={`px-3 py-2.5 align-top cursor-pointer hover:bg-arcova-teal/5 ${cellChannelClass}`}
                                  onClick={() => openCellEditor(seq.id, i)}
                                >
                                  <div className="flex items-start gap-1.5">
                                    <span className={`mt-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0 ${
                                      ch === 'linkedin'
                                        ? 'bg-[#0a66c2]/10 text-[#0a66c2]'
                                        : 'bg-arcova-teal/10 text-arcova-teal'
                                    }`}>
                                      <ChIcon className="h-3 w-3" />
                                      {ch === 'linkedin' ? 'LI' : 'Email'}
                                    </span>
                                    <div className="min-w-0">
                                      <div className="font-medium text-[#0d3547] leading-tight">
                                        {truncate(msg.subject, 50)}
                                      </div>
                                      <div className="mt-0.5 text-[11px] text-[#7d909a] line-clamp-2 leading-snug">
                                        {truncate(msg.body, 110)}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              );
                            })}
                            <td className="px-3 py-2.5 align-top">
                              <div className="flex items-center gap-1">
                                {status === 'draft' || status === 'failed' ? (
                                  <button
                                    type="button"
                                    onClick={() => void openDispatch([seq.id])}
                                    className="rounded-md bg-arcova-navy p-1.5 text-white hover:bg-[#0d3547]"
                                    title="Send to lemlist"
                                  >
                                    <Send className="h-3 w-3" />
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => void deleteSequence(seq.id)}
                                  className="rounded-md p-1.5 text-[#b6c2c8] hover:bg-red-50 hover:text-red-500"
                                  title="Delete"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        <AgentPanel
          page="outreach"
          pageContext={{
            sequenceCount: sequences.length,
            // The agent uses this to call load_outreach_context. When a cell
            // is open the agent gets a focused step; otherwise it sees the
            // whole sequence the rep last clicked.
            selectedSequenceId: editingSequenceId,
            selectedStepIndex: editingStepIdx,
          }}
        />
      </div>

      {/* ── Cell editor side panel ─────────────────────────────────────── */}
      {editorOpen && editDraft && editingSequenceId && (
        <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-white/80 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-[rgba(13,53,71,0.08)] px-5 py-3">
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#7d909a]">
                Step {(editingStepIdx ?? 0) + 1} · Day {editDraft.day_offset}
              </p>
              <h3 className="text-base font-semibold text-[#0d3547]">Edit message</h3>
            </div>
            <button
              type="button"
              onClick={closeEditor}
              className="rounded-md p-1 text-[#b6c2c8] hover:bg-[#f4f7f9] hover:text-[#4a6470]"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Channel selector — mirrors /contacts detail panel field style */}
            <div>
              <label className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#7d909a]">
                Channel
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(['email', 'linkedin'] as Channel[]).map((ch) => {
                  const ChIcon = ch === 'linkedin' ? Linkedin : Mail;
                  const active = editDraft.channel === ch;
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setEditDraft({ ...editDraft, channel: ch })}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] font-medium transition-colors ${
                        active
                          ? ch === 'linkedin'
                            ? 'border-[#0a66c2] bg-[#0a66c2]/8 text-[#0a66c2]'
                            : 'border-arcova-teal bg-arcova-teal/8 text-arcova-teal'
                          : 'border-[rgba(13,53,71,0.15)] bg-white text-[#4a6470] hover:bg-[#f4f7f9]'
                      }`}
                    >
                      <ChIcon className="h-3.5 w-3.5" />
                      {ch === 'linkedin' ? 'LinkedIn' : 'Email'}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Subject (LinkedIn ignores it, kept editable for parity) */}
            <div>
              <label className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#7d909a]">
                Subject
              </label>
              <input
                type="text"
                value={editDraft.subject}
                onChange={(e) => setEditDraft({ ...editDraft, subject: e.target.value })}
                className="mt-1 w-full rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-2 text-[13px] text-[#0d3547] focus:border-arcova-teal focus:outline-none"
              />
              {editDraft.channel === 'linkedin' && (
                <p className="mt-1 text-[10.5px] text-[#b6c2c8]">
                  LinkedIn ignores subject — kept for parity with the email step.
                </p>
              )}
            </div>

            {/* Body */}
            <div>
              <label className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#7d909a]">
                Body
              </label>
              <textarea
                value={editDraft.body}
                onChange={(e) => setEditDraft({ ...editDraft, body: e.target.value })}
                rows={14}
                className="mt-1 w-full rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-2 text-[13px] text-[#0d3547] leading-relaxed focus:border-arcova-teal focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[rgba(13,53,71,0.08)] px-5 py-3">
            <button
              type="button"
              onClick={closeEditor}
              disabled={savingEdit}
              className="rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#4a6470] hover:bg-[#f4f7f9] disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveEdit()}
              disabled={savingEdit}
              className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-navy px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0d3547] disabled:opacity-60"
            >
              {savingEdit && <Loader2 className="h-3 w-3 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      )}

      {/* ── Dispatch (campaign picker) modal ────────────────────────────── */}
      {dispatchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0d3547]/40 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-2xl border border-white/80 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-[#0d3547]">Send to lemlist</h3>
                <p className="mt-1 text-sm text-[#7d909a]">
                  Pick the lemlist campaign that will run this sequence. Your contacts will be added
                  as leads with personalized custom vars.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDispatchOpen(false)}
                disabled={dispatching}
                className="rounded-md p-1 text-[#b6c2c8] hover:bg-[#f4f7f9] hover:text-[#4a6470]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4">
              <label className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#7d909a]">
                Campaign
              </label>
              {campaignsLoading ? (
                <div className="mt-2 flex items-center gap-2 text-[12.5px] text-[#7d909a]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading lemlist campaigns…
                </div>
              ) : campaigns && campaigns.length === 0 ? (
                <p className="mt-2 text-[12.5px] text-[#7d909a]">
                  No campaigns found on your lemlist account. Create one in lemlist first
                  (Campaigns → New), then come back.
                </p>
              ) : (
                <select
                  value={selectedCampaignId}
                  onChange={(e) => setSelectedCampaignId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-2 text-[13px] text-[#0d3547] focus:border-arcova-teal focus:outline-none"
                >
                  <option value="">Pick a campaign…</option>
                  {(campaigns ?? []).map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <p className="mt-3 text-[11px] text-[#7d909a]">
              Dispatching {dispatchRowIds.length} sequence{dispatchRowIds.length === 1 ? '' : 's'}.
            </p>

            {dispatchError && (
              <p className="mt-3 text-[12.5px] text-red-500">{dispatchError}</p>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDispatchOpen(false)}
                disabled={dispatching}
                className="rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#4a6470] hover:bg-[#f4f7f9] disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void doDispatch()}
                disabled={dispatching || !selectedCampaignId}
                className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-navy px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0d3547] disabled:opacity-60"
              >
                {dispatching && <Loader2 className="h-3 w-3 animate-spin" />}
                {dispatching ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
