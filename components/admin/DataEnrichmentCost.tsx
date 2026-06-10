'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

type ByUser = {
  userId: string | null;
  email: string;
  apifyProfileScrapes: number;
  apifyCompanyScrapes: number;
  apifyCostUsd: number;
  apolloPersonEnrichments: number;
  apolloOrgEnrichments: number;
  phoneReveals: number;
  apolloCredits: number;
};

type RecentEvent = {
  id: string;
  createdAt: string;
  userEmail: string;
  provider: string;
  eventType: string;
  quantity: number;
  costUsd: number | null;
  creditUnits: number | null;
};

type DataCostResponse = {
  ok: boolean;
  pricing: {
    apifyProfileUsd: number;
    apifyCompanyUsd: number;
    apolloCredits: { person: number; company: number; phoneReveal: number };
  };
  apolloPlan: {
    name: string;
    monthlyUsd: number | null;
    monthlyCredits: number | null;
    currentPeriodCredits: number;
    currentMonthCredits: number;
    directCredits: number;
    acquisitionCredits: number;
    acquisitionSearchCredits: number;
    acquisitionEnrichmentCredits: number;
    baselineCredits: number;
    baselineRecordedAt: string | null;
    periodStart: string;
    monthStart: string;
    billingCycleAnchorDay: number;
    billingCycleAnchorUtcHour: number;
  };
  totals: {
    apify: { profileScrapes: number; companyScrapes: number; costUsd: number };
    apollo: { personEnrichments: number; orgEnrichments: number; phoneReveals: number; credits: number };
    users: number;
  };
  byUser: ByUser[];
  recent: RecentEvent[];
  meteringSince: string | null;
};

const EVENT_LABELS: Record<string, string> = {
  apify_profile_scrape: 'Apify · profile scrape',
  apify_company_scrape: 'Apify · company scrape',
  apollo_person_enrichment: 'Apollo · person enrichment',
  apollo_company_enrichment: 'Apollo · company enrichment',
  apollo_phone_reveal: 'Apollo · phone reveal',
};

function fmtUsd(value: number | null | undefined): string {
  const n = typeof value === 'number' ? value : 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(n);
}

