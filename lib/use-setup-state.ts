'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from './supabase';
import { useAuth } from '@/context/AuthContext';

export type SetupState = {
  /** Step 1: seller has analysed their own company */
  step1Complete: boolean;
  /** Step 2: at least one target company (ICP) defined */
  step2Complete: boolean;
  /** Step 3: at least one target team (persona) defined */
  step3Complete: boolean;
  /** All three steps are done */
  setupComplete: boolean;
  loading: boolean;
};

/**
 * Returns the next setup path the user should visit given their current progress.
 * Once all steps are done, returns '/import'.
 */
export function getNextSetupPath(state: Omit<SetupState, 'loading'>): string {
  if (!state.step1Complete) return '/arcova-setup';
  if (!state.step2Complete) return '/company-criteria';
  return '/import';
}

export function useSetupState(): SetupState {
  const { user } = useAuth();
  const pathname = usePathname();
  const [state, setState] = useState<SetupState>({
    step1Complete: false,
    step2Complete: false,
    step3Complete: false,
    setupComplete: false,
    loading: true,
  });

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const checkSetup = async () => {
      try {
        const [profileResult, icpsResult, personasResult] = await Promise.all([
          supabase
            .from('user_company')
            .select('id')
            .eq('user_id', user.id)
            .limit(1)
            .maybeSingle(),
          supabase
            .from('icps')
            .select('id')
            .eq('user_id', user.id)
            .limit(1)
            .maybeSingle(),
          supabase
            .from('personas')
            .select('id')
            .eq('user_id', user.id)
            .limit(1)
            .maybeSingle(),
        ]);

        if (cancelled) return;

        const step1Complete = !!profileResult.data;
        const step2Complete = !!icpsResult.data;
        const step3Complete = !!personasResult.data;

        setState({
          step1Complete,
          step2Complete,
          step3Complete,
          setupComplete: step1Complete && step2Complete,
          loading: false,
        });
      } catch (err) {
        console.error('[useSetupState] failed to check setup state:', err);
        if (!cancelled) {
          setState((prev) => ({ ...prev, loading: false }));
        }
      }
    };

    checkSetup();
    return () => {
      cancelled = true;
    };
  }, [user, pathname]);

  return state;
}
