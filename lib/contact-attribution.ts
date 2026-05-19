import type { DatabaseClient } from '@/lib/crm-sync-store';
import { resolveContactDataProvenance } from '@/lib/data-provenance';

type ContactRow = {
  id: string;
  source: string | null;
  created_at: string | null;
  upload_batches?: unknown;
  profile_enrichment_status: string | null;
  profile_enrichment_completed_at: string | null;
  enrichment_refresh_finished_at: string | null;
};

type CrmDealRow = {
  hubspot_deal_id: string;
  deal_name: string | null;
  deal_stage: string | null;
  hs_lastmodifieddate: string | null;
  synced_at: string | null;
};

type TouchpointType = 'sourced' | 'profile_enriched' | 'refresh_enriched';

type Touchpoint = {
  type: TouchpointType;
  at: string;
};

function parseIsoTime(value?: string | null): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function normalizeStage(value?: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || null;
}

function isArcovaEnrichedContact(contact: ContactRow): boolean {
  if (contact.enrichment_refresh_finished_at) return true;
  if (contact.profile_enrichment_completed_at) return true;
  return ['completed', 'ambiguous'].includes((contact.profile_enrichment_status || '').trim().toLowerCase());
}

function buildTouchpoints(contact: ContactRow): Touchpoint[] {
  const touchpoints: Touchpoint[] = [];
  const provenance = resolveContactDataProvenance({
    upload_batches: contact.upload_batches,
    created_at: contact.created_at,
    source: contact.source,
  });

  if (provenance.channels.includes('arcova') && provenance.importedAt) {
    touchpoints.push({ type: 'sourced', at: provenance.importedAt });
  }

  if (contact.profile_enrichment_completed_at) {
    touchpoints.push({ type: 'profile_enriched', at: contact.profile_enrichment_completed_at });
  }

  if (contact.enrichment_refresh_finished_at) {
    touchpoints.push({ type: 'refresh_enriched', at: contact.enrichment_refresh_finished_at });
  }

  return touchpoints
    .filter((touchpoint) => parseIsoTime(touchpoint.at) != null)
    .sort((a, b) => (parseIsoTime(a.at) ?? 0) - (parseIsoTime(b.at) ?? 0));
}

function latestClosedWonDealForContact(
  contactId: string,
  dealIdsByContactId: Map<string, string[]>,
  dealsById: Map<string, CrmDealRow>,
): { dealId: string; dealName: string | null; wonAt: string | null } | null {
  const dealIds = dealIdsByContactId.get(contactId) ?? [];
  const candidates = dealIds
    .map((dealId) => {
      const deal = dealsById.get(dealId);
      if (!deal || normalizeStage(deal.deal_stage) !== 'closedwon') return null;
      const wonAt = deal.hs_lastmodifieddate ?? deal.synced_at ?? null;
      return {
        dealId,
        dealName: deal.deal_name,
        wonAt,
        wonAtTime: parseIsoTime(wonAt),
      };
    })
    .filter((deal): deal is NonNullable<typeof deal> => Boolean(deal))
    .sort((a, b) => (b.wonAtTime ?? 0) - (a.wonAtTime ?? 0));

  if (!candidates.length) return null;

  return {
    dealId: candidates[0]!.dealId,
    dealName: candidates[0]!.dealName,
    wonAt: candidates[0]!.wonAt,
  };
}

