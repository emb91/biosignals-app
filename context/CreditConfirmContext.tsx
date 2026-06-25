'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Coins, ArrowRight } from 'lucide-react';

/**
 * App-wide credits confirmation modal. ANY action that spends credits should
 * confirm through this — call `useCreditConfirm()` and `await confirmCredits({…})`
 * (a drop-in for the old `window.confirm('… N credits?')` dialogs). One branded
 * modal, one place that reads the real balance.
 *
 * Policy: this is a WARNING, never a hard block. Even when the balance is below
 * the cost the confirm button stays enabled (the user can always proceed); we
 * only surface a caution. See the "never block a purchase — warn only" rule.
 */
export type CreditConfirmOptions = {
  /** Modal heading, e.g. "Refresh this contact?" */
  title: string;
  /** One-line explanation of what the spend does. */
  description?: string;
  /** Credit cost of the action. */
  cost: number;
  /** Label for the confirm button verb, e.g. "Refresh" (default "Confirm"). */
  confirmLabel?: string;
  /** When the real cost is a ceiling (batch jobs), renders "up to N". */
  upTo?: boolean;
  /** Optional icon override for the modal orb. */
  icon?: ReactNode;
};

type CreditConfirmContextType = {
  confirmCredits: (options: CreditConfirmOptions) => Promise<boolean>;
};

const CreditConfirmContext = createContext<CreditConfirmContextType>({
  confirmCredits: async () => true,
});

type PendingRequest = CreditConfirmOptions & { resolve: (value: boolean) => void };

export function CreditConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [available, setAvailable] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  // Cache the balance across opens within a session; refresh on each open so it
  // reflects spends from prior confirmations.
  const fetchedOnce = useRef(false);

  const refreshBalance = useCallback(async () => {
    setLoadingBalance(true);
    try {
      const res = await fetch('/api/billing/summary');
      if (!res.ok) {
        setAvailable(null);
        return;
      }
      const json = await res.json();
      const value =
        typeof json?.available === 'number'
          ? json.available
          : typeof json?.credits?.available === 'number'
            ? json.credits.available
            : null;
      setAvailable(value);
      fetchedOnce.current = true;
    } catch {
      setAvailable(null);
    } finally {
      setLoadingBalance(false);
    }
  }, []);

  const confirmCredits = useCallback(
    (options: CreditConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setRequest({ ...options, resolve });
        void refreshBalance();
      }),
    [refreshBalance],
  );

  const settle = useCallback(
    (value: boolean) => {
      setRequest((current) => {
        current?.resolve(value);
        return null;
      });
    },
    [],
  );

  const cost = request?.cost ?? 0;
  const insufficient = available != null && available < cost;

  return (
    <CreditConfirmContext.Provider value={{ confirmCredits }}>
      {children}

      {request && (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-[rgba(13,53,71,0.44)] p-5"
          onClick={() => settle(false)}
          role="presentation"
        >
          <div
            className="w-[380px] max-w-full overflow-hidden rounded-[20px] bg-white shadow-[0_40px_80px_-24px_rgba(13,53,71,0.5)]"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={request.title}
          >
            {/* Header */}
            <div className="relative bg-[linear-gradient(160deg,rgba(0,164,180,0.1),rgba(255,255,255,0)_70%)] px-[22px] pb-[18px] pt-[22px] text-center">
              <div className="mx-auto mb-[13px] grid h-[52px] w-[52px] place-items-center rounded-[15px] bg-[linear-gradient(145deg,#10aebf,#0d6680)] text-white shadow-[0_12px_26px_-10px_rgba(0,164,180,0.7)]">
                {request.icon ?? <Coins className="h-[25px] w-[25px]" strokeWidth={1.8} aria-hidden />}
              </div>
              <h3 className="font-manrope m-0 text-[19px] font-bold tracking-[-0.02em] text-[#0d3547]">
                {request.title}
              </h3>
              {request.description ? (
                <p className="mx-auto mt-2 max-w-[300px] text-[13px] leading-[1.5] text-[#4a6470]">
                  {request.description}
                </p>
              ) : null}
            </div>

            {/* Cost → remaining */}
            <div className="mx-[22px] mt-[18px] flex items-center justify-center gap-[14px] rounded-[14px] border border-[rgba(13,53,71,0.06)] bg-[rgba(246,250,250,0.9)] p-[14px]">
              <div className="text-center">
                <div className="font-manrope text-[22px] font-bold leading-none text-[#0a7b88] tabular-nums">
                  {request.upTo ? `≤${cost}` : cost}
                </div>
                <div className="mt-[5px] text-[10px] font-bold uppercase tracking-[0.1em] text-[#7d909a]">
                  Credits
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-[#b6c2c8]" aria-hidden />
              <div className="text-center">
                <div className="font-manrope text-[22px] font-bold leading-none text-[#0d3547] tabular-nums">
                  {loadingBalance ? '…' : available != null ? available.toLocaleString() : '—'}
                </div>
                <div className="mt-[5px] text-[10px] font-bold uppercase tracking-[0.1em] text-[#7d909a]">
                  Remaining
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-[10px] px-[22px] pb-[22px] pt-[18px]">
              <button
                type="button"
                onClick={() => settle(false)}
                className="flex-1 rounded-xl border border-[rgba(13,53,71,0.12)] bg-white px-[11px] py-[11px] text-[13.5px] font-semibold text-[#4a6470] transition-colors hover:bg-[#f6fafa]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => settle(true)}
                className="flex-1 rounded-xl border-0 bg-[linear-gradient(150deg,#10aebf,#0a8b99)] px-[11px] py-[11px] text-[13.5px] font-semibold text-white shadow-[0_10px_22px_-10px_rgba(0,164,180,0.7)] transition hover:brightness-105"
              >
                {request.confirmLabel ?? 'Confirm'} · {request.upTo ? 'up to ' : ''}
                {cost} credits
              </button>
            </div>

            <p className="px-[22px] pb-[18px] text-center text-[11.5px] leading-snug text-[#7d909a]">
              {insufficient
                ? 'This is more than your remaining balance — you can still proceed, then top up.'
                : 'Credits are only spent when the action completes.'}
            </p>
          </div>
        </div>
      )}
    </CreditConfirmContext.Provider>
  );
}

export function useCreditConfirm() {
  return useContext(CreditConfirmContext).confirmCredits;
}
