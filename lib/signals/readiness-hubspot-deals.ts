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
  type ArcovaCompanyRecord,
  type ArcovaContactRecord,
  findArcovaCompaniesByIds,
  findArcovaContactsByIds,
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
import type { SignalKey } from '@/lib/signals/readiness-types';

const HUBSPOT_SIGNAL_SOURCE = 'hubspot_crm_deals';

type DealChangeType =
  | 'deal_created'
  | 'deal_reopened'
  | 'deal_stage_advanced'
  | 'deal_amount_added'
  | 'deal_closed_lost';

type DealChangeEvent = {
  changeType: DealChangeType;
  sourceEventType: SignalKey;
  signalKeys: SignalKey[];
  title: string;
  summary: string;
};

type ResolutionStatus =
  | 'direct_company_match'
  | 'resolved_via_contact_current_company'
  | 'crm_company_contact_mismatch'
  | 'personal_or_nonwork_domain'
  | 'multiple_current_roles'
  | 'ambiguous_unresolved';

type DealAssociatedCompanyRow = {
  hubspotCompanyId: string;
  hubspotCompanyName: string | null;
  hubspotCompanyDomain: string | null;
  arcovaCompanyId: string | null;
  hsLastModifiedDate: string | null;
  rawPayload: Record<string, unknown>;
};

type DealAssociatedContactRow = {
  hubspotContactId: string;
  hubspotContactEmail: string | null;
  hubspotContactName: string | null;
  arcovaContactId: string | null;
  arcovaContact: ArcovaContactRecord | null;
  hsLastModifiedDate: string | null;
  rawPayload: Record<string, unknown>;
};

type ResolvedDealTarget = {
  companyId: string;
  resolutionStatus: ResolutionStatus;
  resolutionMethod: 'hubspot_company' | 'contact_current_company' | 'arcova_contact_id';
  matchedArcovaContactIds: string[];
  arcovaCompanyDomain: string | null;
  arcovaCompanyName: string | null;
};

