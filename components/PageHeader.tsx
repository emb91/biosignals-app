import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

/**
 * Gradient accent span — use inside a PageHeader title for the key term.
 * Matches the /today bt-hero-accent and SetupFlow header treatment.
 */
export function GradientWord({ children }: { children: ReactNode }) {
  return (
    <span className="bg-gradient-to-br from-arcova-teal to-arcova-mint bg-clip-text text-transparent">
      {children}
    </span>
  );
}

type PageHeaderProps = {
  /** canvas: large hero header for presentation pages. workspace: compact header for data-heavy pages. */
  variant?: 'canvas' | 'workspace';
  eyebrow: ReactNode;
  eyebrowIcon?: ReactNode;
  /** Accept ReactNode so callers can embed <GradientWord> spans */
  title: ReactNode;
  subtitle?: ReactNode;
  /** Optional right-side action (button, badge, etc.) */
  action?: ReactNode;
  className?: string;
};

export function PageHeader({
  variant = 'canvas',
  eyebrow,
  eyebrowIcon,
  title,
  subtitle,
  action,
  className,
}: PageHeaderProps) {
  const isCanvas = variant === 'canvas';

  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-4',
        isCanvas ? 'mb-8' : 'mb-5',
        className,
      )}
    >
      <div>
        {/* Eyebrow */}
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-arcova-teal">
          {eyebrowIcon}
          {eyebrow}
        </p>

        {/* Title */}
        <h1
          className={cn(
            'font-manrope font-bold text-arcova-navy tracking-tight leading-[1.1]',
            isCanvas
              ? 'mt-2 text-[30px] tracking-[-0.026em]'
              : 'mt-1.5 text-xl tracking-[-0.018em]',
          )}
        >
          {title}
        </h1>

        {/* Subtitle */}
        {subtitle && (
          <p
            className={cn(
              'max-w-[38rem] text-arcova-navy/50',
              isCanvas ? 'mt-2 text-[13.5px]' : 'mt-1 text-[13px]',
            )}
          >
            {subtitle}
          </p>
        )}
      </div>

      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
