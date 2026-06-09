/**
 * GET  /api/coverage/target            → the current (or ?period=YYYY-Qn) GTM target
 *   { period, target: { type, value } | null, updatedAt, history: [{period, type, value}] }
 * PUT  /api/coverage/target            → upsert the target for a period
 *   body { period?, type: 'revenue'|'deals', value: number }
 *
 * One row per (user, period) in `gtm_targets` (RLS auth.uid()=user_id). The
 * overall target is the ONLY thing the rep sets — the allocation engine
 * (lib/coverage/allocation.ts) splits it across ICPs. `history` returns prior
 * periods for the attainment trend on the Coverage page.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { quarterOf, isValidPeriod } from '@/lib/coverage/period';

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

  return NextResponse.json({
    period,
    target: current ? { type: current.target_type, value: Number(current.target_value) } : null,
    updatedAt: current?.updated_at ?? null,
    history: rows.map((r) => ({
      period: r.period,
      type: r.target_type,
      value: Number(r.target_value),
    })),
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
