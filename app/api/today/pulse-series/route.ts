import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

/** Pulse sparkline counts for Today page (GET /api/today/pulse-series). */
const DAYS = 28;

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const endUtc = new Date();
    endUtc.setUTCHours(0, 0, 0, 0);
    const startUtc = new Date(endUtc);
    startUtc.setUTCDate(startUtc.getUTCDate() - (DAYS - 1));

    // normalized_signals is the authoritative signals store (the old `signals`
    // table is empty). Join via user_companies so we only count signals for
    // this user's tracked accounts.
    const { data: rows, error } = await supabase
      .from('normalized_signals')
      .select('observed_at, event_at, company_id')
      .eq('user_id', user.id)
      .gte('observed_at', startUtc.toISOString())
      .order('observed_at', { ascending: true });

    if (error) {
      console.error('[GET /api/today/pulse-series]', error);
      return NextResponse.json({ error: 'Failed to load pulse series' }, { status: 500 });
    }

    const counts = new Array(DAYS).fill(0);
    const DAY_MS = 86_400_000;

    for (const r of rows ?? []) {
      // Use event_at (when the signal actually happened) if available, else observed_at
      const raw = r.event_at ?? r.observed_at;
      const t =
        typeof raw === 'string' ? new Date(raw).getTime() : raw instanceof Date ? raw.getTime() : NaN;
      if (!Number.isFinite(t)) continue;
      // Bin to the UTC day it falls in relative to startUtc
      const dayUtc = new Date(t);
      dayUtc.setUTCHours(0, 0, 0, 0);
      const ix = Math.round((dayUtc.getTime() - startUtc.getTime()) / DAY_MS);
      if (ix >= 0 && ix < DAYS) counts[ix] += 1;
    }

    return NextResponse.json({ data: counts });
  } catch (e) {
    console.error('[GET /api/today/pulse-series]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
