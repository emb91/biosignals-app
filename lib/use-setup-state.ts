'use client';

import { useEffect, useState } from 'react';
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
 * Missing company or ICP: `/arcova-setup`. Otherwise the core funnel is done → import.
 */
export function getNextSetupPath(state: Pick<SetupState, 'step1Complete' | 'step2Complete'>): string {
  if (!state.step1Complete || !state.step2Complete) return ROUTES.setup.arcova;
  return ROUTES.import;
}

export function useSetupState(): SetupState {
  const { user } = useAuth();
  const [state, setState] = useState<SetupState>({
    step1Complete: false,
    step2Complete: false,
    setupComplete: false,
    loading: true,
  });

  useEffect(() => {
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

    const checkSetup = async () => {
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
        if (!cancelled) {
          setState((prev) => ({ ...prev, loading: false }));
        }
      }
    };

    checkSetup();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return state;
}
