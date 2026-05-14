/**
 * AgentChatBar — the side-panel-style chat input + send button.
 *
 * Extracted from `AgentPanel` so other surfaces (e.g. the floating "Intercom-style"
 * bar on `/leads/contacts` while a contact card is open) can reuse the same input
 * affordance and stay visually consistent with the side-panel agent.
 *
 * Visual spec (matches AgentPanel's default / side-panel variant):
 *   - Pill container: rounded-[14px], white-translucent, subtle border, focus ring
 *   - Left: 14px arcova-teal "spark" SVG (or replaced with custom `leadingIcon`)
 *   - Middle: text input
 *   - Right: 30x30 navy send button that turns teal on hover, shows a spinner
 *     when `isLoading`
 */

'use client';

import { Send } from 'lucide-react';
import { forwardRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

export interface AgentChatBarProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  /** Override the default spark icon — e.g. a custom logo or orb. */
  leadingIcon?: React.ReactNode;
  /** Spread on the underlying <input>, useful for aria-label overrides etc. */
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}

const DEFAULT_LEADING_ICON = (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="shrink-0 text-arcova-teal"
    aria-hidden
  >
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
  </svg>
);

export const AgentChatBar = forwardRef<HTMLInputElement, AgentChatBarProps>(
  function AgentChatBar(
    { value, onChange, onSubmit, placeholder, isLoading, disabled, className, leadingIcon, inputProps },
    ref,
  ) {
    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSubmit();
      }
      inputProps?.onKeyDown?.(e);
    };

    const submitDisabled = !value.trim() || isLoading || disabled;

    return (
      <div
        className={cn(
          'flex min-w-0 items-center gap-2 transition-all',
          'rounded-[14px] border border-[rgba(13,53,71,0.07)] bg-white/70 pl-3 pr-[6px] py-[6px]',
          'focus-within:ring-2 focus-within:ring-arcova-teal/20 focus-within:border-arcova-teal focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(0,164,180,0.12)]',
          className,
        )}
      >
        {leadingIcon ?? DEFAULT_LEADING_ICON}
        <input
          {...inputProps}
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            'min-w-0 flex-1 bg-transparent text-[13px] text-[#0d3547] placeholder:text-[#7d909a] focus:outline-none',
            inputProps?.className,
          )}
          disabled={isLoading || disabled}
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitDisabled}
          className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[10px] bg-[#0d3547] text-white transition-colors hover:bg-arcova-teal disabled:cursor-not-allowed disabled:bg-[rgba(13,53,71,0.18)]"
          aria-label="Send"
        >
          {isLoading ? (
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    );
  },
);
