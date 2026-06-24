import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { orgIdForUser, scopeIcpsToUser } from '@/lib/org-context';
import {
  effectiveReadiness,
  getLeadActionFromFits,
  isMonitorOrReachOutAction,
} from '@/lib/lead-action';
import { listActiveCompanyStateForUser } from '@/lib/org-company-state';

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

    const orgId = await orgIdForUser(supabase, user.id);

    const companyStateRows = await listActiveCompanyStateForUser(
      supabase as any,
      user.id,
      'company_id, matched_icp_id, company_fit_score, readiness_score',
    );
    const stateByCompanyId = new Map<
      string,
      { matched_icp_id: string | null; company_fit_score: number | null; readiness_score: number | null }
    >();
    for (const r of companyStateRows as Array<{
      company_id: string;
      matched_icp_id: string | null;
      company_fit_score: number | null;
      readiness_score: number | null;
    }>) {
      stateByCompanyId.set(r.company_id, {
        matched_icp_id: r.matched_icp_id,
        company_fit_score: r.company_fit_score,
        readiness_score: r.readiness_score,
      });
    }

    const icpToCompanies = new Map<string, Set<string>>();
    const uncategorizedCompanies = new Set<string>();

    for (const row of contactRows ?? []) {
      const companyId = row.company_id as string | null;
      if (!companyId) continue;
      const companyState = stateByCompanyId.get(companyId);
      if (!companyState) continue;

      const contactReadiness =
        typeof row.readiness_score === 'number' && Number.isFinite(row.readiness_score)
          ? row.readiness_score
          : null;
      const contactFit =
        typeof row.contact_fit_score === 'number' && Number.isFinite(row.contact_fit_score)
          ? row.contact_fit_score
          : null;
      const action = getLeadActionFromFits(
        companyState.company_fit_score,
        contactFit,
        effectiveReadiness(companyState.readiness_score, contactReadiness),
      );
      if (!isMonitorOrReachOutAction(action)) continue;

      const icpId =
        typeof companyState.matched_icp_id === 'string' && companyState.matched_icp_id.length > 0
          ? companyState.matched_icp_id
          : null;

      if (icpId) {
        if (!icpToCompanies.has(icpId)) icpToCompanies.set(icpId, new Set());
        icpToCompanies.get(icpId)!.add(companyId);
      } else {
        uncategorizedCompanies.add(companyId);
      }
    }

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
