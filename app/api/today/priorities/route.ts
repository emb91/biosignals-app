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
import { computeSendOutreachPriority } from '@/lib/priorities/sources/send-outreach';
import { computeNewAccountsPriority } from '@/lib/priorities/sources/new-accounts';

const SEV_RANK: Record<PrioritySeverity, number> = { high: 3, medium: 2, low: 1 };

/**
 * Response contract:
 *   { cheap: TodayPriority[], icp: TodayPriority | null, icpUnchanged: boolean, icpHash: string }
 *
 * Two tiers, for cost reasons:
 * - `cheap` sources (send-outreach, …) are heuristic DB queries with NO LLM. They run
 *   on EVERY request so a fresh draft / new account shows immediately. They are NOT
 *   gated on any hash.
 * - `icp` is the Claude ICP audit. It is gated on its OWN inputs-hash so that a draft
 *   being sent (or any non-ICP change) never triggers a paid re-audit. When the client's
 *   cached `icpHash` still matches, the server skips the Claude call and sets
 *   `icpUnchanged: true`; the client keeps its cached icp row.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const knownIcpHash = searchParams.get('h') ?? '';

    // Run the (cheap) icp-audit inputs-hash alongside the cheap sources. No LLM yet.
    const [icpHash, cheapResults] = await Promise.all([
      getIcpAuditHash(supabase, user.id),
      Promise.all([
        computeSendOutreachPriority(supabase, user.id),
        computeNewAccountsPriority(supabase, user.id),
        // Future cheap sources:
        // computeEnrichmentFailures(supabase, user.id),
      ]),
    ]);

    const cheap: TodayPriority[] = cheapResults
      .filter((p): p is TodayPriority => p !== null)
      .sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);

    // Only pay for the Claude audit when its inputs actually moved.
    const icpUnchanged = Boolean(knownIcpHash) && knownIcpHash === icpHash;
    const icp = icpUnchanged
      ? null
      : await computeIcpAuditPriorities(supabase, user.id, user.email).then(groupIcpAuditForToday);

    return NextResponse.json({ cheap, icp, icpUnchanged, icpHash });
  } catch (err) {
    console.error('[today/priorities] failed:', err);
    return NextResponse.json(
      { cheap: [] satisfies TodayPriority[], icp: null, icpUnchanged: false, icpHash: '' },
      { status: 200 },
    );
  }
}
