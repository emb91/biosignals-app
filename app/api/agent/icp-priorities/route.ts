/**
 * POST /api/agent/icp-priorities
 *
 * Returns the raw individual ICP-audit priorities for the agent inbox on `/icps`.
 * The Claude call + JSON validation are factored into `lib/priorities/sources/icp-audit` so
 * the /today aggregator (which only needs the grouped count) can share the same code path.
 *
 * Hash-based short-circuit:
 *   Client sends `{ knownHash?: string }` from its cached entry.
 *   Server computes the current ICP-set hash (cheap — just SQL + a string hash, no LLM).
 *   If the hash matches `knownHash`, the audit is skipped and the response signals
 *   `{ unchanged: true }` so the client keeps its cached priorities.
 *   Only when the hash differs (or the client has no cache yet) do we run the Claude call.
 *
 * This kills the most expensive failure mode: re-running a full Sonnet/Haiku audit every
 * time someone reloads /icps or /today, even when nothing has changed since the last run.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  computeIcpAuditPriorities,
  getIcpAuditHash,
  type IcpPriority,
} from '@/lib/priorities/sources/icp-audit';

export type { IcpPriority, IcpPriorityKind, IcpPrioritySeverity } from '@/lib/priorities/sources/icp-audit';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({})) as { knownHash?: string; forceRefresh?: boolean };
    const knownHash = typeof body.knownHash === 'string' ? body.knownHash : '';
    const forceRefresh = body.forceRefresh === true;

    const currentHash = await getIcpAuditHash(supabase, user.id);

    // If the client already has fresh-enough data and the inputs haven't changed, skip
    // the Claude call entirely. The client keeps its cached priorities for this hash.
    if (!forceRefresh && knownHash && knownHash === currentHash) {
      return NextResponse.json({ unchanged: true, hash: currentHash });
    }

    const priorities = await computeIcpAuditPriorities(supabase, user.id, user.email);
    return NextResponse.json({ priorities, hash: currentHash });
  } catch (err) {
    console.error('[icp-priorities] failed:', err);
    return NextResponse.json({ priorities: [] satisfies IcpPriority[] }, { status: 200 });
  }
}
