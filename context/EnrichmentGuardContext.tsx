'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { useRouter } from 'next/navigation';

type EnrichmentGuardContextType = {
  isEnriching: boolean;
  setIsEnriching: (val: boolean) => void;
  guardedNavigate: (href: string) => void;
};

const EnrichmentGuardContext = createContext<EnrichmentGuardContextType>({
  isEnriching: false,
  setIsEnriching: () => {},
  guardedNavigate: () => {},
});

export function EnrichmentGuardProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isEnriching, setIsEnriching] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const guardedNavigate = useCallback(
    (href: string) => {
      if (isEnriching) {
        setPendingHref(href);
      } else {
        router.push(href);
      }
    },
    [isEnriching, router],
  );

  const handleLeave = () => {
    const href = pendingHref;
    setPendingHref(null);
    setIsEnriching(false);
    if (href) router.push(href);
  };

  const handleStay = () => {
    setPendingHref(null);
  };

  return (
    <EnrichmentGuardContext.Provider value={{ isEnriching, setIsEnriching, guardedNavigate }}>
      {children}

      {pendingHref && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-lg">⚠️</span>
              <h2 className="text-base font-semibold text-white">Enrichment in progress</h2>
            </div>
            <p className="mb-6 mt-2 text-sm leading-relaxed text-white/60">
              Company analysis is still running. If you leave now the results will be lost and you&apos;ll need to start the enrichment again.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={handleStay}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
              >
                Keep waiting
              </button>
              <button
                onClick={handleLeave}
                className="rounded-lg border border-red-500/30 bg-red-500/20 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30"
              >
                Leave anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </EnrichmentGuardContext.Provider>
  );
}

export function useEnrichmentGuard() {
  return useContext(EnrichmentGuardContext);
}
