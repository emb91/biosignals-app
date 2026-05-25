import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

type RouteParams = { id: string };

/**
 * Aggregate all HubSpot deals tied to any contact at this account (company).
 * Mirrors the per-contact endpoint at /api/contacts/[id]/hubspot-crm, but rolls
 * up across every contact on the company so the accounts side panel can show a
 * single "all the CRM activity for this account" view.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<RouteParams> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: company, error: companyError } = await supabase
    .from('companies')
    .select('id, company_name, domain')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (companyError) {
    return NextResponse.json({ error: 'Failed to load account.' }, { status: 500 });
  }
  if (!company) {
    return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  }

  const { data: contacts, error: contactsError } = await supabase
    .from('contacts')
    .select('id, email, full_name')
    .eq('user_id', user.id)
    .eq('company_id', id)
    .is('archived_at', null);

  if (contactsError) {
    return NextResponse.json({ error: 'Failed to load contacts for account.' }, { status: 500 });
  }

  const contactIds = (contacts ?? []).map((c) => c.id).filter(Boolean) as string[];
  const emails = (contacts ?? [])
    .map((c) => (typeof c.email === 'string' ? c.email.trim().toLowerCase() : null))
    .filter((v): v is string => Boolean(v));
  const contactById = new Map(
    (contacts ?? []).map((c) => [c.id, { full_name: c.full_name, email: c.email }] as const),
  );
  const contactByEmail = new Map(
    (contacts ?? [])
      .filter((c) => typeof c.email === 'string' && c.email.trim())
      .map((c) => [c.email!.trim().toLowerCase(), { id: c.id, full_name: c.full_name }] as const),
  );

  if (contactIds.length === 0 && emails.length === 0) {
    return NextResponse.json({
      data: {
        company_id: company.id,
        company_name: company.company_name,
        company_domain: company.domain,
        deals: [],
      },
    });
  }

  const [contactIdLinksResult, emailLinksResult] = await Promise.all([
    contactIds.length
      ? supabase
          .from('crm_deal_contact_links')
          .select(
            'hubspot_deal_id, hubspot_contact_id, hubspot_contact_email, hubspot_contact_name, arcova_contact_id, raw_payload, synced_at',
          )
          .eq('user_id', user.id)
          .in('arcova_contact_id', contactIds)
      : Promise.resolve({ data: [], error: null }),
    emails.length
      ? supabase
          .from('crm_deal_contact_links')
          .select(
            'hubspot_deal_id, hubspot_contact_id, hubspot_contact_email, hubspot_contact_name, arcova_contact_id, raw_payload, synced_at',
          )
          .eq('user_id', user.id)
          .in('hubspot_contact_email', emails)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (contactIdLinksResult.error || emailLinksResult.error) {
    return NextResponse.json({ error: 'Failed to load HubSpot CRM context.' }, { status: 500 });
  }

  // Dedupe links by (deal_id, contact_id) so the same deal-contact pair doesn't
  // appear twice when matched by both id and email.
  const allLinks = [...(contactIdLinksResult.data ?? []), ...(emailLinksResult.data ?? [])];
  const linkKey = (row: { hubspot_deal_id: unknown; arcova_contact_id: unknown; hubspot_contact_email: unknown }) =>
    `${row.hubspot_deal_id ?? ''}::${row.arcova_contact_id ?? row.hubspot_contact_email ?? ''}`;
  const dedupedLinks = Array.from(new Map(allLinks.map((row) => [linkKey(row), row])).values());

  const dealIds = Array.from(
    new Set(dedupedLinks.map((row) => String(row.hubspot_deal_id)).filter(Boolean)),
  );

  if (dealIds.length === 0) {
    return NextResponse.json({
      data: {
        company_id: company.id,
        company_name: company.company_name,
        company_domain: company.domain,
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

  // Group links by deal so each deal lists every involved contact at this account.
  const linksByDealId = new Map<string, typeof dedupedLinks>();
  for (const link of dedupedLinks) {
    const k = String(link.hubspot_deal_id);
    if (!k) continue;
    const bucket = linksByDealId.get(k) ?? [];
    bucket.push(link);
    linksByDealId.set(k, bucket);
  }

  const crmDeals = dealIds
    .map((dealId) => {
      const deal = dealsById.get(dealId);
      if (!deal) return null;
      const companyLink = companyLinkByDealId.get(dealId);
      const companyPayload = (companyLink?.raw_payload ?? {}) as Record<string, unknown>;

      const links = linksByDealId.get(dealId) ?? [];
      const involvedContacts = links.map((link) => {
        const arcovaId = typeof link.arcova_contact_id === 'string' ? link.arcova_contact_id : null;
        const linkedEmail =
          typeof link.hubspot_contact_email === 'string' ? link.hubspot_contact_email.trim().toLowerCase() : null;
        const resolved = arcovaId
          ? contactById.get(arcovaId) ?? null
          : linkedEmail
            ? contactByEmail.get(linkedEmail) ?? null
            : null;
        return {
          arcova_contact_id: arcovaId ?? (resolved && 'id' in resolved ? resolved.id : null),
          full_name: resolved?.full_name ?? link.hubspot_contact_name ?? null,
          email: link.hubspot_contact_email ?? null,
          hubspot_contact_id: link.hubspot_contact_id ?? null,
        };
      });

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
        resolution_suppressed:
          companyPayload.resolution_suppressed === true || companyPayload.resolution_suppressed === 'true',
        mismatch_reason:
          typeof companyPayload.mismatch_reason === 'string' ? companyPayload.mismatch_reason : null,
        contacts: involvedContacts,
      };
    })
    .filter((d): d is NonNullable<typeof d> => Boolean(d))
    .sort((a, b) => {
      const aTime = a.hs_lastmodifieddate ? new Date(a.hs_lastmodifieddate).getTime() : 0;
      const bTime = b.hs_lastmodifieddate ? new Date(b.hs_lastmodifieddate).getTime() : 0;
      return bTime - aTime;
    });

  return NextResponse.json({
    data: {
      company_id: company.id,
      company_name: company.company_name,
      company_domain: company.domain,
      deals: crmDeals,
    },
  });
}
