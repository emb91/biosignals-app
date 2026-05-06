'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Send, Sparkles, X, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ArcovaLoader } from '@/components/ArcovaLoader';
import type { AccountQueryColumn, AccountQueryFilters, AccountSortBy, QueryAccount } from '@/lib/accounts-data';
import type { QueryColumn as LeadQueryColumn, LeadQueryFilters, LeadSortBy, QueryLead } from '@/lib/leads-data';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentPage = 'accounts' | 'leads' | 'dashboard' | 'pipeline' | 'signals' | 'imports';

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
  navigation?: { href: string; label: string };
}

const HANDOFF_KEY = 'arcova_agent_handoff';

interface AgentHandoff {
  messages: Message[];
  fromPage: AgentPage;
  timestamp: number;
}

interface AgentPanelProps {
  page: AgentPage;
  onTableFilter?: (filter: AgentTableFilter, accounts: QueryAccount[]) => void;
  onLeadsFilter?: (filter: AgentLeadsFilter, leads: QueryLead[]) => void;
  onTableClear?: () => void;
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
    'How healthy is my pipeline?',
    'What should I focus on this week?',
    'How many accounts are covered vs. opportunity?',
  ],
  pipeline: [
    'Which accounts are stalled?',
    'What moved to the next stage recently?',
    'Show me my highest-fit active opportunities',
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

// ─── Tool label prettifier ────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  get_workspace_summary: 'workspace overview',
  get_icp_definitions: 'ICP definitions',
  query_companies: 'company data',
  get_company_details: 'company details',
  query_contacts: 'contact data',
  filter_accounts_table: 'table filter',
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, ' ');
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AgentPanel({ page, onTableFilter, onLeadsFilter, onTableClear, className }: AgentPanelProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasTableFilter, setHasTableFilter] = useState(false);
  const [handoffFrom, setHandoffFrom] = useState<AgentPage | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Restore conversation handed off from another page
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(HANDOFF_KEY);
      if (!raw) return;
      sessionStorage.removeItem(HANDOFF_KEY);
      const handoff: AgentHandoff = JSON.parse(raw);
      if (Date.now() - handoff.timestamp < 5 * 60 * 1000) {
        setMessages(handoff.messages);
        setHandoffFrom(handoff.fromPage);
      }
    } catch {
      // ignore corrupt storage
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function sendMessage(content: string) {
    if (!content.trim() || isLoading) return;
    setInput('');

    const userMessage: Message = { role: 'user', content: content.trim() };
    const pendingMessage: Message = { role: 'assistant', content: '', isPending: true };

    setMessages((prev) => [...prev, userMessage, pendingMessage]);
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
        body: JSON.stringify({ messages: history, page }),
      });

      if (!res.ok) throw new Error('Agent request failed');

      const data: {
        message: string;
        toolsUsed: string[];
        tableFilter?: AgentTableFilter;
        tableAccounts?: QueryAccount[];
        leadsFilter?: AgentLeadsFilter;
        tableLeads?: QueryLead[];
        suggestedNavigation?: { href: string; label: string };
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
        setHasTableFilter(true);
      }

      // Apply leads table filter if present
      if (data.leadsFilter && onLeadsFilter) {
        onLeadsFilter(data.leadsFilter, data.tableLeads ?? []);
        setHasTableFilter(true);
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
    setHasTableFilter(false);
    onTableClear?.();
  }

  function handleNavigate(href: string) {
    const handoff: AgentHandoff = {
      messages: messages.filter((m) => !m.isPending),
      fromPage: page,
      timestamp: Date.now(),
    };
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
    router.push(href);
  }

  function handleClearConversation() {
    setMessages([]);
    setHasTableFilter(false);
    onTableClear?.();
    inputRef.current?.focus();
  }

  const showPrompts = messages.length === 0 && !isLoading;

  return (
    <div
      className={cn(
        'flex flex-col w-80 shrink-0 border-l border-gray-200 bg-white h-full',
        className,
      )}
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-100 bg-gray-50/60 shrink-0">
        <Image
          src="/images/network-og.png"
          alt="Arcova"
          width={28}
          height={28}
          className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-arcova-teal/20"
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-800 leading-none">Arcova Agent</p>
          <p className="text-[11px] text-gray-400 mt-0.5 leading-tight">
            Ask me anything about your accounts
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleClearConversation}
            className="shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Clear conversation"
            title="Clear conversation"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Active filter badge ── */}
      {hasTableFilter && (
        <div className="flex items-center justify-between gap-2 px-4 py-2 bg-arcova-teal/5 border-b border-arcova-teal/10 shrink-0">
          <p className="text-[11px] text-arcova-teal font-medium truncate">Table filter active</p>
          <button
            onClick={handleClearFilter}
            className="text-[11px] text-arcova-teal/70 hover:text-arcova-teal underline shrink-0"
          >
            Clear
          </button>
        </div>
      )}

      {/* ── Suggested prompts ── */}
      {showPrompts && (
        <div className="px-4 pt-4 pb-2 shrink-0">
          <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide mb-2">
            Try asking
          </p>
          <div className="flex flex-col gap-1.5">
            {PROMPTS[page].map((prompt) => (
              <button
                key={prompt}
                onClick={() => sendMessage(prompt)}
                className="flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-left text-xs text-gray-600 hover:border-arcova-teal/30 hover:text-arcova-teal hover:bg-arcova-teal/5 transition-colors"
              >
                <Sparkles className="w-3 h-3 shrink-0 mt-0.5 text-arcova-teal/50" />
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Message thread ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-0"
      >
        {/* Handoff indicator */}
        {handoffFrom && messages.length > 0 && (
          <div className="flex items-center gap-1.5 text-[10px] text-gray-400 justify-center">
            <span className="h-px flex-1 bg-gray-100" />
            <span>continued from {handoffFrom}</span>
            <span className="h-px flex-1 bg-gray-100" />
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'items-start gap-2.5')}>
            {msg.role === 'assistant' && (
              <div className="shrink-0 mt-0.5">
                {msg.isPending ? (
                  <ArcovaLoader size={24} />
                ) : (
                  <Image
                    src="/images/network-og.png"
                    alt="Arcova"
                    width={24}
                    height={24}
                    className="h-6 w-6 rounded-full object-cover ring-1 ring-arcova-teal/20"
                  />
                )}
              </div>
            )}

            <div className="flex flex-col gap-1 min-w-0 max-w-[calc(100%-2.5rem)]">
              {msg.role === 'user' ? (
                <div className="rounded-2xl rounded-tr-none bg-arcova-teal px-3.5 py-2.5 text-sm text-white leading-snug shadow-sm">
                  {msg.content}
                </div>
              ) : (
                <div
                  className={cn(
                    'rounded-2xl rounded-tl-none border border-gray-100 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-800 leading-snug transition-all duration-300',
                    msg.isPending ? 'opacity-100' : 'opacity-100',
                  )}
                >
                  {msg.isPending ? (
                    <div className="flex items-center gap-1 h-4">
                      {[0, 120, 240].map((d) => (
                        <span
                          key={d}
                          className="w-1.5 h-1.5 rounded-full bg-arcova-teal/50 animate-bounce"
                          style={{ animationDelay: `${d}ms` }}
                        />
                      ))}
                    </div>
                  ) : (
                    stripMarkdown(msg.content)
                  )}
                </div>
              )}

              {/* Tools used badge */}
              {msg.role === 'assistant' && !msg.isPending && msg.toolsUsed && msg.toolsUsed.length > 0 && (
                <p className="text-[10px] text-gray-400 pl-0.5">
                  Used: {msg.toolsUsed.map(toolLabel).join(', ')}
                </p>
              )}

              {/* Navigation button */}
              {msg.role === 'assistant' && !msg.isPending && msg.navigation && (
                <button
                  onClick={() => handleNavigate(msg.navigation!.href)}
                  className="flex items-center gap-1.5 rounded-full border border-arcova-teal/30 bg-white px-3 py-1.5 text-xs font-semibold text-arcova-teal hover:border-arcova-teal hover:bg-arcova-teal/5 transition-colors self-start"
                >
                  <ArrowRight className="w-3 h-3" />
                  {msg.navigation.label}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Input bar ── */}
      <div className="px-3 pb-3 pt-2 shrink-0 border-t border-gray-100">
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 focus-within:ring-2 focus-within:ring-arcova-teal/25 focus-within:border-arcova-teal/40 transition-all shadow-sm">
          <Sparkles className="w-3.5 h-3.5 text-arcova-teal/40 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') sendMessage(input);
            }}
            placeholder={messages.length > 0 ? 'Ask a follow-up…' : 'Ask me anything…'}
            className="flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none min-w-0"
            disabled={isLoading}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            className="shrink-0 p-1.5 rounded-lg bg-arcova-teal text-white hover:bg-arcova-teal/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Send"
          >
            {isLoading ? (
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
