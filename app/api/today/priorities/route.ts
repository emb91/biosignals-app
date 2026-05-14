/**
 * GET /api/today/priorities
 *
 * Aggregator for everything the /today priorities list should surface. Calls each priority
 * source in parallel and returns one grouped TodayPriority per source-bucket.
 *
 * Hash-based short-circuit:
 *   Client passes `?h=<knownHash>` from its cached entry. Server computes the current
 *   audit-input hash (cheap — no LLM). If the hash matches, the aggregator skips the
 *   icp-audit source's Claude call and returns `{ unchanged: true }`. Client keeps its
 *   cached grouped priorities.
 *
 * Current sources:
 * - icp-audit: collapses 1-3 individual ICP findings into one "Review your ICPs" row
 *
 * Roadmap (TODO): enrichment-failures, pipeline-health, hubspot-sync, stale Ready queue,
 * import-ready. As each migrates here the equivalent local logic in /today/page.tsx can
 * be deleted.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import type { PrioritySeverity, TodayPriority } from '@/lib/priorities/types';
import {
  computeIcpAuditPriorities,
  getIcpAuditHash,
  groupIcpAuditForToday,
} from '@/lib/priorities/sources/icp-audit';

const SEV_RANK: Record<PrioritySeverity, number> = { high: 3, medium: 2, low: 1 };

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const knownHash = searchParams.get('h') ?? '';

    // Cheap hash check — no LLM. If the client's cached hash still matches the current
    // inputs, return `unchanged: true` so the client keeps its cached priorities.
    const currentHash = await getIcpAuditHash(supabase, user.id);
    if (knownHash && knownHash === currentHash) {
      return NextResponse.json({ unchanged: true, hash: currentHash });
    }

    // Each source runs in parallel. New heuristic sources can be added here without
    // additional LLM cost; LLM sources (icp-audit) should manage their own caching.
    const results = await Promise.all([
      computeIcpAuditPriorities(supabase, user.id, user.email).then(groupIcpAuditForToday),
      // Future sources:
      // computeEnrichmentFailures(supabase, user.id),
      // computePipelineHealth(supabase, user.id),
      // computeStaleReadyQueue(supabase, user.id),
    ]);

    const priorities: TodayPriority[] = results
      .filter((p): p is TodayPriority => p !== null)
      .sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);

    return NextResponse.json({ priorities, hash: currentHash });
  } catch (err) {
    console.error('[today/priorities] failed:', err);
    return NextResponse.json({ priorities: [] satisfies TodayPriority[] }, { status: 200 });
  }
}
