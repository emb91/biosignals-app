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
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw, Copy, Check, ChevronLeft, Send } from 'lucide-react';
import { cachedJson, invalidateCache } from '@/lib/page-fetch-cache';

// Hooks are deterministic for a given contact + day (signal events flow in
// at most daily). Cache for 24h — the "Re-query" button bypasses the cache
// for the rare "I want fresh" case. Without this, switching contacts and
// coming back triggers a wasteful re-fetch every time.
const HOOKS_TTL_MS = 24 * 60 * 60 * 1000;

// Compact date format for hook chips. Shows "May 30" (current year) or
// "May 30 '25" (other years). Keeps the picker rows tight.
function formatHookDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const monthDay = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return sameYear ? monthDay : `${monthDay} '${String(d.getFullYear()).slice(2)}`;
}

type HookCategory =
  | 'funding'
  | 'people'
  | 'strategic'
  | 'clinical_ops'
  | 'research'
  | 'engagement'
  | 'caution';

type Hook = {
  // Source: 'signal' (a signal_source_events row) or 'derived' (computed —
  // e.g. a fallback "pattern observation" hook synthesised from the
  // candidate list as a whole when no specific signal hooks land).
  source_type: 'signal' | 'derived';
  source_event_id: string | null;
  source_event_at: string | null;   // ISO timestamp
  signal_type: string | null;        // e.g. 'funding_round', 'phase_transition'
  signal_label?: string;             // human-friendly label, e.g. "Promotion"
  category?: HookCategory;           // visual bucket; drives pill color
  phrase?: string;                   // CTA fragment, e.g. "their promotion"
  tier?: number;                     // 1 = strongest hook, 3 = weakest
  ai_score?: number | null;          // 0–100 from the curation pass
  ai_reason?: string | null;         // one-line "why this works" from the LLM
  ai_seller_grounding?: string | null;  // named value_prop / capability this ties to
  ai_signal_grounding?: string | null;  // the specific fact from the signal
  is_pattern?: boolean;              // true → derived pattern observation, not a single signal
  is_contact_level: boolean;         // true → contact-specific; false → company
  title: string;                     // signal title (what gets shown)
  summary: string | null;            // signal summary (optional secondary line)
};

/**
 * Category → text color (no background). Used as a small colored eyebrow
 * above the CTA sentence so the signal type is visible but doesn't compete
 * with the action. Tailwind classes need to appear verbatim for purging.
 */
const HOOK_CATEGORY_TEXT: Record<HookCategory, string> = {
  funding:      'text-emerald-700',
  people:       'text-violet-700',
  strategic:    'text-amber-800',
  clinical_ops: 'text-sky-700',
  research:     'text-slate-600',
  engagement:   'text-arcova-teal',
  caution:      'text-rose-700',
};

/**
 * Pill flavour used by the editor's anchor block (kept because the editor
 * has more vertical room and a small filled pill reads cleaner there).
 */
const HOOK_CATEGORY_PILL: Record<HookCategory, string> = {
  funding:      'bg-emerald-50 text-emerald-700',
  people:       'bg-violet-50 text-violet-700',
  strategic:    'bg-amber-50 text-amber-800',
  clinical_ops: 'bg-sky-50 text-sky-700',
  research:     'bg-slate-100 text-slate-700',
  engagement:   'bg-arcova-teal/10 text-arcova-teal',
  caution:      'bg-rose-50 text-rose-700',
};

function categoryTextClassFor(category: HookCategory | undefined): string {
  return HOOK_CATEGORY_TEXT[category ?? 'strategic'];
}

function pillClassesFor(category: HookCategory | undefined): string {
  return HOOK_CATEGORY_PILL[category ?? 'strategic'];
}

type Message = {
  day_offset: number;
  subject: string;
  body: string;
};

type ExistingSequence = {
  id: string;
  anchor_hook_text: string;
  anchor_signal_type: string | null;
  dispatch_status: 'draft' | 'sent' | 'replied' | 'failed' | 'exported' | 'queued' | string | null;
  dispatch_channel: string | null;
  dispatch_error: string | null;
  last_status_at: string | null;
  created_at: string;
};

