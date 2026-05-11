'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const toneStyles = {
  danger: {
    border: 'border-red-500/45',
    bg: 'bg-red-950/40',
    iconWrap: 'bg-red-500/15',
    icon: 'text-red-400',
    title: 'text-white',
    description: 'text-red-100/80',
    shadow: 'shadow-[0_0_0_1px_rgba(239,68,68,0.08)]',
    compactBorder: 'border-red-500/25',
    compactBg: 'bg-red-950/50',
    compactTitle: 'text-red-100/95',
    compactDescription: 'text-red-50/85',
  },
  warning: {
    border: 'border-amber-500/45',
    bg: 'bg-amber-950/35',
    iconWrap: 'bg-amber-500/15',
    icon: 'text-amber-400',
    title: 'text-white',
    description: 'text-amber-100/85',
    shadow: 'shadow-[0_0_0_1px_rgba(245,158,11,0.1)]',
    compactBorder: 'border-amber-500/30',
    compactBg: 'bg-amber-950/45',
    compactTitle: 'text-amber-100/95',
    compactDescription: 'text-amber-50/90',
  },
} as const;

export type AppWarningBannerTone = keyof typeof toneStyles;

export interface AppWarningBannerProps {
  /** Visual severity: `danger` (red), `warning` (amber). */
  tone?: AppWarningBannerTone;
  /**
   * `featured`: centered, prominent block for page tops (large icon + title stack).
   * `compact`: dense strip for dialogs and tight spaces.
   */
  layout?: 'featured' | 'compact';
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  wrapClassName?: string;
  /** Override default AlertTriangle icon. */
  icon?: React.ReactNode;
}

/**
 * Inline warning banner for consistent, high-visibility caution copy across the app.
 */
export function AppWarningBanner({
  tone = 'danger',
  layout = 'featured',
  title,
  description,
  className,
  wrapClassName,
  icon,
}: AppWarningBannerProps) {
  const t = toneStyles[tone];

  const defaultIcon = <AlertTriangle className={cn('h-8 w-8', t.icon)} aria-hidden />;

  if (layout === 'compact') {
    return (
      <div
        role="status"
        className={cn(
          'rounded-xl border px-4 py-3 text-center text-sm font-semibold leading-relaxed',
          t.compactBorder,
          t.compactBg,
          t.compactTitle,
          className,
        )}
      >
        <p className="m-0">{title}</p>
        {description != null ? (
          <div className={cn('mt-2 text-xs font-normal leading-relaxed', t.compactDescription)}>{description}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn('flex justify-center', wrapClassName)}>
      <div
        role="status"
        className={cn(
          'w-full max-w-2xl rounded-2xl border-2 px-6 py-6 text-center',
          t.border,
          t.bg,
          t.shadow,
          className,
        )}
      >
        <div className={cn('mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full', t.iconWrap)}>
          {icon ?? defaultIcon}
        </div>
        <p className={cn('text-xl font-bold tracking-tight', t.title)}>{title}</p>
        {description != null ? (
          <p className={cn('mt-3 text-sm leading-relaxed', t.description)}>{description}</p>
        ) : null}
      </div>
    </div>
  );
}
