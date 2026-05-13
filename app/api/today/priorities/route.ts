/**
 * GET /api/today/priorities
 *
 * Aggregator for everything the /today priorities list should surface. Calls each priority
 * source in parallel and returns one grouped TodayPriority per source-bucket. Sources plug
 * in here without /today/page.tsx ever needing to know about them.
 *
 * Each priority is one row on /today regardless of how many underlying findings it
 * represents — group at this layer so the agenda stays clean.
 *
 * Current sources:
 * - icp-audit: collapses 1-3 individual ICP findings into one "Review your ICPs · N" row
 *
 * Roadmap (TODO): enrichment-failures, pipeline-health, hubspot-sync exceptions, stale Ready
 * queue, import-ready. As each migrates here, the equivalent local logic in /today/page.tsx
 * can be deleted.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import type { PrioritySeverity, TodayPriority } from '@/lib/priorities/types';
import {
  computeIcpAuditPriorities,
  groupIcpAuditForToday,
} from '@/lib/priorities/sources/icp-audit';

const SEV_RANK: Record<PrioritySeverity, number> = { high: 3, medium: 2, low: 1 };

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Each source runs in parallel. New sources slot into this list — they need to return
    // a TodayPriority | null (null = nothing to surface). Heuristic sources can be added
    // without an LLM cost; LLM sources should manage their own cache.
    const results = await Promise.all([
      computeIcpAuditPriorities(supabase, user.id, user.email).then(groupIcpAuditForToday),
      // Future sources go here:
      // computeEnrichmentFailures(supabase, user.id),
      // computePipelineHealth(supabase, user.id),
      // computeStaleReadyQueue(supabase, user.id),
    ]);

    const priorities: TodayPriority[] = results
      .filter((p): p is TodayPriority => p !== null)
      .sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);

    return NextResponse.json({ priorities });
  } catch (err) {
    console.error('[today/priorities] failed:', err);
    return NextResponse.json({ priorities: [] satisfies TodayPriority[] }, { status: 200 });
  }
}
