'use client';

import AppSidebar from '@/components/AppSidebar';
import { useAuth } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

type Bucket = {
  key: string;
  events: number;
  estimated_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
};

type UsageResponse = {
  ok: boolean;
  days: number;
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

function fmtUsd(value: number | null | undefined): string {
  const n = typeof value === 'number' ? value : 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function fmtNum(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export default function AdminLlmUsagePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<UsageResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const days = useMemo(() => {
    const raw = Number(searchParams.get('days') ?? '30');
    return Number.isFinite(raw) ? Math.max(1, Math.min(90, raw)) : 30;
  }, [searchParams]);

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
        const res = await fetch(`/api/admin/llm-usage?days=${days}`);
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
  }, [days, user]);

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
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">LLM Usage</h1>
            <p className="mt-2 text-sm text-slate-500">
              Internal admin view of Anthropic usage by feature, route, model, and user.
            </p>
          </div>

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
                <Card title={`Estimated cost (${data.days}d)`} value={fmtUsd(data.totals.estimated_cost_usd)} />
                <Card title="Events" value={fmtNum(data.totals.events)} />
                <Card title="Input tokens" value={fmtNum(data.totals.input_tokens)} />
                <Card title="Output tokens" value={fmtNum(data.totals.output_tokens)} />
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <BucketTable title="By Feature" rows={data.by_feature} />
                <BucketTable title="By Route" rows={data.by_route} />
                <BucketTable title="By Model" rows={data.by_model} />
                <BucketTable title="By User" rows={data.by_user} />
              </div>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-medium text-slate-950">Recent events</h2>
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
                      {data.recent.map((row) => (
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
                      ))}
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

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
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

