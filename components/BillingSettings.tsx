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
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, CreditCard, ArrowUpRight, Plus } from 'lucide-react';

type Summary = {
  available: boolean;
  unlimited: boolean;
  complimentary?: boolean;
  role: 'owner' | 'admin' | 'member';
  plan: {
    key: string;
    name: string;
    status: string;
    renewsAt: string | null;
    cancelAtPeriodEnd: boolean;
  };
  billing?: {
    stripeBacked: boolean;
    canOpenPortal: boolean;
    creditPackConfigured: boolean;
  };
  seats: { used: number; included: number };
  credits: {
    available: number;
    granted: number;
    includedAvailable?: number;
    includedGranted?: number;
    purchasedAvailable?: number;
    purchasedGranted?: number;
  };
  triage: { used: number; limit: number };
  activeIcps?: { used: number; limit: number };
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
      setError(data.error || 'Could not open Stripe billing.');
    } catch {
      setError('Could not open Stripe billing.');
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
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-sm font-semibold text-slate-950">{plan.name} plan</span>
              <p className="mt-1 text-sm text-[#7d909a]">
                This Arcova workspace is complimentary, with no usage limits or payment required.
              </p>
            </div>
            <Link
              href="/settings/billing"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Select another plan
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const canManage = summary.role === 'owner' || summary.role === 'admin';
  const onFreePlan = plan.key === 'free';
  const includedGranted = credits.includedGranted ?? credits.granted;
  const includedAvailable = credits.includedAvailable ?? credits.available;
  const usagePct =
    includedGranted > 0
      ? Math.min(100, Math.round(((includedGranted - includedAvailable) / includedGranted) * 100))
      : 0;
  const capUsagePct = Math.max(
    usagePct,
    summary.activeIcps ? percentage(summary.activeIcps.used, summary.activeIcps.limit) : 0,
    percentage(summary.activeLeads.used, summary.activeLeads.cap),
    percentage(summary.triage.used, summary.triage.limit),
  );
  const showPlanNudge = capUsagePct >= 75 && (plan.key === 'free' || plan.key === 'starter');
  const showCreditNudge = usagePct >= 80 && plan.key !== 'free' && catalog.pack?.available;
  const canOpenPortal = Boolean(summary.billing?.canOpenPortal);
  const starterPlanAvailable = Boolean(catalog.plans.some((catalogPlan) => catalogPlan.key === 'starter' && catalogPlan.available));
  const canBuyCreditPack = Boolean(catalog.pack?.available && summary.billing?.stripeBacked);
  const renewsAt = plan.renewsAt
    ? new Date(plan.renewsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Plan &amp; billing</h2>
      <p className="mt-1 text-sm text-[#7d909a]">
        Plans include monthly credits and workspace capacity. Purchased credits roll over and can be used for any paid action.
      </p>
      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

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
              type="button"
              onClick={() => void redirectTo('/api/billing/portal')}
              disabled={!canOpenPortal || busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
            <span className="text-[#7d909a]">
              {(credits.includedAvailable ?? credits.available).toLocaleString()} included · {(credits.purchasedAvailable ?? 0).toLocaleString()} purchased
            </span>
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
                    ? 'Starter adds 2,000 monthly credits, 3 active ICPs, and 5,000 lead capacity.'
                    : 'Growth adds 8,000 monthly credits, 10 active ICPs, 10,000 lead capacity, and weekly monitoring.'}
                </p>
              </div>
              {canManage && summary.available && (
                <button
                  type="button"
                  onClick={() => {
                    if (plan.key === 'free') {
                      void redirectTo('/api/billing/checkout', { kind: 'plan', planKey: 'starter', billing: 'monthly' });
                      return;
                    }
                    void redirectTo('/api/billing/portal');
                  }}
                  disabled={busy !== null || (plan.key === 'free' ? !starterPlanAvailable : !canOpenPortal)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0d3547] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0d3547]/90 disabled:cursor-not-allowed disabled:opacity-50"
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
              You’ve used {usagePct}% of this period’s included credits. Add rollover credits to keep using paid actions.
            </p>
            {canManage && (
              <button
                type="button"
                onClick={() => void redirectTo('/api/billing/checkout', { kind: 'pack' })}
                disabled={!canBuyCreditPack || busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add credits
              </button>
            )}
          </div>
        )}

        {/* Actions */}
        {canManage && summary.available && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (onFreePlan) {
                  void redirectTo('/api/billing/checkout', { kind: 'plan', planKey: 'starter', billing: 'monthly' });
                  return;
                }
                void redirectTo('/api/billing/portal');
              }}
              disabled={busy !== null || (onFreePlan ? !starterPlanAvailable : !canOpenPortal)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0d3547] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#0d3547]/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              {onFreePlan ? 'Upgrade to Starter' : 'Manage plan'}
            </button>
            <button
              type="button"
              onClick={() => void redirectTo('/api/billing/checkout', { kind: 'pack' })}
              disabled={!canBuyCreditPack || busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Buy credit add-ons
            </button>
            <Link
              href="/settings/billing"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Plan details
            </Link>
          </div>
        )}
        {canManage && !summary.available && (
          <p className="mt-3 text-sm text-[#7d909a]">Plan upgrades are coming soon.</p>
        )}
        {canManage && onFreePlan && summary.available && !starterPlanAvailable && (
          <p className="mt-3 text-sm text-[#7d909a]">Starter checkout is not configured yet.</p>
        )}
        {canManage && !onFreePlan && summary.plan.status === 'past_due' && (
          <p className="mt-3 text-sm text-[#7d909a]">Resolve the billing issue in Stripe before buying credit packs.</p>
        )}
        {canManage && !onFreePlan && summary.plan.status !== 'past_due' && !summary.billing?.stripeBacked && (
          <p className="mt-3 text-sm text-[#7d909a]">Credit add-ons require an active Stripe-backed subscription.</p>
        )}
      </div>
    </section>
  );
}

function percentage(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}
