'use client';

/**
 * Settings → Plan & billing. Shows the workspace plan and credit usage;
 * owner/admin can upgrade, buy a credit pack, or open the Stripe
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
  credits: { available: number; granted: number };
  triage: { used: number; limit: number };
  importedEnrichments: { used: number; included: number; hardCap: number };
  activeLeads: { used: number; cap: number; waitlisted: number; cadenceDays: number };
  netNewLeads: { used: number; limit: number };
  catalog: {
    plans: Array<{
      key: string;
      name: string;
      monthlyUsd: number;
      annualUsd: number;
      monthlyCredits: number;
      annualCredits: number;
      available: boolean;
      annualAvailable: boolean;
    }>;
    pack: { credits: number; usd: number; available: boolean } | null;
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

  const { plan, seats, credits, catalog } = summary;

  if (summary.unlimited) {
    return (
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Plan &amp; billing</h2>
        <div className={CARD}>
          <span className="text-sm font-semibold text-slate-950">{plan.name} plan</span>
          <p className="mt-1 text-sm text-[#7d909a]">
            This Arcova workspace is complimentary, with no usage limits or payment required.
          </p>
        </div>
      </section>
    );
  }

  const canManage = summary.role === 'owner' || summary.role === 'admin';
  const onFreePlan = plan.key === 'free';
  const usagePct =
    credits.granted > 0
      ? Math.min(100, Math.round(((credits.granted - credits.available) / credits.granted) * 100))
      : 0;
  const capUsagePct = Math.max(
    usagePct,
    percentage(summary.activeLeads.used, summary.activeLeads.cap),
    percentage(summary.triage.used, summary.triage.limit),
    percentage(summary.importedEnrichments.used, summary.importedEnrichments.hardCap),
    percentage(summary.netNewLeads.used, summary.netNewLeads.limit),
  );
  const showPlanNudge = capUsagePct >= 75 && (plan.key === 'free' || plan.key === 'starter');
  const showCreditNudge = usagePct >= 80 && plan.key !== 'free' && catalog.pack?.available;
  const renewsAt = plan.renewsAt
    ? new Date(plan.renewsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Plan &amp; billing</h2>
      <p className="mt-1 text-sm text-[#7d909a]">
        Every feature is included on every plan — plans set credits, usage caps, and monitoring cadence.
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
              {seats.used} {seats.used === 1 ? 'user' : 'users'}
              {seats.included === 1 ? ' · 1 user included' : ' · unlimited workspace users'}
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

        {/* Credit usage */}
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-slate-700">
              {credits.available.toLocaleString()} credits available
            </span>
            <span className="text-[#7d909a]">{credits.granted.toLocaleString()} plan credits</span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all ${usagePct >= 90 ? 'bg-amber-500' : 'bg-[#0d3547]'}`}
              style={{ width: `${usagePct}%` }}
            />
          </div>
        </div>

        {showPlanNudge && (
          <div className={`mt-4 rounded-xl border px-4 py-3 ${
            capUsagePct >= 90
              ? 'border-amber-200 bg-amber-50'
              : 'border-[#dbe8ed] bg-[#f4f8fa]'
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#0d3547]">
                  {plan.key === 'free' ? 'Starter is a better fit now' : 'You’re approaching Starter’s limits'}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-[#4a6470]">
                  Your highest plan allowance is {capUsagePct}% used.{' '}
                  {plan.key === 'free'
                    ? 'Starter adds 2,000 monthly credits and monitoring for up to 5,000 active leads.'
                    : 'Growth adds 8,000 monthly credits, 10,000 active leads, and weekly monitoring.'}
                </p>
              </div>
              {canManage && summary.available && (
                <button
                  onClick={() =>
                    void redirectTo(
                      plan.key === 'free' ? '/api/billing/checkout' : '/api/billing/portal',
                      plan.key === 'free'
                        ? { kind: 'plan', planKey: 'starter', billing: 'monthly' }
                        : undefined,
                    )
                  }
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0d3547] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0d3547]/90 disabled:opacity-50"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  {plan.key === 'free' ? 'Upgrade to Starter' : 'Review Growth'}
                </button>
              )}
            </div>
          </div>
        )}

        {showCreditNudge && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs leading-relaxed text-amber-900">
              You’ve used {usagePct}% of this period’s plan credits. Add a credit pack now to avoid interrupting paid actions.
            </p>
            {canManage && (
              <button
                onClick={() => void redirectTo('/api/billing/checkout', { kind: 'pack' })}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add credits
              </button>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {/* Actions */}
        {canManage && summary.available && (
          <div className="mt-4 flex flex-wrap gap-2">
            {onFreePlan &&
              catalog.plans.filter((p) => p.available).flatMap((p) => [
                <button
                  key={`${p.key}-monthly`}
                  onClick={() => void redirectTo('/api/billing/checkout', {
                    kind: 'plan', planKey: p.key, billing: 'monthly',
                  })}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0d3547] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#0d3547]/90 disabled:opacity-50"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  {p.name} — ${p.monthlyUsd}/workspace/mo · {p.monthlyCredits.toLocaleString()} credits
                </button>,
                ...(p.annualAvailable ? [
                  <button
                    key={`${p.key}-annual`}
                    onClick={() => void redirectTo('/api/billing/checkout', {
                      kind: 'plan', planKey: p.key, billing: 'annual',
                    })}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#0d3547]/15 bg-white px-3 py-1.5 text-sm font-medium text-[#0d3547] transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    {p.name} annual — ${p.annualUsd.toLocaleString()}/yr · {p.annualCredits.toLocaleString()} credits upfront
                  </button>,
                ] : []),
              ])}
            {catalog.pack?.available && (
              <button
                onClick={() => void redirectTo('/api/billing/checkout', { kind: 'pack' })}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add {catalog.pack.credits.toLocaleString()} credits — ${catalog.pack.usd}
              </button>
            )}
          </div>
        )}
        {canManage && !summary.available && (
          <p className="mt-3 text-sm text-[#7d909a]">Plan upgrades are coming soon.</p>
        )}
      </div>
    </section>
  );
}

function percentage(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}
