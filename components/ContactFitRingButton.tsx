'use client';

import type { MouseEvent } from 'react';

import { fitScoreArcColor, percentDisplayNumber } from '@/lib/fit-gauge';
import { cn } from '@/lib/utils';

/**
 * Contact-fit control for the Leads grid: faint twin rings and a gradient orb core (distinct from the company-fit donut gauge).
 */
export function ContactFitRingButton({
  score,
  isRowSelected,
  isGaugeHighlighted,
  onOpen,
  title = 'View contact fit',
}: {
  score: number | null | undefined;
  isRowSelected: boolean;
  isGaugeHighlighted: boolean;
  onOpen: (e: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
}) {
  const pct = percentDisplayNumber(score);
  const hasScore = pct != null;
  const core = fitScoreArcColor(pct ?? 0);

  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      className={cn(
        'relative mx-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-[transform] hover:scale-[1.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arcova-teal focus-visible:ring-offset-2',
        isRowSelected && isGaugeHighlighted && 'ring-2 ring-arcova-teal ring-offset-2',
      )}
    >
      <span
        className="pointer-events-none absolute inset-0 rounded-full border border-[rgba(13,53,71,0.14)]"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-[2.5px] rounded-full border border-[rgba(13,53,71,0.07)]"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-[6px] rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
        style={{
          background: `radial-gradient(circle at 30% 28%, rgba(255,255,255,0.55) 0%, ${core} 42%, ${core} 100%)`,
        }}
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-[7px] rounded-full bg-gradient-to-br from-white/40 to-transparent opacity-80"
        aria-hidden
      />
      <span className="relative z-[1] text-[10px] font-semibold tabular-nums leading-none text-white drop-shadow-[0_1px_1px_rgba(13,53,71,0.35)]">
        {hasScore ? `${pct}` : '—'}
      </span>
    </button>
  );
}
