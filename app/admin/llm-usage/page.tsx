'use client';

import AppSidebar from '@/components/AppSidebar';
import DataEnrichmentCost from '@/components/admin/DataEnrichmentCost';
import { Button } from '@/components/ui/button';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/context/AuthContext';
import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

type Bucket = {
  key: string;
  events: number;
  estimated_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
};

type SeriesKey = {
  key: string;
  label: string;
};

type SeriesPoint = {
  bucket_start: string;
  bucket_label: string;
} & Record<string, number | string>;

type UsageResponse = {
  ok: boolean;
  days: number;
  range: {
    start: string;
    end: string;
    granularity: 'hour' | 'day';
  };
  totals: {
    events: number;
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    estimated_cost_usd: number;
  };
  by_feature: Bucket[];
  by_route: Bucket[];
  by_model: Bucket[];
  by_user: Bucket[];
  time_series: {
    routes: {
      keys: SeriesKey[];
      points: SeriesPoint[];
    };
    features: {
      keys: SeriesKey[];
      points: SeriesPoint[];
    };
  };
  recent: Array<{
    id: string;
    user_email: string | null;
    feature: string;
    route: string;
    model: string;
    estimated_cost_usd: number | null;
    input_tokens: number;
    output_tokens: number;
    created_at: string;
  }>;
};

const QUICK_RANGES = [
  { label: '1D', days: 1 },
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
] as const;

const SERIES_COLORS = ['#0f766e', '#f97316', '#0f172a', '#0891b2', '#65a30d'];

type RecentSortMode = 'when_desc' | 'cost_desc' | 'input_desc' | 'output_desc';

