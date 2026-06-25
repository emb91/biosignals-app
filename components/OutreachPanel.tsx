'use client';

/**
 * OutreachPanel — contact-side-panel surface for picking a signal-anchored
 * hook and generating a 7-message outreach sequence.
 *
 * Two views, swapped in-place:
 *   PICKER  — shows recent signals (last 14d) for this contact + their
 *             company, ordered with contact-level signals first. No LLM —
 *             pure DB query. User picks one as the anchor.
 *   EDITOR  — legacy fallback preview. The normal flow now auto-stages the
 *             generated draft and sends the rep to /outreach to review/edit.
 *
 * Cost model:
 *   - Picker is free (DB query only)
 *   - Sequence is one Sonnet call. The confirmed generation is persisted as a
 *     draft outreach_sequences row before the rep lands on /outreach.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Copy, Check, ChevronLeft, Send, Linkedin, Mail, UserPlus } from 'lucide-react';
import { cachedJson, invalidateCache } from '@/lib/page-fetch-cache';
import { useCreditConfirm } from '@/context/CreditConfirmContext';

// Hooks are deterministic for a given contact + day (signal events flow in
// at most daily). Cache for 24h — the "Re-query" button bypasses the cache
// for the rare "I want fresh" case. Without this, switching contacts and
// coming back triggers a wasteful re-fetch every time.
const HOOKS_TTL_MS = 24 * 60 * 60 * 1000;

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
  channel: 'email' | 'linkedin';
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
  const mountedRef = useRef(true);
  const [view, setView] = useState<'picker' | 'editor'>('picker');

  // Readiness-gate state. gateLoaded is the "fetched once" sentinel (the panel
  // only needs the gate + existing-sequence now, not curated hooks).
  const [gateLoaded, setGateLoaded] = useState(false);
  const [hooksLoading, setHooksLoading] = useState(false);
  const [hooksError, setHooksError] = useState<string | null>(null);
  const [gating, setGating] = useState<Gating | null>(null);

  // Existing sequence for this contact, if any. Drives the "you're already
  // reaching out to this person" notice instead of the generate view.
  const [existingSequence, setExistingSequence] = useState<ExistingSequence | null>(null);
  // User clicked "Stage another angle" — hide the notice + show the generate view.
  const [overrideExisting, setOverrideExisting] = useState(false);

  // Optional deliberate angle the rep wants the copy to lead with (e.g. a new
  // product). Woven into generation; signals stay background-only.
  const [userAngle, setUserAngle] = useState('');

  // Editor state.
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
  const confirmCredits = useCreditConfirm();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset when contact changes
  useEffect(() => {
    setView('picker');
    setGateLoaded(false);
    setMessages([]);
    setSequenceError(null);
    setHooksError(null);
    setExportSuccess(null);
    setGating(null);
    setExistingSequence(null);
    setOverrideExisting(false);
    setUserAngle('');
  }, [contactId]);

  // Auto-load signals on mount — cheap DB query, no LLM cost.
  // IMPORTANT: do NOT put hooksLoading in the deps. We call setHooksLoading(true)
  // inside the effect, which would re-trigger the effect, cancel the in-flight
  // fetch via the cleanup, and leave hooksLoading=true forever ("Loading
  // signals…" stuck). The `hooks !== null` guard alone keeps the effect from
  // double-firing — when hooks is reset to null (mount, contact change, manual
  // refresh) we re-run; otherwise we skip.
  useEffect(() => {
    if (gateLoaded) return;
    let cancelled = false;
    setHooksLoading(true);
    setHooksError(null);
    (async () => {
      try {
        // gateOnly=1: we only need the readiness gate + existing-sequence state,
        // not curated hooks (the rep no longer picks one). Skips the LLM in /hooks.
        const { data: json } = await cachedJson<{
          gated?: boolean;
          gating?: Gating;
          existing_sequence?: ExistingSequence | null;
        }>(`/api/outreach/hooks?contactId=${encodeURIComponent(contactId)}&gateOnly=1`, {
          ttlMs: HOOKS_TTL_MS,
        });
        if (cancelled) return;
        setGateLoaded(true);
        setGating(json.gated === true && json.gating ? json.gating : null);
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
  }, [contactId, gateLoaded]);

  // Generate a sequence directly — no hook to pick. The server fetches all of the
  // contact's signals as background. `override` bypasses the reach-out gate (used
  // when the rep deliberately generates for a not-ready contact).
  const generateSequence = useCallback(
    async (override: boolean) => {
      const ok = await confirmCredits({
        title: 'Generate outreach sequence?',
        description:
          'Arcova drafts a multichannel sequence for this contact and stages it in Outreach for your review.',
        cost: 5,
        confirmLabel: 'Generate',
      });
      if (!ok) return;
      if (
        override &&
        !window.confirm(
          "This contact isn't flagged as ready to reach out (low readiness). Generate a sequence anyway?",
        )
      ) {
        return;
      }
      setMessages([]);
      setSequenceError(null);
      setSequenceLoading(true);
      setExportSuccess(null);
      try {
        const res = await fetch('/api/outreach/sequence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contactId,
            userAngle: userAngle.trim() || undefined,
            manualOverride: override,
            operationId: crypto.randomUUID(),
            autoStage: true,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (json.sequenceId) {
          invalidateCache('/api/outreach');
          invalidateCache('/api/contacts');
          invalidateCache('/api/companies');
          invalidateCache('/api/today');
          invalidateCache(`/api/outreach/hooks?contactId=${encodeURIComponent(contactId)}`);
          if (mountedRef.current) {
            router.push(`/outreach?highlight=${encodeURIComponent(json.sequenceId)}`);
          }
          return;
        }
        if (!mountedRef.current) return;
        setMessages(json.messages ?? []);
        setView('editor');
      } catch (e) {
        if (!mountedRef.current) return;
        setSequenceError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mountedRef.current) setSequenceLoading(false);
      }
    },
    [contactId, userAngle, router, confirmCredits],
  );

  const backToPicker = useCallback(() => {
    setView('picker');
    setMessages([]);
    setSequenceError(null);
    setExportSuccess(null);
  }, []);

  const stageForOutreach = useCallback(async () => {
    if (messages.length === 0) return;
    setStaging(true);
    setExportSuccess(null);
    try {
      const res = await fetch('/api/outreach/lemlist/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId,
          // No hook to anchor on anymore; label the staged row by the rep's angle
          // if they gave one, else a neutral label.
          anchorHookText: userAngle.trim() || 'Outreach sequence',
          // Preserve the generated best-practice channel mix. Reps can still
          // override individual message steps in the /outreach editor.
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
  }, [messages, contactId, userAngle, router]);

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

  // ── GENERATE ────────────────────────────────────────────────────────────
  // No hook-picking: the rep clicks Generate and the server pulls all of the
  // contact's signals as background. Readiness is a soft gate — a not-ready
  // contact can still be generated via manual override.
  if (view === 'picker') {
    const notReady = gating != null;
    return (
      <div className="space-y-3">
        <div className="space-y-0.5">
          <p className="text-xs text-gray-700">Generate a multichannel outreach sequence for this contact.</p>
          <p className="text-xs text-gray-500">
            Arcova writes to their role and your offer, then stages the draft in Outreach for review.
          </p>
        </div>

        {hooksLoading && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking readiness…
          </div>
        )}

        {hooksError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {hooksError}
          </div>
        )}

        {!hooksLoading && notReady && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5">
            <p className="text-[11.5px] leading-snug text-amber-800">
              {gating.reason === 'no_company'
                ? "This contact isn't matched to a company yet, so there's no readiness signal."
                : gating.reason === 'fit_below_threshold'
                  ? "This contact isn't flagged as ready — fit is below your threshold."
                  : "This contact isn't flagged as ready — no strong buying signal yet."}{' '}
              You can still generate manually.
            </p>
          </div>
        )}

        <div className="space-y-1">
          <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
            Your angle (optional)
          </label>
          <textarea
            value={userAngle}
            onChange={(e) => setUserAngle(e.target.value)}
            rows={2}
            placeholder="e.g. We're launching a new assay I'd like to lead with"
            className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400 focus:border-arcova-teal focus:outline-none focus:ring-2 focus:ring-arcova-teal/20"
          />
          <p className="text-[10.5px] leading-snug text-gray-400">
            A deliberate steer woven into the copy. Leave blank to write purely from the persona + your offer.
          </p>
        </div>

        <button
          type="button"
          onClick={() => generateSequence(notReady)}
          disabled={hooksLoading || sequenceLoading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-arcova-navy px-3 py-2.5 text-[13px] font-semibold text-white hover:bg-[#0d3547] disabled:opacity-60"
        >
          {sequenceLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {sequenceLoading ? 'Generating and staging…' : 'Generate and stage in Outreach'}
        </button>
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
        Back
      </button>

      {(() => {
        const firstName = (contactName ?? '').trim().split(/\s+/)[0] || 'this contact';
        return (
          <p className="text-[13px] leading-snug text-gray-700">
            Sequence for <span className="font-semibold text-gray-900">{firstName}</span>
            {userAngle.trim() ? (
              <>
                {' '}— angle: <span className="text-gray-900">{userAngle.trim()}</span>
              </>
            ) : null}
          </p>
        );
      })()}

      {sequenceLoading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Drafting 7-step sequence…
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
              const isInvite = m.channel === 'linkedin' && m.day_offset === 7;
              const ChannelIcon = isInvite ? UserPlus : m.channel === 'linkedin' ? Linkedin : Mail;
              const channelLabel = isInvite
                ? 'LinkedIn connection request'
                : m.channel === 'linkedin'
                  ? 'LinkedIn message'
                  : 'Email';
              return (
                <li key={i} className="rounded-xl border border-gray-150 bg-white p-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      Day {m.day_offset}
                    </p>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      m.channel === 'linkedin'
                        ? 'bg-[#0a66c2]/8 text-[#0a66c2]'
                        : 'bg-arcova-teal/8 text-arcova-teal'
                    }`}>
                      <ChannelIcon className="h-3 w-3" />
                      {channelLabel}
                    </span>
                  </div>
                  {isInvite ? (
                    <p className="text-[12.5px] leading-snug text-gray-700">
                      Send a connection request. No note is added.
                    </p>
                  ) : (
                    <>
                      {m.channel === 'email' && (
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
                            {copiedField === subjectId ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      )}
                      <div className={`${m.channel === 'email' ? 'mt-1.5' : ''} flex items-start gap-2`}>
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
                          {copiedField === bodyId ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </>
                  )}
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
// Sequence states, each with distinct copy + actions:
//   generating — sequence row exists and the background job is writing copy.
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

  if (status === 'generating') {
    headline = (
      <>
        Outreach is being drafted for: <span className="text-gray-900">{sequence.anchor_hook_text}</span>.
      </>
    );
    body = (
      <>
        Arcova is generating the sequence in Outreach. You can leave this panel and open it there.
      </>
    );
    allowAnother = false;
    openLabel = 'Open in Outreach';
  } else if (status === 'draft') {
    headline = <>Outreach Drafted</>;
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