type Gating = {
  contact_fit_score: number | null;
  company_fit_score: number | null;
  contact_readiness_score: number | null;
  company_readiness_score: number | null;
  threshold: number;
  reason: 'fit_below_threshold' | 'readiness_below_threshold' | 'no_company';
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
  const [gating, setGating] = useState<Gating | null>(null);
  // 'ai' when the curation LLM ranked these; 'mechanical' when we fell back.
  const [curation, setCuration] = useState<'ai' | 'mechanical' | null>(null);
  // 'ok' when AI found grounded picks (or pattern); 'no_strong_hooks' when AI
  // evaluated and honestly concluded nothing concrete fits.
  const [aiVerdict, setAiVerdict] = useState<'ok' | 'no_strong_hooks' | null>(null);

  // Existing sequence for this contact, if any. Drives the "you're already
  // reaching out to this person" notice instead of the picker.
  const [existingSequence, setExistingSequence] = useState<ExistingSequence | null>(null);
  // User clicked "Stage another angle" — hide the notice + show the picker.
  const [overrideExisting, setOverrideExisting] = useState(false);

  // Editor state
  const [anchorHook, setAnchorHook] = useState<Hook | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sequenceLoading, setSequenceLoading] = useState(false);
  const [sequenceError, setSequenceError] = useState<string | null>(null);

  // Stage feedback (renders the same banner as before; legacy export paths
  // were removed in favour of per-field manual copy).
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);
  // Per-field copy feedback: tracks which "subject"/"body" of which message was
  // most recently copied so the icon can flip to a check briefly.
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Staging state — primary path now: drop the sequence into /outreach for
  // multi-step channel selection + lemlist dispatch.
  const [staging, setStaging] = useState(false);
  const router = useRouter();

  // Reset when contact changes
  useEffect(() => {
    setView('picker');
    setHooks(null);
    setAnchorHook(null);
    setMessages([]);
    setSequenceError(null);
    setHooksError(null);
    setExportSuccess(null);
    setGating(null);
    setCuration(null);
    setAiVerdict(null);
    setExistingSequence(null);
    setOverrideExisting(false);
  }, [contactId]);

  // Auto-load signals on mount — cheap DB query, no LLM cost.
  // IMPORTANT: do NOT put hooksLoading in the deps. We call setHooksLoading(true)
  // inside the effect, which would re-trigger the effect, cancel the in-flight
  // fetch via the cleanup, and leave hooksLoading=true forever ("Loading
  // signals…" stuck). The `hooks !== null` guard alone keeps the effect from
  // double-firing — when hooks is reset to null (mount, contact change, manual
  // refresh) we re-run; otherwise we skip.
  useEffect(() => {
    if (hooks !== null) return;
    let cancelled = false;
    setHooksLoading(true);
    setHooksError(null);
    (async () => {
      try {
        const { data: json } = await cachedJson<{
          hooks?: Hook[];
          gated?: boolean;
          gating?: Gating;
          curation?: string;
          ai_verdict?: string;
          existing_sequence?: ExistingSequence | null;
        }>(`/api/outreach/hooks?contactId=${encodeURIComponent(contactId)}`, {
          ttlMs: HOOKS_TTL_MS,
        });
        if (cancelled) return;
        setHooks(json.hooks ?? []);
        setGating(json.gated === true && json.gating ? json.gating : null);
        setCuration(json.curation === 'ai' || json.curation === 'mechanical' ? json.curation : null);
        setAiVerdict(
          json.ai_verdict === 'ok' || json.ai_verdict === 'no_strong_hooks'
            ? json.ai_verdict
            : null,
        );
        setExistingSequence(json.existing_sequence ?? null);
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
  }, [contactId, hooks]);

  const refreshHooks = useCallback(() => {
    // Drop this contact's cache entry so the effect re-fetches from the network.
    invalidateCache(`/api/outreach/hooks?contactId=${encodeURIComponent(contactId)}`);
    setHooks(null);
    setHooksError(null);
    setGating(null);
    setCuration(null);
    setAiVerdict(null);
  }, [contactId]);

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
            anchorIsContactLevel: hook.is_contact_level,
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

  const stageForOutreach = useCallback(async () => {
    if (!anchorHook || messages.length === 0) return;
    setStaging(true);
    setExportSuccess(null);
    try {
      const res = await fetch('/api/outreach/lemlist/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId,
          anchorHookText: anchorHook.title,
          anchorSignalEventId: anchorHook.source_event_id,
          anchorSignalType: anchorHook.signal_type,
          // No channel field — server applies best-practice defaults per
          // day_offset (email-first, then alternating). Reps override
          // per-step in the /outreach editor's cell side-panel.
          messages,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      invalidateCache('/api/outreach');
      router.push(`/outreach?highlight=${encodeURIComponent(json.id ?? '')}`);
    } catch (e) {
      setExportSuccess(`Stage failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setStaging(false);
    }
  }, [anchorHook, messages, contactId, router]);

  // Per-field clipboard copy. We removed the bulk CSV / "save & copy" exports
  // (they implicitly persisted the sequence with a fake dispatch_status, which
  // muddied the action gate). Reps copy each subject/body individually now,
  // and the only persistence path is Stage for outreach.
  const copyField = useCallback(async (fieldId: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(fieldId);
      window.setTimeout(() => {
        setCopiedField((current) => (current === fieldId ? null : current));
      }, 1500);
    } catch {
      // Clipboard may be blocked (insecure context, denied perms). Surface a
      // soft error via the existing banner rather than failing silently.
      setExportSuccess('Copy failed — your browser blocked clipboard access.');
    }
  }, []);

  // ── ALREADY-CONTACTED NOTICE ────────────────────────────────────────────
  // If we have a prior sequence and the user hasn't asked to override, show
  // a state-aware notice instead of the hook picker. Click "Stage another
  // angle" to fall through to the picker.
  if (view === 'picker' && existingSequence && !overrideExisting) {
    return (
      <ContactedNotice
        sequence={existingSequence}
        contactName={contactName}
        onStageAnother={() => setOverrideExisting(true)}
        onOpenOutreach={() =>
          router.push(`/outreach?highlight=${encodeURIComponent(existingSequence.id)}`)
        }
      />
    );
  }

  // ── PICKER ──────────────────────────────────────────────────────────────
  if (view === 'picker') {
    return (
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <p className="text-xs text-gray-700">
              {curation === 'ai'
                ? 'AI picked the strongest angles for this contact.'
                : 'Here are some recommended signals for engagement.'}
            </p>
            <p className="text-xs text-gray-500">Click an option below to generate an outreach sequence.</p>
          </div>
          <button
            type="button"
            onClick={refreshHooks}
            disabled={hooksLoading}
            className="inline-flex shrink-0 items-center gap-1 text-xs text-gray-500 hover:text-arcova-teal disabled:opacity-50"
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
          <ol className="space-y-1.5">
            {hooks.map((h, i) => {
              const phrase = h.phrase ?? h.title;
              return (
                <li key={`${h.source_event_id ?? 'derived'}-${i}`}>
                  <button
                    type="button"
                    onClick={() => pickHook(h)}
                    className="group w-full rounded-lg border border-gray-150 bg-white px-3 py-2.5 text-left transition-colors hover:border-arcova-teal/60 hover:bg-arcova-teal/[0.03] focus:outline-none focus:ring-2 focus:ring-arcova-teal/30"
                  >
                    {/* Eyebrow: category (colored) + date. Small + uppercase
                        so it reads as metadata, not as a second headline.
                        Pattern hooks have no anchoring date (they observe a
                        theme across multiple events) — show "across recent
                        activity" instead. */}
                    <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
                      <span className={categoryTextClassFor(h.category)}>
                        {h.is_pattern
                          ? 'Pattern observation'
                          : (h.signal_label ?? h.signal_type ?? 'Signal')}
                      </span>
                      {h.is_pattern ? (
                        <>
                          <span className="text-gray-300">·</span>
                          <span className="font-normal normal-case tracking-normal text-gray-400">
                            across recent activity
                          </span>
                        </>
                      ) : h.source_event_at ? (
                        <>
                          <span className="text-gray-300">·</span>
                          <span className="font-normal normal-case tracking-normal text-gray-400">
                            {formatHookDate(h.source_event_at)}
                          </span>
                        </>
                      ) : null}
                    </div>
                    {/* Primary: the CTA sentence with the brief signal phrase. */}
                    <p className="text-[13px] leading-snug text-gray-800">
                      Generate a sequence on{' '}
                      <span className="font-semibold text-gray-900">
                        &lsquo;{phrase}&rsquo;
                      </span>
                    </p>
                    {/* AI reasoning — only when the curation LLM ranked these.
                        Tells the rep WHY in plain language. */}
                    {h.ai_reason && (
                      <p className="mt-1.5 text-[11.5px] leading-snug text-gray-500">
                        <span className="font-medium text-gray-600">Why: </span>
                        {h.ai_reason}
                      </p>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        )}

        {hooks && hooks.length === 0 && gating && !hooksLoading && !hooksError && (
          <GatedNotice gating={gating} />
        )}

        {hooks && hooks.length === 0 && !gating && !hooksLoading && !hooksError && aiVerdict === 'no_strong_hooks' && (
          <div className="rounded-lg border border-gray-150 bg-gray-50/60 px-3 py-3">
            <p className="text-xs font-medium text-gray-700">No strong outreach angle right now.</p>
            <p className="mt-1 text-[11.5px] leading-snug text-gray-500">
              The recent activity for this contact doesn&rsquo;t map cleanly to what your company sells. Better to wait for fresh signals than send a weak opener.
            </p>
          </div>
        )}

        {hooks && hooks.length === 0 && !gating && !hooksLoading && !hooksError && aiVerdict !== 'no_strong_hooks' && (
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

      {anchorHook && (() => {
        // One plain sentence. No "Anchor" label, no pill, no date, no
        // snake_case signal_type. Just: "Generating a sequence for Chong on
        // {whatever this hook is about}." First name only because that's how
        // the rep refers to the contact in their head.
        const firstName = (contactName ?? '').trim().split(/\s+/)[0] || 'this contact';
        return (
          <p className="text-[13px] leading-snug text-gray-700">
            Generating a sequence for{' '}
            <span className="font-semibold text-gray-900">{firstName}</span> on:{' '}
            <span className="text-gray-900">{anchorHook.title}</span>
          </p>
        );
      })()}

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
          {/* Primary CTA pinned to the top — staging is the main action,
              and the rep shouldn't have to scroll a 7-message preview to find
              the button. Edits happen on /outreach where there's room. */}
          <div className="sticky top-0 z-10 -mx-1 mb-1 bg-white/85 px-1 pt-0.5 pb-2 backdrop-blur">
            <button
              type="button"
              onClick={() => void stageForOutreach()}
              disabled={staging}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-arcova-navy text-white px-3 py-2 text-sm font-semibold hover:bg-[#0d3547] transition-colors disabled:opacity-60"
            >
              {staging ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              {staging ? 'Staging…' : 'Stage for outreach'}
            </button>
            <p className="mt-1 text-[11px] text-gray-500">
              Stage for outreach. You can edit this on the next page.
            </p>
          </div>

          {exportSuccess && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                exportSuccess.startsWith('Export failed') || exportSuccess.startsWith('Stage failed')
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-green-200 bg-green-50 text-green-800'
              }`}
            >
              {exportSuccess}
            </div>
          )}

          {/* Read-only preview cards with a per-field copy affordance. Each
              subject + body row exposes a small copy button so reps can pull
              text into whatever tool they're sending from, without going
              through a bulk CSV / clipboard export (those silently persisted a
              sequence with a fake dispatch_status and confused the action
              gate). The only persistence path here is Stage for outreach. */}
          <ul className="space-y-2">
            {messages.map((m, i) => {
              const subjectId = `m${i}-subject`;
              const bodyId = `m${i}-body`;
              return (
                <li key={i} className="rounded-xl border border-gray-150 bg-white p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
                    {m.day_offset === 0 ? 'Day 0 · Initial' : `Day ${m.day_offset} · Follow-up`}
                  </p>
                  <div className="flex items-start gap-2">
                    <p className="flex-1 text-[13px] font-medium text-gray-900 leading-snug">
                      {m.subject}
                    </p>
                    <button
                      type="button"
                      onClick={() => void copyField(subjectId, m.subject)}
                      title="Copy subject"
                      aria-label="Copy subject"
                      className="shrink-0 inline-flex items-center justify-center rounded-md p-1 text-gray-400 hover:bg-arcova-teal/10 hover:text-arcova-teal transition-colors"
                    >
                      {copiedField === subjectId ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  <div className="mt-1.5 flex items-start gap-2">
                    <p className="flex-1 whitespace-pre-wrap text-[12.5px] text-gray-700 leading-snug">
                      {m.body}
                    </p>
                    <button
                      type="button"
                      onClick={() => void copyField(bodyId, m.body)}
                      title="Copy body"
                      aria-label="Copy body"
                      className="shrink-0 inline-flex items-center justify-center rounded-md p-1 text-gray-400 hover:bg-arcova-teal/10 hover:text-arcova-teal transition-colors"
                    >
                      {copiedField === bodyId ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

// ── ContactedNotice ──────────────────────────────────────────────────────────
// State-aware "you've already reached out" message. Replaces the hook picker
// when an outreach_sequences row already exists for this contact, so reps
// don't accidentally double-pitch.
//
// Five states, each with distinct copy + actions:
//   draft   — sequence staged but not sent. "Open draft" + "Draft another".
//   sent    — leads enrolled in lemlist. "Open" + "Stage another angle".
//   replied — they answered. "Open" only — human takes over here.
//   failed  — last dispatch errored. "Open to retry" + "Stage another angle".
//   exported/queued — fallback, just a generic "previously contacted" note.
function ContactedNotice({
  sequence,
  contactName,
  onStageAnother,
  onOpenOutreach,
}: {
  sequence: ExistingSequence;
  contactName: string;
  onStageAnother: () => void;
  onOpenOutreach: () => void;
}) {
  const firstName = (contactName ?? '').trim().split(/\s+/)[0] || 'this contact';
  const when = sequence.last_status_at ?? sequence.created_at;
  const whenStr = when
    ? new Date(when).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';

  const status = (sequence.dispatch_status ?? 'draft').toLowerCase();

  let headline: React.ReactNode = '';
  let body: React.ReactNode = null;
  let allowAnother = false;
  let openLabel = 'Open in /outreach';

  if (status === 'draft') {
    headline = (
      <>
        Outreach drafted for: <span className="text-gray-900">{sequence.anchor_hook_text}</span>.
      </>
    );
    body = (
      <>
        Click <span className="font-medium text-gray-900">&lsquo;Open draft&rsquo;</span> below to
        edit the copy and send to lemlist, or draft a different angle.
      </>
    );
    allowAnother = true;
    openLabel = 'Open draft';
  } else if (status === 'sent' || status === 'queued') {
    headline = (
      <>
        Outreach sent for: <span className="text-gray-900">{sequence.anchor_hook_text}</span>
        {whenStr && ` (${whenStr})`}.
      </>
    );
    body = (
      <>
        Wait for a reply before pitching {firstName} a new angle, or click{' '}
        <span className="font-medium text-gray-900">&lsquo;Open&rsquo;</span> below to track status.
      </>
    );
    allowAnother = true;
  } else if (status === 'replied') {
    headline = (
      <>
        {firstName} replied to: <span className="text-gray-900">{sequence.anchor_hook_text}</span>
        {whenStr && ` (${whenStr})`}.
      </>
    );
    body = (
      <>
        Take it human from here. Click{' '}
        <span className="font-medium text-gray-900">&lsquo;Open&rsquo;</span> below to see the thread.
      </>
    );
    allowAnother = false;
  } else if (status === 'failed') {
    headline = (
      <>
        Dispatch failed for: <span className="text-gray-900">{sequence.anchor_hook_text}</span>.
      </>
    );
    body = (
      <>
        <span className="text-red-700">{sequence.dispatch_error || 'Unknown error'}</span>. Click{' '}
        <span className="font-medium text-gray-900">&lsquo;Open to retry&rsquo;</span> below, or draft a different angle.
      </>
    );
    allowAnother = true;
    openLabel = 'Open to retry';
  } else {
    headline = (
      <>
        Previously contacted on: <span className="text-gray-900">{sequence.anchor_hook_text}</span>.
      </>
    );
    body = null;
    allowAnother = true;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-arcova-teal/25 bg-arcova-teal/5 p-3.5">
        <p className="text-[13px] font-semibold text-[#0d3547]">{headline}</p>
        <p className="mt-1 text-[12.5px] leading-snug text-gray-700">{body}</p>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onOpenOutreach}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-arcova-navy text-white px-3 py-2 text-sm font-semibold hover:bg-[#0d3547] transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
          {openLabel}
        </button>
        {allowAnother && (
          <button
            type="button"
            onClick={onStageAnother}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-arcova-teal/40 text-arcova-teal px-3 py-2 text-[12.5px] font-semibold hover:bg-arcova-teal/5 transition-colors"
          >
            Stage another angle
          </button>
        )}
      </div>
    </div>
  );
}

// ── GatedNotice ──────────────────────────────────────────────────────────────
// Shown when the contact is below the outreach threshold. Tells the rep why
// in one line + lists the four scores so they can see the gap at a glance.
// Intentionally compact: this is friction-on-purpose, not an empty state to
// dress up. We want the rep to pick a stronger contact.
function GatedNotice({ gating }: { gating: Gating }) {
  const fmt = (v: number | null) => (typeof v === 'number' ? v.toFixed(2) : '—');
  const reasonLine =
    gating.reason === 'no_company'
      ? 'No company linked to this contact.'
      : gating.reason === 'fit_below_threshold'
      ? `Both contact fit and company fit need to be ≥ ${gating.threshold.toFixed(2)}.`
      : `Readiness needs to be ≥ ${gating.threshold.toFixed(2)} (from company or contact signals).`;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
        Below outreach threshold
      </p>
      <p className="mt-1 text-[12px] leading-snug text-amber-900">{reasonLine}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-amber-900/80">
        <div className="flex justify-between">
          <dt>Contact fit</dt>
          <dd className="font-mono">{fmt(gating.contact_fit_score)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Company fit</dt>
          <dd className="font-mono">{fmt(gating.company_fit_score)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Contact readiness</dt>
          <dd className="font-mono">{fmt(gating.contact_readiness_score)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Company readiness</dt>
          <dd className="font-mono">{fmt(gating.company_readiness_score)}</dd>
        </div>
      </dl>
    </div>
  );
}
