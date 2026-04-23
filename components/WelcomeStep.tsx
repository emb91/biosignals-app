'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import { ArcovaLoader } from '@/components/ArcovaLoader';

// ── Types ──────────────────────────────────────────────────────────────────

type TextBlock = { type: 'text'; text: string };
type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, string> };
type ContentBlock = TextBlock | ToolUseBlock;

type AssistantMessage = { role: 'assistant'; content: ContentBlock[] };
type UserMessage = { role: 'user'; content: string };
type ToolResultMessage = {
  role: 'user';
  content: Array<{ type: 'tool_result'; tool_use_id: string; content: string }>;
};
type ConversationMessage = AssistantMessage | UserMessage | ToolResultMessage;

type DisplayMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  /** true while the typewriter animation is in progress */
  typing?: boolean;
};

// ── Sub-components ─────────────────────────────────────────────────────────

function AgentAvatar() {
  return (
    <div className="shrink-0 w-8 h-8 rounded-full bg-arcova-darkblue flex items-center justify-center mt-0.5">
      <Image src="/images/network-og.png" alt="Arcova" width={18} height={18} className="rounded-full" />
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-start gap-3">
      <AgentAvatar />
      <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-none px-4 py-3 shadow-sm">
        <div className="flex gap-1 items-center h-4">
          {[0, 150, 300].map((delay) => (
            <div
              key={delay}
              className="w-1.5 h-1.5 bg-arcova-teal/70 rounded-full animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const TYPING_SPEED = 18; // ms per character — shared by TypingText component below

// ── Main component ─────────────────────────────────────────────────────────

interface WelcomeStepProps {
  firstName?: string;
  onAnalyse: (websiteUrl: string) => Promise<void>;
  isAnalyzing: boolean;
  loadingMessage: string;
}

export default function WelcomeStep({ firstName, onAnalyse, isAnalyzing, loadingMessage }: WelcomeStepProps) {
  // Conversation history sent to the API on each turn
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  // What's shown in the UI
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
  // The assistant message currently being animated
  const [isThinking, setIsThinking] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [inputDisabled, setInputDisabled] = useState(true);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [displayMessages, isThinking]);

  // Focus input when enabled
  useEffect(() => {
    if (!inputDisabled) inputRef.current?.focus();
  }, [inputDisabled]);

  // ── Send a turn to the API ──────────────────────────────────────────────

  const sendToAgent = useCallback(
    async (messages: ConversationMessage[]) => {
      setIsThinking(true);
      setError('');

      try {
        const res = await fetch('/api/onboarding-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages, firstName }),
        });

        if (!res.ok) throw new Error('Failed to reach onboarding agent');

        const data = await res.json() as {
          role: 'assistant';
          content: ContentBlock[];
          stop_reason: string;
        };

        setIsThinking(false);

        // Build updated history with this assistant message
        const assistantMsg: AssistantMessage = { role: 'assistant', content: data.content };
        const updatedHistory: ConversationMessage[] = [...messages, assistantMsg];

        // Extract text to display
        const textBlock = data.content.find((b): b is TextBlock => b.type === 'text');
        const toolBlocks = data.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');

        if (textBlock?.text) {
          // Animate the text response
          const msgId = crypto.randomUUID();
          setDisplayMessages((prev) => [
            ...prev,
            { id: msgId, role: 'assistant', text: textBlock.text, typing: true },
          ]);
          // Wait for animation before handling tools
          await new Promise<void>((resolve) => {
            const duration = textBlock.text.length * TYPING_SPEED + 200;
            setTimeout(resolve, duration);
          });

          setDisplayMessages((prev) =>
            prev.map((m) => (m.id === msgId ? { ...m, typing: false } : m))
          );
        }

        // Handle tool calls
        if (toolBlocks.length > 0) {
          const toolResults: ToolResultMessage = {
            role: 'user',
            content: [],
          };

          for (const tool of toolBlocks) {
            if (tool.name === 'capture_name') {
              const name = tool.input.first_name;
              // Save name to Supabase auth metadata
              try {
                await supabase.auth.updateUser({ data: { full_name: name } });
              } catch {
                // Non-fatal — continue the conversation
              }
              toolResults.content.push({
                type: 'tool_result',
                tool_use_id: tool.id,
                content: `Name captured: ${name}`,
              });
            } else if (tool.name === 'begin_analysis') {
              const url = tool.input.website_url;
              toolResults.content.push({
                type: 'tool_result',
                tool_use_id: tool.id,
                content: 'Analysis started.',
              });
              // Continue the conversation (Claude will say something like "On it...")
              const finalHistory: ConversationMessage[] = [...updatedHistory, toolResults];
              setHistory(finalHistory);
              // Trigger analysis — WelcomeStep will be unmounted by the parent
              await onAnalyse(url.startsWith('http') ? url : `https://${url}`);
              return;
            }
          }

          // For capture_name: continue the conversation
          const finalHistory: ConversationMessage[] = [...updatedHistory, toolResults];
          setHistory(finalHistory);
          await sendToAgent(finalHistory);
          return;
        }

        // Text only — now wait for user input
        setHistory(updatedHistory);
        if (data.stop_reason === 'end_turn') {
          setInputDisabled(false);
        }
      } catch (err) {
        console.error('[WelcomeStep] agent error:', err);
        setIsThinking(false);
        setError('Something went wrong. Please refresh and try again.');
      }
    },
    [firstName, onAnalyse]
  );

  // ── Kick off the conversation on mount ─────────────────────────────────

  useEffect(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    sendToAgent([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handle user sending a message ──────────────────────────────────────

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || inputDisabled) return;

    setInputValue('');
    setInputDisabled(true);

    // Add user bubble
    setDisplayMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', text },
    ]);

    const userMsg: UserMessage = { role: 'user', content: text };
    const newHistory: ConversationMessage[] = [...history, userMsg];
    setHistory(newHistory);

    await sendToAgent(newHistory);
  };

  // ── Typewriter animation ────────────────────────────────────────────────

  // Render the last assistant message with typewriter; all others are static
  const renderedMessages = displayMessages.map((msg, i) => {
    const isLastAssistant = msg.role === 'assistant' && msg.typing;

    if (msg.role === 'user') {
      return (
        <div key={msg.id} className="flex justify-end">
          <div className="bg-arcova-teal text-white rounded-2xl rounded-tr-none px-4 py-2.5 max-w-sm shadow-sm">
            <p className="text-sm leading-relaxed">{msg.text}</p>
          </div>
        </div>
      );
    }

    return (
      <div key={msg.id} className="flex items-start gap-3">
        <AgentAvatar />
        <div
          className={`bg-white border border-gray-200 rounded-2xl rounded-tl-none px-4 py-2.5 max-w-lg shadow-sm transition-opacity ${
            i < displayMessages.length - 2 ? 'opacity-60' : 'opacity-100'
          }`}
        >
          <p className="text-gray-800 text-sm leading-relaxed">
            {isLastAssistant ? (
              <>
                <TypingText target={msg.text} />
              </>
            ) : (
              msg.text
            )}
          </p>
        </div>
      </div>
    );
  });

  // ── Welcome splash — shown while agent is firing up ───────────────────

  const showingSplash = isThinking && displayMessages.length === 0;

  if (showingSplash) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 gap-6 px-4 text-center">
        <ArcovaLoader size={64} />
        <div>
          <h1 className="text-2xl font-bold text-arcova-darkblue">Welcome to Arcova</h1>
          <p className="text-gray-500 text-sm mt-2">just firing up your personal agent…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-50">
      {/* ── Message thread ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-8">
        <div className="max-w-2xl mx-auto space-y-4">
          {renderedMessages}
          {isThinking && <ThinkingDots />}
          {isAnalyzing && (
            <div className="flex items-start gap-3">
              <AgentAvatar />
              <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-none px-4 py-2.5 shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {[0, 150, 300].map((delay) => (
                      <div
                        key={delay}
                        className="w-1.5 h-1.5 bg-arcova-teal/70 rounded-full animate-bounce"
                        style={{ animationDelay: `${delay}ms` }}
                      />
                    ))}
                  </div>
                  <span className="text-sm text-gray-500">{loadingMessage}</span>
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input bar ─────────────────────────────────────────────── */}
      {!isAnalyzing && (
        <div className="border-t border-gray-200 bg-white px-4 py-3">
          <div className="max-w-2xl mx-auto">
            {error ? (
              <p className="text-sm text-red-600 text-center py-1">{error}</p>
            ) : (
              <form onSubmit={handleSend} className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  disabled={inputDisabled}
                  placeholder={inputDisabled ? '' : 'Type your reply…'}
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-arcova-teal disabled:bg-gray-50 disabled:text-transparent placeholder:text-gray-400"
                />
                <button
                  type="submit"
                  disabled={inputDisabled || !inputValue.trim()}
                  className="px-4 py-2.5 bg-arcova-teal text-white rounded-xl font-semibold text-sm hover:bg-arcova-teal/90 disabled:opacity-30 transition-colors"
                >
                  Send
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Typewriter sub-component ───────────────────────────────────────────────

function TypingText({ target }: { target: string }) {
  const [displayed, setDisplayed] = useState('');
  const indexRef = useRef(0);

  useEffect(() => {
    indexRef.current = 0;
    setDisplayed('');
    const tick = setInterval(() => {
      indexRef.current += 1;
      setDisplayed(target.slice(0, indexRef.current));
      if (indexRef.current >= target.length) clearInterval(tick);
    }, TYPING_SPEED);
    return () => clearInterval(tick);
  }, [target]);

  return (
    <>
      {displayed}
      {displayed.length < target.length && (
        <span className="inline-block w-[2px] h-[14px] bg-arcova-teal ml-0.5 align-middle animate-pulse" />
      )}
    </>
  );
}
