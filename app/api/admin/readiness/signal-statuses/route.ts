import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { isAdminEmail } from '@/lib/admin-access';

const TEST_SOURCES = new Set([
  'admin_signals_test_page',
  'admin_seed_test_signals',
]);

export async function GET() {
  try {
    const auth = await createClient();
    const {
      data: { user },
      error: authError,
    } = await auth.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isAdminEmail(user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('normalized_signals')
      .select(`
        signal_key,
        source_event:signal_source_events!inner(
          source
        )
      `)
      .eq('user_id', user.id)
      .limit(5000);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const statusBySignal: Record<string, 'active' | 'partial' | 'not_executed'> = {};

    for (const row of data ?? []) {
      const signalKey = typeof (row as any)?.signal_key === 'string' ? (row as any).signal_key : null;
      const source = typeof (row as any)?.source_event?.source === 'string' ? (row as any).source_event.source : null;
      if (!signalKey || !source) continue;

      const current = statusBySignal[signalKey] ?? 'not_executed';
      if (!TEST_SOURCES.has(source)) {
        statusBySignal[signalKey] = 'active';
      } else if (current !== 'active') {
        statusBySignal[signalKey] = 'partial';
      }
    }

    return NextResponse.json({ statusBySignal });
  } catch (error) {
    console.error('[admin/readiness/signal-statuses] error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

