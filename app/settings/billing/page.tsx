'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, Check, CreditCard, Loader2, Minus, Plus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import AppSidebar from '@/components/AppSidebar';

type Plan = {
  key: 'starter' | 'growth';
  name: string;
  monthlyUsd: number;
  annualUsd: number;
  monthlyCredits: number;
  annualCredits: number;
  activeLeadsCap: number;
  activeIcpCap: number;
  monitoringCadenceDays: number;
  available: boolean;
  annualAvailable: boolean;
};

type Summary = {
  available: boolean;
  unlimited: boolean;
  complimentary?: boolean;
  role: 'owner' | 'admin' | 'member';
  plan: { key: string; name: string; status: string; billingInterval: 'monthly' | 'annual' };
  billing?: {
    stripeBacked: boolean;
    canOpenPortal: boolean;
    creditPackConfigured: boolean;
  };
  credits: {
    available: number;
    granted: number;
    includedAvailable?: number;
    includedGranted?: number;
    purchasedAvailable?: number;
    purchasedGranted?: number;
  };
  capacity?: {
    storedContacts: number;
    storedContactsCap: number;
    activeMonitoredContacts: number;
    activeMonitoredContactsCap: number;
    monitoringCadenceDays: number;
  };
  catalog: {
    plans: Plan[];
    pack: { credits: number; usd: number; available: boolean } | null;
  };
};

type PlanView = {
  key: 'free' | 'starter' | 'growth';
  name: string;
  desc: string;
  priceMonthly: string;
  priceAnnual: string;
  annualList?: string;
  per?: string;
  pop?: string;
  featured?: boolean;
  paid?: boolean;
  featuresHeading: string;
  activeIcpCap: number;
  featuresMonthly: string[];
  featuresAnnual: string[];
  available?: boolean;
  annualAvailable?: boolean;
};

const FREE_PLAN: PlanView = {
  key: 'free',
  name: 'Free',
  desc: 'Try Arcova on a real slice of your market.',
  priceMonthly: '$0',
  priceAnnual: '$0',
  featuresHeading: 'Includes',
  activeIcpCap: 1,
  featuresMonthly: ['**100** credits / month', '**1** workspace user', '**1** active ICP', '**100** lead capacity', '**Monthly** monitoring'],
  featuresAnnual: ['**100** credits / month', '**1** workspace user', '**1** active ICP', '**100** lead capacity', '**Monthly** monitoring'],
};

