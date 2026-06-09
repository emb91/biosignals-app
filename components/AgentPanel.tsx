'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Send, Sparkles, RotateCcw, ArrowRight, Plus, RefreshCw } from 'lucide-react';
import { AgentChatBar } from '@/components/AgentChatBar';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ArcovaLoader } from '@/components/ArcovaLoader';
import { BorderBeam } from '@/components/ui/border-beam';
import { BriefingAgentOrb } from '@/components/briefing/BriefingAgentOrb';
import type { AccountQueryColumn, AccountQueryFilters, AccountSortBy, QueryAccount } from '@/lib/accounts-data';
import type { QueryColumn as LeadQueryColumn, LeadQueryFilters, LeadSortBy, QueryLead } from '@/lib/leads-data';
import { fetchIcpPriorities, clearIcpPrioritiesCache, getDismissedPriorityIds, dismissPriority, clearIcpAuditDismissals } from '@/lib/icp-priorities-client';
import { BATCH_CONTACTS_KEY } from '@/lib/batch-contacts';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentPage = 'accounts' | 'leads' | 'today' | 'health' | 'signals' | 'imports' | 'data' | 'icps' | 'log' | 'outreach';

export interface AgentTableFilter {
  columns: AccountQueryColumn[];
  filters: AccountQueryFilters;
  sortBy: AccountSortBy;
  reshapeOnly: boolean;
  interpretation: string | null;
}

export interface AgentLeadsFilter {
  columns: LeadQueryColumn[];
  filters: LeadQueryFilters;
  sortBy: LeadSortBy;
  interpretation: string | null;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  /** User bubble text when it should differ from `content` (still sent to the API as `content`). */
  displayContent?: string;
  toolsUsed?: string[];
  /** True on the "thinking" placeholder before the real response arrives */
  isPending?: boolean;
  /** Navigation button to show below this message */
  navigation?: { href: string; label: string; batchCompanies?: { id: string; name: string; icpId?: string | null }[] };
}

const HANDOFF_KEY = 'arcova_agent_handoff';

interface AgentHandoff {
  messages: Message[];
  fromPage: AgentPage;
  timestamp: number;
}

export interface AgentPanelProps {
  page: AgentPage;
  pageContext?: Record<string, unknown>;
  /** Programmatically fire a message into the agent. Increment nonce to re-fire the same text.
   *  Set isHidden to suppress the user bubble so the agent appears to open the conversation.
   *  Optional threadPreview: short label shown in the user bubble instead of `text`. */
  pendingMessage?: { text: string; nonce: number; isHidden?: boolean; threadPreview?: string };
  onTableFilter?: (filter: AgentTableFilter, accounts: QueryAccount[]) => void;
  onLeadsFilter?: (filter: AgentLeadsFilter, leads: QueryLead[]) => void;
  onTableClear?: () => void;
  /** When true, the panel fills its container width instead of the fixed w-80 default. */
  wide?: boolean;
  onJobStarted?: (job: { requestType: string; icpId?: string; companyId?: string; batchCompanies?: { id: string; name: string; icpId?: string | null }[]; quantity: number }) => void;
  /** Fires after the agent has written to the ICPs table (update / delete). Parent should re-fetch the ICP list. */
  onIcpMutation?: (mutations: Array<{ kind: 'updated' | 'deleted'; icpId: string; name: string | null; reasoning: string }>) => void;
  /** Hide the Arcova Agent title row (full-bleed chat, e.g. Data page). */
  hideHeader?: boolean;
  /** Hide suggested prompt chips when the parent is providing state-aware onboarding. */
  suppressPrompts?: boolean;
  /** Sit inside a glass bento card: no outer chrome, transparent thread (briefing Today layout). */
  embedInBriefingBento?: boolean;
  /** Replace default inner panel chrome (e.g. glass rail on Leads contacts). */
  surfaceClassName?: string;
  /** Fires when a message request is in flight (for parent UI, e.g. briefing status dot). */
  onBusyChange?: (busy: boolean) => void;
  /** Today bento: static opener shown before the user sends anything (no automatic agent round-trip). */
  briefingWelcome?: { greeting: string; body: string };
  /** Today bento: pill prompts under the static opener; defaults are used when welcome is set and this is omitted. */
  briefingIdleChips?: { label: string; prompt: string; threadPreview?: string }[];
  /** Override the subtitle line in the panel header (e.g. "Watching · Kumar Bala"). Supports ReactNode for bold/styled text. */
  headerSubtitle?: React.ReactNode;
  className?: string;
  /**
   * 'side-rail' (default) — glass panel fixed to the right edge of the layout.
   * 'central'             — full-width briefing-style chat (used by AgentCentral wrapper).
   */
  variant?: 'side-rail' | 'central';
}

/** Payload for firing the agent from parent state (`pendingMessage`). */
export type AgentPendingMessage = NonNullable<AgentPanelProps['pendingMessage']>;

// ─── Suggested prompts per page ───────────────────────────────────────────────

const PROMPTS: Record<AgentPage, string[]> = {
  accounts: [
    'Who should I prioritise this week?',
    'Show me good fit companies with no strong contacts',
    'How many oncology accounts do I have?',
    'Which funded biotechs are coverage gaps?',
    'Explain the scoring for a company',
  ],
  leads: [
    'Who are my best contacts right now?',
    'Find VP-level contacts at high-fit companies',
    'Which contacts have a 100% fit score?',
    'Show me recently imported contacts',
  ],
  today: [
    'Let’s work on item 1 first',
    'What should I do after that?',
    'Show me the highest-leverage option',
  ],
  health: [
    'Where is my ICP coverage weakest?',
    'Which ICP needs more companies?',
    'Where do I need better contacts?',
  ],
  data: [
    'Get 50 more companies for ICP 2',
    'Show recent acquisition jobs',
    'How much data should I source?',
  ],
  signals: [
    'What signals came in this week?',
    'Which companies had a funding round recently?',
    'Show signals for my top accounts',
  ],
  imports: [
    'What did my last import add?',
    'How many contacts came from HubSpot?',
    'Were there any duplicate contacts?',
  ],
  icps: [
    'Audit my ICPs — anything too broad or overlapping?',
    'Where are my gaps based on what my company sells?',
    'Compare ICP 1 and ICP 3',
    'Draft a new ICP for me to consider',
  ],
  log: [
    'Why did my last sync fail?',
    'How many contacts were imported this week?',
    'Were there any errors in my last push?',
    'Show me a summary of recent activity',
  ],
  outreach: [
    'Which sequences are ready to send?',
    'Show me the drafts with the strongest anchor signals',
    'Which sent sequences have not replied yet?',
    'Suggest channel mix for these drafts',
  ],
};

