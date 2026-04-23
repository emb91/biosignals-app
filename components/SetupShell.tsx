'use client';

import Link from 'next/link';
import { Check, Settings } from 'lucide-react';
import AppSidebar from '@/components/AppSidebar';
import { cn } from '@/lib/utils';

const STEPS: { num: 1 | 2 | 3; label: string }[] = [
  { num: 1, label: 'Your company' },
  { num: 2, label: 'Target companies' },
  { num: 3, label: 'Target teams' },
];

/** Nav labels aligned with AppSidebar setup items */
const PAGE_TITLE: Record<1 | 2 | 3, string> = {
  1: 'My Profile',
  2: 'Companies',
  3: 'Teams',
};

interface SetupShellProps {
  /**
   * When true, shows a compact setup strip above the page (same shell as the rest of the app).
   */
  inSetup: boolean;
  /** Which setup step this page is (1–3). Used for the strip and copy. */
  step?: 1 | 2 | 3;
  children: React.ReactNode;
  /** Optional first name for a short line in the setup header. */
  setupUserGreeting?: string;
  /** When true, no progress strip (e.g. full-screen conversational setup with its own chrome). */
  hideSetupProgress?: boolean;
}

/**
 * App layout for setup-related pages: sidebar + main column.
 * During setup, progress and settings sit in the main column (not a separate header chrome).
 */
export default function SetupShell({
  inSetup,
  step = 1,
  children,
  setupUserGreeting,
  hideSetupProgress = false,
}: SetupShellProps) {
  const stepInfo = STEPS.find((s) => s.num === step) ?? STEPS[0];
  const pageTitle = PAGE_TITLE[step];

  return (
    <div
      className={cn(
        'flex h-screen',
        inSetup ? 'bg-arcova-darkblue' : 'bg-gray-50',
      )}
    >
      <AppSidebar setupFlowOnly={inSetup} />
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-hidden',
          inSetup && hideSetupProgress && 'bg-slate-950',
          inSetup && !hideSetupProgress && 'bg-arcova-darkblue',
        )}
      >
        {inSetup && !hideSetupProgress && (
          <div className="shrink-0 border-b border-white/10 px-4 py-2.5 sm:px-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-arcova-teal">
                  Getting started
                </p>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <h1 className="text-base font-semibold text-white sm:text-lg">{pageTitle}</h1>
                  <span className="text-sm text-slate-400">{stepInfo.label}</span>
                </div>
                {setupUserGreeting && (
                  <p className="mt-1 text-xs text-slate-400">Hi, {setupUserGreeting}. This takes a few minutes.</p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-3 lg:gap-4">
                <ol
                  className="flex items-center gap-1.5 sm:gap-2"
                  aria-label="Setup progress"
                >
                  {STEPS.map((s, idx) => {
                    const done = s.num < step;
                    const current = s.num === step;
                    return (
                      <li key={s.num} className="flex items-center gap-1.5 sm:gap-2">
                        {idx > 0 && (
                          <span
                            className={cn(
                              'hidden h-px w-4 sm:block sm:w-6',
                              done ? 'bg-arcova-teal/50' : 'bg-white/15',
                            )}
                            aria-hidden
                          />
                        )}
                        <span
                          className={cn(
                            'flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2 sm:pr-2.5',
                            current && 'bg-arcova-teal/15 ring-1 ring-arcova-teal/30',
                            done && 'opacity-90',
                            !current && !done && 'opacity-60',
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                              done && 'bg-arcova-teal text-white',
                              current && !done && 'bg-white text-arcova-darkblue',
                              !current && !done &&
                                'border border-white/20 bg-white/10 text-slate-400',
                            )}
                          >
                            {done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : s.num}
                          </span>
                          <span
                            className={cn(
                              'hidden text-xs font-medium sm:inline',
                              current ? 'text-white' : 'text-slate-400',
                            )}
                          >
                            {s.label}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ol>

                <Link
                  href="/settings"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-slate-300 transition-colors hover:bg-white/20 hover:text-white"
                  title="Settings"
                >
                  <Settings className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
