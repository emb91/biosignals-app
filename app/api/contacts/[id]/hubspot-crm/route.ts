import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

type RouteParams = { id: string };

export async function GET(
  _request: Request,
  { params }: { params: Promise<RouteParams> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .select('id, email, company_id, resolved_current_company_name, resolved_current_company_domain')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (contactError) {
    return NextResponse.json({ error: 'Failed to load contact.' }, { status: 500 });
  }

  if (!contact) {
    return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });
  }

  const normalizedEmail = typeof contact.email === 'string' ? contact.email.trim().toLowerCase() : null;
  const { data: contactLinks, error: linksError } = await supabase
    .from('crm_deal_contact_links')
    .select('hubspot_deal_id, hubspot_contact_id, hubspot_contact_email, hubspot_contact_name, arcova_contact_id, raw_payload, synced_at')
    .eq('user_id', user.id)
    .or(
      normalizedEmail
        ? `arcova_contact_id.eq.${contact.id},hubspot_contact_email.eq.${normalizedEmail}`
        : `arcova_contact_id.eq.${contact.id}`
    );

  if (linksError) {
    return NextResponse.json({ error: 'Failed to load HubSpot CRM context.' }, { status: 500 });
  }

  const dedupedLinks = Array.from(
    new Map((contactLinks ?? []).map((row) => [String(row.hubspot_deal_id), row])).values()
  );
  const dealIds = dedupedLinks.map((row) => String(row.hubspot_deal_id)).filter(Boolean);

  if (dealIds.length === 0) {
    return NextResponse.json({
      data: {
        contact_id: contact.id,
        arcova_company_id: contact.company_id,
        arcova_company_name: contact.resolved_current_company_name,
        arcova_company_domain: contact.resolved_current_company_domain,
        deals: [],
      },
    });
  }

  const [{ data: deals, error: dealsError }, { data: companyLinks, error: companyLinksError }] = await Promise.all([
    supabase
      .from('crm_deals')
      .select('hubspot_deal_id, deal_name, deal_stage, amount, close_date, hs_lastmodifieddate, synced_at')
      .eq('user_id', user.id)
      .in('hubspot_deal_id', dealIds),
    supabase
      .from('crm_deal_company_links')
      .select('hubspot_deal_id, hubspot_company_name, hubspot_company_domain, arcova_company_id, raw_payload')
      .eq('user_id', user.id)
      .in('hubspot_deal_id', dealIds),
  ]);

  if (dealsError || companyLinksError) {
    return NextResponse.json({ error: 'Failed to load mirrored HubSpot deals.' }, { status: 500 });
  }

  const dealsById = new Map((deals ?? []).map((row) => [String(row.hubspot_deal_id), row]));
  const companyLinkByDealId = new Map((companyLinks ?? []).map((row) => [String(row.hubspot_deal_id), row]));

  const crmDeals = dealIds
    .map((dealId) => {
      const deal = dealsById.get(dealId);
      const dealContact = dedupedLinks.find((row) => String(row.hubspot_deal_id) === dealId);
      const companyLink = companyLinkByDealId.get(dealId);
      if (!deal) return null;

      const companyPayload = (companyLink?.raw_payload ?? {}) as Record<string, unknown>;
      const matchedArcovaContactIds = Array.isArray(companyPayload.matched_arcova_contact_ids)
        ? companyPayload.matched_arcova_contact_ids
        : [];
      const matchedArcovaCompanyIds = Array.isArray(companyPayload.matched_arcova_company_ids)
        ? companyPayload.matched_arcova_company_ids
        : [];

      return {
        hubspot_deal_id: dealId,
        deal_name: deal.deal_name,
        deal_stage: deal.deal_stage,
        amount: deal.amount,
        close_date: deal.close_date,
        hs_lastmodifieddate: deal.hs_lastmodifieddate,
        synced_at: deal.synced_at,
        hubspot_company_name: companyLink?.hubspot_company_name ?? null,
        hubspot_company_domain: companyLink?.hubspot_company_domain ?? null,
        arcova_company_id: companyLink?.arcova_company_id ?? null,
        resolution_status:
          typeof companyPayload.resolution_status === 'string' ? companyPayload.resolution_status : null,
        resolution_suppressed: companyPayload.resolution_suppressed === true || companyPayload.resolution_suppressed === 'true',
        mismatch_reason:
          typeof companyPayload.mismatch_reason === 'string' ? companyPayload.mismatch_reason : null,
        matched_arcova_contact_ids: matchedArcovaContactIds,
        matched_arcova_company_ids: matchedArcovaCompanyIds,
        hubspot_contact_id: dealContact?.hubspot_contact_id ?? null,
        hubspot_contact_email: dealContact?.hubspot_contact_email ?? null,
        hubspot_contact_name: dealContact?.hubspot_contact_name ?? null,
        pushed_arcova_contact_id:
          typeof (dealContact?.raw_payload as Record<string, unknown> | null)?.arcova_contact_id === 'string'
            ? (dealContact?.raw_payload as Record<string, unknown>).arcova_contact_id
            : null,
        pushed_arcova_company_id:
          typeof (dealContact?.raw_payload as Record<string, unknown> | null)?.arcova_company_id === 'string'
            ? (dealContact?.raw_payload as Record<string, unknown>).arcova_company_id
            : null,
        pushed_arcova_company_name:
          typeof (dealContact?.raw_payload as Record<string, unknown> | null)?.arcova_company_name === 'string'
            ? (dealContact?.raw_payload as Record<string, unknown>).arcova_company_name
            : null,
        pushed_arcova_company_domain:
          typeof (dealContact?.raw_payload as Record<string, unknown> | null)?.arcova_company_domain === 'string'
            ? (dealContact?.raw_payload as Record<string, unknown>).arcova_company_domain
            : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aTime = a?.hs_lastmodifieddate ? new Date(a.hs_lastmodifieddate).getTime() : 0;
      const bTime = b?.hs_lastmodifieddate ? new Date(b.hs_lastmodifieddate).getTime() : 0;
      return bTime - aTime;
    });

  return NextResponse.json({
    data: {
      contact_id: contact.id,
      arcova_company_id: contact.company_id,
      arcova_company_name: contact.resolved_current_company_name,
      arcova_company_domain: contact.resolved_current_company_domain,
      deals: crmDeals,
    },
  });
}
