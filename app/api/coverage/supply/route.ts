/**
 * POST /api/coverage/supply → addressable-supply ceilings per ICP for the
 * Coverage feasibility check.
 *
 * For each of the user's ICPs: count the Apollo company universe
 * (pagination.total_entries — a COUNT, ~0.1 credits, never an enrich), subtract
 * held companies, and convert to a net-new contact ceiling via
 * estimateIcpSupply(). Returns [{ icpId, sourceableContacts, universeCompanies,
 * netNewCompanies, estimate }].
 *
 * CREDIT-SPENDING — invoked ONLY on an explicit user action (the "Check supply"
 * button on /coverage), never on page load. Body may carry observed
 * contacts/company per ICP (from the icp-cards the page already holds) to make
 * the contact estimate ICP-specific.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { estimateIcpSupply, ICP_SUPPLY_SELECT } from '@/lib/coverage/supply';
import type { AcquisitionIcp } from '@/lib/data-acquisition/search-spec';

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    contactsPerCompany?: Record<string, number>;
  };
  const cpcByIcp = body.contactsPerCompany ?? {};

  const { data: icpRows, error: icpErr } = await supabase
    .from('icps')
    .select(ICP_SUPPLY_SELECT)
    .eq('user_id', user.id);
  if (icpErr) {
    return NextResponse.json({ error: 'Failed to load ICPs', detail: icpErr.message }, { status: 500 });
  }
  const icps = (icpRows ?? []) as AcquisitionIcp[];
  if (!icps.length) return NextResponse.json({ supply: [] });

  // Held company counts per ICP (RLS-scoped) — the dedupe subtrahend.
  const { data: companyRows, error: coErr } = await supabase
    .from('user_companies')
    .select('company_id, matched_icp_id')
    .eq('user_id', user.id)
    .not('matched_icp_id', 'is', null);
  if (coErr) {
    return NextResponse.json({ error: 'Failed to load companies', detail: coErr.message }, { status: 500 });
  }
  const heldByIcp = new Map<string, number>();
  for (const row of companyRows ?? []) {
    const icpId = row.matched_icp_id as string | null;
    if (!icpId) continue;
    heldByIcp.set(icpId, (heldByIcp.get(icpId) ?? 0) + 1);
  }

  // One Apollo count per ICP, in parallel. Failures degrade to null (unknown).
  const supply = await Promise.all(
    icps.map((icp) =>
      estimateIcpSupply({
        icp,
        heldCompanies: heldByIcp.get(icp.id) ?? 0,
        contactsPerCompany: cpcByIcp[icp.id] ?? null,
      }),
    ),
  );

  return NextResponse.json({ supply });
}
