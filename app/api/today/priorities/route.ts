/**
 * GET /api/today/priorities
 *
 * Aggregator for the /today priorities list. Every source is now a CHEAP DB read with
 * NO LLM call — including the ICP row, which just reads the note the /icps audit left
 * (see lib/priorities/sources/icp-note). So /today never triggers a Claude call; the
 * audit runs only on the /icps side. Sources run in parallel; one TodayPriority per
 * source-bucket, sorted by severity.
 *
 * Roadmap (TODO): pipeline-health, hubspot-sync, stale Ready queue, import-ready. As
 * each migrates here the equivalent local logic in /today/page.tsx can be deleted.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import type { PrioritySeverity, TodayPriority } from '@/lib/priorities/types';
import { computeSendOutreachPriority } from '@/lib/priorities/sources/send-outreach';
import { computeNewAccountsPriority } from '@/lib/priorities/sources/new-accounts';
import {
  computeContactPriorityChanges,
  computeAccountPriorityChanges,
} from '@/lib/priorities/sources/priority-changes';
import { computeIcpNotePriority } from '@/lib/priorities/sources/icp-note';
import { computeInviteTeamPriority } from '@/lib/priorities/sources/invite-team';
import { computeEnrichmentFailuresPriority } from '@/lib/priorities/sources/enrichment-failures';

const SEV_RANK: Record<PrioritySeverity, number> = { high: 3, medium: 2, low: 1 };

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const results = await Promise.all([
      computeSendOutreachPriority(supabase, user.id),
      computeNewAccountsPriority(supabase, user.id),
      computeContactPriorityChanges(supabase, user.id),
      computeAccountPriorityChanges(supabase, user.id),
      // Reads the note the /icps audit left — no LLM on /today.
      computeIcpNotePriority(supabase, user.id),
      // Nudge a solo owner/admin to invite teammates.
      computeInviteTeamPriority(supabase, user.id),
      computeEnrichmentFailuresPriority(supabase, user.id),
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
