'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Magic UI animated circular gauge (see https://magicui.design/docs/components/animated-circular-progress-bar). */
export interface AnimatedCircularProgressBarProps {
  max?: number;
  min?: number;
  /** Value that the arc animates toward (0–100 when min/max are default). */
  value: number;
  gaugePrimaryColor: string;
  gaugeSecondaryColor: string;
  className?: string;
  /** When set, replaces the default center percentage text (0–100). */
  label?: ReactNode;
  /**
   * When true, the arc starts at 0 and fills after mount so the CSS transition is visible
   * (avoids the ring already looking “finished” when the table finishes loading).
   */
  animateOnMount?: boolean;
  /** Extra delay after mount before the arc runs from 0 to `value` (ms). */
  deferAnimationMs?: number;
}

export function AnimatedCircularProgressBar({
  max = 100,
  min = 0,
  value = 0,
  gaugePrimaryColor,
  gaugeSecondaryColor,
  className,
  label,
  animateOnMount = true,
  deferAnimationMs = 180,
}: AnimatedCircularProgressBarProps) {
  const [arcValue, setArcValue] = useState(() => (!animateOnMount ? value : 0));
  /** False once the first deferred fill has run (or skipped). Later `value` updates apply immediately and still CSS-transition. */
  const initialFillDone = useRef(false);

  useEffect(() => {
    if (!animateOnMount) {
      initialFillDone.current = true;
      setArcValue(value);
      return;
    }

    if (typeof window === 'undefined') {
      initialFillDone.current = true;
      setArcValue(value);
      return;
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      initialFillDone.current = true;
      setArcValue(value);
      return;
    }

    if (!initialFillDone.current) {
      setArcValue(0);
      const id = window.setTimeout(() => {
        initialFillDone.current = true;
        setArcValue(value);
      }, deferAnimationMs);
      return () => window.clearTimeout(id);
    }

    setArcValue(value);
  }, [value, animateOnMount, deferAnimationMs]);

  const circumference = 2 * Math.PI * 45;
  const percentPx = circumference / 100;
  const currentPercent = Math.round(((arcValue - min) / (max - min)) * 100);

  return (
    <div
      className={cn('relative size-40 text-2xl font-semibold', className)}
      style={
        {
          '--circle-size': '100px',
          '--circumference': circumference,
          '--percent-to-px': `${percentPx}px`,
          '--gap-percent': '5',
          '--offset-factor': '0',
          '--transition-length': '1s',
          '--transition-step': '200ms',
          '--delay': '0s',
          '--percent-to-deg': '3.6deg',
          transform: 'translateZ(0)',
        } as CSSProperties
      }
    >
      <svg fill="none" className="size-full" strokeWidth="2" viewBox="0 0 100 100">
        {currentPercent <= 90 && currentPercent >= 0 && (
          <circle
            cx="50"
            cy="50"
            r="45"
            strokeWidth="10"
            strokeDashoffset="0"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="opacity-100"
            style={
              {
                stroke: gaugeSecondaryColor,
                '--stroke-percent': 90 - currentPercent,
                '--offset-factor-secondary': 'calc(1 - var(--offset-factor))',
                strokeDasharray:
                  'calc(var(--stroke-percent) * var(--percent-to-px)) var(--circumference)',
                transform:
                  'rotate(calc(1turn - 90deg - (var(--gap-percent) * var(--percent-to-deg) * var(--offset-factor-secondary)))) scaleY(-1)',
                transition: 'all var(--transition-length) ease var(--delay)',
                transformOrigin: 'center',
              } as CSSProperties
            }
          />
        )}
        <circle
          cx="50"
          cy="50"
          r="45"
          strokeWidth="10"
          strokeDashoffset="0"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="opacity-100"
          style={
            {
              stroke: gaugePrimaryColor,
              '--stroke-percent': currentPercent,
              strokeDasharray:
                'calc(var(--stroke-percent) * var(--percent-to-px)) var(--circumference)',
              transition:
                'var(--transition-length) cubic-bezier(0.4, 0, 0.2, 1) var(--delay),stroke var(--transition-length) cubic-bezier(0.4, 0, 0.2, 1) var(--delay)',
              transitionProperty: 'stroke-dasharray,transform',
              transform:
                'rotate(calc(-90deg + var(--gap-percent) * var(--offset-factor) * var(--percent-to-deg)))',
              transformOrigin: 'center',
            } as CSSProperties
          }
        />
      </svg>
      <span
        data-current-value={currentPercent}
        className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 select-none"
      >
        {label !== undefined ? label : currentPercent}
      </span>
    </div>
  );
}