function fmtUsd(value: number | null | undefined): string {
  const n = typeof value === 'number' ? value : 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function fmtNum(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function buildRangeFromDays(days: number) {
  const end = new Date();
  const safeDays = Math.max(1, Math.min(90, days));
  const start = shiftDays(end, -(safeDays - 1));
  return {
    start: toDateInputValue(start),
    end: toDateInputValue(end),
  };
}

function formatRangeLabel(start: string, end: string): string {
  const startLabel = new Date(`${start}T12:00:00.000Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  const endLabel = new Date(`${end}T12:00:00.000Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startLabel} - ${endLabel}`;
}

function buildChartConfig(keys: SeriesKey[]): ChartConfig {
  return keys.reduce<ChartConfig>((acc, item, index) => {
    acc[item.key] = {
      label: item.label,
      color: SERIES_COLORS[index % SERIES_COLORS.length],
    };
    return acc;
  }, {});
}

export default function AdminLlmUsagePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<UsageResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [recentMinCost, setRecentMinCost] = useState('0');
  const [recentSortMode, setRecentSortMode] = useState<RecentSortMode>('when_desc');

  const initialRange = useMemo(() => {
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    if (start && end) return { start, end };
    const fallbackDays = Number(searchParams.get('days') ?? '30');
    return buildRangeFromDays(Number.isFinite(fallbackDays) ? fallbackDays : 30);
  }, [searchParams]);

  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);

  useEffect(() => {
    setStartDate(initialRange.start);
    setEndDate(initialRange.end);
  }, [initialRange.end, initialRange.start]);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, router, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ start: initialRange.start, end: initialRange.end });
        const res = await fetch(`/api/admin/llm-usage?${params.toString()}`);
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || 'Failed to load usage');
        }
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load usage');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [initialRange.end, initialRange.start, user]);

  const routeChartConfig = useMemo(
    () => buildChartConfig(data?.time_series.routes.keys ?? []),
    [data?.time_series.routes.keys]
  );
  const featureChartConfig = useMemo(
    () => buildChartConfig(data?.time_series.features.keys ?? []),
    [data?.time_series.features.keys]
  );
  const recentMinCostValue = useMemo(() => {
    const parsed = Number(recentMinCost);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [recentMinCost]);
  const filteredRecent = useMemo(() => {
    const rows = (data?.recent ?? []).filter((row) => (row.estimated_cost_usd ?? 0) >= recentMinCostValue);
    const sorted = [...rows];
    sorted.sort((a, b) => {
      switch (recentSortMode) {
        case 'cost_desc':
          return (b.estimated_cost_usd ?? 0) - (a.estimated_cost_usd ?? 0);
        case 'input_desc':
          return b.input_tokens - a.input_tokens;
        case 'output_desc':
          return b.output_tokens - a.output_tokens;
        case 'when_desc':
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });
    return sorted;
  }, [data?.recent, recentMinCostValue, recentSortMode]);

  function applyRange(nextStart: string, nextEnd: string) {
    if (!nextStart || !nextEnd) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('start', nextStart);
    params.set('end', nextEnd);
    params.delete('days');
    router.replace(`/admin/llm-usage?${params.toString()}`);
  }

  function applyQuickRange(days: number) {
    const range = buildRangeFromDays(days);
    setStartDate(range.start);
    setEndDate(range.end);
    applyRange(range.start, range.end);
  }

  function onApplyCustomRange() {
    if (!startDate || !endDate) return;
    const safeStart = startDate <= endDate ? startDate : endDate;
    const safeEnd = startDate <= endDate ? endDate : startDate;
    setStartDate(safeStart);
    setEndDate(safeEnd);
    applyRange(safeStart, safeEnd);
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <Loader2 className="h-8 w-8 animate-spin text-arcova-teal" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-transparent">
      <AppSidebar />
      <main className="arcova-scroll-surface min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-950">Usage &amp; cost</h1>
              <p className="mt-2 text-sm text-slate-500">
                Internal admin view of LLM spend (Anthropic + OpenRouter) and paid data-provider usage (Apify, Apollo, ZeroBounce).
              </p>
            </div>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap gap-2">
                {QUICK_RANGES.map((option) => (
                  <Button
                    key={option.days}
                    variant={data?.days === option.days ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => applyQuickRange(option.days)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="flex-1 text-sm text-slate-600">
                  Start
                  <Input className="mt-1" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </label>
                <label className="flex-1 text-sm text-slate-600">
                  End
                  <Input className="mt-1" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </label>
                <Button onClick={onApplyCustomRange}>Apply range</Button>
              </div>
            </section>
          </div>

          <DataEnrichmentCost />

          <div className="border-t border-slate-200" />

          <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Historical totals may be incomplete before May 13, 2026 because some Anthropic usage paths were not yet instrumented.
            New usage after that date should be much more complete, but this dashboard is still an app-side estimate rather than a direct Anthropic billing import, and separate tool charges like web search may not be fully reflected.
          </section>

          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading usage…
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : data ? (
            <>
              <div className="grid gap-4 md:grid-cols-4">
                <Card
                  title="Total estimated cost"
                  value={fmtUsd(data.totals.estimated_cost_usd)}
                  detail={formatRangeLabel(data.range.start, data.range.end)}
                />
                <Card title="Events" value={fmtNum(data.totals.events)} />
                <Card title="Input tokens" value={fmtNum(data.totals.input_tokens)} />
                <Card title="Output tokens" value={fmtNum(data.totals.output_tokens)} />
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <TrendChart
                  title="Usage by Route"
                  description={`Top routes over time by event count (${data.range.granularity === 'hour' ? 'hourly' : 'daily'}).`}
                  points={data.time_series.routes.points}
                  series={data.time_series.routes.keys}
                  config={routeChartConfig}
                />
                <TrendChart
                  title="Usage by Feature"
                  description={`Top features over time by event count (${data.range.granularity === 'hour' ? 'hourly' : 'daily'}).`}
                  points={data.time_series.features.points}
                  series={data.time_series.features.keys}
                  config={featureChartConfig}
                />
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <BucketTable title="By Feature" rows={data.by_feature} />
                <BucketTable title="By Route" rows={data.by_route} />
                <BucketTable title="By Model" rows={data.by_model} />
                <BucketTable title="By User" rows={data.by_user} />
              </div>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <h2 className="text-lg font-medium text-slate-950">Recent events</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Filter to high-cost requests and sort this event list by cost or token volume.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <label className="text-sm text-slate-600">
                      Min cost (USD)
                      <Input
                        className="mt-1 w-full sm:w-40"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        type="number"
                        value={recentMinCost}
                        onChange={(e) => setRecentMinCost(e.target.value)}
                      />
                    </label>
                    <label className="text-sm text-slate-600">
                      Sort by
                      <select
                        className="mt-1 flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-400 sm:w-52"
                        value={recentSortMode}
                        onChange={(e) => setRecentSortMode(e.target.value as RecentSortMode)}
                      >
                        <option value="when_desc">Most recent</option>
                        <option value="cost_desc">Highest cost</option>
                        <option value="input_desc">Most input tokens</option>
                        <option value="output_desc">Most output tokens</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">When</th>
                        <th className="px-3 py-2 font-medium">User</th>
                        <th className="px-3 py-2 font-medium">Feature</th>
                        <th className="px-3 py-2 font-medium">Route</th>
                        <th className="px-3 py-2 font-medium">Model</th>
                        <th className="px-3 py-2 font-medium">Cost</th>
                        <th className="px-3 py-2 font-medium">Input</th>
                        <th className="px-3 py-2 font-medium">Output</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRecent.length ? (
                        filteredRecent.map((row) => (
                          <tr key={row.id} className="border-t border-slate-100">
                            <td className="px-3 py-2 text-slate-600">{new Date(row.created_at).toLocaleString()}</td>
                            <td className="px-3 py-2 text-slate-900">{row.user_email ?? 'unknown'}</td>
                            <td className="px-3 py-2 text-slate-900">{row.feature}</td>
                            <td className="px-3 py-2 text-slate-600">{row.route}</td>
                            <td className="px-3 py-2 text-slate-600">{row.model}</td>
                            <td className="px-3 py-2 text-slate-900">{fmtUsd(row.estimated_cost_usd)}</td>
                            <td className="px-3 py-2 text-slate-600">{fmtNum(row.input_tokens)}</td>
                            <td className="px-3 py-2 text-slate-600">{fmtNum(row.output_tokens)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr className="border-t border-slate-100">
                          <td className="px-3 py-6 text-sm text-slate-500" colSpan={8}>
                            No recent events match the current cost filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : null}

        </div>
      </main>
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

function TrendChart({
  title,
  description,
  points,
  series,
  config,
}: {
  title: string;
  description: string;
  points: SeriesPoint[];
  series: SeriesKey[];
  config: ChartConfig;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-medium text-slate-950">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
      {series.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
          No usage events found for this range.
        </div>
      ) : (
        <ChartContainer className="mt-4 h-80 w-full" config={config}>
          <LineChart data={points} margin={{ left: 12, right: 12, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="bucket_label"
              minTickGap={24}
              tickLine={false}
              tickMargin={8}
            />
            <YAxis allowDecimals={false} axisLine={false} tickLine={false} tickMargin={8} />
            <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
            {series.map((item, index) => (
              <Line
                key={item.key}
                dataKey={item.key}
                dot={false}
                stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                strokeWidth={2}
                type="monotone"
              />
            ))}
          </LineChart>
        </ChartContainer>
      )}
      {series.length > 0 ? <SeriesLegend series={series} /> : null}
    </section>
  );
}

function SeriesLegend({ series }: { series: SeriesKey[] }) {
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
      {series.map((item, index) => (
        <div
          key={item.key}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
          />
          <span className="min-w-0 truncate">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function BucketTable({ title, rows }: { title: string; rows: Bucket[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-medium text-slate-950">{title}</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Key</th>
              <th className="px-3 py-2 font-medium">Cost</th>
              <th className="px-3 py-2 font-medium">Events</th>
              <th className="px-3 py-2 font-medium">Input</th>
              <th className="px-3 py-2 font-medium">Output</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-slate-100">
                <td className="px-3 py-2 text-slate-900">{row.key}</td>
                <td className="px-3 py-2 text-slate-900">{fmtUsd(row.estimated_cost_usd)}</td>
                <td className="px-3 py-2 text-slate-600">{fmtNum(row.events)}</td>
                <td className="px-3 py-2 text-slate-600">{fmtNum(row.input_tokens)}</td>
                <td className="px-3 py-2 text-slate-600">{fmtNum(row.output_tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