function featureParts(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <b key={index} className="font-bold text-[#0d3547]">{part.slice(2, -2)}</b>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

export default function BillingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadingBilling, setLoadingBilling] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [annual, setAnnual] = useState(false);
  const [packQuantity, setPackQuantity] = useState(1);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, router, user]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/summary');
      if (res.ok) setSummary(await res.json());
    } finally {
      setLoadingBilling(false);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const canManage = summary?.role === 'owner' || summary?.role === 'admin';
  const currentPlanKey = summary?.plan.key ?? 'free';
  const hasPaidPlan = currentPlanKey === 'starter' || currentPlanKey === 'growth';
  const interval = annual ? 'annual' : 'monthly';
  const canOpenPortal = Boolean(summary?.billing?.canOpenPortal);
  const canBuyCreditPack = Boolean(summary?.catalog.pack?.available && summary.billing?.stripeBacked);

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
      setError(data.error || 'Could not open checkout.');
    } catch {
      setError('Could not open checkout.');
    } finally {
      setBusy(null);
    }
  }, []);

  const plans = useMemo<PlanView[]>(() => {
    const paid = summary?.catalog.plans ?? [];
    const views = paid.map((plan): PlanView => ({
      key: plan.key,
      name: plan.name,
      desc: plan.key === 'starter' ? 'Build a repeatable outbound motion.' : 'Run an always-on revenue engine.',
      priceMonthly: `$${plan.monthlyUsd}`,
      priceAnnual: `$${plan.annualUsd.toLocaleString()}`,
      annualList: `$${(plan.monthlyUsd * 12).toLocaleString()}`,
      per: '/workspace/mo',
      paid: true,
      featured: plan.key === 'starter',
      pop: plan.key === 'starter' ? 'Most teams start here' : undefined,
      featuresHeading: plan.key === 'starter' ? 'Everything in Free, plus' : 'Everything in Starter, plus',
      activeIcpCap: plan.activeIcpCap,
      featuresMonthly: [
        `**${plan.monthlyCredits.toLocaleString()}** credits / month`,
        '**Unlimited** users',
        `**${plan.activeIcpCap.toLocaleString()}** active ICP${plan.activeIcpCap === 1 ? '' : 's'}`,
        `**${plan.activeLeadsCap.toLocaleString()}** lead capacity`,
        `**${plan.monitoringCadenceDays === 7 ? 'Weekly' : 'Monthly'}** monitoring`,
      ],
      featuresAnnual: [
        `**${plan.annualCredits.toLocaleString()}** credits upfront`,
        '**Spend at your pace** with usage warnings',
        '**Unlimited** users',
        `**${plan.activeIcpCap.toLocaleString()}** active ICP${plan.activeIcpCap === 1 ? '' : 's'}`,
        `**${plan.activeLeadsCap.toLocaleString()}** lead capacity`,
        `**${plan.monitoringCadenceDays === 7 ? 'Weekly' : 'Monthly'}** monitoring`,
      ],
      available: plan.available,
      annualAvailable: plan.annualAvailable,
    }));
    return [FREE_PLAN, ...views];
  }, [summary]);

  if (loading || loadingBilling) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <Loader2 className="h-8 w-8 animate-spin text-arcova-teal" />
      </div>
    );
  }

  if (!user || !summary) return null;

  return (
    <div className="flex h-screen bg-transparent">
      <AppSidebar />
      <main className="bg-transparent min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-[1180px]">
          <div className="mb-8">
            <Link href="/settings" className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#7d909a] hover:text-[#0d3547]">
              <ArrowLeft className="h-3.5 w-3.5" />
              Settings
            </Link>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <span className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.2em] text-[#007f8c]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#00a4b4]" />
                Pricing
              </span>
              <h1 className="mt-4 max-w-2xl font-manrope text-[clamp(2rem,1.3rem+2.4vw,3rem)] font-bold leading-[1.05] tracking-[-0.038em] text-[#0d3547]">
                One workspace. Your whole revenue team.
              </h1>
            </div>

            <div className="inline-flex items-center gap-1 rounded-full bg-[rgba(13,53,71,0.05)] p-1">
              <button
                type="button"
                className={`inline-flex rounded-full px-4 py-2 text-[13px] font-semibold transition ${!annual ? 'bg-white text-[#0d3547] shadow-[0_2px_18px_-6px_rgba(13,53,71,0.10)]' : 'text-[#7d909a]'}`}
                aria-pressed={!annual}
                onClick={() => setAnnual(false)}
              >
                Monthly
              </button>
              <button
                type="button"
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold transition ${annual ? 'bg-white text-[#0d3547] shadow-[0_2px_18px_-6px_rgba(13,53,71,0.10)]' : 'text-[#7d909a]'}`}
                aria-pressed={annual}
                onClick={() => setAnnual(true)}
              >
                Annual
                <span className="rounded-full bg-[rgba(0,164,180,0.14)] px-1.5 py-0.5 text-[10px] font-bold text-[#007f8c]">2 months free</span>
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {summary.complimentary && (
            <div className="mt-5 rounded-lg border border-[#dbe8ed] bg-white/70 px-4 py-3 text-sm text-[#4a6470]">
              This Arcova workspace is complimentary. It uses a pretend credit track here so the billing experience matches a customer workspace, while Stripe checkout is only used when switching onto a real paid plan.
            </div>
          )}

          {hasPaidPlan && (
            <section className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[22px] border border-white/80 bg-white/70 p-5 shadow-[0_8px_24px_-12px_rgba(13,53,71,0.15)] backdrop-blur-xl">
              <div>
                <h2 className="text-base font-semibold text-[#0d3547]">{summary.plan.name} billing</h2>
                <p className="mt-1 text-sm text-[#7d909a]">
                  Manage payment method, invoices, cancellation and plan changes in Stripe Customer Portal.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void redirectTo('/api/billing/portal')}
                disabled={!canManage || !canOpenPortal || busy !== null}
                className="inline-flex items-center gap-2 rounded-full bg-[#0d3547] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#003344] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CreditCard className="h-4 w-4" />
                Manage in Stripe
                <ArrowUpRight className="h-4 w-4" />
              </button>
              {!canOpenPortal && canManage && (
                <p className="basis-full text-sm text-[#7d909a]">
                  This plan is not connected to a Stripe customer yet. Choose a hosted plan checkout before managing billing.
                </p>
              )}
            </section>
          )}

          <section className="mt-11 grid overflow-hidden rounded-[24px] border border-[rgba(13,53,71,0.08)] bg-white shadow-[0_2px_18px_-6px_rgba(13,53,71,0.10)] md:grid-cols-3">
            {plans.map((plan, index) => {
              const current = currentPlanKey === plan.key && (plan.key === 'free' || summary.plan.billingInterval === interval);
              const unavailable = plan.paid && !(annual ? plan.annualAvailable : plan.available);
              return (
                <div
                  key={plan.key}
                  className={`flex flex-col p-7 ${index > 0 ? 'border-t border-[rgba(13,53,71,0.08)] md:border-l md:border-t-0' : ''} ${plan.featured ? 'bg-gradient-to-b from-[rgba(0,164,180,0.06)] to-transparent' : ''}`}
                >
                  <div className="mb-3 flex min-h-6 items-center">
                    {plan.pop && (
                      <span className="rounded-full bg-[rgba(0,164,180,0.12)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#007f8c]">
                        {plan.pop}
                      </span>
                    )}
                    {current && !plan.pop && (
                      <span className="rounded-full bg-[rgba(13,53,71,0.08)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#0d3547]">
                        Current
                      </span>
                    )}
                  </div>
                  <h2 className="font-manrope text-xl font-bold tracking-[-0.02em] text-[#0d3547]">{plan.name}</h2>
                  <p className="mt-1 min-h-9 text-[12.8px] leading-[1.45] text-[#7d909a]">{plan.desc}</p>

                  <div className="mt-4 flex items-baseline gap-1">
                    {annual && plan.annualList && (
                      <span className="font-manrope text-[22px] font-semibold tracking-[-0.02em] text-[#aab8bf] line-through">
                        {plan.annualList}
                      </span>
                    )}
                    <span className="font-manrope text-[40px] font-bold leading-none tracking-[-0.035em] text-[#0d3547]">
                      {annual ? plan.priceAnnual : plan.priceMonthly}
                    </span>
                    {plan.per && <span className="text-[13px] text-[#7d909a]">{annual ? '/workspace/yr' : plan.per}</span>}
                  </div>
                  <p className="min-h-4 text-[11.5px] text-[#aab8bf]">{plan.paid ? (annual ? 'billed annually' : 'billed monthly') : ''}</p>

                  <button
                    type="button"
                    onClick={() => {
                      if (!plan.paid || current || unavailable || !canManage) return;
                      if (hasPaidPlan && canOpenPortal) void redirectTo('/api/billing/portal');
                      else void redirectTo('/api/billing/checkout', { kind: 'plan', planKey: plan.key, billing: interval });
                    }}
                    disabled={!plan.paid || current || unavailable || !canManage || busy !== null || (hasPaidPlan && !canOpenPortal)}
                    className={`mt-5 inline-flex w-full items-center justify-center rounded-full px-5 py-3 text-[15px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-55 ${
                      plan.featured
                        ? 'bg-[#00a4b4] text-white shadow-[0_10px_24px_-10px_rgba(0,164,180,0.7)] hover:bg-[#008c99]'
                        : 'bg-[rgba(13,53,71,0.05)] text-[#0d3547] hover:bg-[rgba(13,53,71,0.09)]'
                    }`}
                  >
                    {current
                      ? 'Current plan'
                      : !plan.paid
                        ? 'Included'
                        : !canManage
                          ? 'Owner/admin only'
                          : hasPaidPlan
                            ? 'Manage plan'
                            : unavailable
                              ? 'Checkout unavailable'
                              : 'Select plan'}
                  </button>

                  <p className="mb-3 mt-6 text-xs font-bold text-[#0d3547]">{plan.featuresHeading}</p>
                  <ul className="flex flex-col gap-3">
                    {(annual ? plan.featuresAnnual : plan.featuresMonthly).map((feature) => (
                      <li key={feature} className="flex gap-2 text-[13px] leading-[1.4] text-[#4a6470]">
                        <Check className="mt-0.5 h-[15px] w-[15px] shrink-0 text-[#00a4b4]" />
                        <span>{featureParts(feature)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>

          <section className="mt-5 flex flex-wrap items-center gap-7 rounded-[22px] bg-[#0d3547] px-8 py-7 text-white">
            <div className="min-w-[260px] flex-1">
              <h2 className="font-manrope text-[19px] font-bold tracking-[-0.02em] text-white">Custom</h2>
              <p className="mt-1 max-w-xl text-[13px] leading-6 text-white/60">
                For larger teams that need custom volumes, security and hands-on onboarding.
              </p>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {['Negotiated volumes', 'Unlimited active leads', 'SSO & onboarding'].map((item) => (
                <span key={item} className="inline-flex items-center gap-2 text-[12.8px] text-white/80">
                  <Check className="h-3.5 w-3.5 text-[#8cd9c9]" />
                  {item}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => router.push('/contact-us')}
              className="inline-flex items-center justify-center rounded-full bg-[#00a4b4] px-5 py-3 text-[15px] font-semibold text-white shadow-[0_12px_28px_-10px_rgba(0,164,180,0.7)] transition hover:bg-[#008c99]"
            >
              Contact sales
            </button>
          </section>

          <p className="mt-6 text-center text-[12.5px] text-[#7d909a]">
            All plans include the full engine: signals, scoring, drafted outreach and CRM sync.
          </p>

          <section className="mt-8 rounded-[22px] border border-white/80 bg-white/70 p-5 shadow-[0_8px_24px_-12px_rgba(13,53,71,0.15)] backdrop-blur-xl">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-[#0d3547]">Additional credits</h2>
                <p className="mt-1 text-sm text-[#7d909a]">
                  Buy rollover credits for paid workspaces. Purchased credits can be used for any paid action; they do not increase active ICP capacity, workspace lead capacity or monitoring cadence.
                </p>
              </div>
              <div className="text-right text-sm">
                <p className="font-semibold text-[#0d3547]">{summary.credits.available.toLocaleString()} credits available</p>
                <p className="text-xs text-[#7d909a]">
                  {(summary.credits.includedAvailable ?? summary.credits.available).toLocaleString()} included · {(summary.credits.purchasedAvailable ?? 0).toLocaleString()} purchased
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center rounded-lg border border-[rgba(13,53,71,0.12)] bg-white">
                <button
                  type="button"
                  onClick={() => setPackQuantity((value) => Math.max(1, value - 1))}
                  className="p-2 text-[#4a6470] hover:text-[#0d3547]"
                  aria-label="Decrease credit packs"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="min-w-12 px-3 text-center text-sm font-semibold text-[#0d3547]">{packQuantity}</span>
                <button
                  type="button"
                  onClick={() => setPackQuantity((value) => Math.min(20, value + 1))}
                  className="p-2 text-[#4a6470] hover:text-[#0d3547]"
                  aria-label="Increase credit packs"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <span className="text-sm text-[#4a6470]">
                {(summary.catalog.pack?.credits ?? 1000) * packQuantity} credits
                {summary.catalog.pack ? ` · $${summary.catalog.pack.usd * packQuantity}` : ''}
              </span>
              <button
                type="button"
                onClick={() => void redirectTo('/api/billing/checkout', { kind: 'pack', quantity: packQuantity })}
                disabled={
                  busy !== null ||
                  !canManage ||
                  !canBuyCreditPack ||
                  summary.unlimited ||
                  !hasPaidPlan
                }
                className="inline-flex items-center gap-2 rounded-full bg-[#0d3547] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#003344] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Buy additional credits
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </div>

            {!hasPaidPlan && !summary.unlimited && (
              <p className="mt-3 text-sm text-[#7d909a]">Credit add-ons are available after choosing a paid plan.</p>
            )}
            {hasPaidPlan && summary.plan.status === 'past_due' && (
              <p className="mt-3 text-sm text-[#7d909a]">Resolve the billing issue in Stripe before buying credit packs.</p>
            )}
            {hasPaidPlan && summary.plan.status !== 'past_due' && !summary.billing?.stripeBacked && (
              <p className="mt-3 text-sm text-[#7d909a]">Credit add-ons require an active Stripe-backed subscription.</p>
            )}
            {hasPaidPlan && summary.billing?.stripeBacked && !summary.billing.creditPackConfigured && (
              <p className="mt-3 text-sm text-[#7d909a]">Credit add-ons are not configured yet.</p>
            )}
            {summary.capacity && (
              <p className="mt-3 text-sm text-[#7d909a]">
                Workspace capacity: {summary.capacity.storedContacts.toLocaleString()} / {summary.capacity.storedContactsCap.toLocaleString()} leads. Upgrade the plan to hold or monitor more leads.
              </p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
