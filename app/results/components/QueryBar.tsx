'use client';

import { useRef, useState } from 'react';
import { Sparkles, X, Search } from 'lucide-react';

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
}

export function QueryBar({
  onQuery,
  onClear,
  isLoading,
  interpretation,
  conversational,
  activeQuery,
}: QueryBarProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit() {
    const q = input.trim();
    if (!q || isLoading) return;
    onQuery(q);
  }

  function handleClear() {
    setInput('');
    onClear();
    inputRef.current?.focus();
  }

  function handleChip(prompt: string) {
    setInput(prompt);
    onQuery(prompt);
  }

  const showChips = !input && !activeQuery && !isLoading;
  const hasActive = !!activeQuery;

  return (
    <div className="mb-4 space-y-2">
      {/* Input row */}
      <div className="relative flex items-center gap-2">
        <div className="relative flex-1">
          <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-arcova-teal pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
              if (e.key === 'Escape') handleClear();
            }}
            placeholder="Ask anything about your leads…"
            className="w-full pl-9 pr-10 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-arcova-teal/30 bg-white placeholder:text-gray-400"
            disabled={isLoading}
          />
          {(input || hasActive) && (
            <button
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Clear query"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || isLoading}
          className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-arcova-teal text-white text-sm font-medium hover:bg-arcova-teal/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          Search
        </button>
      </div>

      {/* Suggested chips */}
      {showChips && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => handleChip(prompt)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 bg-white text-xs text-gray-600 hover:border-arcova-teal/40 hover:text-arcova-teal hover:bg-arcova-teal/5 transition-colors"
            >
              <Sparkles className="w-3 h-3 text-arcova-teal/60" />
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Interpretation / conversational feedback */}
      {isLoading && (
        <p className="text-xs text-gray-400 flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 border border-gray-300 border-t-arcova-teal rounded-full animate-spin" />
          Interpreting query…
        </p>
      )}

      {!isLoading && interpretation && (
        <p className="text-xs text-gray-500">
          <span className="font-medium text-gray-600">Agent: </span>
          {interpretation}
        </p>
      )}

      {!isLoading && conversational && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded px-2.5 py-1.5 border border-amber-100">
          {conversational}
        </p>
      )}
    </div>
  );
}
