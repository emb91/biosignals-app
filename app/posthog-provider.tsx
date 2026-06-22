'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from '@/lib/posthog-client';
import type { PostHog } from 'posthog-js';
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react';
import { useAuth } from '@/context/AuthContext';

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
// PostHog publishes nominally distinct declarations for each bundle variant,
// although they implement the same runtime client interface.
const posthogReactClient = posthog as unknown as PostHog;

if (typeof window !== 'undefined' && POSTHOG_KEY && !posthog.__loaded) {
  posthog.init(POSTHOG_KEY, {
    // Route via the Next.js reverse proxy so events aren't blocked by ad-blockers.
    api_host: '/ingest',
    defaults: '2026-01-30',
    // Only create person profiles for identified users — anonymous events still
    // captured (so the marketing funnel works) but billable profiles stay lean.
    person_profiles: 'identified_only',
    // We send $pageview manually below so client-side App Router navigations are tracked.
    capture_pageview: false,
    capture_pageleave: true,
    // Enables capturing unhandled exceptions via Error Tracking.
    capture_exceptions: true,
    session_recording: {
      // Mask everything typed into inputs/textareas. Page text stays visible.
      maskAllInputs: true,
    },
    debug: process.env.NODE_ENV === 'development',
  });
}

/** Sends a $pageview on every App Router navigation (pathname or query change). */
function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ph = usePostHog();

  useEffect(() => {
    if (!pathname || !ph) return;
    let url = window.origin + pathname;
    const qs = searchParams?.toString();
    if (qs) url += `?${qs}`;
    ph.capture('$pageview', { $current_url: url });
  }, [pathname, searchParams, ph]);

  return null;
}

/**
 * Ties the anonymous PostHog person to the signed-in user once auth resolves,
 * and resets on sign-out so a shared browser doesn't merge identities.
 */
export function PostHogIdentify() {
  const { user } = useAuth();
  const ph = usePostHog();

  useEffect(() => {
    if (!POSTHOG_KEY || !ph) return;
    if (user?.id) {
      ph.identify(user.id, user.email ? { email: user.email } : undefined);
    }
  }, [user?.id, user?.email, ph]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  // No key configured (e.g. local dev without analytics) → render children untouched.
  if (!POSTHOG_KEY) return <>{children}</>;

  return (
    <PHProvider client={posthogReactClient}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </PHProvider>
  );
}
