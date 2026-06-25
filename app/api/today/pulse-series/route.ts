import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { orgIdForUser } from '@/lib/org-context';

/** Pulse sparkline counts for Today page (GET /api/today/pulse-series). */
const DAYS = 28;

type RawRow = {
  observed_at: string;
  event_at: string | null;
  signal_key: string;
  company_id: string | null;
  contact_id: string | null;
  companies: { company_name: string } | null;
  source_event: {
    source_event_id: string | null;
    source_url: string | null;
    title: string | null;
  } | null;
};

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
    const orgId = await orgIdForUser(supabase as any, user.id);
    const readClient = orgId ? createAdminClient() : supabase;
    let visibleUserIds = [user.id];
    if (orgId) {
      const { data: memberRows, error: memberErr } = await readClient
        .from('org_members')
        .select('user_id')
        .eq('org_id', orgId);
      if (memberErr) {
        console.error('[GET /api/today/pulse-series] org member lookup', memberErr);
        return NextResponse.json({ error: 'Failed to load pulse series' }, { status: 500 });
      }
      visibleUserIds = [
        ...new Set((memberRows ?? [])
          .map((row: any) => (typeof row.user_id === 'string' ? row.user_id : null))
          .filter((value): value is string => Boolean(value))),
      ];
      if (!visibleUserIds.includes(user.id)) visibleUserIds.push(user.id);
    }

    const endUtc = new Date();
    endUtc.setUTCHours(0, 0, 0, 0);
    const startUtc = new Date(endUtc);
    startUtc.setUTCDate(startUtc.getUTCDate() - (DAYS - 1));

    // normalized_signals is the authoritative signals store (the old `signals`
    // table is empty). Join companies so we can label signals in the hover tooltip.
    const { data: rows, error } = await readClient
      .from('normalized_signals')
      .select('observed_at, event_at, signal_key, company_id, contact_id, companies(company_name), source_event:signal_source_events!inner(source_event_id, source_url, title)')
      .in('user_id', visibleUserIds)
      .gte('observed_at', startUtc.toISOString())
      .order('observed_at', { ascending: true });

    if (error) {
      console.error('[GET /api/today/pulse-series]', error);
      return NextResponse.json({ error: 'Failed to load pulse series' }, { status: 500 });
    }

    const counts = new Array<number>(DAYS).fill(0);
    // Collect up to 5 signal examples per day for the hover tooltip
    const perDayTop: Array<Array<{ signalKey: string; companyName: string | null }>> =
      Array.from({ length: DAYS }, () => []);
    const DAY_MS = 86_400_000;
    const seenSignals = new Set<string>();

    for (const r of (rows as unknown as RawRow[]) ?? []) {
      const logicalSourceId =
        r.source_event?.source_event_id
        ?? r.source_event?.source_url
        ?? r.source_event?.title
        ?? '';
      const key = [
        r.signal_key,
        r.company_id ?? '',
        r.contact_id ?? '',
        logicalSourceId,
      ].join('|');
      if (seenSignals.has(key)) continue;
      seenSignals.add(key);
      // Use event_at (when the signal actually happened) if available, else observed_at
      const raw = r.event_at ?? r.observed_at;
      const t =
        typeof raw === 'string' ? new Date(raw).getTime() : NaN;
      if (!Number.isFinite(t)) continue;
      // Bin to the UTC day it falls in relative to startUtc
      const dayUtc = new Date(t);
      dayUtc.setUTCHours(0, 0, 0, 0);
      const ix = Math.round((dayUtc.getTime() - startUtc.getTime()) / DAY_MS);
      if (ix >= 0 && ix < DAYS) {
        counts[ix] += 1;
        const dayTop = perDayTop[ix]!;
        if (dayTop.length < 5) {
          dayTop.push({
            signalKey: r.signal_key,
            companyName: (r.companies as { company_name: string } | null)?.company_name ?? null,
          });
        }
      }
    }

    // Build the per-day breakdown array (one entry per calendar day in the window)
    const breakdown = perDayTop.map((top, i) => {
      const d = new Date(startUtc.getTime() + i * DAY_MS);
      return {
        date: d.toISOString().slice(0, 10), // "YYYY-MM-DD"
        count: counts[i]!,
        top,
      };
    });

    return NextResponse.json({ data: counts, breakdown });
  } catch (e) {
    console.error('[GET /api/today/pulse-series]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
