'use client';

import type { MouseEvent } from 'react';

import { AnimatedCircularProgressBar } from '@/components/ui/animated-circular-progress-bar';
import { fitScoreArcColor, percentDisplayNumber } from '@/lib/fit-gauge';
import { cn } from '@/lib/utils';

/** Animated circular fit gauge used on Leads Contacts and Accounts tables. */
export function TableFitGaugeButton({
  score,
  isRowSelected,
  isGaugeHighlighted,
  onOpen,
  title = 'View fit',
}: {
  score: number | null | undefined;
  isRowSelected: boolean;
  isGaugeHighlighted: boolean;
  onOpen: (e: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
}) {
  const pct = percentDisplayNumber(score);
  const hasScore = pct != null;
  const primaryColor = fitScoreArcColor(pct);

  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      className={cn(
        'mx-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-[transform] hover:scale-[1.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arcova-teal focus-visible:ring-offset-2',
        isRowSelected && isGaugeHighlighted && 'ring-2 ring-arcova-teal ring-offset-2',
      )}
    >
      <AnimatedCircularProgressBar
        value={pct ?? 0}
        gaugePrimaryColor={primaryColor}
        gaugeSecondaryColor="rgba(13,53,71,0.09)"
        animateOnMount
        deferAnimationMs={160}
        label={
          <span className="block text-xs text-gray-700 leading-snug tabular-nums">
            {hasScore ? `${pct}` : '—'}
          </span>
        }
        className="size-8 [--transition-length:0.95s]"
      />
    </button>
  );
}
