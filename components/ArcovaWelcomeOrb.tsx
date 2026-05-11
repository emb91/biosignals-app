'use client';

import { cn } from '@/lib/utils';

export type ArcovaWelcomeOrbSize = 'md' | 'lg';

/**
 * Shared welcome orb shell: halo, corona, expanding rings, petals, core + shine + cycle.
 * Styles live in `app/globals.css` (`.setup-welcome-orb`, `.swo-*`).
 */
export function ArcovaWelcomeOrb({
  energised = false,
  size = 'md',
  className,
}: {
  energised?: boolean;
  /** `md` = 110px (setup card), `lg` = 7.5rem (Today briefing hero). */
  size?: ArcovaWelcomeOrbSize;
  className?: string;
}) {
  const idle = !energised;
  return (
    <div
      className={cn(
        'setup-welcome-orb',
        size === 'lg' && 'setup-welcome-orb--lg',
        idle && 'setup-welcome-orb--idle',
        className,
      )}
      aria-hidden
    >
      <span className="swo-halo" />
      <span className="swo-corona" />
      <span className="swo-ring" />
      <span className="swo-ring swo-r2" />
      <span className="swo-ring swo-r3" />
      <span className="swo-petal swo-p1" />
      <span className="swo-petal swo-p2" />
      <span className="swo-petal swo-p3" />
      <span className="swo-core">
        <span className="swo-shine" />
        <span className="swo-cycle" />
      </span>
    </div>
  );
}