const PAGE_SUBTITLE: Partial<Record<AgentPage, string>> = {
  accounts: 'Working on your accounts',
  leads: 'Working on your contacts',
  icps: 'Working on your ICPs',
  health: 'Working on coverage',
  signals: 'Working on recent signals',
  imports: 'Working on your imports',
  data: 'Run sourcing jobs and track the queue',
  log: 'Working on your sync history',
};

/** Input placeholder for the side-panel agent's chat bar, one per page. */
const PAGE_INPUT_PLACEHOLDER: Partial<Record<AgentPage, string>> = {
  accounts: 'Ask anything about your accounts…',
  leads: 'Ask anything about your contacts…',
  icps: 'Ask anything about your ICPs…',
  health: 'Ask anything about coverage…',
  signals: 'Ask anything about recent signals…',
  imports: 'Ask anything about your imports…',
  data: 'Ask anything about your data jobs…',
  log: 'Ask anything about your sync history…',
};

const DEFAULT_BRIEFING_IDLE_CHIPS: { label: string; prompt: string; threadPreview?: string }[] = [
  { label: 'Suggest where to start', prompt: 'Suggest a good place for me to start today based on my briefing.' },
  { label: 'Summarise overnight', prompt: 'Summarise what changed overnight that I should care about today.' },
  { label: 'Just the top lead', prompt: 'Walk me through my single best lead to work right now.' },
];

// ─── Strip markdown formatting from agent responses ───────────────────────────

