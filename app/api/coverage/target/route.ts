/**
 * GET  /api/coverage/target            → the current (or ?period=YYYY-Qn) GTM target
 *   { period, target: { type, value } | null, updatedAt,
 *     history: [{period, type, value, attained, attainmentPct}] }
 * PUT  /api/coverage/target            → upsert the target for a period
 *   body { period?, type: 'revenue'|'deals', value: number }
 *
 * One row per (user, period) in `gtm_targets` (RLS auth.uid()=user_id). The
 * overall target is the ONLY thing the rep sets — the allocation engine
 * (lib/coverage/allocation.ts) splits it across ICPs. `history` returns prior
 * periods for the attainment trend on the Coverage page: each entry carries
 * `attained` (closed-won USD for revenue targets, closed-won deal count for
 * deals targets, scoped to that period's quarter) and `attainmentPct`.
 * Closed-won deals are fetched ONCE and bucketed by quarter in JS, using the
 * same closed-won predicate as the rollup so numbers agree across the page.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { quarterOf, isValidPeriod } from '@/lib/coverage/period';
import { isWon } from '@/lib/coverage/icp-performance';

type TargetType = 'revenue' | 'deals';
const MAX_VALUE = 1_000_000_000; // $1B / 1B deals — generous sanity ceiling

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const periodParam = url.searchParams.get('period');
  const period = periodParam && isValidPeriod(periodParam) ? periodParam : quarterOf();

  const { data, error } = await supabase
    .from('gtm_targets')
    .select('period, target_type, target_value, updated_at')
    .eq('user_id', user.id)
    .order('period', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Failed to load target', detail: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{
    period: string;
    target_type: TargetType;
    target_value: number;
    updated_at: string;
  }>;
  const current = rows.find((r) => r.period === period) ?? null;

  // Closed-won attainment per quarter, computed from ONE deals query and
  // bucketed in JS. Users without a CRM simply have no rows here, so every
  // period attains 0 (the UI copy handles meaning).
  const wonByQuarter = new Map<string, { usd: number; count: number }>();
  if (rows.length > 0) {
    const { data: dealRows } = await supabase
      .from('crm_deals')
      .select('deal_stage, amount, close_date')
      .eq('user_id', user.id)
      .not('close_date', 'is', null);
    for (const d of (dealRows ?? []) as Array<{
      deal_stage: string | null;
      amount: number | null;
      close_date: string | null;
    }>) {
      if (!isWon(d.deal_stage) || !d.close_date) continue;
      const closedAt = new Date(d.close_date);
      if (!Number.isFinite(closedAt.getTime())) continue;
      const q = quarterOf(closedAt);
      const bucket = wonByQuarter.get(q) ?? { usd: 0, count: 0 };
      bucket.usd += typeof d.amount === 'number' && Number.isFinite(d.amount) ? d.amount : 0;
      bucket.count += 1;
      wonByQuarter.set(q, bucket);
    }
  }

  return NextResponse.json({
    period,
    target: current ? { type: current.target_type, value: Number(current.target_value) } : null,
    updatedAt: current?.updated_at ?? null,
    history: rows.map((r) => {
      const value = Number(r.target_value);
      const won = wonByQuarter.get(r.period);
      const attained = r.target_type === 'deals' ? (won?.count ?? 0) : (won?.usd ?? 0);
      return {
        period: r.period,
        type: r.target_type,
        value,
        attained,
        attainmentPct: value > 0 ? attained / value : null,
      };
    }),
  });
}

export async function PUT(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    period?: unknown;
    type?: unknown;
    value?: unknown;
  };

  const period =
    typeof body.period === 'string' && isValidPeriod(body.period) ? body.period : quarterOf();

  const type: TargetType = body.type === 'deals' ? 'deals' : 'revenue';

  const rawValue = typeof body.value === 'number' ? body.value : Number(body.value);
  if (!Number.isFinite(rawValue) || rawValue <= 0 || rawValue > MAX_VALUE) {
    return NextResponse.json({ error: 'Invalid target value' }, { status: 400 });
  }
  // Deals must be whole numbers; revenue can be fractional but we round to cents.
  const value = type === 'deals' ? Math.round(rawValue) : Math.round(rawValue * 100) / 100;

  const { error } = await supabase.from('gtm_targets').upsert(
    {
      user_id: user.id,
      period,
      target_type: type,
      target_value: value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,period' },
  );

  if (error) {
    return NextResponse.json({ error: 'Failed to save target', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, period, target: { type, value } });
}
