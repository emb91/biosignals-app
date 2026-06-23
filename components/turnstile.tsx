'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

// Cloudflare Turnstile site key. When unset, the widget renders nothing and
// callers skip the verification check — so local dev and any environment
// without a key behaves exactly as before (no bot protection, no breakage).
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

export interface TurnstileHandle {
  /** Clears the consumed token and re-issues a challenge (tokens are single-use). */
  reset: () => void;
}

interface TurnstileProps {
  onVerify: (token: string) => void;
  /** Called when the token expires or the challenge errors — clear any stored token. */
  onExpire?: () => void;
  className?: string;
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src^="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Turnstile failed to load')));
      if (window.turnstile) resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Turnstile failed to load'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * Cloudflare Turnstile widget. Renders only when NEXT_PUBLIC_TURNSTILE_SITE_KEY
 * is configured; otherwise it is inert and returns null so unconfigured
 * environments are unaffected.
 */
export const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(function Turnstile(
  { onVerify, onExpire, className },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // Hold the latest callbacks in refs so the render effect can run once and not
  // tear down / re-render the widget every time the parent re-renders.
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  onVerifyRef.current = onVerify;
  onExpireRef.current = onExpire;

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.reset(widgetId.current);
        } catch {
          /* widget already gone */
        }
      }
    },
  }));

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile || widgetId.current) return;
        widgetId.current = window.turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token: string) => onVerifyRef.current(token),
          'expired-callback': () => onExpireRef.current?.(),
          'error-callback': () => onExpireRef.current?.(),
        });
      })
      .catch(() => {
        /* network/script failure — fail open, parent still works without a token */
      });

    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* already removed */
        }
        widgetId.current = null;
      }
    };
  }, []);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={containerRef} className={className} />;
});
