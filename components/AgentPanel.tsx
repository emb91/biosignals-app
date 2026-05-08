'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Send, Sparkles, X, ArrowRight, Mic } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ArcovaLoader } from '@/components/ArcovaLoader';
import { BorderBeam } from '@/components/ui/border-beam';
import { BriefingAgentOrb } from '@/components/briefing/BriefingAgentOrb';
import type { AccountQueryColumn, AccountQueryFilters, AccountSortBy, QueryAccount } from '@/lib/accounts-data';
import type { QueryColumn as LeadQueryColumn, LeadQueryFilters, LeadSortBy, QueryLead } from '@/lib/leads-data';
import { BATCH_CONTACTS_KEY } from '@/lib/batch-contacts';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentPage = 'accounts' | 'leads' | 'dashboard' | 'health' | 'signals' | 'imports' | 'data';

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

interface AgentPanelProps {
  page: AgentPage;
  pageContext?: Record<string, unknown>;
  /** Programmatically fire a message into the agent. Increment nonce to re-fire the same text.
   *  Set isHidden to suppress the user bubble — the agent appears to open the conversation. */
  pendingMessage?: { text: string; nonce: number; isHidden?: boolean };
  onTableFilter?: (filter: AgentTableFilter, accounts: QueryAccount[]) => void;
  onLeadsFilter?: (filter: AgentLeadsFilter, leads: QueryLead[]) => void;
  onTableClear?: () => void;
  /** When true, the panel fills its container width instead of the fixed w-80 default. */
  wide?: boolean;
  onJobStarted?: (job: { requestType: string; icpId?: string; companyId?: string; batchCompanies?: { id: string; name: string; icpId?: string | null }[]; quantity: number }) => void;
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
  briefingIdleChips?: { label: string; prompt: string }[];
  className?: string;
}

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
  dashboard: [
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
};

