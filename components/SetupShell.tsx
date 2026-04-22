'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Settings } from 'lucide-react';
import AppSidebar from '@/components/AppSidebar';

const STEPS: { num: 1 | 2 | 3; label: string }[] = [
  { num: 1, label: 'Your company' },
  { num: 2, label: 'Target companies' },
  { num: 3, label: 'Target teams' },
];

interface SetupShellProps {
  /**
   * Whether the user is currently in the setup flow.
   * true  → show stripped progress header, no sidebar
   * false → show normal AppSidebar layout
   */
  inSetup: boolean;
  /** Which step number this page represents (1–3). Only used when inSetup=true. */
  step?: 1 | 2 | 3;
  children: React.ReactNode;
}

/**
 * Layout wrapper for the three setup pages.
 *
 * In setup mode it renders a slim header (logo + step counter + settings icon)
 * with a step progress indicator and no sidebar.
 *
 * Once setup is complete it falls back to the standard AppSidebar layout so that
 * users who revisit these pages later see the normal navigation.
 */
export default function SetupShell({ inSetup, step = 1, children }: SetupShellProps) {
  if (!inSetup) {
    return (
      <div className="flex h-screen bg-gray-50">
        <AppSidebar />
        <div className="flex-1 flex flex-col overflow-hidden">{children}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <div className="bg-arcova-darkblue px-6 py-3 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center space-x-2 shrink-0">
          <Image
            src="/images/network-og.png"
            alt="Arcova"
            width={28}
            height={28}
            className="rounded-lg"
          />
          <span className="text-white font-semibold text-lg">arcova</span>
        </Link>

        {/* Step counter */}
        <div className="text-center">
          <p className="text-white font-semibold text-sm">Step {step} of 3</p>
          <p className="text-white/50 text-xs">Setup should take no more than 10 mins</p>
        </div>

        {/* Settings icon */}
        <Link
          href="/settings"
          className="text-white/50 hover:text-white transition-colors shrink-0"
          title="Settings"
        >
          <Settings className="w-5 h-5" />
        </Link>
      </div>

      {/* ── Progress strip ──────────────────────────────────────────── */}
      <div className="bg-arcova-darkblue border-t border-white/10 px-6 pb-4">
        <div className="flex items-center max-w-xs mx-auto gap-0">
          {STEPS.map((s, i) => (
            <div key={s.num} className="flex items-center flex-1">
              {/* Circle + label */}
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                    s.num < step
                      ? 'bg-arcova-teal text-white'
                      : s.num === step
                      ? 'bg-white text-arcova-darkblue'
                      : 'bg-white/10 text-white/40'
                  }`}
                >
                  {s.num < step ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    s.num
                  )}
                </div>
                <span
                  className={`text-[10px] whitespace-nowrap hidden sm:block ${
                    s.num === step ? 'text-white font-medium' : 'text-white/40'
                  }`}
                >
                  {s.label}
                </span>
              </div>

              {/* Connector line (not after last step) */}
              {i < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-px mx-1 mb-4 transition-colors ${
                    s.num < step ? 'bg-arcova-teal' : 'bg-white/15'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Page content ────────────────────────────────────────────── */}
      <div className="flex-1">{children}</div>
    </div>
  );
}
