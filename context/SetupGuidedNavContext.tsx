'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type SetupGuidedNavContextValue = {
  /** Highest setup segment (0 = my company, 1 = target ICP, 2 = buying team) the user has reached this session. */
  reachedStepIndex: number;
  reportStep: (stepIndex: number) => void;
  reset: () => void;
};

const SetupGuidedNavContext = createContext<SetupGuidedNavContextValue | null>(null);

export function SetupGuidedNavProvider({ children }: { children: ReactNode }) {
  const [reachedStepIndex, setReached] = useState(0);
  const reportStep = useCallback((idx: number) => {
    setReached((p) => (idx > p ? idx : p));
  }, []);
  const reset = useCallback(() => setReached(0), []);
  const value = useMemo(
    () => ({ reachedStepIndex, reportStep, reset }),
    [reachedStepIndex, reportStep, reset],
  );
  return <SetupGuidedNavContext.Provider value={value}>{children}</SetupGuidedNavContext.Provider>;
}

export function useSetupGuidedNav(): SetupGuidedNavContextValue | null {
  return useContext(SetupGuidedNavContext);
}