const DEFAULT_BRIEFING_IDLE_CHIPS: { label: string; prompt: string }[] = [
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

export function AgentPanel({ page, pageContext, pendingMessage, onTableFilter, onLeadsFilter, onTableClear, wide, onJobStarted, hideHeader, suppressPrompts, embedInBriefingBento, onBusyChange, briefingWelcome, briefingIdleChips, surfaceClassName, className }: AgentPanelProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [handoffFrom, setHandoffFrom] = useState<AgentPage | null>(null);
  /** Today tile: orb and "standing" surface until the user types, sends, or taps an idle chip (one-way). */
  const [briefingSurfaceEngaged, setBriefingSurfaceEngaged] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastPendingNonceRef = useRef<number | null>(null);

  // Restore conversation handed off from another page (layout effect avoids a one-frame idle welcome flash)
  useLayoutEffect(() => {
    try {
      const raw = sessionStorage.getItem(HANDOFF_KEY);
      if (!raw) return;
      sessionStorage.removeItem(HANDOFF_KEY);
      const handoff: AgentHandoff = JSON.parse(raw);
      if (Date.now() - handoff.timestamp < 5 * 60 * 1000) {
        setMessages(handoff.messages);
        setHandoffFrom(handoff.fromPage);
        if (embedInBriefingBento && page === 'dashboard') {
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

  // Fire a programmatic message when the parent sets pendingMessage
  useEffect(() => {
    if (pendingMessage?.text) {
      if (lastPendingNonceRef.current === pendingMessage.nonce) return;
      lastPendingNonceRef.current = pendingMessage.nonce;
      void sendMessage(pendingMessage.text, pendingMessage.isHidden);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMessage?.nonce]);

  async function sendMessage(content: string, hidden?: boolean) {
    if (!content.trim() || isLoading) return;
    if (embedGlass) setBriefingSurfaceEngaged(true);
    setInput('');

    const userMessage: Message = { role: 'user', content: content.trim() };
    const pendingPlaceholder: Message = { role: 'assistant', content: '', isPending: true };

    // Hidden messages don't show a user bubble — agent appears to open the conversation
    setMessages((prev) => [...(hidden ? prev : [...prev, userMessage]), pendingPlaceholder]);
    setIsLoading(true);

    try {
      // Build history for the API (exclude the pending placeholder)
      const history: { role: 'user' | 'assistant'; content: string }[] = [
        ...messages.filter((m) => !m.isPending).map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: content.trim() },
      ];

      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, page, pageContext }),
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

  const showPrompts = !suppressPrompts && messages.length === 0 && !isLoading;
  const lightSetupChat = page === 'data';
  /** Briefing-only: light surface aligned with /briefing, not the old dark nested panels */
  const briefingChat = page === 'dashboard';
  const embedGlass = Boolean(embedInBriefingBento && briefingChat);
  const showBriefingOrb = embedGlass && briefingWelcome && !briefingSurfaceEngaged && !isLoading;
  const showBriefingIdleWelcome = embedGlass && briefingWelcome && messages.length === 0;
  const briefingChips = briefingIdleChips ?? (briefingWelcome ? DEFAULT_BRIEFING_IDLE_CHIPS : []);

  const briefingEmbedThreadVisible = embedGlass && (messages.length > 0 || isLoading);

  const messageThread = (
    <>
        {/* Handoff indicator */}
        {handoffFrom && messages.length > 0 && (
          <div className={cn('flex items-center justify-center gap-1.5 text-[10px]', briefingChat ? 'text-slate-400' : 'text-gray-400')}>
            <span className={cn('h-px flex-1', briefingChat ? 'bg-slate-200' : 'bg-gray-100')} />
            <span>continued from {handoffFrom}</span>
            <span className={cn('h-px flex-1', briefingChat ? 'bg-slate-200' : 'bg-gray-100')} />
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.role === 'user') {
            return (
              <div key={i} className="flex justify-end">
                <div
                  className={cn(
                    'bg-arcova-teal text-white shadow-sm',
                    lightSetupChat
                      ? 'max-w-[min(100%,28rem)] rounded-2xl rounded-tr-none px-4 py-3 text-base leading-relaxed'
                      : briefingChat
                        ? embedGlass
                          ? 'max-w-[min(100%,36rem)] rounded-2xl rounded-br-md rounded-tl-2xl rounded-tr-2xl px-4 py-3.5 font-manrope text-[1.125rem] leading-[1.45] tracking-[-0.016em] shadow-[0_10px_40px_-18px_rgba(0,164,180,0.45)]'
                          : 'max-w-[min(100%,34rem)] rounded-2xl rounded-br-md rounded-tl-2xl rounded-tr-2xl px-4 py-3 text-[15px] leading-relaxed shadow-[0_10px_40px_-18px_rgba(0,164,180,0.45)]'
                        : 'max-w-[calc(100%-2.5rem)] rounded-2xl rounded-tr-none px-3.5 py-2.5 text-sm leading-snug',
                  )}
                >
                  {msg.content}
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
                lightSetupChat || briefingChat ? 'gap-3' : 'gap-2.5',
              )}
            >
              {!embedGlass ? (
                <div className="shrink-0 mt-0.5">
                  {msg.isPending ? (
                    <ArcovaLoader size={lightSetupChat ? 36 : briefingChat ? 32 : 24} />
                  ) : (
                    <Image
                      src="/images/network-og.png"
                      alt="Arcova"
                      width={lightSetupChat ? 36 : briefingChat ? 32 : 24}
                      height={lightSetupChat ? 36 : briefingChat ? 32 : 24}
                      className={cn(
                        'rounded-full object-cover',
                        lightSetupChat
                          ? 'h-9 w-9 ring-2 ring-white shadow-sm'
                          : briefingChat
                            ? 'h-8 w-8 ring-2 ring-slate-100 shadow-sm'
                            : 'h-6 w-6 ring-1 ring-arcova-teal/20',
                      )}
                    />
                  )}
                </div>
              ) : null}

              <div
                className={cn(
                  'flex min-w-0 flex-col',
                  embedGlass ? 'w-full max-w-[min(100%,40rem)]' : '',
                  lightSetupChat ? 'max-w-[min(100%,28rem)] gap-2' : briefingChat ? 'max-w-[min(100%,40rem)] gap-3' : 'max-w-[calc(100%-2.5rem)] gap-1.5',
                )}
              >
                {msg.isPending ? (
                  <div
                    className={cn(
                      lightSetupChat
                        ? 'rounded-2xl rounded-tl-none border border-slate-200 bg-white px-4 py-3 text-base leading-relaxed text-slate-800 shadow-sm'
                        : briefingChat
                          ? embedGlass
                            ? 'rounded-2xl rounded-tl-sm bg-gradient-to-br from-slate-50 to-slate-100/80 px-4 py-4 font-manrope text-[1.1875rem] leading-[1.45] tracking-[-0.018em] text-slate-700 ring-1 ring-slate-200/60'
                            : 'rounded-2xl rounded-tl-sm bg-gradient-to-br from-slate-50 to-slate-100/80 px-4 py-4 text-[15px] leading-relaxed text-slate-700 ring-1 ring-slate-200/60'
                          : 'rounded-2xl rounded-tl-none border border-gray-100 bg-white px-3.5 py-2.5 text-sm leading-snug text-gray-800 shadow-sm',
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
                ) : briefingChat ? (
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
                        'rounded-2xl rounded-tl-none border shadow-sm',
                        lightSetupChat
                          ? 'border-slate-200 bg-white px-4 py-3 text-base leading-relaxed text-slate-800'
                          : 'border-gray-100 bg-gray-50 px-3.5 py-2.5 text-sm leading-snug text-gray-800',
                      )}
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
                      briefingChat
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
        'flex min-h-0 flex-col',
        wide
          ? cn(
              'min-h-0 flex-1',
              embedGlass && 'h-full min-h-0 overflow-hidden',
              embedGlass ? 'px-0 py-0' : cn('px-4', lightSetupChat ? 'py-3' : 'py-4'),
            )
          : 'shrink-0 self-stretch py-3 pr-3 pl-2 max-[1279px]:h-80 max-[1279px]:self-auto max-[1279px]:px-4 max-[1279px]:pb-4 max-[1279px]:pt-0 sm:max-[1279px]:px-6',
        className,
      )}
    >
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]',
          embedGlass && 'h-full min-h-0',
          wide ? 'w-full' : 'w-80 max-[1279px]:w-full',
          embedGlass
            ? 'relative border-0 bg-transparent shadow-none ring-0'
            : surfaceClassName
              ? surfaceClassName
              : lightSetupChat
              ? 'border border-slate-200/80 bg-white shadow-[0_24px_70px_-34px_rgba(15,23,42,0.45)] ring-1 ring-white'
              : briefingChat
                ? 'relative border border-slate-200/90 bg-white shadow-[0_28px_80px_-44px_rgba(15,23,42,0.22)] ring-1 ring-slate-900/[0.04]'
                : cn(
                    'border border-gray-200 bg-white',
                    'shadow-lg shadow-gray-900/5',
                    'ring-1 ring-gray-950/[0.06]',
                  ),
        )}
      >
      {briefingChat && !embedGlass ? (
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
          'flex shrink-0 items-center gap-2.5 border-b',
          lightSetupChat
            ? 'border-slate-200 bg-white px-5 py-4'
            : briefingChat
              ? 'border-slate-100 bg-white px-4 py-3'
              : 'border-gray-100 bg-gray-50/60 px-4 py-3',
        )}
      >
        <Image
          src="/images/network-og.png"
          alt="Arcova"
          width={lightSetupChat ? 36 : 28}
          height={lightSetupChat ? 36 : 28}
          className={cn(
            'shrink-0 rounded-full object-cover',
            lightSetupChat
              ? 'h-9 w-9 ring-2 ring-slate-100 shadow-sm'
              : briefingChat
                ? 'h-8 w-8 ring-2 ring-slate-100/80 shadow-sm'
                : 'h-7 w-7 ring-1 ring-arcova-teal/20',
          )}
        />
        <div className="flex-1 min-w-0">
          <p className={cn('font-semibold leading-none', lightSetupChat ? 'text-sm text-gray-900' : briefingChat ? 'text-sm text-slate-900' : 'text-xs text-gray-900')}>Arcova Agent</p>
          <p className={cn('mt-1 leading-tight', lightSetupChat ? 'text-xs text-gray-500' : briefingChat ? 'text-xs text-slate-500' : 'text-[11px] text-gray-500')}>
            {page === 'data'
              ? 'Run sourcing jobs and watch the queue on the right'
              : 'Ask me anything about your accounts'}
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleClearConversation}
            className={cn(
              'shrink-0 transition-colors',
              lightSetupChat
                ? 'text-gray-400 hover:text-gray-600 rounded-lg p-2 hover:bg-slate-50'
                : briefingChat
                  ? 'text-slate-400 hover:text-slate-700 rounded-lg p-2 hover:bg-slate-100'
                  : 'text-gray-400 hover:text-gray-600',
            )}
            aria-label="Clear conversation"
            title="Clear conversation"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      )}

      {/* ── Suggested prompts ── */}
      {showPrompts && (
        <div className={cn('shrink-0', lightSetupChat ? 'px-5 pt-5 pb-3' : 'px-4 pt-4 pb-2', !wide && 'max-[1279px]:hidden')}>
          <p className={cn('font-medium uppercase tracking-wide', lightSetupChat ? 'mb-3 text-[10px] text-slate-400' : briefingChat ? 'mb-2 text-[11px] text-slate-400' : 'mb-2 text-[11px] text-gray-400')}>
            Try asking
          </p>
          <div className={cn('flex flex-col', lightSetupChat ? 'gap-2' : 'gap-1.5')}>
            {PROMPTS[page].map((prompt) => (
              <button
                key={prompt}
                onClick={() => sendMessage(prompt)}
                className={cn(
                  'flex items-start gap-2 text-left transition-colors',
                  lightSetupChat
                    ? 'rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-sm text-slate-600 hover:border-arcova-teal/30 hover:bg-white hover:text-slate-900'
                    : briefingChat
                      ? 'rounded-xl border border-slate-200/80 bg-slate-50/90 px-3.5 py-2.5 text-sm text-slate-600 hover:border-arcova-teal/25 hover:bg-white hover:text-slate-900'
                      : 'rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600 hover:border-arcova-teal/30 hover:text-arcova-teal hover:bg-arcova-teal/5',
                )}
              >
                <Sparkles className={cn('shrink-0 text-arcova-teal/50', lightSetupChat ? 'mt-0.5 h-3.5 w-3.5' : 'mt-0.5 h-3 w-3')} />
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
              'flex shrink-0 flex-col items-center justify-center overflow-hidden transition-[max-height,opacity,margin] duration-300 ease-out',
              showBriefingOrb
                ? 'max-h-[min(17.5rem,42vh)] opacity-100'
                : 'pointer-events-none max-h-0 opacity-0',
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
                      onClick={() => sendMessage(chip.prompt)}
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
              : briefingChat
                ? 'flex-1 space-y-5 px-5 py-5 sm:px-6'
                : 'flex-1 space-y-4 px-4 py-3',
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
            : briefingChat
              ? embedGlass
                ? 'border-t border-[rgba(13,53,71,0.07)] bg-transparent px-0 pb-2 pt-2'
                : 'border-t border-slate-100 bg-white px-4 py-4'
              : 'border-t border-gray-100 px-3 pb-3 pt-2',
        )}
      >
        <div className="flex items-center gap-2">
          {hideHeader && messages.length > 0 && (
            <button
              type="button"
              onClick={handleClearConversation}
              className={cn(
                'shrink-0 rounded-lg p-2 transition-colors',
                briefingChat ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-700' : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600',
              )}
              aria-label="Clear conversation"
              title="Clear conversation"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <div
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2 transition-all',
              !(briefingChat && embedGlass) && 'focus-within:ring-2 focus-within:ring-arcova-teal/20',
              lightSetupChat
                ? 'rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm focus-within:border-arcova-teal/40'
                : briefingChat
                  ? embedGlass
                    ? 'rounded-2xl border border-[rgba(13,53,71,0.12)] bg-white/90 px-3 py-2.5 shadow-[0_8px_32px_-20px_rgba(13,53,71,0.18)] backdrop-blur-md focus-within:border-arcova-teal/45 focus-within:shadow-[0_8px_28px_-18px_rgba(0,164,180,0.22)]'
                    : 'rounded-2xl bg-slate-100/85 px-3 py-2 ring-1 ring-slate-200/70 focus-within:ring-arcova-teal/25'
                  : 'rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm focus-within:border-arcova-teal/40',
            )}
          >
            {embedGlass ? (
              <button
                type="button"
                className="shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100/90 hover:text-slate-600"
                aria-label="Voice input"
                title="Voice input coming soon"
                onClick={() => inputRef.current?.focus()}
              >
                <Mic className="h-4 w-4" />
              </button>
            ) : (
              <Sparkles className={cn('shrink-0 text-arcova-teal/45', briefingChat || lightSetupChat ? 'h-4 w-4' : 'h-3.5 w-3.5')} />
            )}
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
                    ? 'Ask a follow-up, or press space to talk…'
                    : 'Ask anything, or press space to talk…'
                  : messages.length > 0
                    ? 'Ask a follow-up…'
                    : 'Ask me anything…'
              }
              className={cn(
                'min-w-0 flex-1 bg-transparent focus:outline-none',
                embedGlass
                  ? 'font-manrope text-[1.0625rem] text-slate-800 placeholder:text-slate-400'
                  : lightSetupChat || briefingChat
                    ? 'text-base text-slate-800 placeholder:text-slate-400'
                    : 'text-sm text-gray-800 placeholder:text-gray-400',
              )}
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isLoading}
              className={cn(
                'shrink-0 rounded-xl bg-arcova-teal text-white transition-colors hover:bg-arcova-teal/90 disabled:cursor-not-allowed disabled:opacity-30',
                briefingChat ? 'px-4 py-2.5 text-sm font-semibold' : lightSetupChat ? 'p-2' : 'p-1.5',
              )}
              aria-label={briefingChat ? 'Send message' : 'Send'}
            >
              {isLoading ? (
                <div
                  className={cn(
                    'rounded-full border-2 border-white/30 border-t-white animate-spin',
                    briefingChat ? 'h-4 w-4' : 'h-3.5 w-3.5',
                  )}
                />
              ) : briefingChat ? (
                <span className="flex items-center gap-1.5">
                  <Send className="h-4 w-4" />
                  Send
                </span>
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
  );
}
