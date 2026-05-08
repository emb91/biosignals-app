import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { nango, HUBSPOT_INTEGRATION_ID } from '@/lib/nango';
import {
  ensureArcovaHubSpotProperties,
  batchUpsertContacts,
  getContactAssociatedCompanyIds,
  batchUpdateCompanies,
  batchReadContactsByEmail,
} from '@/lib/hubspot';
import { getLeadAction, formatLeadActionLabel } from '@/lib/lead-action';
import { formatDataSourceLabel, resolveContactDataProvenance } from '@/lib/data-provenance';

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  return (Math.round(n * 1000) / 1000).toString();
}

function fmtList(arr: string[] | null | undefined): string {
  if (!arr?.length) return '';
  return arr.join('; ');
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: conn } = await supabase
    .from('nango_connections')
    .select('nango_connection_id')
    .eq('user_id', user.id)
    .eq('integration_id', HUBSPOT_INTEGRATION_ID)
    .single();

  if (!conn?.nango_connection_id) {
    return NextResponse.json({ error: 'HubSpot not connected' }, { status: 400 });
  }

  let accessToken: string;
  try {
    accessToken = await nango.getToken(HUBSPOT_INTEGRATION_ID, conn.nango_connection_id) as string;
  } catch {
    return NextResponse.json({ error: 'Failed to get HubSpot token' }, { status: 400 });
  }

  // Fetch ALL leads — use admin client to bypass RLS on the companies join
  const admin = createAdminClient();
  const { data: leads, error: leadsError } = await admin
    .from('contacts')
    .select(`
      id, email, first_name, last_name, job_title, seniority_level, business_area, source, created_at,
      contact_fit_score, intent_score, overall_fit_score, contact_bio, linkedin_url,
      upload_batches(filename, created_at),
      companies(
        company_name,
        company_fit_score, modalities, therapeutic_areas, development_stages,
        company_type, platform_category, bio_summary,
        industry, employee_count, founded_year, headquarters_city, headquarters_state, headquarters_country,
        linkedin_url, funding_stage, funding_status_label, total_funding_usd
      )
    `)
    .eq('user_id', user.id);

  if (leadsError) {
    console.error('HubSpot push — failed to fetch leads:', leadsError);
    return NextResponse.json({ error: 'Failed to fetch leads', detail: leadsError.message }, { status: 500 });
  }

  if (!leads?.length) {
    return NextResponse.json({ upserted: 0, skipped: 0, errors: 0 });
  }

  // Split into syncable and skipped
  type SkippedContact = { name: string; company: string | null; reason: string };
  const skippedContacts: SkippedContact[] = [];
  const syncableLeads = leads.filter((lead) => {
    if (!lead.email || lead.email.trim() === '') {
      const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unknown';
      const company = (lead.companies as any)?.company_name ?? null;
      skippedContacts.push({ name, company, reason: 'No email address' });
      return false;
    }
    return true;
  });

  if (!syncableLeads.length) {
    return NextResponse.json({ contacts: { upserted: 0, errors: 0 }, companies: { updated: 0, errors: 0 }, total: 0, skipped: skippedContacts.length, skippedContacts });
  }

  await ensureArcovaHubSpotProperties(accessToken);

  const enrichedAt = new Date().toISOString().slice(0, 10);

  const upserts: Array<{ email: string; properties: Record<string, string> }> = [];

  for (const lead of syncableLeads) {
    const contactFit = typeof lead.contact_fit_score === 'number' ? lead.contact_fit_score : null;
    const overallFit = lead.overall_fit_score ?? null;
    const action = formatLeadActionLabel(getLeadAction(lead));

    const props: Record<string, string> = {
      arcova_action: action,
      arcova_enriched: 'true',
      arcova_enriched_at: enrichedAt,
    };
    const provenance = resolveContactDataProvenance({
      upload_batches: (lead as any).upload_batches,
      created_at: typeof lead.created_at === 'string' ? lead.created_at : null,
      source: typeof lead.source === 'string' ? lead.source : null,
    });
    props.arcova_data_sourced_from = formatDataSourceLabel(provenance.channels);

    if (overallFit !== null) props.arcova_overall_fit_score = fmt(overallFit);
    if (contactFit !== null) props.arcova_contact_fit_score = fmt(contactFit);
    if (lead.seniority_level) props.arcova_seniority = lead.seniority_level;
    if (lead.business_area) props.arcova_function = lead.business_area;
    props.arcova_enriched_email = lead.email!;

    const personSummary = Array.isArray(lead.contact_bio)
      ? (lead.contact_bio as string[]).filter(Boolean).join(' ')
      : (lead.contact_bio as string | null) ?? '';
    if (personSummary) props.arcova_person_summary = personSummary;
    if (lead.linkedin_url) props.arcova_linkedin_url = lead.linkedin_url;
    if (lead.linkedin_url) props.hs_linkedin_url = lead.linkedin_url;
    if (lead.job_title) props.jobtitle = lead.job_title;

    upserts.push({ email: lead.email!.toLowerCase(), properties: props });
  }

  const contactResult = await batchUpsertContacts(accessToken, upserts);

  // Resolve HubSpot contact IDs to update associated companies
  const emails = upserts.map((u) => u.email);
  const hubspotContacts = await batchReadContactsByEmail(accessToken, emails);

  const emailToLead = new Map(syncableLeads.map((l) => [l.email!.toLowerCase(), l]));
  const hubspotContactToLead = new Map(
    hubspotContacts
      .map((c) => {
        const email = c.properties.email?.toLowerCase();
        const lead = email ? emailToLead.get(email) : undefined;
        return lead ? ([c.id, lead] as const) : null;
      })
      .filter((x): x is [string, typeof syncableLeads[number]] => x !== null)
  );

  const matchedIds = [...hubspotContactToLead.keys()];
  const contactToCompany = await getContactAssociatedCompanyIds(accessToken, matchedIds);

  const companyUpdates: Array<{ id: string; properties: Record<string, string> }> = [];
  const seenCompanyIds = new Set<string>();

  for (const [contactId, companyId] of contactToCompany.entries()) {
    if (seenCompanyIds.has(companyId)) continue;
    seenCompanyIds.add(companyId);

    const lead = hubspotContactToLead.get(contactId);
    if (!lead) continue;

    const co = lead.companies as any;
    if (!co) continue;

    const props: Record<string, string> = {};
    const companyFit = co?.company_fit_score ?? null;
    if (companyFit !== null) props.arcova_company_fit_score = fmt(companyFit);
    if (co.modalities?.length) props.arcova_modalities = fmtList(co.modalities);
    if (co.therapeutic_areas?.length) props.arcova_therapeutic_areas = fmtList(co.therapeutic_areas);
    if (co.development_stages?.length) props.arcova_development_stages = fmtList(co.development_stages);
    if (co.company_type) props.arcova_company_type = co.company_type;
    if (co.platform_category) props.arcova_platform_category = co.platform_category;
    if (co.bio_summary) props.arcova_bio_summary = co.bio_summary;
    if (co.industry) props.arcova_industry = co.industry;
    if (co.employee_count != null) props.arcova_employee_count = String(co.employee_count);
    if (co.founded_year != null) props.arcova_founded_year = String(co.founded_year);
    if (co.headquarters_city) props.arcova_hq_city = co.headquarters_city;
    if (co.headquarters_state) props.arcova_hq_state = co.headquarters_state;
    if (co.headquarters_country) props.arcova_hq_country = co.headquarters_country;
    if (co.linkedin_url) props.arcova_linkedin_url = co.linkedin_url;
    if (co.funding_stage) props.arcova_funding_stage = co.funding_stage;
    if (co.funding_status_label) props.arcova_funding_status = co.funding_status_label;
    if (co.total_funding_usd != null) props.arcova_total_funding_usd = String(co.total_funding_usd);

    if (Object.keys(props).length > 0) {
      companyUpdates.push({ id: companyId, properties: props });
    }
  }

  const companyResult = companyUpdates.length > 0
    ? await batchUpdateCompanies(accessToken, companyUpdates)
    : { updated: 0, errors: 0 };

  const { data: existingLog } = await supabase
    .from('hubspot_sync_log')
    .select('auto_pull_at, auto_pull_count')
    .eq('user_id', user.id)
    .maybeSingle();

  // Persist sync log (keep last pull stats from daily cron when push runs alone)
  await supabase.from('hubspot_sync_log').upsert({
    user_id: user.id,
    synced_at: new Date().toISOString(),
    contacts_synced: contactResult.upserted,
    contacts_errors: contactResult.errors,
    contacts_skipped: skippedContacts.length,
    skipped_contacts: skippedContacts,
    auto_pull_at: existingLog?.auto_pull_at ?? null,
    auto_pull_count: existingLog?.auto_pull_count ?? null,
  }, { onConflict: 'user_id' });

  return NextResponse.json({
    contacts: contactResult,
    companies: companyResult,
    total: upserts.length,
    skipped: skippedContacts.length,
    skippedContacts,
  });
}
