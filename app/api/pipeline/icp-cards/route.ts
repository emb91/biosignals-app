import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  PIPELINE_MIN_COMPANIES_FOR_ASSESSMENT,
  comparePipelineCards,
  contactFitHealth,
  coverageHealth,
  depthHealth,
  normalizeFitScore01,
  overallHealth,
} from '@/lib/pipeline-icp-health';
import { computeCoverageRollup } from '@/lib/coverage/icp-performance';
import { quarterOf } from '@/lib/coverage/period';

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

    const { data: icpRows, error: icpErr } = await supabase
      .from('icps')
      .select('id, name, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (icpErr) {
      console.error('[pipeline/icp-cards] icps', icpErr);
      return NextResponse.json({ error: 'Failed to load ICPs' }, { status: 500 });
    }

    const { data: companyRows, error: coErr } = await supabase
      .from('user_companies')
      .select('company_id, matched_icp_id, company_fit_score')
      .eq('user_id', user.id);

    if (coErr) {
      console.error('[pipeline/icp-cards] companies', coErr);
      return NextResponse.json({ error: 'Failed to load companies' }, { status: 500 });
    }

    const { data: contactRows, error: ctErr } = await supabase
      .from('contacts')
      .select('company_id, contact_fit_score')
      .eq('user_id', user.id)
      .not('company_id', 'is', null);

    if (ctErr) {
      console.error('[pipeline/icp-cards] contacts', ctErr);
      return NextResponse.json({ error: 'Failed to load contacts' }, { status: 500 });
    }

    const orderedIcps = (icpRows || []) as Array<{ id: string; name: string | null; created_at: string }>;
    const indexById = new Map(orderedIcps.map((r, index) => [r.id, index + 1]));

    const labelFor = (icpId: string): string => {
      const row = orderedIcps.find((r) => r.id === icpId);
      if (!row) return 'ICP';
      const idx = indexById.get(row.id);
      if (idx != null && row.name?.trim()) return `ICP ${idx}: ${row.name}`;
      if (row.name?.trim()) return row.name;
      return idx != null ? `ICP ${idx}` : 'ICP';
    };

    const companiesByIcp = new Map<string, Set<string>>();
    for (const row of companyRows || []) {
      const icpId = row.matched_icp_id as string | null;
      if (!icpId || typeof row.company_id !== 'string') continue;
      if (!companiesByIcp.has(icpId)) companiesByIcp.set(icpId, new Set());
      companiesByIcp.get(icpId)!.add(row.company_id);
    }

    const contactsByCompany = new Map<string, { contactCount: number; fitValues: number[] }>();
    for (const row of contactRows || []) {
      const cid = row.company_id as string | null;
      if (!cid) continue;
      const fit = normalizeFitScore01(
        typeof row.contact_fit_score === 'number' ? row.contact_fit_score : null,
      );
      if (!contactsByCompany.has(cid)) {
        contactsByCompany.set(cid, { contactCount: 0, fitValues: [] });
      }
      const agg = contactsByCompany.get(cid)!;
      agg.contactCount += 1;
      if (fit != null) agg.fitValues.push(fit);
    }

    const companyFitById = new Map<string, number | null>();
    for (const row of companyRows || []) {
      const id = row.company_id as string;
      const raw = row.company_fit_score as number | null | undefined;
      companyFitById.set(id, normalizeFitScore01(typeof raw === 'number' ? raw : null));
    }

    // Bottom-up: per-ICP deal performance + whole-book rollup from the CRM
    // mirror (null-safe — empty when no HubSpot data, so the page degrades to
    // the coverage-only tier).
    const period = quarterOf();
    const rollup = await computeCoverageRollup(supabase, user.id, period);
    const performanceByIcp = rollup.byIcp;

    const cards = orderedIcps.map((icp) => {
      const companyIds = [...(companiesByIcp.get(icp.id) ?? [])];
      const company_count = companyIds.length;

      const companyFitSamples: number[] = [];
      for (const cid of companyIds) {
        const f = companyFitById.get(cid);
        if (f != null) companyFitSamples.push(f);
      }
      const avg_company_fit =
        companyFitSamples.length > 0
          ? companyFitSamples.reduce((s, v) => s + v, 0) / companyFitSamples.length
          : null;

      const fitSamples: number[] = [];
      let contactTotal = 0;
      for (const cid of companyIds) {
        const agg = contactsByCompany.get(cid);
        if (!agg) continue;
        contactTotal += agg.contactCount;
        fitSamples.push(...agg.fitValues);
      }

      const avg_contact_fit =
        fitSamples.length > 0 ? fitSamples.reduce((s, v) => s + v, 0) / fitSamples.length : null;

      const avg_contacts_per_company =
        company_count > 0 ? contactTotal / company_count : null;

      const coverage = coverageHealth(company_count);
      const contact_fit = contactFitHealth(avg_contact_fit);
      const depth = depthHealth(avg_contacts_per_company);
      const overall = overallHealth(coverage, contact_fit, depth);

      return {
        icp_id: icp.id,
        icp_index: indexById.get(icp.id) ?? 0,
        label: labelFor(icp.id),
        company_count,
        avg_company_fit,
        contact_count: contactTotal,
        avg_contact_fit,
        avg_contacts_per_company,
        thin_data: company_count < PIPELINE_MIN_COMPANIES_FOR_ASSESSMENT,
        coverage,
        contact_fit,
        depth,
        overall,
        // Bottom-up deal performance (null when no CRM deals mapped to this ICP).
        performance: performanceByIcp.get(icp.id) ?? null,
      };
    });

    cards.sort(comparePipelineCards);

    return NextResponse.json({
      cards,
      // Whole-book CRM meta the per-ICP cards can't carry: data-coverage of the
      // deals themselves (unattributed) + period actuals for attainment pacing.
      meta: {
        period,
        hasCrm: rollup.totalDeals > 0,
        totalDeals: rollup.totalDeals,
        attributedDeals: rollup.attributedDeals,
        unattributed: rollup.unattributed,
        actuals: rollup.actuals,
      },
    });
  } catch (e) {
    console.error('[pipeline/icp-cards]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
