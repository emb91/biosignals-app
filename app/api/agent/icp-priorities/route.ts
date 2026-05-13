/**
 * POST /api/agent/icp-priorities
 *
 * Returns the raw individual ICP-audit priorities for the agent inbox on `/icps`.
 * The Claude call + JSON validation are factored into `lib/priorities/sources/icp-audit` so
 * the /today aggregator (which only needs the grouped count) can share the same code path.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  computeIcpAuditPriorities,
  type IcpPriority,
} from '@/lib/priorities/sources/icp-audit';

export type { IcpPriority, IcpPriorityKind, IcpPrioritySeverity } from '@/lib/priorities/sources/icp-audit';

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const priorities = await computeIcpAuditPriorities(supabase, user.id, user.email);
    return NextResponse.json({ priorities });
  } catch (err) {
    console.error('[icp-priorities] failed:', err);
    return NextResponse.json({ priorities: [] satisfies IcpPriority[] }, { status: 200 });
  }
}
