import {
  HUBSPOT_ACTIVE_DEAL_STAGES,
  HUBSPOT_CLOSED_DEAL_STAGES,
  HUBSPOT_CRM_PROVIDER,
  HUBSPOT_DEAL_OBJECT_TYPE,
  batchReadCompaniesById,
  batchReadContactsById,
  batchReadDealCompanyAssociations,
  batchReadDealContactAssociations,
  fetchModifiedHubSpotDeals,
  getHubSpotAccessTokenForConnection,
  normalizeDomain,
  toIsoFromHubSpotDate,
  toNullableNumber,
  type HubSpotCompanyRecord,
  type HubSpotContactRecordById,
  type HubSpotDeal,
} from '@/lib/hubspot-deals';
import {
  findArcovaCompaniesByDomains,
  findArcovaContactsByEmails,
  getCrmSyncCheckpoint,
  listCrmDealsByHubSpotIds,
  replaceCrmDealCompanyLinks,
  replaceCrmDealContactLinks,
  sourceEventExists,
  upsertCrmDeal,
  upsertCrmSyncCheckpoint,
  type CrmDealMirrorRecord,
  type DatabaseClient,
} from '@/lib/crm-sync-store';
import {
  generateAccountReason,
  ingestSignalSourceEvent,
  normalizeSignalSourceEvent,
  recomputeAccountReadiness,
} from '@/lib/signals/readiness-service';

const HUBSPOT_SIGNAL_SOURCE = 'hubspot_crm_deals';

type DealChangeType = 'deal_created' | 'deal_reopened' | 'deal_stage_advanced' | 'deal_amount_added';

type DealChangeEvent = {
  changeType: DealChangeType;
  title: string;
  summary: string;
};

export type HubSpotDealReadinessSyncResult = {
  fetchedDeals: number;
  mirroredDeals: number;
  emittedEvents: number;
  recomputedCompanies: number;
  skippedUnresolvedCompanies: number;
  checkpoint: string | null;
};

function normalizeStage(value?: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || null;
}

function isActiveStage(stage?: string | null): boolean {
  const normalized = normalizeStage(stage);
  return normalized ? HUBSPOT_ACTIVE_DEAL_STAGES.has(normalized) : false;
}

function isClosedStage(stage?: string | null): boolean {
  const normalized = normalizeStage(stage);
  return normalized ? HUBSPOT_CLOSED_DEAL_STAGES.has(normalized) : false;
}

function buildDealChangeEvents(previous: CrmDealMirrorRecord | null, current: HubSpotDeal): DealChangeEvent[] {
  const nextStage = current.properties.dealstage ?? null;
  const nextAmount = toNullableNumber(current.properties.amount ?? null);

  if (!previous) {
    return [{
      changeType: 'deal_created',
      title: 'HubSpot deal created',
      summary: 'A new HubSpot deal was created for this account.',
    }];
  }

  const events: DealChangeEvent[] = [];
  const prevStage = previous.deal_stage;
  const prevAmount = previous.amount;

  if (isClosedStage(prevStage) && isActiveStage(nextStage)) {
    events.push({
      changeType: 'deal_reopened',
      title: 'HubSpot deal reopened',
      summary: 'A previously closed HubSpot deal moved back into an active stage.',
    });
  }

  if (!isActiveStage(prevStage) && isActiveStage(nextStage) && prevStage !== nextStage) {
    events.push({
      changeType: 'deal_stage_advanced',
      title: 'HubSpot deal entered active stage',
      summary: 'A HubSpot deal advanced into an active buying stage.',
    });
  }

  if ((prevAmount == null || prevAmount <= 0) && nextAmount != null && nextAmount > 0) {
    events.push({
      changeType: 'deal_amount_added',
      title: 'HubSpot deal amount added',
      summary: 'A HubSpot deal amount was added where no amount previously existed.',
    });
  }

  return events;
}

