import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/org-context';
import { createAdminClient } from '@/lib/supabase-admin';
import { resolveOrgContactAccess } from '@/lib/org-contact-access';

type RouteParams = { id: string };

// One row in the contact's "CRM updates" feed — real data only:
//  - 'stage'  : a deal stage transition (crm_deal_stage_history)
//  - 'event'  : a mirrored HubSpot CRM activity event for this contact
//               (signal_source_events — the same source as /today)
type CrmUpdate = {
  id: string;
  kind: 'stage' | 'event';
  at: string;
  deal_name: string | null;
  stage: string | null;
  event_type: string | null;
  title: string | null;
  summary: string | null;
};

const CRM_EVENT_SOURCES = ['hubspot_crm_contacts', 'hubspot_crm_deals'] as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<RouteParams> }
) {
  const { id } = await params;
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const admin = createAdminClient();
  const access = await resolveOrgContactAccess({
    id,
    orgId: ctx.orgId,
    userId: ctx.user.id,
    admin,
  });
  if (!access) {
    return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });
  }

  const { data: contact, error: contactError } = await admin
    .from('contacts')
    .select('id, email, company_id, resolved_current_company_name, resolved_current_company_domain')
    .eq('id', access.contactId)
    .eq('user_id', access.ownerUserId)
    .maybeSingle();

  if (contactError) {
    return NextResponse.json({ error: 'Failed to load contact.' }, { status: 500 });
  }

  if (!contact) {
    return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });
  }

  const normalizedEmail = typeof contact.email === 'string' ? contact.email.trim().toLowerCase() : null;
  const { data: contactLinks, error: linksError } = await admin
    .from('crm_deal_contact_links')
    .select('hubspot_deal_id, hubspot_contact_id, hubspot_contact_email, hubspot_contact_name, arcova_contact_id, raw_payload, synced_at')
    .in('user_id', access.memberIds)
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

  // CRM updates feed — deal stage transitions (the historical deals path) plus
  // this contact's mirrored HubSpot CRM activity (the /today crm-activity source).
  const buildUpdates = async (dealNameById: Map<string, string | null>): Promise<CrmUpdate[]> => {
    const [stageRes, eventRes] = await Promise.all([
      dealIds.length
        ? admin
            .from('crm_deal_stage_history')
            .select('id, hubspot_deal_id, stage, entered_at')
            .in('user_id', access.memberIds)
            .in('hubspot_deal_id', dealIds)
            .order('entered_at', { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      admin
        .from('signal_source_events')
        .select('id, source_event_type, title, summary, event_at, observed_at')
        .in('user_id', access.memberIds)
        .in('source', CRM_EVENT_SOURCES as unknown as string[])
        .eq('entity_contact_id', contact.id)
        .order('observed_at', { ascending: false })
        .limit(20),
    ]);

    const stageUpdates: CrmUpdate[] = ((stageRes.data ?? []) as Array<Record<string, unknown>>)
      .filter((r) => typeof r.entered_at === 'string')
      .map((r) => ({
        id: `stage:${String(r.id)}`,
        kind: 'stage',
        at: String(r.entered_at),
        deal_name: dealNameById.get(String(r.hubspot_deal_id)) ?? null,
        stage: typeof r.stage === 'string' ? r.stage : null,
        event_type: null,
        title: null,
        summary: null,
      }));

    const eventUpdates: CrmUpdate[] = ((eventRes.data ?? []) as Array<Record<string, unknown>>)
      .map((r): CrmUpdate | null => {
        const at = (typeof r.event_at === 'string' && r.event_at) || (typeof r.observed_at === 'string' ? r.observed_at : null);
        if (!at) return null;
        return {
          id: `event:${String(r.id)}`,
          kind: 'event',
          at,
          deal_name: null,
          stage: null,
          event_type: typeof r.source_event_type === 'string' ? r.source_event_type : null,
          title: typeof r.title === 'string' ? r.title : null,
          summary: typeof r.summary === 'string' ? r.summary : null,
        };
      })
      .filter((u): u is CrmUpdate => u != null);

    return [...stageUpdates, ...eventUpdates]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 12);
  };

  if (dealIds.length === 0) {
    return NextResponse.json({
      data: {
        contact_id: contact.id,
        arcova_company_id: contact.company_id,
        arcova_company_name: contact.resolved_current_company_name,
        arcova_company_domain: contact.resolved_current_company_domain,
        deals: [],
        updates: await buildUpdates(new Map()),
      },
    });
  }

  const [{ data: deals, error: dealsError }, { data: companyLinks, error: companyLinksError }] = await Promise.all([
    admin
      .from('crm_deals')
      .select('hubspot_deal_id, deal_name, deal_stage, amount, close_date, hs_lastmodifieddate, synced_at')
      .in('user_id', access.memberIds)
      .in('hubspot_deal_id', dealIds),
    admin
      .from('crm_deal_company_links')
      .select('hubspot_deal_id, hubspot_company_name, hubspot_company_domain, arcova_company_id, raw_payload')
      .in('user_id', access.memberIds)
      .in('hubspot_deal_id', dealIds),
  ]);

  if (dealsError || companyLinksError) {
    return NextResponse.json({ error: 'Failed to load mirrored HubSpot deals.' }, { status: 500 });
  }

  const dealsById = new Map((deals ?? []).map((row) => [String(row.hubspot_deal_id), row]));
  const companyLinkByDealId = new Map((companyLinks ?? []).map((row) => [String(row.hubspot_deal_id), row]));
  const dealNameById = new Map(
    (deals ?? []).map((row) => [String(row.hubspot_deal_id), (row.deal_name as string | null) ?? null]),
  );
  const updates = await buildUpdates(dealNameById);

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
      updates,
    },
  });
}
