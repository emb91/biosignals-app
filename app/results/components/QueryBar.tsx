'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Sparkles, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ArcovaLoader } from '@/components/ArcovaLoader';

const SUGGESTED_PROMPTS = [
  'Who should I reach out to this week',
  'Show me good fit companies with poor contacts',
  'Find all Series B oncology contacts',
  'Who has a recent signal',
  "Show me contacts I haven't actioned yet",
];

interface QueryBarProps {
  onQuery: (query: string) => void;
  onClear: () => void;
  isLoading: boolean;
  interpretation: string | null;
  conversational: string | null;
  activeQuery: string | null;
  placeholder?: string;
  suggestedPrompts?: string[];
}

export function QueryBar({
  onQuery,
  onClear,
  isLoading,
  interpretation,
  conversational,
  activeQuery,
  placeholder = 'Ask anything about your leads…',
  suggestedPrompts = SUGGESTED_PROMPTS,
}: QueryBarProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [revealed, setRevealed] = useState(false);

  function handleSubmit() {
    const q = input.trim();
    if (!q || isLoading) return;
    setInput('');
    onQuery(q);
  }

  function handleClear() {
    setInput('');
    onClear();
    inputRef.current?.focus();
  }

  function handleChip(prompt: string) {
    onQuery(prompt);
  }

  // Fade-in reveal when response arrives
  useEffect(() => {
    if (isLoading) {
      setRevealed(false);
      return;
    }
    if (!interpretation && !conversational) return;
    const t = setTimeout(() => setRevealed(true), 30);
    return () => clearTimeout(t);
  }, [isLoading, interpretation, conversational]);

  const showChips = !activeQuery && !isLoading;
  const primaryMessage = conversational || interpretation;

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-100 bg-gray-50/60">
        <Image
          src="/images/network-og.png"
          alt="Arcova"
          width={22}
          height={22}
          className="h-[22px] w-[22px] shrink-0 rounded-full object-cover ring-1 ring-arcova-teal/20"
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-700 leading-none">Arcova Agent</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Ask me to filter, sort, or reshape the table</p>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* ── Chat transcript ── */}
        {(activeQuery || isLoading) && (
          <div className="space-y-2">
            {/* User bubble */}
            {activeQuery && (
              <div className="flex justify-end">
                <div className="max-w-[min(100%,32rem)] rounded-2xl rounded-tr-none bg-arcova-teal px-4 py-2.5 text-sm leading-snug text-white shadow-sm">
                  {activeQuery}
                </div>
              </div>
            )}

            {/* Agent bubble */}
            <div className="flex items-start gap-2.5">
              {isLoading ? (
                <div className="shrink-0 mt-0.5">
                  <ArcovaLoader size={26} />
                </div>
              ) : (
                <Image
                  src="/images/network-og.png"
                  alt="Arcova"
                  width={26}
                  height={26}
                  className="h-[26px] w-[26px] shrink-0 rounded-full object-cover ring-1 ring-arcova-teal/20 mt-0.5"
                />
              )}

              <div
                className={cn(
                  'max-w-[min(100%,32rem)] rounded-2xl rounded-tl-none border border-gray-100 bg-gray-50 px-4 py-2.5 text-sm leading-snug text-gray-800 transition-all duration-500 ease-out',
                  isLoading ? 'opacity-100 translate-y-0' : revealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
                )}
              >
                {isLoading ? (
                  <div className="flex items-center gap-1 h-4">
                    {[0, 150, 300].map((d) => (
                      <span
                        key={d}
                        className="w-1.5 h-1.5 rounded-full bg-arcova-teal/50 animate-bounce"
                        style={{ animationDelay: `${d}ms` }}
                      />
                    ))}
                  </div>
                ) : (
                  primaryMessage ?? ''
                )}
              </div>
            </div>

            {/* Clear link */}
            {!isLoading && (
              <div className="flex justify-end">
                <button
                  onClick={handleClear}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Suggested chips ── */}
        {showChips && (
          <div className="flex flex-wrap gap-1.5">
            {suggestedPrompts.map((prompt) => (
              <button
                key={prompt}
                onClick={() => handleChip(prompt)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 bg-gray-50 text-xs text-gray-600 hover:border-arcova-teal/40 hover:text-arcova-teal hover:bg-arcova-teal/5 transition-colors"
              >
                <Sparkles className="w-3 h-3 text-arcova-teal/60" />
                {prompt}
              </button>
            ))}
          </div>
        )}

        {/* ── Chat input ── */}
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 focus-within:ring-2 focus-within:ring-arcova-teal/30 focus-within:border-arcova-teal/40 transition-all">
          <Sparkles className="w-3.5 h-3.5 text-arcova-teal/50 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
              if (e.key === 'Escape') handleClear();
            }}
            placeholder={activeQuery ? 'Ask a follow-up…' : placeholder}
            className="flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none min-w-0"
            disabled={isLoading}
          />
          <button
            onClick={handleSubmit}
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