function getMaxModifiedAt(deals: HubSpotDeal[]): string | null {
  const values = deals
    .map((deal) => toIsoFromHubSpotDate(deal.properties.hs_lastmodifieddate ?? null))
    .filter((value): value is string => Boolean(value))
    .sort();
  return values.length ? values[values.length - 1] : null;
}

function contactName(contact?: HubSpotContactRecordById | null): string | null {
  if (!contact) return null;
  const first = contact.properties.firstname?.trim() ?? '';
  const last = contact.properties.lastname?.trim() ?? '';
  const name = `${first} ${last}`.trim();
  return name || null;
}

export async function syncHubSpotDealsIntoReadiness(
  supabase: DatabaseClient,
  input: { userId: string; nangoConnectionId: string }
): Promise<HubSpotDealReadinessSyncResult> {
  const checkpoint = await getCrmSyncCheckpoint(supabase, input.userId, HUBSPOT_CRM_PROVIDER, HUBSPOT_DEAL_OBJECT_TYPE);

  try {
    const accessToken = await getHubSpotAccessTokenForConnection(input.nangoConnectionId);
    const deals = await fetchModifiedHubSpotDeals(accessToken, checkpoint?.last_synced_remote_at ?? null);

    if (!deals.length) {
      await upsertCrmSyncCheckpoint(supabase, {
        userId: input.userId,
        provider: HUBSPOT_CRM_PROVIDER,
        objectType: HUBSPOT_DEAL_OBJECT_TYPE,
        lastSyncedRemoteAt: checkpoint?.last_synced_remote_at ?? null,
        lastSyncStatus: 'success',
        metadata: { fetched_deals: 0 },
      });

      return {
        fetchedDeals: 0,
        mirroredDeals: 0,
        emittedEvents: 0,
        recomputedCompanies: 0,
        skippedUnresolvedCompanies: 0,
        checkpoint: checkpoint?.last_synced_remote_at ?? null,
      };
    }

    const dealIds = deals.map((deal) => deal.id);
    const [existingDeals, dealCompanyMap, dealContactMap] = await Promise.all([
      listCrmDealsByHubSpotIds(supabase, input.userId, dealIds),
      batchReadDealCompanyAssociations(accessToken, dealIds),
      batchReadDealContactAssociations(accessToken, dealIds),
    ]);

    const hubspotCompanyIds = [...new Set([...dealCompanyMap.values()].flat())];
    const hubspotContactIds = [...new Set([...dealContactMap.values()].flat())];

    const [hubspotCompanies, hubspotContacts] = await Promise.all([
      hubspotCompanyIds.length ? batchReadCompaniesById(accessToken, hubspotCompanyIds) : Promise.resolve([]),
      hubspotContactIds.length ? batchReadContactsById(accessToken, hubspotContactIds) : Promise.resolve([]),
    ]);

    const hubspotCompaniesById = new Map(hubspotCompanies.map((company) => [company.id, company]));
    const hubspotContactsById = new Map(hubspotContacts.map((contact) => [contact.id, contact]));

    const uniqueDomains = [...new Set(
      hubspotCompanies
        .map((company) => normalizeDomain(company.properties.domain ?? company.properties.website ?? null))
        .filter((value): value is string => Boolean(value))
    )];
    const uniqueEmails = [...new Set(
      hubspotContacts
        .map((contact) => contact.properties.email?.trim().toLowerCase() ?? '')
        .filter(Boolean)
    )];

    const [arcovaCompanies, arcovaContacts] = await Promise.all([
      findArcovaCompaniesByDomains(supabase, input.userId, uniqueDomains),
      findArcovaContactsByEmails(supabase, input.userId, uniqueEmails),
    ]);

    const arcovaCompanyByDomain = new Map(
      arcovaCompanies
        .map((company) => [normalizeDomain(company.domain ?? company.company_website ?? null), company] as const)
        .filter((entry): entry is [string, (typeof arcovaCompanies)[number]] => Boolean(entry[0]))
    );
    const arcovaContactByEmail = new Map(
      arcovaContacts
        .map((contact) => [contact.email?.trim().toLowerCase() ?? '', contact] as const)
        .filter((entry): entry is [string, (typeof arcovaContacts)[number]] => Boolean(entry[0]))
    );

    let mirroredDeals = 0;
    let emittedEvents = 0;
    let skippedUnresolvedCompanies = 0;
    const affectedCompanyIds = new Set<string>();

    for (const deal of deals) {
      const previous = existingDeals.get(deal.id) ?? null;
      const hsLastModifiedDate = toIsoFromHubSpotDate(deal.properties.hs_lastmodifieddate ?? null);

      await upsertCrmDeal(supabase, {
        userId: input.userId,
        hubspotDealId: deal.id,
        dealName: deal.properties.dealname ?? null,
        dealStage: deal.properties.dealstage ?? null,
        pipeline: deal.properties.pipeline ?? null,
        amount: toNullableNumber(deal.properties.amount ?? null),
        closeDate: toIsoFromHubSpotDate(deal.properties.closedate ?? null),
        createdDate: toIsoFromHubSpotDate(deal.properties.createdate ?? null),
        hubspotOwnerId: deal.properties.hubspot_owner_id ?? null,
        hsLastModifiedDate,
        rawPayload: deal as unknown as Record<string, unknown>,
      });
      mirroredDeals += 1;

      const associatedCompanyRows = (dealCompanyMap.get(deal.id) ?? []).map((hubspotCompanyId) => {
        const company = hubspotCompaniesById.get(hubspotCompanyId) as HubSpotCompanyRecord | undefined;
        const domain = normalizeDomain(company?.properties.domain ?? company?.properties.website ?? null);
        const arcovaCompany = domain ? arcovaCompanyByDomain.get(domain) : undefined;
        return {
          hubspotCompanyId,
          hubspotCompanyName: company?.properties.name ?? null,
          hubspotCompanyDomain: domain,
          arcovaCompanyId: arcovaCompany?.id ?? null,
          hsLastModifiedDate,
          rawPayload: company ? (company as unknown as Record<string, unknown>) : { hubspot_company_id: hubspotCompanyId },
        };
      });

      await replaceCrmDealCompanyLinks(supabase, {
        userId: input.userId,
        hubspotDealId: deal.id,
        rows: associatedCompanyRows,
      });

      const associatedContactRows = (dealContactMap.get(deal.id) ?? []).map((hubspotContactId) => {
        const contact = hubspotContactsById.get(hubspotContactId);
        const email = contact?.properties.email?.trim().toLowerCase() ?? null;
        const arcovaContact = email ? arcovaContactByEmail.get(email) : undefined;
        return {
          hubspotContactId,
          hubspotContactEmail: email,
          hubspotContactName: contactName(contact),
          arcovaContactId: arcovaContact?.id ?? null,
          hsLastModifiedDate,
          rawPayload: contact ? (contact as unknown as Record<string, unknown>) : { hubspot_contact_id: hubspotContactId },
        };
      });

      await replaceCrmDealContactLinks(supabase, {
        userId: input.userId,
        hubspotDealId: deal.id,
        rows: associatedContactRows,
      });

      const changes = buildDealChangeEvents(previous, deal);
      if (!changes.length) continue;

      const resolvedCompanyIds = [...new Set(associatedCompanyRows.map((row) => row.arcovaCompanyId).filter((value): value is string => Boolean(value)))];
      if (!resolvedCompanyIds.length) {
        skippedUnresolvedCompanies += changes.length;
        continue;
      }

      for (const companyId of resolvedCompanyIds) {
        for (const change of changes) {
          const sourceEventId = `hubspot:deal:${deal.id}:company:${companyId}:${change.changeType}:${hsLastModifiedDate ?? 'unknown'}`;
          const alreadyExists = await sourceEventExists(supabase, input.userId, HUBSPOT_SIGNAL_SOURCE, sourceEventId);
          if (alreadyExists) continue;

          const ingest = await ingestSignalSourceEvent(supabase, {
            userId: input.userId,
            entityScope: 'company',
            companyId,
            source: HUBSPOT_SIGNAL_SOURCE,
            sourceEventType: 'open_opportunity_in_crm',
            sourceEventId,
            title: change.title,
            summary: change.summary,
            excerpt: change.summary,
            eventAt: hsLastModifiedDate,
            metadata: {
              crm_provider: HUBSPOT_CRM_PROVIDER,
              object_type: 'deal',
              object_id: deal.id,
              changed_fields: ['dealstage', 'amount'],
              previous_values: previous
                ? { deal_stage: previous.deal_stage, amount: previous.amount }
                : {},
              next_values: {
                deal_stage: deal.properties.dealstage ?? null,
                amount: toNullableNumber(deal.properties.amount ?? null),
              },
              associated_hubspot_company_ids: associatedCompanyRows.map((row) => row.hubspotCompanyId),
              associated_hubspot_contact_ids: associatedContactRows.map((row) => row.hubspotContactId),
              diff_rule: change.changeType,
              remote_updated_at: hsLastModifiedDate,
              crm_label: 'HubSpot CRM',
            },
          });

          const rawEvent = {
            id: ingest.sourceEventId,
            userId: input.userId,
            entityId: companyId,
            entityScope: 'company' as const,
            source: HUBSPOT_SIGNAL_SOURCE,
            sourceUrl: null,
            sourceEventType: 'open_opportunity_in_crm',
            sourceEventId,
            title: change.title,
            summary: change.summary,
            excerpt: change.summary,
            eventAt: hsLastModifiedDate,
            observedAt: new Date().toISOString(),
            metadata: {
              crm_provider: HUBSPOT_CRM_PROVIDER,
              object_type: 'deal',
              object_id: deal.id,
              diff_rule: change.changeType,
              crm_label: 'HubSpot CRM',
            },
          } as const;

          await normalizeSignalSourceEvent(supabase, {
            userId: input.userId,
            rawEvent,
            signalKeys: ['open_opportunity_in_crm'],
            companyId,
          });

          affectedCompanyIds.add(companyId);
          emittedEvents += 1;
        }
      }
    }

    for (const companyId of affectedCompanyIds) {
      await recomputeAccountReadiness(supabase, { userId: input.userId, companyId });
      await generateAccountReason(supabase, { userId: input.userId, companyId });
    }

    const maxModifiedAt = getMaxModifiedAt(deals);
    await upsertCrmSyncCheckpoint(supabase, {
      userId: input.userId,
      provider: HUBSPOT_CRM_PROVIDER,
      objectType: HUBSPOT_DEAL_OBJECT_TYPE,
      lastSyncedRemoteAt: maxModifiedAt ?? checkpoint?.last_synced_remote_at ?? null,
      lastSyncStatus: 'success',
      metadata: {
        fetched_deals: deals.length,
        mirrored_deals: mirroredDeals,
        emitted_events: emittedEvents,
        recomputed_companies: affectedCompanyIds.size,
        skipped_unresolved_companies: skippedUnresolvedCompanies,
      },
    });

    return {
      fetchedDeals: deals.length,
      mirroredDeals,
      emittedEvents,
      recomputedCompanies: affectedCompanyIds.size,
      skippedUnresolvedCompanies,
      checkpoint: maxModifiedAt ?? checkpoint?.last_synced_remote_at ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertCrmSyncCheckpoint(supabase, {
      userId: input.userId,
      provider: HUBSPOT_CRM_PROVIDER,
      objectType: HUBSPOT_DEAL_OBJECT_TYPE,
      lastSyncedRemoteAt: checkpoint?.last_synced_remote_at ?? null,
      lastSyncStatus: 'error',
      lastSyncError: message,
      metadata: { failed_at: new Date().toISOString() },
    });
    throw error;
  }
}
