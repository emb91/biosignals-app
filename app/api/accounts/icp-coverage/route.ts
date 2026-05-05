import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  getLeadAction,
  isMonitorOrReachOutAction,
  type LeadLikeForAction,
} from '@/lib/lead-action';

/**
 * Per ICP: count distinct companies that have at least one contact classified as
 * Monitor or Reach out on the Leads page (same rules as getLeadAction).
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: contactRows, error } = await supabase
      .from('contacts')
      .select('company_id, contact_fit_score, fit_score, companies(id, company_fit_score, matched_icp_id)')
      .eq('user_id', user.id)
      .not('company_id', 'is', null);

    if (error) {
      console.error('[icp-coverage] contacts:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const icpToCompanies = new Map<string, Set<string>>();
    const uncategorizedCompanies = new Set<string>();

    for (const row of contactRows ?? []) {
      const companyId = row.company_id as string | null;
      if (!companyId) continue;

      const co = row.companies;
      const company = Array.isArray(co)
        ? (co[0] as { id: string; company_fit_score: number | null; matched_icp_id: string | null } | undefined)
        : (co as { id: string; company_fit_score: number | null; matched_icp_id: string | null } | null);
      if (!company?.id) continue;

      const action = getLeadAction(row as LeadLikeForAction);
      if (!isMonitorOrReachOutAction(action)) continue;

      const icpId =
        typeof company.matched_icp_id === 'string' && company.matched_icp_id.length > 0
          ? company.matched_icp_id
          : null;

      if (icpId) {
        if (!icpToCompanies.has(icpId)) icpToCompanies.set(icpId, new Set());
        icpToCompanies.get(icpId)!.add(companyId);
      } else {
        uncategorizedCompanies.add(companyId);
      }
    }

    const { data: icps, error: icpErr } = await supabase
      .from('icps')
      .select('id, name, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (icpErr) {
      console.error('[icp-coverage] icps:', icpErr);
      return NextResponse.json({ error: 'Failed to load ICPs' }, { status: 500 });
    }

    const ordered = (icps || []) as Array<{ id: string; name: string | null }>;
    const indexById = new Map(ordered.map((r, index) => [r.id, index + 1]));

    const labelFor = (icpId: string): string => {
      const row = ordered.find((r) => r.id === icpId);
      if (!row) return 'ICP';
      const idx = indexById.get(row.id);
      if (idx != null && row.name?.trim()) return `ICP ${idx}: ${row.name}`;
      if (row.name?.trim()) return row.name;
      return idx != null ? `ICP ${idx}` : 'ICP';
    };

    const rows = [...icpToCompanies.entries()]
      .map(([icp_id, set]) => ({
        icp_id,
        label: labelFor(icp_id),
        company_count: set.size,
      }))
      .filter((r) => r.company_count > 0)
      .sort((a, b) => b.company_count - a.company_count);

    return NextResponse.json({
      rows,
      uncategorized_company_count: uncategorizedCompanies.size,
    });
  } catch (e) {
    console.error('[icp-coverage]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
