'use client';

import { ArcovaWelcomeOrb } from '@/components/ArcovaWelcomeOrb';
import { cn } from '@/lib/utils';

/** Stage width/height: room for 7.5rem orb plus expanding rings (matches former layout). */
const ORB_STAGE_REM = 10.5;

/**
 * Centered orb for Today briefing chat (idle / empty input). Uses shared welcome shell from setup;
 * bottom bars are Today-specific. Styles: `briefing-today` scope for `.bt-orb-vbar` in briefing-today.css.
 */
export function BriefingAgentOrb({
  className,
  energised = false,
}: {
  className?: string;
  /** Busy motion on the orb (e.g. while the agent is replying). */
  energised?: boolean;
}) {
  return (
    <div className={cn('bt-orb-host flex w-full max-w-full flex-col items-center px-2 pt-4 sm:pt-6', className)}>
      <div
        className="relative flex shrink-0 items-center justify-center"
        style={{ width: `${ORB_STAGE_REM}rem`, height: `${ORB_STAGE_REM}rem` }}
      >
        <ArcovaWelcomeOrb energised={energised} size="lg" />
      </div>
      <div
        className="mt-2 flex h-6 items-end justify-center gap-1 opacity-[0.38] motion-reduce:opacity-25"
        aria-hidden
      >
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <span
            key={i}
            className="bt-orb-vbar w-[0.1875rem] origin-bottom rounded-sm bg-arcova-teal/75"
            style={{
              height: '0.375rem',
              animationDelay: `${i * 90}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
