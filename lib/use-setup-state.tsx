'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/context/AuthContext';
import { ROUTES } from '@/lib/routes';

export type SetupState = {
  /** Step 1: seller has analysed their own company */
  step1Complete: boolean;
  /** Step 2: at least one target company (ICP) defined */
  step2Complete: boolean;
  /** Company profile + at least one ICP. Buying teams are edited on each ICP card. */
  setupComplete: boolean;
  /** Invited members skip org setup; they're complete the moment they join. */
  isMember: boolean;
  /** Caller's org role. Drives UI locking (members are read-only on org setup). */
  role: 'owner' | 'admin' | 'member' | null;
  /** Convenience: owner/admin may edit org setup (company profile, delete ICPs). */
  canEditOrgSetup: boolean;
  loading: boolean;
};

/**
 * Returns the next setup path the user should visit given their current progress.
 * Missing company or ICP: `/arcova-setup`. Once both exist, send users somewhere useful —
 * `/today` if they accidentally opened guided setup again (avoid bouncing them into Import).
 */
export function getNextSetupPath(state: Pick<SetupState, 'step1Complete' | 'step2Complete'>): string {
  if (!state.step1Complete || !state.step2Complete) return ROUTES.setup.arcova;
  return ROUTES.today;
}

const SetupStateContext = createContext<SetupState | undefined>(undefined);

const SETUP_COMPLETE_EVENT = 'arcova:setup-complete';

/**
 * Call when the guided setup flow finishes saving. The provider fetches setup
 * state once per session, so without this the post-setup redirect races a
 * stale "incomplete" snapshot and SetupGuard bounces the user straight back
 * into /arcova-setup at step 1.
 */
export function notifySetupComplete() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SETUP_COMPLETE_EVENT));
}

/**
 * Single shared source for onboarding completion flags (company profile + first ICP).
 * Avoid mounting multiple independent `useEffect` polls — duplicates briefly disagreed during
 * Supabase errors/races and triggered SetupGuard → `/arcova-setup` → `/import` ping-pong.
 */
export function SetupStateProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<SetupState>({
    step1Complete: false,
    step2Complete: false,
    setupComplete: false,
    isMember: false,
    role: null,
    canEditOrgSetup: false,
    loading: true,
  });

  useEffect(() => {
    // While auth is still resolving, keep setup loading too. This prevents a
    // one-render window where authLoading=false + setupLoading=false + setupComplete=false
    // causes SetupGuard to redirect even for fully-onboarded users.
    if (authLoading) return;

    if (!user) {
      setState({
        step1Complete: false,
        step2Complete: false,
        setupComplete: false,
        isMember: false,
        role: null,
        canEditOrgSetup: false,
        loading: false,
      });
      return;
    }

    let cancelled = false;

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    // Org-aware: the server resolves the caller's org + role and reports setup at the
    // org level (members are always complete). See /api/org/setup-state.
    const checkSetup = async (attempt: number): Promise<void> => {
      try {
        const res = await fetch('/api/org/setup-state');
        if (!res.ok) throw new Error(`setup-state ${res.status}`);
        const json = (await res.json()) as {
          step1Complete: boolean;
          step2Complete: boolean;
          setupComplete: boolean;
          isMember: boolean;
          role: 'owner' | 'admin' | 'member' | null;
        };

        if (cancelled) return;

        const role = json.role ?? null;
        setState({
          step1Complete: json.step1Complete,
          step2Complete: json.step2Complete,
          setupComplete: json.setupComplete,
          isMember: json.isMember,
          role,
          canEditOrgSetup: role === 'owner' || role === 'admin',
          loading: false,
        });
      } catch (err) {
        console.error('[useSetupState] failed to check setup state:', err);
        if (cancelled) return;
        if (attempt < 2) {
          await sleep(400);
          if (!cancelled) await checkSetup(attempt + 1);
          return;
        }
        setState((prev) => ({ ...prev, loading: false }));
      }
    };

    void checkSetup(0);
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  // Optimistic completion: the setup flow just saved everything, so flip the
  // flags immediately rather than waiting for a refetch the guard would race.
  useEffect(() => {
    const onComplete = () =>
      setState((prev) => ({
        ...prev,
        step1Complete: true,
        step2Complete: true,
        setupComplete: true,
        loading: false,
      }));
    window.addEventListener(SETUP_COMPLETE_EVENT, onComplete);
    return () => window.removeEventListener(SETUP_COMPLETE_EVENT, onComplete);
  }, []);

  return <SetupStateContext.Provider value={state}>{children}</SetupStateContext.Provider>;
}

export function useSetupState(): SetupState {
  const ctx = useContext(SetupStateContext);
  if (ctx === undefined) {
    throw new Error('useSetupState must be used within SetupStateProvider');
  }
  return ctx;
}