function stripMarkdown(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];

  // Collect contiguous table blocks and convert them to "Key: Value" lines
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('|')) {
      // Gather all lines belonging to this table
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }

      // Parse headers from first row
      const headers = tableLines[0]
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);

      // Convert each data row (skip separator rows like |---|---|)
      for (let r = 1; r < tableLines.length; r++) {
        const isSeparator = /^\|[\s\-|:]+\|$/.test(tableLines[r].trim());
        if (isSeparator) continue;

        const cells = tableLines[r]
          .split('|')
          .map((c) => c.trim())
          .filter(Boolean);

        if (headers.length >= 2 && cells.length >= 2) {
          // Two-column table → "Key: Value"
          out.push(`${cells[0]}: ${cells[1]}`);
        } else {
          // Multi-column — join with spaces
          out.push(cells.join('  '));
        }
      }
    } else {
      out.push(line);
      i++;
    }
  }

  return out
    .join('\n')
    .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold**
    .replace(/\*(.+?)\*/g, '$1')        // *italic*
    .replace(/^#{1,6}\s+/gm, '')        // # headings
    .replace(/^[-*+]\s+/gm, '')         // bullet points
    .replace(/^\d+\.\s+/gm, '')         // numbered lists
    .replace(/`(.+?)`/g, '$1')          // `code`
    .replace(/\n{3,}/g, '\n\n')         // collapse extra blank lines
    .trim();
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AgentPanel({ page, pageContext, pendingMessage, onTableFilter, onLeadsFilter, onTableClear, wide, onJobStarted, onIcpMutation, hideHeader, suppressPrompts, embedInBriefingBento, onBusyChange, briefingWelcome, briefingIdleChips, surfaceClassName, headerSubtitle, className, variant = 'side-rail' }: AgentPanelProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [handoffFrom, setHandoffFrom] = useState<AgentPage | null>(null);
  /** Today tile: orb and "standing" surface until the user types, sends, or taps an idle chip (one-way). */
  const [briefingSurfaceEngaged, setBriefingSurfaceEngaged] = useState(false);
  // ICPs page: silent audit run on mount → up to 3 priority cards rendered in the empty state
  // (instead of generic chip suggestions). Each click auto-submits its seedPrompt.
  type IcpPriority = {
    id: string;
    kind: 'overlap' | 'gap' | 'too_broad' | 'too_narrow' | 'rename' | 'other';
    severity: 'low' | 'medium' | 'high';
    headline: string;
    detail: string;
    cta: { label: string; seedPrompt: string };
    icpIds: string[];
    /** Position labels like "ICP 1", "ICP 5" — server-derived from icps.created_at order. */
    icpLabels: string[];
  };
  const [icpPriorities, setIcpPriorities] = useState<IcpPriority[]>([]);
  const [icpPrioritiesLoading, setIcpPrioritiesLoading] = useState(page === 'icps');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastPendingNonceRef = useRef<number | null>(null);
  // Lets the `⟳` Refresh button cancel the in-flight chat request when the agent looks stuck.
  const inFlightAbortRef = useRef<AbortController | null>(null);
  // Tracks which ICP priority card triggered the current conversation so we can
  // dismiss it after the agent responds (regardless of verdict).
  const activePriorityIdRef = useRef<string | null>(null);

  // Restore conversation handed off from another page (layout effect avoids a one-frame idle welcome flash)
  useLayoutEffect(() => {
    try {
      const raw = sessionStorage.getItem(HANDOFF_KEY);
      if (!raw) return;
      sessionStorage.removeItem(HANDOFF_KEY);
      const handoff = JSON.parse(raw) as AgentHandoff & { fromPage?: string };
      if (Date.now() - handoff.timestamp < 5 * 60 * 1000) {
        setMessages(handoff.messages);
        const normalizedFromPage: AgentPage =
          (handoff.fromPage as string) === 'dashboard' ? 'today' : (handoff.fromPage as AgentPage);
        setHandoffFrom(normalizedFromPage);
        if (embedInBriefingBento && page === 'today') {
          setBriefingSurfaceEngaged(true);
        }
      }
    } catch {
      // ignore corrupt storage
    }
  }, [embedInBriefingBento, page]);

  // Keep the latest exchanges in view inside the fixed-height briefing tile (runs before paint)
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isLoading]);

  useEffect(() => {
    onBusyChange?.(isLoading);
  }, [isLoading, onBusyChange]);

  // ICPs page: silently fetch priority audit on first mount. Goes through the shared
  // client cache so /today can reuse the same audit without re-running Claude.
  // Re-fetches (force) when an icp mutation lands.
  const [priorityRefreshKey, setPriorityRefreshKey] = useState(0);
  useEffect(() => {
    if (page !== 'icps') return;
    let cancelled = false;
    setIcpPrioritiesLoading(true);
    void (async () => {
      const priorities = await fetchIcpPriorities({ forceRefresh: priorityRefreshKey > 0 });
      if (cancelled) return;
      const dismissed = getDismissedPriorityIds();
      setIcpPriorities(priorities.filter((p) => !dismissed.has(p.id)));
      setIcpPrioritiesLoading(false);
    })();
    return () => { cancelled = true; };
  }, [page, priorityRefreshKey]);

  // Fire a programmatic message when the parent sets pendingMessage
  useEffect(() => {
    if (pendingMessage?.text) {
      if (lastPendingNonceRef.current === pendingMessage.nonce) return;
      lastPendingNonceRef.current = pendingMessage.nonce;
      void sendMessage(pendingMessage.text, pendingMessage.isHidden, pendingMessage.threadPreview);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMessage?.nonce]);

  async function sendMessage(content: string, hidden?: boolean, threadPreview?: string) {
    if (!content.trim() || isLoading) return;
    if (embedGlass) setBriefingSurfaceEngaged(true);
    setInput('');

    const trimmed = content.trim();
    const preview = threadPreview?.trim();
    const userMessage: Message = {
      role: 'user',
      content: trimmed,
      ...(preview && preview !== trimmed ? { displayContent: preview } : {}),
    };
    const pendingPlaceholder: Message = { role: 'assistant', content: '', isPending: true };

    // Hidden messages don't show a user bubble — agent appears to open the conversation
    setMessages((prev) => [...(hidden ? prev : [...prev, userMessage]), pendingPlaceholder]);
    setIsLoading(true);

    try {
      // Build history for the API (exclude the pending placeholder)
      const history: { role: 'user' | 'assistant'; content: string }[] = [
        ...messages.filter((m) => !m.isPending).map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: trimmed },
      ];

      // Track the request so the Refresh button can abort it if the agent gets stuck.
      const abortController = new AbortController();
      inFlightAbortRef.current = abortController;
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, page, pageContext }),
        signal: abortController.signal,
      });

      if (!res.ok) throw new Error('Agent request failed');

      const data: {
        message: string;
        toolsUsed: string[];
        tableFilter?: AgentTableFilter;
        tableAccounts?: QueryAccount[];
        leadsFilter?: AgentLeadsFilter;
        tableLeads?: QueryLead[];
        suggestedNavigation?: { href: string; label: string; batchCompanies?: { id: string; name: string; icpId?: string | null }[] };
        pendingJobStart?: { requestType: string; icpId?: string; companyId?: string; batchCompanies?: { id: string; name: string; icpId?: string | null }[]; quantity: number };
        icpMutations?: Array<{ kind: 'updated' | 'deleted'; icpId: string; name: string | null; reasoning: string }>;
      } = await res.json();

      // Update the pending placeholder with the real response
      setMessages((prev) =>
        prev.map((m) =>
          m.isPending
            ? {
                role: 'assistant',
                content: data.message,
                toolsUsed: data.toolsUsed,
                navigation: data.suggestedNavigation,
              }
            : m,
        ),
      );

      // Apply accounts table filter if present
      if (data.tableFilter && onTableFilter) {
        onTableFilter(data.tableFilter, data.tableAccounts ?? []);
      }

      // Apply leads table filter if present
      if (data.leadsFilter && onLeadsFilter) {
        onLeadsFilter(data.leadsFilter, data.tableLeads ?? []);
      }

      // Notify parent to start a job
      if (data.pendingJobStart && onJobStarted) {
        onJobStarted(data.pendingJobStart);
      }

      // Notify parent that the agent wrote to the ICPs table (icps page) and refresh the
      // priorities inbox + cache so /today and /icps see the new state.
      if (Array.isArray(data.icpMutations) && data.icpMutations.length > 0) {
        if (onIcpMutation) onIcpMutation(data.icpMutations);
        clearIcpPrioritiesCache();
        setPriorityRefreshKey((k) => k + 1);
      }

      // If this response closes out a priority-card conversation, remove the card.
      // When the agent made no mutations ("not a problem"), persist the dismissal so
      // the same flag never resurfaces after a cache refresh.
      if (activePriorityIdRef.current) {
        const closedId = activePriorityIdRef.current;
        activePriorityIdRef.current = null;
        setIcpPriorities((prev) => prev.filter((p) => p.id !== closedId));
        const hadMutations = Array.isArray(data.icpMutations) && data.icpMutations.length > 0;
        if (!hadMutations) dismissPriority(closedId);
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.isPending
            ? {
                role: 'assistant',
                content: 'Something went wrong. Please try again.',
                toolsUsed: [],
              }
            : m,
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleClearFilter() {
    onTableClear?.();
  }

  function handleNavigate(href: string, batchCompanies?: { id: string; name: string; icpId?: string | null }[]) {
    const handoff: AgentHandoff = {
      messages: messages.filter((m) => !m.isPending),
      fromPage: page,
      timestamp: Date.now(),
    };
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
    if (batchCompanies && batchCompanies.length > 0) {
      sessionStorage.setItem(BATCH_CONTACTS_KEY, JSON.stringify(batchCompanies));
    }
    router.push(href);
  }

  function handleClearConversation() {
    setMessages([]);
    if (embedGlass) setBriefingSurfaceEngaged(false);
    onTableClear?.();
    inputRef.current?.focus();
  }

  /**
   * Refresh / unstick the agent without losing the conversation.
   * - Aborts any in-flight `/api/agent/chat` request so a hung tool call doesn't keep
   *   the panel locked in "thinking…" forever.
   * - Drops any pending placeholder message so the thread doesn't show a stale spinner.
   * - Resets isLoading + notifies the parent via onBusyChange.
   * - On the icps page also force-refreshes the audit priorities so a fresh "Worth attention"
   *   set is fetched. On other pages there are no priorities to refresh, so we just unstick.
   */
  function handleRefreshAgent() {
    try {
      inFlightAbortRef.current?.abort();
    } catch {
      // ignore
    }
    inFlightAbortRef.current = null;
    setMessages((prev) => prev.filter((m) => !m.isPending));
    setIsLoading(false);
    onBusyChange?.(false);
    if (page === 'icps') {
      setPriorityRefreshKey((k) => k + 1);
    }
    inputRef.current?.focus();
  }

  const showPrompts = !suppressPrompts && messages.length === 0 && !isLoading;
  const lightSetupChat = page === 'data' && variant !== 'central';
  /** Briefing-style / central layout: wide light chat surface. Triggered by Today (`page=today`) or the 'central' variant. */
  const todayChat = page === 'today' || variant === 'central';
  const embedGlass = Boolean(embedInBriefingBento && todayChat);
  const showBriefingOrb = embedGlass && briefingWelcome && !briefingSurfaceEngaged && !isLoading;
  const showBriefingIdleWelcome = embedGlass && briefingWelcome && messages.length === 0;
  const briefingChips = briefingIdleChips ?? (briefingWelcome ? DEFAULT_BRIEFING_IDLE_CHIPS : []);

  const briefingEmbedThreadVisible = embedGlass && (messages.length > 0 || isLoading);

  const messageThread = (
    <>
        {/* Handoff indicator */}
        {handoffFrom && messages.length > 0 && (
          <div className={cn('flex items-center justify-center gap-1.5 text-[10px]', todayChat ? 'text-slate-400' : 'text-[#b6c2c8]')}>
            <span className={cn('h-px flex-1', todayChat ? 'bg-slate-200' : 'bg-[rgba(13,53,71,0.07)]')} />
            <span>continued from {handoffFrom}</span>
            <span className={cn('h-px flex-1', todayChat ? 'bg-slate-200' : 'bg-[rgba(13,53,71,0.07)]')} />
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.role === 'user') {
            return (
              <div key={i} className="flex justify-end">
                <div
                  className={cn(
                    'text-white shadow-sm',
                    lightSetupChat
                      ? 'bg-arcova-teal max-w-[min(100%,28rem)] rounded-2xl rounded-tr-none px-4 py-3 text-base leading-relaxed'
                      : todayChat
                        ? embedGlass
                          ? 'bg-arcova-teal max-w-[min(100%,36rem)] rounded-2xl rounded-br-md rounded-tl-2xl rounded-tr-2xl px-4 py-3.5 font-manrope text-[1.125rem] leading-[1.45] tracking-[-0.016em] shadow-[0_10px_40px_-18px_rgba(0,164,180,0.45)]'
                          : 'bg-arcova-teal max-w-[min(100%,34rem)] rounded-2xl rounded-br-md rounded-tl-2xl rounded-tr-2xl px-4 py-3 text-[15px] leading-relaxed shadow-[0_10px_40px_-18px_rgba(0,164,180,0.45)]'
                        : 'bg-[#0d3547] max-w-[90%] rounded-tl-[14px] rounded-tr-[14px] rounded-bl-[14px] rounded-br-[4px] px-3.5 py-2.5 text-[13px] leading-[1.55]',
                  )}
                  style={!lightSetupChat && !todayChat ? { animation: 'arcova-msg-in 0.4s cubic-bezier(.16,1,.3,1)' } : undefined}
                >
                  {msg.displayContent ?? msg.content}
                </div>
              </div>
            );
          }

          // Split assistant message into paragraphs for separate bubbles
          const bubbles = msg.isPending
            ? ['']
            : stripMarkdown(msg.content)
                .split(/\n\n+/)
                .map((s) => s.trim())
                .filter(Boolean);
          if (bubbles.length === 0) bubbles.push('');

          return (
            <div
              key={i}
              className={cn(
                'flex items-start',
                embedGlass ? 'w-full' : '',
                lightSetupChat || todayChat ? 'gap-3' : 'gap-2.5',
              )}
              style={!lightSetupChat && !todayChat ? { animation: 'arcova-msg-in 0.18s ease-out' } : undefined}
            >
              {!embedGlass && (lightSetupChat || todayChat) ? (
                <div className="shrink-0 mt-0.5">
                  {msg.isPending ? (
                    <ArcovaLoader size={lightSetupChat ? 36 : 32} />
                  ) : (
                    <Image
                      src="/images/network-og.png"
                      alt="Arcova"
                      width={lightSetupChat ? 36 : 32}
                      height={lightSetupChat ? 36 : 32}
                      className={cn(
                        'rounded-full object-cover',
                        lightSetupChat
                          ? 'h-9 w-9 ring-2 ring-white shadow-sm'
                          : 'h-8 w-8 ring-2 ring-slate-100 shadow-sm',
                      )}
                    />
                  )}
                </div>
              ) : null}

              <div
                className={cn(
                  'flex min-w-0 flex-col',
                  embedGlass ? 'w-full max-w-[min(100%,40rem)]' : '',
                  lightSetupChat ? 'max-w-[min(100%,28rem)] gap-2' : todayChat ? 'max-w-[min(100%,40rem)] gap-3' : 'max-w-[90%] gap-1.5',
                )}
              >
                {msg.isPending ? (
                  <div
                    className={cn(
                      lightSetupChat
                        ? 'rounded-2xl rounded-tl-none border border-slate-200 bg-white px-4 py-3 text-base leading-relaxed text-slate-800 shadow-sm'
                        : todayChat
                          ? embedGlass
                            ? 'rounded-2xl rounded-tl-sm bg-gradient-to-br from-slate-50 to-slate-100/80 px-4 py-4 font-manrope text-[1.1875rem] leading-[1.45] tracking-[-0.018em] text-slate-700 ring-1 ring-slate-200/60'
                            : 'rounded-2xl rounded-tl-sm bg-gradient-to-br from-slate-50 to-slate-100/80 px-4 py-4 text-[15px] leading-relaxed text-slate-700 ring-1 ring-slate-200/60'
                          : 'rounded-tl-[14px] rounded-tr-[14px] rounded-bl-[4px] rounded-br-[14px] border border-[rgba(13,53,71,0.07)] bg-white/80 px-3.5 py-2.5 text-[13px] leading-[1.55] text-[#0d3547] backdrop-blur-sm',
                    )}
                  >
                    <div className="flex h-5 items-center gap-1.5">
                      {[0, 120, 240].map((d) => (
                        <span
                          key={d}
                          className="h-1.5 w-1.5 rounded-full bg-arcova-teal/60 animate-bounce"
                          style={{ animationDelay: `${d}ms` }}
                        />
                      ))}
                    </div>
                  </div>
                ) : todayChat ? (
                  <div
                    className={cn(
                      'rounded-2xl rounded-tl-sm bg-gradient-to-br from-slate-50 to-white px-4 py-4 text-slate-700 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9)] ring-1 ring-slate-200/55',
                      embedGlass
                        ? 'font-manrope text-[1.1875rem] leading-[1.45] tracking-[-0.018em]'
                        : 'text-[15px] leading-relaxed',
                    )}
                  >
                    {bubbles.map((bubble, bi) => (
                      <p key={bi} className={cn(bi > 0 && 'mt-3')}>
                        {bubble}
                      </p>
                    ))}
                  </div>
                ) : (
                  bubbles.map((bubble, bi) => (
                    <div
                      key={bi}
                      className={cn(
                        lightSetupChat
                          ? 'rounded-2xl rounded-tl-none border border-slate-200 bg-white px-4 py-3 text-base leading-relaxed text-slate-800 shadow-sm'
                          : 'rounded-tl-[14px] rounded-tr-[14px] rounded-bl-[4px] rounded-br-[14px] border border-[rgba(13,53,71,0.07)] bg-white/80 px-3.5 py-2.5 text-[13px] leading-[1.55] text-[#0d3547] backdrop-blur-sm',
                      )}
                      style={{ animation: !lightSetupChat ? 'arcova-msg-in 0.4s cubic-bezier(.16,1,.3,1)' : 'arcova-msg-in 0.18s ease-out' }}
                    >
                      {bubble}
                    </div>
                  ))
                )}

                {!msg.isPending && msg.navigation && (
                  <button
                    type="button"
                    onClick={() => handleNavigate(msg.navigation!.href, msg.navigation!.batchCompanies)}
                    className={cn(
                      'self-start rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors',
                      todayChat
                        ? 'flex items-center gap-1.5 border-slate-200 bg-white text-arcova-teal shadow-sm hover:border-arcova-teal/35 hover:bg-slate-50'
                        : 'flex items-center gap-1.5 border border-arcova-teal/30 bg-white text-arcova-teal hover:border-arcova-teal hover:bg-arcova-teal/5',
                    )}
                  >
                    <ArrowRight className="h-3 w-3" />
                    {msg.navigation.label}
                  </button>
                )}
              </div>
            </div>
          );
        })}
    </>
  );

  return (
    <div
      className={cn(
        'min-h-0 flex-col',
        // `flex` is split into the per-variant branches so the side-rail variant
        // can start as `hidden` (never paints at <768px) instead of `flex + max-[767px]:hidden`
        // (paints `display:flex` first, then drops to `display:none` once that media-query
        // rule wins). That race showed up as a one-frame flash of the agent stacked below
        // content on /import et al at viewports just under 768px.
        wide
          ? cn(
              'flex min-h-0 flex-1',
              embedGlass && 'h-full min-h-0 overflow-hidden',
              embedGlass ? 'px-0 py-0' : cn('px-4', lightSetupChat ? 'py-3' : 'py-4'),
            )
          : 'hidden md:flex shrink-0 self-stretch py-3 pr-3 pl-2',
        className,
      )}
    >
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-hidden',
          embedGlass && 'h-full min-h-0',
          wide ? 'w-full' : 'w-[360px] max-[767px]:w-full',
          embedGlass
            ? 'relative border-0 bg-transparent shadow-none ring-0'
            : surfaceClassName
              ? surfaceClassName
              : lightSetupChat
              ? 'rounded-[inherit] border border-slate-200/80 bg-white shadow-[0_24px_70px_-34px_rgba(15,23,42,0.45)] ring-1 ring-white'
              : todayChat
                ? 'relative rounded-[inherit] border border-slate-200/90 bg-white shadow-[0_28px_80px_-44px_rgba(15,23,42,0.22)] ring-1 ring-slate-900/[0.04]'
                : cn(
                    'relative rounded-[24px]',
                    'border border-white/85 bg-white/55',
                    'shadow-[0_24px_60px_-32px_rgba(13,53,71,0.18),_0_2px_6px_-2px_rgba(13,53,71,0.06)]',
                    'backdrop-blur-[28px] backdrop-saturate-150',
                  ),
        )}
      >
      {todayChat && !embedGlass ? (
        <BorderBeam
          size={100}
          duration={9}
          borderWidth={1.5}
          colorFrom="rgb(0, 164, 180)"
          colorTo="rgb(140, 217, 201)"
          delay={0}
        />
      ) : null}
      {!hideHeader && (
      <div
        className={cn(
          'flex shrink-0 items-center border-b',
          // Distinct chrome per surface — see memory: agent_surfaces_distinct.md
          // - lightSetupChat: /data sourcing flow (intentionally different)
          // - todayChat:      /today briefing or central variant (intentionally different)
          // - default:        side-panel agent on icps/accounts/leads/health/signals/imports/log
          lightSetupChat
            ? 'gap-3 border-slate-200 bg-white px-5 py-4'
            : todayChat
              ? 'gap-3 border-slate-100 bg-white px-4 py-3'
              : 'gap-3 border-[rgba(13,53,71,0.07)] bg-transparent px-[18px] pb-[14px] pt-[18px]',
        )}
      >
        {(!lightSetupChat && !todayChat) ? (
          /* 44×44 breathing orb — softer / glowier than the previous "football" look:
             bigger and more diffuse halo, lighter core that doesn't go to near-black at
             the edge. Three stacked layers (outer halo, main body, top sheen). */
          <div className="relative h-11 w-11 shrink-0" aria-hidden>
            {/* Outer halo — bigger, blurrier, brighter so the orb feels emissive.
                Throbs ~3.4s at rest (visible heartbeat, like it's waiting/thinking)
                and ~1.8s when actively loading. */}
            <span className="absolute rounded-full" style={{
              inset: '-55%',
              background: isLoading
                ? 'radial-gradient(circle, rgba(0,164,180,0.7) 0%, rgba(0,164,180,0.25) 35%, transparent 70%)'
                : 'radial-gradient(circle, rgba(0,164,180,0.45) 0%, rgba(0,164,180,0.18) 35%, transparent 70%)',
              filter: isLoading ? 'blur(14px)' : 'blur(12px)',
              animation: isLoading ? 'arcova-halo-pulse 1.8s ease-in-out infinite' : 'arcova-halo-pulse 5.2s ease-in-out infinite',
            }} />
            {/* Inner halo — tighter glow ring that hugs the orb. */}
            <span className="absolute rounded-full" style={{
              inset: '-15%',
              background: 'radial-gradient(circle, rgba(0,200,220,0.5) 0%, rgba(0,164,180,0.18) 45%, transparent 70%)',
              filter: 'blur(6px)',
            }} />
            {/* Main body — lighter teal that fades to a soft mid-tone, not near-black. */}
            <span className="absolute inset-0 rounded-full" style={{
              background: isLoading
                ? 'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.95) 0%, #1fd0e0 38%, rgba(0,164,180,0.85) 80%, rgba(0,95,128,0.55) 115%)'
                : 'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.9) 0%, #2fc6d4 42%, rgba(0,164,180,0.75) 82%, rgba(0,95,128,0.45) 115%)',
              boxShadow: isLoading
                ? 'inset 0 -3px 7px rgba(0,80,100,0.18), inset 0 2px 6px rgba(255,255,255,0.65), 0 0 24px 6px rgba(0,200,220,0.5)'
                : 'inset 0 -3px 7px rgba(0,80,100,0.14), inset 0 2px 6px rgba(255,255,255,0.55), 0 0 18px 4px rgba(0,200,220,0.32)',
              animation: isLoading ? 'arcova-orb-breathe 1.8s ease-in-out infinite' : 'arcova-orb-breathe 5.2s ease-in-out infinite',
            }} />
            {/* Top sheen — soft white highlight to keep the surface feeling spherical. */}
            <span className="absolute inset-0 rounded-full" style={{ background: 'radial-gradient(ellipse 65% 35% at 36% 24%, rgba(255,255,255,0.85), transparent 60%)' }} />
          </div>
        ) : (
          <Image
            src="/images/network-og.png"
            alt="Arcova"
            width={lightSetupChat ? 36 : 28}
            height={lightSetupChat ? 36 : 28}
            className={cn(
              'shrink-0 rounded-full object-cover',
              lightSetupChat
                ? 'h-9 w-9 ring-2 ring-slate-100 shadow-sm'
                : 'h-8 w-8 ring-2 ring-slate-100/80 shadow-sm',
            )}
          />
        )}
        <div className="flex-1 min-w-0">
          {(!lightSetupChat && !todayChat) ? (
            /* Side-rail variant: single-line page-specific prompt. Lighter
               weight + cool grey so the header reads as quietly present
               rather than a heavy navy slab; the orb on the left identifies
               this as the agent. */
            <p className="font-manrope text-[13px] font-medium leading-snug tracking-[0.005em] text-[#7d909a]">
              {headerSubtitle ?? PAGE_SUBTITLE[page] ?? 'Ask me anything'}
            </p>
          ) : (
            <>
              <p className={cn('font-semibold leading-none', lightSetupChat ? 'text-sm text-gray-900' : 'text-sm text-slate-900')}>Arcova Agent</p>
              <p className={cn('mt-1 leading-tight', lightSetupChat ? 'text-xs text-gray-500' : 'text-xs text-slate-500')}>
                {headerSubtitle ? String(headerSubtitle) : PAGE_SUBTITLE[page] ?? 'Ask me anything'}
              </p>
            </>
          )}
        </div>
        {/*
          Header actions (right cluster):
            +  Start new chat  → clears the message thread, restores the empty state
            ⟳  Refresh agent   → aborts any stuck request, drops pending placeholders,
                                  re-fetches priorities on the icps page

          Shown across all pages (the component is shared). The + is hidden when there's
          no conversation to clear; the ⟳ is always visible since stuck states can also
          happen on an idle panel mid-fetch.
        */}
        <div className="flex shrink-0 items-center gap-0.5">
          {messages.length > 0 && (
            <button
              onClick={handleClearConversation}
              className={cn(
                'transition-colors',
                lightSetupChat
                  ? 'rounded-lg p-2 text-gray-400 hover:bg-slate-50 hover:text-gray-600'
                  : todayChat
                    ? 'rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                    : 'rounded-lg p-1.5 text-gray-400 hover:bg-[#0d3547]/5 hover:text-gray-600',
              )}
              aria-label="Start new chat"
              title="Start new chat"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={handleRefreshAgent}
            className={cn(
              'transition-colors',
              lightSetupChat
                ? 'rounded-lg p-2 text-gray-400 hover:bg-slate-50 hover:text-gray-600'
                : todayChat
                  ? 'rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                  : 'rounded-lg p-1.5 text-gray-400 hover:bg-[#0d3547]/5 hover:text-gray-600',
            )}
            aria-label="Refresh agent"
            title="Refresh agent (recover from stuck state)"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
          </button>
        </div>
      </div>
      )}

      {/* ── ICP priorities loading state: ghost suggestion pills ── */}
      {showPrompts && page === 'icps' && icpPrioritiesLoading && (
        <div className={cn('shrink-0 px-[18px] pb-2 pt-3', !wide && 'max-[767px]:hidden')} aria-hidden>
          <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#b6c2c8]">
            Auditing your ICPs
          </p>
          <div className="flex flex-col gap-2">
            {([100, 76, 54] as const).map((pct, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-full px-3"
                style={{
                  height: 34,
                  width: `${pct}%`,
                  border: '1px dashed rgba(13,53,71,0.08)',
                  background: 'rgba(255,255,255,0.45)',
                  animation: `arcova-ghost-fadein 0.4s cubic-bezier(.16,1,.3,1) both`,
                  animationDelay: `${i * 0.12}s`,
                }}
              >
                {/* spark dot */}
                <span
                  className="shrink-0 rounded-full"
                  style={{ width: 16, height: 16, background: 'rgba(0,164,180,0.13)' }}
                />
                {/* shimmer bar */}
                <span
                  className="flex-1 rounded-full"
                  style={{
                    height: 7,
                    backgroundImage: 'linear-gradient(90deg, rgba(13,53,71,0.05) 0%, rgba(13,53,71,0.13) 40%, rgba(13,53,71,0.05) 100%)',
                    backgroundSize: '200% 100%',
                    animation: `arcova-ghost-shimmer 1.7s ease-in-out infinite`,
                    animationDelay: `${i * 0.22}s`,
                  }}
                />
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-[11px] text-[#a4b6c2]">Reading your ICPs in the background…</p>
        </div>
      )}

      {/* ── ICP priorities all-clear (icps page, audit done, nothing flagged) ── */}
      {showPrompts && page === 'icps' && !icpPrioritiesLoading && icpPriorities.length === 0 && (
        <div className={cn('shrink-0 px-[18px] pb-2 pt-1', !wide && 'max-[767px]:hidden')}>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#b6c2c8]">ICP definitions</p>
          <div className="rounded-[12px] border border-[rgba(13,53,71,0.07)] bg-white/55 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-arcova-teal/15 text-arcova-teal text-[9px]">✓</span>
              <p className="text-[12px] font-semibold text-[#0d3547]">Definitions look good</p>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-[#0d3547]">No structural issues with your ICPs. For coverage gaps, check ICP Health.</p>
          </div>
        </div>
      )}

      {/* ── ICP priorities inbox (icps page only, idle state) ── */}
      {showPrompts && page === 'icps' && !icpPrioritiesLoading && icpPriorities.length > 0 && (
        <div className={cn('shrink-0 px-[18px] pb-2 pt-1', !wide && 'max-[767px]:hidden')}>
          <div className="mb-2 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
            <span className="text-[11px] font-semibold text-[#0d3547]">Worth attention</span>
            <span className="rounded-full bg-[#0d3547]/8 px-1.5 py-px text-[10px] font-semibold text-[#0d3547]/60">
              {icpPriorities.length}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {icpPriorities.map((p) => (
              <div
                key={p.id}
                className="rounded-[12px] border border-[rgba(13,53,71,0.08)] bg-white/65 px-3 py-3"
              >
                {p.icpLabels.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {p.icpLabels.map((label) => (
                      <span
                        key={label}
                        className="inline-block rounded-full bg-[#0d3547]/8 px-2 py-0.5 text-[10.5px] font-medium text-[#0d3547]/70"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                )}
                <p className="m-0 text-[13px] font-semibold leading-snug text-[#0d3547]">
                  {p.headline}
                </p>
                {p.detail && (
                  <p className="m-0 mt-1.5 text-[11.5px] leading-snug text-[#0d3547]/70">{p.detail}</p>
                )}
                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => { activePriorityIdRef.current = p.id; sendMessage(p.cta.seedPrompt, false, p.cta.label); }}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#0d3547] px-3 py-1.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-[#0d3547]/85"
                  >
                    {p.cta.label}
                    <ArrowRight className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => { dismissPriority(p.id); setIcpPriorities((prev) => prev.filter((x) => x.id !== p.id)); }}
                    className="text-[11px] text-[#0d3547]/45 transition-colors hover:text-[#0d3547]/70"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/*
        Re-audit this page (icps page only, idle state).
        Always visible — whether the inbox has priorities or is all-clear — so the user
        can force a fresh Claude audit after making changes outside the agent (e.g.
        editing an ICP card directly). Different from the header `⟳` Refresh which
        unsticks the agent; this re-runs the audit content end-to-end.
      */}
      {showPrompts && page === 'icps' && !icpPrioritiesLoading && (
        <div className={cn('shrink-0 px-[18px] pb-2', !wide && 'max-[767px]:hidden')}>
          <button
            type="button"
            onClick={() => {
              try { sessionStorage.removeItem('arcova:icp-priorities'); sessionStorage.removeItem('arcova:today-priorities'); } catch { /* ignore */ }
              setPriorityRefreshKey((k) => k + 1);
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(13,53,71,0.12)] bg-white/55 px-3 py-1 text-[11px] font-medium text-[#0d3547]/60 transition-colors hover:bg-white hover:text-[#0d3547]"
          >
            <RefreshCw className="h-3 w-3" />
            Re-audit this page
          </button>
        </div>
      )}

      {/* ── Suggested prompts ──
          Hidden on /icps when priorities are showing — the inbox + chat input are enough,
          duplicating with chips makes the panel feel cramped. */}
      {showPrompts && page !== 'icps' && (
        <div className={cn('shrink-0', lightSetupChat ? 'px-5 pt-5 pb-3' : todayChat ? 'px-4 pt-4 pb-2' : 'px-[18px] pb-2 pt-1', !wide && 'max-[767px]:hidden')}>
          <p className={cn('font-semibold uppercase tracking-[0.16em]', lightSetupChat ? 'mb-3 text-[10px] text-slate-400' : todayChat ? 'mb-2 text-[11px] text-slate-400' : 'mb-2 text-[10px] text-[#b6c2c8]')}>
            Try asking
          </p>
          <div className={cn('flex flex-col', lightSetupChat ? 'gap-2' : todayChat ? 'gap-1.5' : 'gap-2')}>
            {(PROMPTS[page as keyof typeof PROMPTS] ?? []).map((prompt) => (
              <button
                key={prompt}
                onClick={() => sendMessage(prompt)}
                className={cn(
                  'flex items-center gap-2 text-left transition-all',
                  lightSetupChat
                    ? 'rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-sm text-slate-600 hover:border-arcova-teal/30 hover:bg-white hover:text-slate-900'
                    : todayChat
                      ? 'rounded-xl border border-slate-200/80 bg-slate-50/90 px-3.5 py-2.5 text-sm text-slate-600 hover:border-arcova-teal/25 hover:bg-white hover:text-slate-900'
                      : 'rounded-[12px] border border-[rgba(13,53,71,0.07)] bg-white/55 px-3 py-[9px] text-[12.5px] leading-snug text-[#0d3547] hover:-translate-y-px hover:border-arcova-teal hover:bg-white hover:shadow-[0_6px_16px_-10px_rgba(0,164,180,0.4)]',
                )}
              >
                {(!lightSetupChat && !todayChat) ? (
                  <span className="shrink-0 text-arcova-teal text-[11px] leading-[1.6]">✦</span>
                ) : (
                  <Sparkles className={cn('shrink-0 text-arcova-teal/50', lightSetupChat ? 'mt-0.5 h-3.5 w-3.5' : 'mt-0.5 h-3 w-3')} />
                )}
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {embedGlass && briefingWelcome && messages.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col justify-start px-1 pt-5 pb-2 sm:px-3 sm:pt-6 sm:pb-3">
          <div
            className={cn(
              'flex shrink-0 flex-col items-center justify-center transition-[max-height,opacity,margin] duration-300 ease-out',
              showBriefingOrb ? 'max-h-[min(17.5rem,42cqh)] overflow-visible opacity-100' : 'pointer-events-none max-h-0 overflow-hidden opacity-0',
            )}
            aria-hidden={!showBriefingOrb}
          >
            <BriefingAgentOrb />
          </div>
          {showBriefingIdleWelcome && briefingWelcome ? (
            <div className="mt-auto shrink-0 px-0.5 pb-0.5 sm:px-1 sm:pb-1">
              <p className="font-manrope text-sm font-medium text-slate-400">{briefingWelcome.greeting}</p>
              <p className="mt-3 font-manrope text-[1.25rem] leading-[1.42] tracking-[-0.02em] text-slate-800">
                {briefingWelcome.body}
              </p>
              {briefingChips.length > 0 ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  {briefingChips.map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => sendMessage(chip.prompt, undefined, chip.threadPreview)}
                      disabled={isLoading}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/90 bg-white/95 px-3.5 py-2 font-manrope text-sm font-semibold text-arcova-teal shadow-sm transition-colors hover:border-arcova-teal/35 hover:bg-slate-50/90 disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-arcova-teal/70" />
                      {chip.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Message thread ── */}
      {embedGlass ? (
        <div
          className={cn(
            'relative min-h-0 w-full',
            briefingEmbedThreadVisible ? 'flex-1' : 'max-h-0 shrink-0 overflow-hidden',
          )}
        >
          <div
            ref={scrollRef}
            className={cn(
              'space-y-5 px-1 sm:px-2',
              briefingEmbedThreadVisible
                ? 'absolute inset-0 box-border min-h-0 overflow-y-auto overscroll-contain py-2 [touch-action:pan-y]'
                : 'max-h-0 min-h-0 overflow-hidden py-0',
            )}
          >
            {messageThread}
          </div>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className={cn(
            'min-h-0 overflow-y-auto overscroll-y-contain',
            lightSetupChat
              ? 'flex-1 space-y-5 bg-slate-50/70 px-5 py-5'
              : todayChat
                ? 'flex-1 space-y-5 px-5 py-5 sm:px-6'
                : 'flex-1 space-y-3.5 bg-transparent px-[18px] py-4 [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-thumb]:rounded-[3px] [&::-webkit-scrollbar-thumb]:bg-[rgba(13,53,71,0.12)]',
          )}
        >
          {messageThread}
        </div>
      )}

      {/* ── Input bar ── */}
      <div
        className={cn(
          'shrink-0',
          lightSetupChat
            ? 'border-t border-slate-200 bg-white px-4 py-3'
            : todayChat
              ? embedGlass
                ? 'border-t border-[rgba(13,53,71,0.07)] bg-transparent px-0 pb-2 pt-2'
                : 'border-t border-slate-100 bg-white px-4 py-4'
              : 'border-t border-[rgba(13,53,71,0.07)] px-[14px] pb-[14px] pt-3',
        )}
      >
        <div className="flex items-center gap-2">
          {hideHeader && messages.length > 0 && (
            <button
              type="button"
              onClick={handleClearConversation}
              className={cn(
                'shrink-0 rounded-lg p-2 transition-colors',
                todayChat ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-700' : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600',
              )}
              aria-label="Clear conversation"
              title="Clear conversation"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          {/* Side-panel agent (default variant) uses the shared `AgentChatBar` component
              so other surfaces (e.g. the floating chat bar on /leads/contacts) stay
              visually consistent. The bespoke `todayChat` and `lightSetupChat` variants
              keep their inline JSX — different shapes/sizes, intentionally distinct. */}
          {!todayChat && !lightSetupChat ? (
            <AgentChatBar
              ref={inputRef}
              value={input}
              onChange={(v) => {
                setInput(v);
                if (embedGlass && v.trim()) setBriefingSurfaceEngaged(true);
              }}
              onSubmit={() => sendMessage(input)}
              placeholder={
                messages.length > 0
                  ? 'Ask a follow-up…'
                  : PAGE_INPUT_PLACEHOLDER[page] ?? 'Ask anything…'
              }
              isLoading={isLoading}
              className="flex-1"
            />
          ) : (
            <div
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 transition-all',
                !(todayChat && embedGlass) && 'focus-within:ring-2 focus-within:ring-arcova-teal/20',
                lightSetupChat
                  ? 'rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm focus-within:border-arcova-teal/40'
                  : embedGlass
                    ? 'rounded-2xl border border-[rgba(13,53,71,0.12)] bg-white/90 px-3 py-2.5 shadow-[0_8px_32px_-20px_rgba(13,53,71,0.18)] backdrop-blur-md focus-within:border-arcova-teal/45 focus-within:shadow-[0_8px_28px_-18px_rgba(0,164,180,0.22)]'
                    : 'rounded-2xl bg-slate-100/85 px-3 py-2 ring-1 ring-slate-200/70 focus-within:ring-arcova-teal/25',
              )}
            >
              <Sparkles className={cn('shrink-0 h-4 w-4 text-arcova-teal/45')} />
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => {
                  const v = e.target.value;
                  setInput(v);
                  if (embedGlass && v.trim()) setBriefingSurfaceEngaged(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendMessage(input);
                }}
                placeholder={
                  embedGlass
                    ? messages.length > 0
                      ? 'Ask a follow-up…'
                      : 'Ask anything…'
                    : messages.length > 0
                      ? 'Ask a follow-up…'
                      : page === 'leads'
                        ? 'Ask anything about your contacts…'
                        : 'Ask anything about your accounts…'
                }
                className={cn(
                  'min-w-0 flex-1 bg-transparent focus:outline-none',
                  embedGlass
                    ? 'font-manrope text-[1.0625rem] text-slate-800 placeholder:text-slate-400'
                    : 'text-base text-slate-800 placeholder:text-slate-400',
                )}
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isLoading}
                className={cn(
                  'shrink-0 text-white transition-colors disabled:cursor-not-allowed',
                  todayChat
                    ? 'rounded-xl bg-arcova-teal px-4 py-2.5 text-sm font-semibold hover:bg-arcova-teal/90 disabled:opacity-30'
                    : 'rounded-xl bg-arcova-teal p-2 hover:bg-arcova-teal/90 disabled:opacity-30',
                )}
                aria-label={todayChat ? 'Send message' : 'Send'}
              >
                {isLoading ? (
                  <div
                    className={cn(
                      'rounded-full border-2 border-white/30 border-t-white animate-spin',
                      todayChat ? 'h-4 w-4' : 'h-3.5 w-3.5',
                    )}
                  />
                ) : todayChat ? (
                  <span className="flex items-center gap-1.5">
                    <Send className="h-4 w-4" />
                    Send
                  </span>
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
  );
}
