'use client';

/**
 * Settings → Plan & billing. Shows the org's plan, seat usage, and contact
 * usage; owner/admin can upgrade, buy a contact pack, or open the Stripe
 * customer portal (card, invoices, plan changes, cancel). Members see a
 * read-only view.
 *
 * Self-contained so it drops into the settings page with a single import
 * (same pattern as TeamSettings). When billing isn't live yet (no Stripe
 * config) the card still shows usage but hides purchase buttons.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, CreditCard, ArrowUpRight, Plus } from 'lucide-react';

type Summary = {
  available: boolean;
  unlimited: boolean;
  role: 'owner' | 'admin' | 'member';
  plan: {
    key: string;
    name: string;
    status: string;
    renewsAt: string | null;
    cancelAtPeriodEnd: boolean;
  };
  seats: { used: number; included: number };
  enrichments: {
    used: number;
    included: number;
    lifetime: boolean;
    packBalance: number;
    remaining: number;
  };
  catalog: {
    plans: Array<{
      key: string;
      name: string;
      perSeatMonthlyUsd: number;
      minSeats: number;
      enrichmentsPerSeat: number;
      available: boolean;
    }>;
    pack: { enrichments: number; usd: number };
  };
};

const CARD =
  'mt-4 rounded-2xl border border-white/80 bg-white/70 p-5 shadow-[0_8px_24px_-12px_rgba(13,53,71,0.15)] backdrop-blur-xl';

export default function BillingSettings() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/summary');
      if (res.ok) setSummary(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const redirectTo = useCallback(async (path: string, body?: Record<string, unknown>) => {
    setBusy(path + JSON.stringify(body ?? {}));
    setError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error || 'Something went wrong — please try again.');
    } catch {
      setError('Something went wrong — please try again.');
    } finally {
      setBusy(null);
    }
  }, []);

  if (loading) {
    return (
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Plan &amp; billing</h2>
        <div className={`${CARD} flex items-center gap-2 text-sm text-[#7d909a]`}>
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      </section>
    );
  }
  if (!summary) return null;

  const { plan, seats, enrichments: contacts, catalog } = summary;

  if (summary.unlimited) {
    return (
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Plan &amp; billing</h2>
        <div className={CARD}>
          <span className="text-sm font-semibold text-slate-950">{plan.name} plan</span>
          <p className="mt-1 text-sm text-[#7d909a]">
            This workspace has no contact or seat limits, and nothing to pay.
          </p>
        </div>
      </section>
    );
  }

  const canManage = summary.role === 'owner' || summary.role === 'admin';
  const onFreePlan = plan.key === 'free';
  const usagePct =
    contacts.included > 0 ? Math.min(100, Math.round((contacts.used / contacts.included) * 100)) : 0;
  const renewsAt = plan.renewsAt
    ? new Date(plan.renewsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Plan &amp; billing</h2>
      <p className="mt-1 text-sm text-[#7d909a]">
        Every feature is included on every plan — plans set how many teammates and contacts you can add.
      </p>

      <div className={CARD}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-950">{plan.name} plan</span>
              {plan.status === 'past_due' && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  Payment issue
                </span>
              )}
              {plan.cancelAtPeriodEnd && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  Ends {renewsAt ?? 'at period end'}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-[#7d909a]">
              {seats.used} of {seats.included} {seats.included === 1 ? 'seat' : 'seats'} used
              {renewsAt && !plan.cancelAtPeriodEnd ? ` · renews ${renewsAt}` : ''}
            </p>
          </div>
          {canManage && summary.available && !onFreePlan && (
            <button
              onClick={() => void redirectTo('/api/billing/portal')}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <CreditCard className="h-3.5 w-3.5" /> Manage billing
            </button>
          )}
        </div>

        {/* Contact usage */}
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-slate-700">
              {contacts.used.toLocaleString()} of {contacts.included.toLocaleString()} contacts
              {contacts.lifetime ? '' : ' this month'}
            </span>
            {contacts.packBalance > 0 && (
              <span className="text-[#7d909a]">+{contacts.packBalance.toLocaleString()} extra available</span>
            )}
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all ${usagePct >= 90 ? 'bg-amber-500' : 'bg-[#0d3547]'}`}
              style={{ width: `${usagePct}%` }}
            />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {/* Actions */}
        {canManage && summary.available && (
          <div className="mt-4 flex flex-wrap gap-2">
            {onFreePlan &&
              catalog.plans.filter((p) => p.available).map((p) => (
                <button
                  key={p.key}
                  onClick={() =>
                    void redirectTo('/api/billing/checkout', {
                      kind: 'plan',
                      planKey: p.key,
                      seats: p.minSeats,
                    })
                  }
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0d3547] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#0d3547]/90 disabled:opacity-50"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  {p.name} — ${p.perSeatMonthlyUsd}/seat/mo ·{' '}
                  {p.enrichmentsPerSeat.toLocaleString()} contacts/seat
                </button>
              ))}
            <button
              onClick={() => void redirectTo('/api/billing/checkout', { kind: 'pack' })}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add {catalog.pack.enrichments.toLocaleString()} contacts — ${catalog.pack.usd}
            </button>
          </div>
        )}
        {canManage && !summary.available && (
          <p className="mt-3 text-sm text-[#7d909a]">Plan upgrades are coming soon.</p>
        )}
      </div>
    </section>
  );
}
