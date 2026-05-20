'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from './supabase';
import { useAuth } from '@/context/AuthContext';
import { ROUTES } from '@/lib/routes';

export type SetupState = {
  /** Step 1: seller has analysed their own company */
  step1Complete: boolean;
  /** Step 2: at least one target company (ICP) defined */
  step2Complete: boolean;
  /** Company profile + at least one ICP. Buying teams are edited on each ICP card. */
  setupComplete: boolean;
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
        loading: false,
      });
      return;
    }

    let cancelled = false;

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    const checkSetup = async (attempt: number): Promise<void> => {
      try {
        const [profileResult, icpsResult] = await Promise.all([
          supabase
            .from('user_company')
            .select('id')
            .eq('user_id', user.id)
            .limit(1)
            .maybeSingle(),
          supabase.from('icps').select('id').eq('user_id', user.id).limit(1).maybeSingle(),
        ]);

        if (cancelled) return;

        const step1Complete = !!profileResult.data;
        const step2Complete = !!icpsResult.data;

        setState({
          step1Complete,
          step2Complete,
          setupComplete: step1Complete && step2Complete,
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

  return <SetupStateContext.Provider value={state}>{children}</SetupStateContext.Provider>;
}

export function useSetupState(): SetupState {
  const ctx = useContext(SetupStateContext);
  if (ctx === undefined) {
    throw new Error('useSetupState must be used within SetupStateProvider');
  }
  return ctx;
}
