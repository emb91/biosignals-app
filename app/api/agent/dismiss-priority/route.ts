/**
 * POST /api/agent/dismiss-priority { id, source }
 *
 * Records that a user has dismissed a server-side priority. Used by the agent inbox on
 * /company-criteria when the user clicks the X on a priority card. Server-side `compute*`
 * functions for each source filter dismissed ids out before returning anything, so /today
 * and the source page stay in sync — the moment a card is dismissed, the corresponding
 * /today row also disappears on next fetch.
 *
 * Upsert semantics: dismissing the same id twice is a no-op.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({})) as { id?: unknown; source?: unknown };
    const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
    const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim() : '';
    if (!id || !source) {
      return NextResponse.json({ error: 'id and source are required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('agent_priority_dismissals')
      .upsert(
        { user_id: user.id, priority_id: id, source, dismissed_at: new Date().toISOString() },
        { onConflict: 'user_id,priority_id' },
      );

    if (error) {
      console.error('[dismiss-priority] upsert failed:', error);
      return NextResponse.json({ error: 'Failed to record dismissal' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[dismiss-priority] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
