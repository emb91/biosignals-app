import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getLatestReasonSnapshot } from '@/lib/signals/readiness-store';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const reason = await getLatestReasonSnapshot(supabase, user.id, id);
    return NextResponse.json({ reason: reason ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
