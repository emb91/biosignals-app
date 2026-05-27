import { createClient } from '@supabase/supabase-js';

function buildCompanyFitSummary(companyName, fitScore, icpName, matchedOn) {
  const label = (companyName && String(companyName).trim()) || 'This company';
  const score01 = Number.isFinite(fitScore) ? Math.max(0, Math.min(1, fitScore)) : 0;
  const scorePct = Math.round(score01 * 100);
  const icpLabel = (icpName && String(icpName).trim()) || 'the best-matching ICP';
  const matched = Array.isArray(matchedOn)
    ? matchedOn.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const matchedText =
    matched.length > 0 ? matched.join(', ').toLowerCase() : 'limited criteria overlap';

  if (score01 <= 0.001) {
    return `${label} has no ICP fit winner yet, so company fit is low. Define or update ICP criteria to score this account.`;
  }

  return `${label} is currently ${scorePct}% aligned to ${icpLabel}. The strongest fit evidence is ${matchedText}.`;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: companies, error: companiesError } = await supabase
    .from('companies')
    .select('id,user_id,company_name,matched_icp_id,company_fit_score,company_fit_breakdown');

  if (companiesError) throw companiesError;
  if (!companies || companies.length === 0) {
    console.log('No companies found.');
    return;
  }

  const icpIds = [...new Set(companies.map((c) => c.matched_icp_id).filter(Boolean))];
  let icpNameById = new Map();
  if (icpIds.length > 0) {
    const { data: icps, error: icpsError } = await supabase
      .from('icps')
      .select('id,name')
      .in('id', icpIds);
    if (icpsError) throw icpsError;
    icpNameById = new Map((icps || []).map((row) => [row.id, row.name || null]));
  }

  let companiesUpdated = 0;
  let userCompaniesUpdated = 0;

  for (const company of companies) {
    const breakdown = company.company_fit_breakdown && typeof company.company_fit_breakdown === 'object'
      ? company.company_fit_breakdown
      : null;
    const matchedOn = Array.isArray(breakdown?.matched_on) ? breakdown.matched_on : [];
    const summary = buildCompanyFitSummary(
      company.company_name,
      company.company_fit_score,
      company.matched_icp_id ? icpNameById.get(company.matched_icp_id) : null,
      matchedOn,
    );

    const { error: companyUpdateError } = await supabase
      .from('companies')
      .update({ company_fit_summary: summary })
      .eq('id', company.id)
      .eq('user_id', company.user_id);
    if (companyUpdateError) throw companyUpdateError;
    companiesUpdated += 1;

    const { error: userCompanyUpdateError } = await supabase
      .from('user_companies')
      .update({ company_fit_summary: summary })
      .eq('company_id', company.id)
      .eq('user_id', company.user_id);
    if (!userCompanyUpdateError) {
      userCompaniesUpdated += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        companiesUpdated,
        userCompaniesUpdated,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

