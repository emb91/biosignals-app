import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { isAdminEmail } from '@/lib/admin-access';

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
    const days = Math.max(1, Math.min(90, Number(url.searchParams.get('days') ?? '30') || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('llm_usage_events')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5000);

    if (error) {
      throw error;
    }

    const rows = (data ?? []) as UsageRow[];

    const totals = rows.reduce(
      (acc, row) => {
        acc.events += 1;
        acc.input_tokens += row.input_tokens ?? 0;
        acc.output_tokens += row.output_tokens ?? 0;
        acc.cache_creation_input_tokens += row.cache_creation_input_tokens ?? 0;
        acc.cache_read_input_tokens += row.cache_read_input_tokens ?? 0;
        acc.estimated_cost_usd += row.estimated_cost_usd ?? 0;
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
            acc[bucket].estimated_cost_usd += row.estimated_cost_usd ?? 0;
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
      totals,
      by_feature: byKey('feature').slice(0, 20),
      by_route: byKey('route').slice(0, 20),
      by_model: byKey('model').slice(0, 20),
      by_user: byKey('user_email').slice(0, 20),
      recent: rows.slice(0, 100),
    });
  } catch (error) {
    console.error('[admin/llm-usage] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

