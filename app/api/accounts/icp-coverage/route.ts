import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { orgIdForUser, scopeIcpsToUser } from '@/lib/org-context';
import {
  getLeadAction,
  isMonitorOrReachOutAction,
  type LeadLikeForAction,
} from '@/lib/lead-action';

/**
 * Per ICP: count distinct companies that have at least one contact whose recommended
 * action is Monitor, Source, or Reach out (not Deprioritise), using the same rules as getLeadAction.
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
      .select(
        'company_id, contact_fit_score, fit_score, readiness_score',
      )
      .eq('user_id', user.id)
      .is('archived_at', null)
      .not('company_id', 'is', null);

    if (error) {
      console.error('[icp-coverage] contacts:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // matched_icp_id + company_fit_score live on user_companies now
    // (Phase 1d moved them off the canonical companies table). Fetch the
    // per-user link rows separately and join in memory.
    const { data: ucRows, error: ucErr } = await supabase
      .from('user_companies')
      .select('company_id, matched_icp_id, company_fit_score')
      .eq('user_id', user.id)
      .is('archived_at', null);
    if (ucErr) {
      console.error('[icp-coverage] user_companies:', ucErr);
      return NextResponse.json({ error: ucErr.message }, { status: 500 });
    }
    const ucByCompanyId = new Map<string, { matched_icp_id: string | null; company_fit_score: number | null }>();
    for (const r of (ucRows ?? []) as Array<{ company_id: string; matched_icp_id: string | null; company_fit_score: number | null }>) {
      ucByCompanyId.set(r.company_id, {
        matched_icp_id: r.matched_icp_id,
        company_fit_score: r.company_fit_score,
      });
    }

    const icpToCompanies = new Map<string, Set<string>>();
    const uncategorizedCompanies = new Set<string>();

    for (const row of contactRows ?? []) {
      const companyId = row.company_id as string | null;
      if (!companyId) continue;
      const uc = ucByCompanyId.get(companyId);
      if (!uc) continue;

      const action = getLeadAction(row as LeadLikeForAction);
      if (!isMonitorOrReachOutAction(action)) continue;

      const icpId =
        typeof uc.matched_icp_id === 'string' && uc.matched_icp_id.length > 0
          ? uc.matched_icp_id
          : null;

      if (icpId) {
        if (!icpToCompanies.has(icpId)) icpToCompanies.set(icpId, new Set());
        icpToCompanies.get(icpId)!.add(companyId);
      } else {
        uncategorizedCompanies.add(companyId);
      }
    }

    const orgId = await orgIdForUser(supabase, user.id);
    const { data: icps, error: icpErr } = await scopeIcpsToUser(
      supabase.from('icps').select('id, name, created_at'),
      orgId,
      user.id,
    ).order('created_at', { ascending: false });

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