type DealResolutionResult =
  | {
      targets: ResolvedDealTarget[];
      suppressed: false;
      resolutionStatus: ResolutionStatus;
      mismatchReason: null;
    }
  | {
      targets: [];
      suppressed: true;
      resolutionStatus: ResolutionStatus;
      mismatchReason: string;
    };

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

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
      sourceEventType: 'open_opportunity_in_crm',
      signalKeys: ['open_opportunity_in_crm'],
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
      sourceEventType: 'open_opportunity_in_crm',
      signalKeys: ['open_opportunity_in_crm'],
      title: 'HubSpot deal reopened',
      summary: 'A previously closed HubSpot deal moved back into an active stage.',
    });
  }

  if (!isActiveStage(prevStage) && isActiveStage(nextStage) && prevStage !== nextStage) {
    events.push({
      changeType: 'deal_stage_advanced',
      sourceEventType: 'open_opportunity_in_crm',
      signalKeys: ['open_opportunity_in_crm'],
      title: 'HubSpot deal entered active stage',
      summary: 'A HubSpot deal advanced into an active buying stage.',
    });
  }

  if ((prevAmount == null || prevAmount <= 0) && nextAmount != null && nextAmount > 0) {
    events.push({
      changeType: 'deal_amount_added',
      sourceEventType: 'open_opportunity_in_crm',
      signalKeys: ['open_opportunity_in_crm'],
      title: 'HubSpot deal amount added',
      summary: 'A HubSpot deal amount was added where no amount previously existed.',
    });
  }

  if (normalizeStage(prevStage) !== 'closedlost' && normalizeStage(nextStage) === 'closedlost') {
    events.push({
      changeType: 'deal_closed_lost',
      sourceEventType: 'closed_lost_in_crm',
      signalKeys: ['closed_lost_in_crm'],
      title: 'HubSpot deal closed lost',
      summary: 'A HubSpot deal moved to closed lost, so this account should stay dormant until something changes.',
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

function uniqueNonNull<T>(values: Array<T | null | undefined>): T[] {
  return [...new Set(values.filter((value): value is T => value != null))];
}

function resolveContactBackedCompany(
  contact: ArcovaContactRecord,
  arcovaCompanyByDomain: Map<string, ArcovaCompanyRecord>
): { companyId: string | null; companyDomain: string | null; companyName: string | null } {
  if (contact.company_id) {
    return {
      companyId: contact.company_id,
      companyDomain: normalizeDomain(contact.resolved_current_company_domain ?? contact.company_domain ?? null),
      companyName: contact.resolved_current_company_name ?? contact.company_name ?? null,
    };
  }

  const candidateDomain = normalizeDomain(contact.resolved_current_company_domain ?? contact.company_domain ?? null);
  const matchedCompany = candidateDomain ? arcovaCompanyByDomain.get(candidateDomain) : undefined;
  return {
    companyId: matchedCompany?.id ?? null,
    companyDomain: candidateDomain,
    companyName: contact.resolved_current_company_name ?? contact.company_name ?? matchedCompany?.company_name ?? null,
  };
}

function resolveDealTargets(
  associatedCompanyRows: DealAssociatedCompanyRow[],
  associatedContactRows: DealAssociatedContactRow[],
  arcovaCompanyByDomain: Map<string, ArcovaCompanyRecord>
): DealResolutionResult {
  const idAnchoredContacts = associatedContactRows
    .filter((row): row is DealAssociatedContactRow & { arcovaContact: ArcovaContactRecord } => Boolean(row.arcovaContact))
    .map((row) => ({
      row,
      resolved: resolveContactBackedCompany(row.arcovaContact, arcovaCompanyByDomain),
    }))
    .filter((item) => Boolean(item.row.arcovaContactId) && Boolean(item.resolved.companyId));

  const uniqueIdAnchoredCompanyIds = uniqueNonNull(idAnchoredContacts.map((item) => item.resolved.companyId));
  if (uniqueIdAnchoredCompanyIds.length === 1) {
    const anchor = idAnchoredContacts[0]!;
    return {
      targets: [{
        companyId: anchor.resolved.companyId!,
        resolutionStatus: 'resolved_via_contact_current_company',
        resolutionMethod: 'arcova_contact_id',
        matchedArcovaContactIds: uniqueNonNull(idAnchoredContacts.map((item) => item.row.arcovaContactId)),
        arcovaCompanyDomain: anchor.resolved.companyDomain,
        arcovaCompanyName: anchor.resolved.companyName,
      }],
      suppressed: false,
      resolutionStatus: 'resolved_via_contact_current_company',
      mismatchReason: null,
    };
  }

  const directTargets = associatedCompanyRows
    .filter((row): row is DealAssociatedCompanyRow & { arcovaCompanyId: string } => Boolean(row.arcovaCompanyId))
    .map((row) => {
      const matchedCompany = row.hubspotCompanyDomain ? arcovaCompanyByDomain.get(row.hubspotCompanyDomain) : undefined;
      return {
        companyId: row.arcovaCompanyId,
        resolutionStatus: 'direct_company_match' as const,
        resolutionMethod: 'hubspot_company' as const,
        matchedArcovaContactIds: [],
        arcovaCompanyDomain: normalizeDomain(matchedCompany?.domain ?? matchedCompany?.website ?? null),
        arcovaCompanyName: matchedCompany?.company_name ?? null,
      };
    });

  if (directTargets.length > 0) {
    return {
      targets: directTargets,
      suppressed: false,
      resolutionStatus: 'direct_company_match',
      mismatchReason: null,
    };
  }

  const contactCandidates = associatedContactRows
    .map((row) => {
      if (!row.arcovaContact) return null;
      const resolved = resolveContactBackedCompany(row.arcovaContact, arcovaCompanyByDomain);
      if (!resolved.companyId) return null;
      return {
        ...resolved,
        arcovaContactId: row.arcovaContact.id,
        email: row.arcovaContact.email ?? row.hubspotContactEmail,
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  const uniqueCandidateIds = uniqueNonNull(contactCandidates.map((candidate) => candidate.companyId));
  const hubspotDomains = uniqueNonNull(associatedCompanyRows.map((row) => row.hubspotCompanyDomain));

  if (uniqueCandidateIds.length === 1 && hubspotDomains.length === 0) {
    const candidate = contactCandidates[0]!;
    if (!candidate.companyId) {
      return {
        targets: [],
        suppressed: true,
        resolutionStatus: 'ambiguous_unresolved',
        mismatchReason: 'missing_contact_company_id',
      };
    }
    return {
      targets: [{
        companyId: candidate.companyId,
        resolutionStatus: 'resolved_via_contact_current_company',
        resolutionMethod: 'contact_current_company',
        matchedArcovaContactIds: uniqueNonNull(contactCandidates.map((item) => item.arcovaContactId)),
        arcovaCompanyDomain: candidate.companyDomain,
        arcovaCompanyName: candidate.companyName,
      }],
      suppressed: false,
      resolutionStatus: 'resolved_via_contact_current_company',
      mismatchReason: null,
    };
  }

  if (uniqueCandidateIds.length > 1) {
    return {
      targets: [],
      suppressed: true,
      resolutionStatus: 'multiple_current_roles',
      mismatchReason: 'Associated Arcova contacts point to multiple current companies.',
    };
  }

  if (uniqueCandidateIds.length === 1 && hubspotDomains.length > 0) {
    const candidate = contactCandidates[0]!;
    const candidateDomain = normalizeDomain(candidate.companyDomain);
    const emailDomains = uniqueNonNull(
      associatedContactRows.map((row) => normalizeDomain(row.hubspotContactEmail?.split('@')[1] ?? null))
    );
    const hasPersonalLikeEmail =
      emailDomains.length > 0 &&
      candidateDomain != null &&
      !emailDomains.includes(candidateDomain) &&
      !hubspotDomains.includes(candidateDomain);

    return {
      targets: [],
      suppressed: true,
      resolutionStatus: hasPersonalLikeEmail ? 'personal_or_nonwork_domain' : 'crm_company_contact_mismatch',
      mismatchReason: hasPersonalLikeEmail
        ? 'Associated contact email/domain does not line up cleanly with either HubSpot company or Arcova current-company truth.'
        : 'HubSpot company and Arcova current-company truth disagree.',
    };
  }

  return {
    targets: [],
    suppressed: true,
    resolutionStatus: 'ambiguous_unresolved',
    mismatchReason: 'Arcova could not confidently resolve this HubSpot deal to a single company.',
  };
}

export async function syncHubSpotDealsIntoReadiness(
  supabase: DatabaseClient,
  input: { userId: string; nangoConnectionId?: string; accessToken?: string }
): Promise<HubSpotDealReadinessSyncResult> {
  const checkpoint = await getCrmSyncCheckpoint(supabase, input.userId, HUBSPOT_CRM_PROVIDER, HUBSPOT_DEAL_OBJECT_TYPE);

  try {
    const accessToken =
      input.accessToken ??
      (input.nangoConnectionId
        ? await getHubSpotAccessTokenForConnection(input.nangoConnectionId)
        : null);

    if (!accessToken) {
      throw new Error('Missing HubSpot access token for CRM deal sync.');
    }

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
    const hubspotArcovaContactIds = [...new Set(
      hubspotContacts
        .map((contact) => contact.properties.arcova_contact_id?.trim() ?? '')
        .filter(Boolean)
    )];
    const hubspotArcovaCompanyIds = [...new Set(
      [
        ...hubspotContacts.map((contact) => contact.properties.arcova_company_id?.trim() ?? ''),
        ...hubspotCompanies.map((company) => company.properties.arcova_company_id?.trim() ?? ''),
      ].filter(Boolean)
    )];

    const [arcovaCompanies, arcovaContacts, arcovaCompaniesByIdRows, arcovaContactsByIdRows] = await Promise.all([
      findArcovaCompaniesByDomains(supabase, input.userId, uniqueDomains),
      findArcovaContactsByEmails(supabase, input.userId, uniqueEmails),
      findArcovaCompaniesByIds(supabase, input.userId, hubspotArcovaCompanyIds),
      findArcovaContactsByIds(supabase, input.userId, hubspotArcovaContactIds),
    ]);

    const arcovaCompanyByDomain = new Map(
      arcovaCompanies
        .map((company) => [normalizeDomain(company.domain ?? company.website ?? null), company] as const)
        .filter((entry): entry is [string, (typeof arcovaCompanies)[number]] => Boolean(entry[0]))
    );
    const arcovaContactByEmail = new Map(
      arcovaContacts
        .map((contact) => [contact.email?.trim().toLowerCase() ?? '', contact] as const)
        .filter((entry): entry is [string, (typeof arcovaContacts)[number]] => Boolean(entry[0]))
    );
    const arcovaContactById = new Map(arcovaContactsByIdRows.map((contact) => [contact.id, contact] as const));
    const arcovaCompanyById = new Map(arcovaCompaniesByIdRows.map((company) => [company.id, company] as const));

    const contactResolvedDomains = [...new Set(
      arcovaContacts
        .map((contact) => normalizeDomain(contact.resolved_current_company_domain ?? contact.company_domain ?? null))
        .filter((value): value is string => Boolean(value))
    )];

    if (contactResolvedDomains.length > 0) {
      const extraArcovaCompanies = await findArcovaCompaniesByDomains(supabase, input.userId, contactResolvedDomains);
      for (const company of extraArcovaCompanies) {
        const key = normalizeDomain(company.domain ?? company.website ?? null);
        if (key) arcovaCompanyByDomain.set(key, company);
      }
    }

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

      const associatedCompanyRows: DealAssociatedCompanyRow[] = (dealCompanyMap.get(deal.id) ?? []).map((hubspotCompanyId) => {
        const company = hubspotCompaniesById.get(hubspotCompanyId) as HubSpotCompanyRecord | undefined;
        const domain = normalizeDomain(company?.properties.domain ?? company?.properties.website ?? null);
        const storedArcovaCompanyId = company?.properties.arcova_company_id?.trim() ?? null;
        const arcovaCompany =
          (storedArcovaCompanyId ? arcovaCompanyById.get(storedArcovaCompanyId) : undefined) ??
          (domain ? arcovaCompanyByDomain.get(domain) : undefined);
        return {
          hubspotCompanyId,
          hubspotCompanyName: company?.properties.name ?? null,
          hubspotCompanyDomain: domain,
          arcovaCompanyId: arcovaCompany?.id ?? null,
          hsLastModifiedDate,
          rawPayload: company ? (company as unknown as Record<string, unknown>) : { hubspot_company_id: hubspotCompanyId },
        };
      });

      const associatedContactRows: DealAssociatedContactRow[] = (dealContactMap.get(deal.id) ?? []).map((hubspotContactId) => {
        const contact = hubspotContactsById.get(hubspotContactId);
        const email = contact?.properties.email?.trim().toLowerCase() ?? null;
        const storedArcovaContactId = contact?.properties.arcova_contact_id?.trim() ?? null;
        const arcovaContact =
          (storedArcovaContactId ? arcovaContactById.get(storedArcovaContactId) : undefined) ??
          (email ? arcovaContactByEmail.get(email) : undefined);
        return {
          hubspotContactId,
          hubspotContactEmail: email,
          hubspotContactName: contactName(contact),
          arcovaContactId: arcovaContact?.id ?? null,
          arcovaContact: arcovaContact ?? null,
          hsLastModifiedDate,
          rawPayload: contact ? (contact as unknown as Record<string, unknown>) : { hubspot_contact_id: hubspotContactId },
        };
      });

      await replaceCrmDealContactLinks(supabase, {
        userId: input.userId,
        hubspotDealId: deal.id,
        rows: associatedContactRows.map(({ arcovaContact: _arcovaContact, ...row }) => row),
      });

      const changes = buildDealChangeEvents(previous, deal);
      const resolution = resolveDealTargets(associatedCompanyRows, associatedContactRows, arcovaCompanyByDomain);

      await replaceCrmDealCompanyLinks(supabase, {
        userId: input.userId,
        hubspotDealId: deal.id,
        rows: associatedCompanyRows.map((row) => ({
          ...row,
          rawPayload: {
            ...row.rawPayload,
            resolution_status: resolution.resolutionStatus,
            resolution_suppressed: resolution.suppressed,
            mismatch_reason: resolution.mismatchReason,
            matched_arcova_contact_ids: resolution.suppressed
              ? []
              : uniqueNonNull(resolution.targets.flatMap((target) => target.matchedArcovaContactIds)),
            matched_arcova_company_ids: resolution.suppressed
              ? []
              : uniqueNonNull(resolution.targets.map((target) => target.companyId)),
          },
        })),
      });

      if (!changes.length) continue;

      if (resolution.suppressed || resolution.targets.length === 0) {
        skippedUnresolvedCompanies += changes.length;
        continue;
      }

      for (const target of resolution.targets) {
        const companyId = target.companyId;
        for (const change of changes) {
          const sourceEventId = `hubspot:deal:${deal.id}:company:${companyId}:${change.changeType}:${hsLastModifiedDate ?? 'unknown'}`;
          const alreadyExists = await sourceEventExists(supabase, input.userId, HUBSPOT_SIGNAL_SOURCE, sourceEventId);
          if (alreadyExists) continue;

          const ingest = await ingestSignalSourceEvent(supabase, {
            userId: input.userId,
            entityScope: 'company',
            companyId,
            source: HUBSPOT_SIGNAL_SOURCE,
            sourceEventType: change.sourceEventType,
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
              resolution_status: target.resolutionStatus,
              resolution_method: target.resolutionMethod,
              matched_arcova_contact_ids: target.matchedArcovaContactIds,
              arcova_company_name: target.arcovaCompanyName,
              arcova_company_domain: target.arcovaCompanyDomain,
              hubspot_company_names: associatedCompanyRows.map((row) => row.hubspotCompanyName).filter(Boolean),
              hubspot_company_domains: associatedCompanyRows.map((row) => row.hubspotCompanyDomain).filter(Boolean),
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
            sourceEventType: change.sourceEventType,
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
              resolution_status: target.resolutionStatus,
              resolution_method: target.resolutionMethod,
              matched_arcova_contact_ids: target.matchedArcovaContactIds,
              arcova_company_name: target.arcovaCompanyName,
              arcova_company_domain: target.arcovaCompanyDomain,
              hubspot_company_names: associatedCompanyRows.map((row) => row.hubspotCompanyName).filter(Boolean),
              hubspot_company_domains: associatedCompanyRows.map((row) => row.hubspotCompanyDomain).filter(Boolean),
              crm_label: 'HubSpot CRM',
            },
          } as const;

          await normalizeSignalSourceEvent(supabase, {
            userId: input.userId,
            rawEvent,
            signalKeys: change.signalKeys,
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
    const message = errorToMessage(error);
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