export async function recomputeContactAttributionSnapshots(
  supabase: DatabaseClient,
  input: { userId: string },
): Promise<{ recomputedContacts: number }> {
  const { data: contacts, error: contactsError } = await supabase
    .from('contacts')
    .select(
      'id, source, created_at, profile_enrichment_status, profile_enrichment_completed_at, enrichment_refresh_finished_at, upload_batches(filename, created_at)',
    )
    .eq('user_id', input.userId)
    .is('archived_at', null);

  if (contactsError) throw contactsError;

  const contactRows = ((contacts || []) as ContactRow[]).filter((contact) => typeof contact.id === 'string');
  if (!contactRows.length) return { recomputedContacts: 0 };

  const contactIds = contactRows.map((contact) => contact.id);
  const { data: contactDealLinks, error: contactDealLinksError } = await supabase
    .from('crm_deal_contact_links')
    .select('arcova_contact_id, hubspot_deal_id')
    .eq('user_id', input.userId)
    .in('arcova_contact_id', contactIds);

  if (contactDealLinksError) throw contactDealLinksError;

  const dealIds = [...new Set(
    ((contactDealLinks || []) as Array<{ hubspot_deal_id: string | null }>)
      .map((row) => (typeof row.hubspot_deal_id === 'string' ? row.hubspot_deal_id : null))
      .filter((dealId): dealId is string => Boolean(dealId)),
  )];

  const dealsById = new Map<string, CrmDealRow>();
  if (dealIds.length > 0) {
    const { data: deals, error: dealsError } = await supabase
      .from('crm_deals')
      .select('hubspot_deal_id, deal_name, deal_stage, hs_lastmodifieddate, synced_at')
      .eq('user_id', input.userId)
      .in('hubspot_deal_id', dealIds);

    if (dealsError) throw dealsError;

    for (const deal of (deals || []) as CrmDealRow[]) {
      if (typeof deal.hubspot_deal_id === 'string') {
        dealsById.set(deal.hubspot_deal_id, deal);
      }
    }
  }

  const dealIdsByContactId = new Map<string, string[]>();
  for (const row of (contactDealLinks || []) as Array<{ arcova_contact_id: string | null; hubspot_deal_id: string | null }>) {
    if (!row.arcova_contact_id || !row.hubspot_deal_id) continue;
    const current = dealIdsByContactId.get(row.arcova_contact_id) ?? [];
    current.push(row.hubspot_deal_id);
    dealIdsByContactId.set(row.arcova_contact_id, current);
  }

  const now = new Date().toISOString();
  const snapshotRows = contactRows.map((contact) => {
    const provenance = resolveContactDataProvenance({
      upload_batches: contact.upload_batches,
      created_at: contact.created_at,
      source: contact.source,
    });
    const touchpoints = buildTouchpoints(contact);
    const firstTouch = touchpoints[0] ?? null;
    const latestTouch = touchpoints[touchpoints.length - 1] ?? null;
    const latestClosedWonDeal = latestClosedWonDealForContact(contact.id, dealIdsByContactId, dealsById);
    const firstTouchAtTime = parseIsoTime(firstTouch?.at ?? null);
    const wonAtTime = parseIsoTime(latestClosedWonDeal?.wonAt ?? null);

    return {
      user_id: input.userId,
      contact_id: contact.id,
      is_arcova_sourced: provenance.channels.includes('arcova'),
      is_arcova_enriched: isArcovaEnrichedContact(contact),
      arcova_touchpoint_count: touchpoints.length,
      arcova_touchpoints: touchpoints,
      first_arcova_touch_at: firstTouch?.at ?? null,
      latest_arcova_touch_at: latestTouch?.at ?? null,
      latest_arcova_touch_type: latestTouch?.type ?? null,
      latest_closed_won_deal_id: latestClosedWonDeal?.dealId ?? null,
      latest_closed_won_deal_name: latestClosedWonDeal?.dealName ?? null,
      latest_closed_won_at: latestClosedWonDeal?.wonAt ?? null,
      won_after_arcova_touch:
        firstTouchAtTime != null && wonAtTime != null ? firstTouchAtTime <= wonAtTime : false,
      metadata: {
        provenance_channels: provenance.channels,
        imported_at: provenance.importedAt,
      },
      computed_at: now,
    };
  });

  const { error: upsertError } = await supabase
    .from('contact_attribution_snapshots')
    .upsert(snapshotRows, { onConflict: 'user_id,contact_id' });

  if (upsertError) throw upsertError;

  return { recomputedContacts: snapshotRows.length };
}