function fmtNum(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export default function DataEnrichmentCost() {
  const [data, setData] = useState<DataCostResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setError('');
      try {
        const res = await fetch('/api/admin/data-costs');
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load data costs');
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load data costs');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-950">Data &amp; enrichment cost</h2>
        <p className="mt-1 text-sm text-slate-500">
          Paid data-provider usage across all users. Apify (LinkedIn scraping) is priced in dollars; Apollo is shown
          as credit consumption. Totals are counted from every enriched record, so they cover all history.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading data costs…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : data ? (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card
              title="Apify cost"
              value={fmtUsd(data.totals.apify.costUsd)}
              detail={`${fmtNum(data.totals.apify.profileScrapes)} profile + ${fmtNum(data.totals.apify.companyScrapes)} company scrapes`}
            />
            <Card
              title="Apify scrapes"
              value={fmtNum(data.totals.apify.profileScrapes + data.totals.apify.companyScrapes)}
              detail={`${fmtUsd(data.pricing.apifyProfileUsd)} / scrape`}
            />
            <Card
              title="Apollo credits used (all time)"
              value={fmtNum(data.totals.apollo.credits)}
              detail={`${fmtNum(data.totals.apollo.personEnrichments)} person · ${fmtNum(data.totals.apollo.orgEnrichments)} org · ${fmtNum(data.totals.apollo.phoneReveals)} phone reveal`}
            />
            <ApolloMonthCard plan={data.apolloPlan} />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-lg font-medium text-slate-950">By user</h3>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">User</th>
                    <th className="px-3 py-2 font-medium">Apify scrapes</th>
                    <th className="px-3 py-2 font-medium">Apify cost</th>
                    <th className="px-3 py-2 font-medium">Apollo credits</th>
                    <th className="px-3 py-2 font-medium">Phone reveals</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byUser.length ? (
                    data.byUser.map((u) => (
                      <tr key={u.userId ?? u.email} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-900">{u.email}</td>
                        <td className="px-3 py-2 text-slate-600">
                          {fmtNum(u.apifyProfileScrapes + u.apifyCompanyScrapes)}
                        </td>
                        <td className="px-3 py-2 text-slate-900">{fmtUsd(u.apifyCostUsd)}</td>
                        <td className="px-3 py-2 text-slate-600">{fmtNum(u.apolloCredits)}</td>
                        <td className="px-3 py-2 text-slate-600">{fmtNum(u.phoneReveals)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr className="border-t border-slate-100">
                      <td className="px-3 py-6 text-sm text-slate-500" colSpan={5}>
                        No enriched records yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <h3 className="text-lg font-medium text-slate-950">Recent enrichment activity</h3>
              <p className="text-xs text-slate-500">
                {data.meteringSince
                  ? `Per-call log since ${new Date(data.meteringSince).toLocaleDateString()}`
                  : 'Per-call log — fills as new enrichment runs'}
              </p>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">User</th>
                    <th className="px-3 py-2 font-medium">Event</th>
                    <th className="px-3 py-2 font-medium">Qty</th>
                    <th className="px-3 py-2 font-medium">Cost / credits</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.length ? (
                    data.recent.map((e) => (
                      <tr key={e.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-600">{new Date(e.createdAt).toLocaleString()}</td>
                        <td className="px-3 py-2 text-slate-900">{e.userEmail}</td>
                        <td className="px-3 py-2 text-slate-600">{EVENT_LABELS[e.eventType] ?? e.eventType}</td>
                        <td className="px-3 py-2 text-slate-600">{fmtNum(e.quantity)}</td>
                        <td className="px-3 py-2 text-slate-900">
                          {e.costUsd != null
                            ? fmtUsd(e.costUsd)
                            : e.creditUnits != null
                              ? `${fmtNum(e.creditUnits)} cr`
                              : '—'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr className="border-t border-slate-100">
                      <td className="px-3 py-6 text-sm text-slate-500" colSpan={5}>
                        No metered events yet — new enrichment runs (and re-enrichments) will appear here.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-slate-400">
            Apify priced at {fmtUsd(data.pricing.apifyProfileUsd)}/profile scrape (the actor&apos;s &ldquo;$4 per 1k&rdquo;
            mode) and {fmtUsd(data.pricing.apifyCompanyUsd)}/company scrape (estimate — confirm on the Apify console).
            Edit prices in <code className="rounded bg-slate-100 px-1 py-0.5">lib/provider-usage.ts</code>. Apollo credits
            are consumption estimates (≈1 per person/org enrichment, 1 per phone reveal). The billing-period meter also
            includes ICP sourcing search/enrichment events; failed Apollo calls are not counted as spend.
          </p>
        </>
      ) : null}
    </section>
  );
}

function ApolloMonthCard({ plan }: { plan: DataCostResponse['apolloPlan'] }) {
  const {
    name,
    monthlyCredits,
    currentPeriodCredits,
    directCredits,
    acquisitionCredits,
    acquisitionSearchCredits,
    acquisitionEnrichmentCredits,
    baselineCredits,
    baselineRecordedAt,
    periodStart,
    billingCycleAnchorDay,
  } = plan;
  const periodLabel = new Date(`${periodStart.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  const pct = monthlyCredits ? Math.min(100, (currentPeriodCredits / monthlyCredits) * 100) : null;
  const isWarning = pct != null && pct >= 80;
  const isDanger = pct != null && pct >= 95;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">Apollo billing period — since {periodLabel}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{name}</div>
      <div className="mt-3 space-y-1.5">
        {monthlyCredits != null ? (
          <>
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-slate-600">
                {fmtNum(currentPeriodCredits)} / {fmtNum(monthlyCredits)} tracked credits
              </span>
              <span
                className={
                  isDanger
                    ? 'font-semibold text-red-600'
                    : isWarning
                      ? 'font-semibold text-amber-600'
                      : 'text-slate-400'
                }
              >
                {Math.round(pct!)}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-all ${
                  isDanger ? 'bg-red-500' : isWarning ? 'bg-amber-400' : 'bg-teal-500'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-slate-400">
              {fmtNum(Math.max(0, monthlyCredits - currentPeriodCredits))} remaining · configured renewal day{' '}
              {billingCycleAnchorDay}
            </p>
            <p className="text-xs leading-relaxed text-slate-500">
              Apollo baseline {fmtNum(baselineCredits)} cr
              {baselineRecordedAt ? ` · since ${new Date(baselineRecordedAt).toLocaleDateString()}` : ''} · direct
              enrichment {fmtNum(directCredits)} cr · ICP sourcing {fmtNum(acquisitionCredits)} cr (
              {fmtNum(acquisitionSearchCredits)} search, {fmtNum(acquisitionEnrichmentCredits)} enrichment)
            </p>
          </>
        ) : (
          <p className="text-xs text-slate-400">Credit limit unknown — set monthlyCredits in lib/provider-usage.ts</p>
        )}
      </div>
    </div>
  );
}

function Card({ title, value, detail }: { title: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
      {detail ? <div className="mt-1 text-xs text-slate-500">{detail}</div> : null}
    </div>
  );
}
