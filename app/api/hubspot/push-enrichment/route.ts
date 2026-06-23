import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getNangoAccessToken, HUBSPOT_INTEGRATION_ID } from '@/lib/nango';
import { looksLikeEmail } from '@/lib/contact-emails';
import {
  ensureArcovaHubSpotProperties,
  batchUpsertContacts,
  getContactAssociatedCompanyIds,
  batchUpdateCompanies,
  batchReadContactsByEmail,
  resolveOrgNangoConnectionId,
} from '@/lib/hubspot';
import { ensureBaselineSnapshot } from '@/lib/backup/hubspot-snapshot';
import { getActionFromScores, effectiveReadiness, formatLeadActionLabel } from '@/lib/lead-action';
import { resolveEffectivePriority } from '@/lib/effective-priority';
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
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Org-scoped: use the org's HubSpot connection (one per org).
    const connectionId = await resolveOrgNangoConnectionId(supabase, user.id, HUBSPOT_INTEGRATION_ID);

    if (!connectionId) {
      return NextResponse.json({ error: 'HubSpot not connected' }, { status: 400 });
    }

    let accessToken: string;
    try {
      accessToken = await getNangoAccessToken(HUBSPOT_INTEGRATION_ID, connectionId);
    } catch (e) {
      const nangoMsg: string =
        (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? '';
      const msg = nangoMsg || 'Failed to get HubSpot token';
      return NextResponse.json({ error: msg, code: 'token_error' }, { status: 400 });
    }

    const admin = createAdminClient();

    // SAFETY GATE: never write into a customer's HubSpot until an immutable baseline backup of
    // their account exists. If the vault can't be written, refuse the push.
    const baseline = await ensureBaselineSnapshot(admin, { userId: user.id, accessToken });
    if (!baseline.ok) {
      return NextResponse.json(
        { error: `Backup not ready, push blocked to protect your CRM: ${baseline.reason}`, code: 'backup_required' },
        { status: 503 },
      );
    }

    const { data: leads, error: leadsError } = await admin
      .from('contacts')
      .select(`
        id, email, first_name, last_name, job_title, seniority_level, business_area, source, created_at,
        contact_fit_score, readiness_score, priority_score, crm_is_suppressed,
        overall_fit_score, contact_bio, linkedin_url,
        company_id,
        upload_batches(filename, created_at),
        companies(
          id,
          domain,
          company_name,
          modalities, therapeutic_areas, development_stages,
          company_type, platform_category, bio_summary,
          industry, employee_count, founded_year, headquarters_city, headquarters_state, headquarters_country,
          linkedin_url, funding_stage, funding_status_label, total_funding_usd
        )
      `)
      .eq('user_id', user.id);

    if (leadsError) {
      console.error('HubSpot push - failed to fetch leads:', leadsError);
      return NextResponse.json({ error: 'Failed to fetch leads', detail: leadsError.message }, { status: 500 });
    }

    if (!leads?.length) {
      return NextResponse.json({ upserted: 0, skipped: 0, errors: 0 });
    }

    type SkippedContact = { name: string; company: string | null; reason: string };
    const skippedContacts: SkippedContact[] = [];
    const syncableLeads = leads.filter((lead) => {
      const trimmedEmail = lead.email?.trim() ?? '';
      const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unknown';
      const company = (lead.companies as any)?.company_name ?? null;

      if (!trimmedEmail) {
        skippedContacts.push({ name, company, reason: 'No email address' });
        return false;
      }
      if (!looksLikeEmail(trimmedEmail)) {
        skippedContacts.push({
          name,
          company,
          reason: 'Email looks invalid. Update it to something like name@company.com.',
        });
        return false;
      }
      return true;
    });

    if (!syncableLeads.length) {
      return NextResponse.json({
        contacts: { upserted: 0, errors: 0, errorDetails: [] },
        companies: { updated: 0, errors: 0, errorDetails: [] },
        total: 0,
        skipped: skippedContacts.length,
        skippedContacts,
      });
    }

    await ensureArcovaHubSpotProperties(accessToken);

    // Company-level scores (fit / readiness / priority) live on user_companies
    // post-Phase-1d, NOT on companies. Build a per-company score map for this
    // user so the contact + company pushes can read them.
    const leadCompanyIds = [
      ...new Set(
        syncableLeads
          .map((l) => (l as { company_id?: string | null }).company_id)
          .filter((v): v is string => typeof v === 'string' && Boolean(v)),
      ),
    ];
    const companyScoreById = new Map<
      string,
      { fit: number | null; readiness: number | null; priority: number | null; crmIsSuppressed: boolean }
    >();
    if (leadCompanyIds.length > 0) {
      const { data: ucRows } = await admin
        .from('user_companies')
        .select('company_id, company_fit_score, readiness_score, priority_score, crm_is_suppressed')
        .eq('user_id', user.id)
        .in('company_id', leadCompanyIds);
      for (const r of (ucRows ?? []) as Array<{
        company_id: string;
        company_fit_score: number | null;
        readiness_score: number | null;
        priority_score: number | null;
        crm_is_suppressed: boolean | null;
      }>) {
        companyScoreById.set(r.company_id, {
          fit: r.company_fit_score,
          readiness: r.readiness_score,
          priority: r.priority_score,
          crmIsSuppressed: r.crm_is_suppressed === true,
        });
      }
    }

    const enrichedAt = new Date().toISOString().slice(0, 10);
    const upserts: Array<{ email: string; properties: Record<string, string> }> = [];

    for (const lead of syncableLeads) {
      const contactFit = typeof lead.contact_fit_score === 'number' ? lead.contact_fit_score : null;
      const overallFit = lead.overall_fit_score ?? null;
      const contactReadiness = typeof lead.readiness_score === 'number' ? lead.readiness_score : null;
      const leadCompanyId = (lead as { company_id?: string | null }).company_id ?? null;
      const actionScores = leadCompanyId ? companyScoreById.get(leadCompanyId) : undefined;
      const intrinsicReadiness = effectiveReadiness(
        actionScores?.readiness ?? null,
        contactReadiness,
      );
      const contactPriority = resolveEffectivePriority({
        intrinsicPriority: typeof lead.priority_score === 'number' ? lead.priority_score : null,
        companyFit: actionScores?.fit ?? null,
        contactFit,
        intrinsicReadiness,
        crmIsSuppressed: lead.crm_is_suppressed === true,
      });
      const action = formatLeadActionLabel(
        getActionFromScores(
          actionScores?.fit ?? null,
          contactFit,
          contactPriority.effectiveReadiness,
          contactPriority.isSuppressed ? 'dormant' : null,
        ),
      );

      const props: Record<string, string> = {
        arcova_action: action,
        arcova_enriched: 'true',
        arcova_enriched_at: enrichedAt,
        arcova_contact_id: lead.id,
      };
      const provenance = resolveContactDataProvenance({
        upload_batches: (lead as any).upload_batches,
        created_at: typeof lead.created_at === 'string' ? lead.created_at : null,
        source: typeof lead.source === 'string' ? lead.source : null,
      });
      props.arcova_data_sourced_from = formatDataSourceLabel(provenance.channels);

      if (overallFit !== null) props.arcova_overall_fit_score = fmt(overallFit);
      if (contactFit !== null) props.arcova_contact_fit_score = fmt(contactFit);
      if (contactReadiness !== null) props.arcova_contact_readiness_score = fmt(contactReadiness);
      if (contactPriority.effectivePriority !== null) {
        props.arcova_contact_priority_score = fmt(contactPriority.effectivePriority);
      }
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
      const company = lead.companies as any;
      if (company?.id) props.arcova_company_id = company.id;
      if (company?.company_name) props.arcova_company_name = company.company_name;
      if (company?.domain) props.arcova_company_domain = company.domain;

      upserts.push({ email: lead.email!.toLowerCase(), properties: props });
    }

    const contactResult = await batchUpsertContacts(accessToken, upserts);

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
      const coScores = co?.id ? companyScoreById.get(co.id) : undefined;
      const companyPriority = resolveEffectivePriority({
        intrinsicPriority: coScores?.priority ?? null,
        companyFit: coScores?.fit ?? null,
        intrinsicReadiness: coScores?.readiness ?? 0,
        crmIsSuppressed: coScores?.crmIsSuppressed ?? false,
      });
      if (coScores?.fit != null) props.arcova_company_fit_score = fmt(coScores.fit);
      if (coScores?.readiness != null) props.arcova_company_readiness_score = fmt(coScores.readiness);
      if (companyPriority.effectivePriority != null) {
        props.arcova_company_priority_score = fmt(companyPriority.effectivePriority);
      }
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
      : { updated: 0, errors: 0, errorDetails: [] };

    const { data: existingLog } = await supabase
      .from('hubspot_sync_log')
      .select('auto_pull_at, auto_pull_count')
      .eq('user_id', user.id)
      .maybeSingle();

    await Promise.all([
      supabase.from('hubspot_sync_log').upsert({
        user_id: user.id,
        synced_at: new Date().toISOString(),
        contacts_synced: contactResult.upserted,
        contacts_errors: contactResult.errors,
        contacts_skipped: skippedContacts.length,
        skipped_contacts: skippedContacts,
        last_error_details: contactResult.errorDetails,
        auto_pull_at: existingLog?.auto_pull_at ?? null,
        auto_pull_count: existingLog?.auto_pull_count ?? null,
      }, { onConflict: 'user_id' }),
      supabase.from('hubspot_sync_events').insert({
        user_id: user.id,
        event_type: 'push',
        contacts_synced: contactResult.upserted,
        contacts_errors: contactResult.errors,
        contacts_skipped: skippedContacts.length,
        skipped_contacts: skippedContacts,
        error_details: contactResult.errorDetails,
        companies_updated: companyResult.updated,
      }),
    ]);

    return NextResponse.json({
      contacts: contactResult,
      companies: companyResult,
      total: upserts.length,
      skipped: skippedContacts.length,
      skippedContacts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'HubSpot push failed.';
    console.error('HubSpot push route error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
