import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { isAdminEmail } from '@/lib/admin-access';
import { estimateAnthropicUsageCostUsd } from '@/lib/llm-usage';

type UsageRow = {
  id: string;
  user_id: string | null;
  user_email: string | null;
  provider: string;
  feature: string;
  route: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  estimated_cost_usd: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function estimatedRowCost(row: UsageRow): number {
  return (
    estimateAnthropicUsageCostUsd(row.model, {
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cache_creation_input_tokens: row.cache_creation_input_tokens,
      cache_read_input_tokens: row.cache_read_input_tokens,
    }) ?? 0
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_RANGE_DAYS = 90;
const MAX_SERIES = 5;

function parseDateParam(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addMs(date: Date, amount: number): Date {
  return new Date(date.getTime() + amount);
}

function bucketStartFor(createdAt: string, granularity: 'hour' | 'day'): Date {
  const date = new Date(createdAt);
  if (granularity === 'hour') {
    date.setUTCMinutes(0, 0, 0);
    return date;
  }
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function formatBucketLabel(date: Date, granularity: 'hour' | 'day'): string {
  return granularity === 'hour'
    ? date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        timeZone: 'UTC',
      })
    : date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
}

function makeSeriesKey(prefix: string, index: number): string {
  return `${prefix}_${index + 1}`;
}

function buildTimeSeries(
  rows: UsageRow[],
  bucketKey: 'route' | 'feature',
  start: Date,
  endExclusive: Date,
  granularity: 'hour' | 'day'
) {
  const totals = rows.reduce<Record<string, number>>((acc, row) => {
    const label = row[bucketKey] || 'unknown';
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});

  const topLabels = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SERIES)
    .map(([label]) => label);

  const series = topLabels.map((label, index) => ({
    key: makeSeriesKey(bucketKey, index),
    label,
  }));

  const seriesByLabel = new Map(series.map((item) => [item.label, item.key]));
  const pointsByBucket = new Map<string, Record<string, number>>();

  for (const row of rows) {
    const label = row[bucketKey] || 'unknown';
    const seriesKey = seriesByLabel.get(label);
    if (!seriesKey) continue;

    const bucketStart = bucketStartFor(row.created_at, granularity);
    const bucketIso = bucketStart.toISOString();
    const point = pointsByBucket.get(bucketIso) ?? {};
    point[seriesKey] = (point[seriesKey] ?? 0) + 1;
    pointsByBucket.set(bucketIso, point);
  }

  const step = granularity === 'hour' ? HOUR_MS : DAY_MS;
  const points: Array<{ bucket_start: string; bucket_label: string } & Record<string, number | string>> = [];

  for (let cursor = new Date(start); cursor < endExclusive; cursor = addMs(cursor, step)) {
    const bucketStart = granularity === 'hour' ? bucketStartFor(cursor.toISOString(), 'hour') : bucketStartFor(cursor.toISOString(), 'day');
    const bucketIso = bucketStart.toISOString();
    const values = pointsByBucket.get(bucketIso) ?? {};
    const point: { bucket_start: string; bucket_label: string } & Record<string, number | string> = {
      bucket_start: bucketIso,
      bucket_label: formatBucketLabel(bucketStart, granularity),
    };
    for (const item of series) {
      point[item.key] = values[item.key] ?? 0;
    }
    points.push(point);
  }

  return {
    keys: series,
    points,
  };
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdminEmail(user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(request.url);
    const startParam = parseDateParam(url.searchParams.get('start'));
    const endParam = parseDateParam(url.searchParams.get('end'));

    let start = startParam;
    let endInclusive = endParam;

    if (!start || !endInclusive) {
      const days = Math.max(1, Math.min(MAX_RANGE_DAYS, Number(url.searchParams.get('days') ?? '30') || 30));
      endInclusive = new Date();
      endInclusive.setUTCHours(0, 0, 0, 0);
      start = addMs(endInclusive, -(days - 1) * DAY_MS);
    }

    if (start > endInclusive) {
      [start, endInclusive] = [endInclusive, start];
    }

    const days = Math.floor((endInclusive.getTime() - start.getTime()) / DAY_MS) + 1;
    if (days > MAX_RANGE_DAYS) {
      return NextResponse.json({ error: `Date range cannot exceed ${MAX_RANGE_DAYS} days` }, { status: 400 });
    }

    const endExclusive = addMs(endInclusive, DAY_MS);
    const granularity = days <= 2 ? 'hour' : 'day';

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('llm_usage_events')
      .select('*')
      .gte('created_at', start.toISOString())
      .lt('created_at', endExclusive.toISOString())
      .order('created_at', { ascending: false })
      .limit(5000);

    if (error) {
      throw error;
    }

    const rows = (data ?? []) as UsageRow[];

    const totals = rows.reduce(
      (acc, row) => {
        const rowCost = estimatedRowCost(row);
        acc.events += 1;
        acc.input_tokens += row.input_tokens ?? 0;
        acc.output_tokens += row.output_tokens ?? 0;
        acc.cache_creation_input_tokens += row.cache_creation_input_tokens ?? 0;
        acc.cache_read_input_tokens += row.cache_read_input_tokens ?? 0;
        acc.estimated_cost_usd += rowCost;
        return acc;
      },
      {
        events: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        estimated_cost_usd: 0,
      }
    );

    const byKey = <K extends 'feature' | 'route' | 'model' | 'user_email'>(key: K) =>
      Object.values(
        rows.reduce<Record<string, { key: string; events: number; estimated_cost_usd: number; input_tokens: number; output_tokens: number }>>(
          (acc, row) => {
            const bucket = String(row[key] ?? (key === 'user_email' ? 'unknown' : 'unknown'));
            if (!acc[bucket]) {
              acc[bucket] = {
                key: bucket,
                events: 0,
                estimated_cost_usd: 0,
                input_tokens: 0,
                output_tokens: 0,
              };
            }
            acc[bucket].events += 1;
            acc[bucket].estimated_cost_usd += estimatedRowCost(row);
            acc[bucket].input_tokens += row.input_tokens ?? 0;
            acc[bucket].output_tokens += row.output_tokens ?? 0;
            return acc;
          },
          {}
        )
      ).sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd || b.events - a.events);

    return NextResponse.json({
      ok: true,
      days,
      range: {
        start: toDateInputValue(start),
        end: toDateInputValue(endInclusive),
        granularity,
      },
      totals,
      by_feature: byKey('feature').slice(0, 20),
      by_route: byKey('route').slice(0, 20),
      by_model: byKey('model').slice(0, 20),
      by_user: byKey('user_email').slice(0, 20),
      time_series: {
        routes: buildTimeSeries(rows, 'route', start, endExclusive, granularity),
        features: buildTimeSeries(rows, 'feature', start, endExclusive, granularity),
      },
      recent: rows.slice(0, 500).map((row) => ({
        ...row,
        estimated_cost_usd: estimatedRowCost(row),
      })),
    });
  } catch (error) {
    console.error('[admin/llm-usage] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
