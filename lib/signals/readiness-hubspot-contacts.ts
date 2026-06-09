import {
  HUBSPOT_CRM_PROVIDER,
  batchReadCompaniesById,
  batchReadContactCompanyAssociations,
  fetchModifiedHubSpotContacts,
  normalizeDomain,
  toIsoFromHubSpotDate,
  type HubSpotCompanyRecord,
  type HubSpotContactRecordById,
} from '@/lib/hubspot-deals';
import {
  type ArcovaCompanyRecord,
  type ArcovaContactRecord,
  type CrmContactMirrorRecord,
  findArcovaCompaniesByDomains,
  findArcovaCompaniesByIds,
  findArcovaContactsByEmails,
  findArcovaContactsByIds,
  getCrmSyncCheckpoint,
  listCrmContactsByHubSpotIds,
  replaceCrmContactCompanyLinks,
  sourceEventExists,
  upsertCrmContact,
  upsertCrmSyncCheckpoint,
  type DatabaseClient,
} from '@/lib/crm-sync-store';
import {
  generateAccountReason,
  ingestSignalSourceEvent,
  normalizeSignalSourceEvent,
  recomputeAccountReadiness,
} from '@/lib/signals/readiness-service';
import type { BuyerFunction, SignalKey } from '@/lib/signals/readiness-types';

const HUBSPOT_CONTACT_OBJECT_TYPE = 'contacts';
const HUBSPOT_SIGNAL_SOURCE = 'hubspot_crm_contacts';

type ContactChangeType =
  | 'new_contact_added'
  | 'account_association_added'
  | 'title_change'
  | 'recently_promoted'
  | 'new_internal_role'
  | 'recently_changed_company'
  | 'owner_reassigned'
  | 'contact_removed_from_account';

type ContactChangeEvent = {
  changeType: ContactChangeType;
  sourceEventType: string;
  signalKeys: SignalKey[];
  title: string;
  summary: string;
  entityScope: 'company' | 'contact';
  isContextOnly?: boolean;
  companyId: string | null;
  contactId: string | null;
  buyerFunctionsOverride?: BuyerFunction[];
};

type ContactAssociatedCompanyRow = {
  hubspotCompanyId: string;
  hubspotCompanyName: string | null;
  hubspotCompanyDomain: string | null;
  arcovaCompanyId: string | null;
  hsLastModifiedDate: string | null;
  rawPayload: Record<string, unknown>;
};

type ContactResolution = {
  companyId: string | null;
  arcovaContactId: string | null;
  arcovaCompanyId: string | null;
  arcovaCompanyName: string | null;
  arcovaCompanyDomain: string | null;
  resolutionStatus:
    | 'direct_company_match'
    | 'resolved_via_arcova_contact'
    | 'resolved_via_hubspot_arcova_company'
    | 'crm_company_contact_mismatch'
    | 'multiple_current_roles'
    | 'ambiguous_unresolved';
  resolutionMethod: 'hubspot_company' | 'arcova_contact' | 'hubspot_arcova_company' | 'ambiguous';
  suppressed: boolean;
  mismatchReason: string | null;
  matchedArcovaContactIds: string[];
};

function uniqueNonNull<T>(values: Array<T | null | undefined>): T[] {
  return [...new Set(values.filter((value): value is T => value != null))];
}

function normalizeText(value?: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || null;
}

function titleCaseWords(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function fullName(contact: HubSpotContactRecordById): string | null {
  const first = contact.properties.firstname?.trim() ?? '';
  const last = contact.properties.lastname?.trim() ?? '';
  const joined = `${first} ${last}`.trim();
  return joined || null;
}

function stringArrayFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && Boolean(item));
}

const SENIORITY_RANKS: Array<{ rank: number; patterns: RegExp[] }> = [
  { rank: 7, patterns: [/\bchief\b/i, /\bc.?suite\b/i, /\bceo\b/i, /\bcfo\b/i, /\bcto\b/i, /\bcoo\b/i, /\bcmo\b/i, /\bpresident\b/i] },
  { rank: 6, patterns: [/\bsvp\b/i, /\bvice president\b/i, /\bvp\b/i] },
  { rank: 5, patterns: [/\bhead\b/i, /\bdirector\b/i, /\bmanaging director\b/i] },
  { rank: 4, patterns: [/\bsenior manager\b/i, /\bmanager\b/i, /\blead\b/i] },
  { rank: 3, patterns: [/\bprincipal\b/i, /\bsenior\b/i] },
  { rank: 2, patterns: [/\bassociate\b/i, /\bspecialist\b/i] },
  { rank: 1, patterns: [/\banalyst\b/i, /\bcoordinator\b/i, /\bassistant\b/i] },
];

function seniorityRank(title?: string | null): number {
  if (!title) return 0;
  for (const item of SENIORITY_RANKS) {
    if (item.patterns.some((pattern) => pattern.test(title))) return item.rank;
  }
  return 0;
}

function roleFamily(title?: string | null): string | null {
  if (!title) return null;
  const normalized = title.toLowerCase();
  if (/(scientific|science|research|r&d|discovery|translational|preclinical)/i.test(normalized)) return 'research_and_development';
  if (/(business development|bd|partnership|alliances|licensing)/i.test(normalized)) return 'business_development';
  if (/(commercial|sales|revenue|account manager|market access)/i.test(normalized)) return 'commercial';
  if (/(clinical|trial|site)/i.test(normalized)) return 'clinical_operations';
  if (/(regulatory|quality|compliance)/i.test(normalized)) return 'regulatory_affairs';
  if (/(manufacturing|cmc|process development|msat|operations)/i.test(normalized)) return 'manufacturing_and_cmc';
  if (/(procurement|purchasing|sourcing)/i.test(normalized)) return 'procurement';
  if (/(technology|systems|it|data|informatics|engineering)/i.test(normalized)) return 'technology_and_systems';
  if (/(finance|accounting)/i.test(normalized)) return 'finance';
  return null;
}

function inferBuyerFunctions(title?: string | null, matchedContact?: ArcovaContactRecord | null): BuyerFunction[] {
  const businessArea = normalizeText(matchedContact?.business_area);
  if (businessArea === 'commercial') return ['commercial'];
  if (businessArea === 'operations') return ['manufacturing_and_cmc'];
  if (businessArea === 'finance') return ['procurement'];
  if (businessArea === 'scientific/technical') return ['research_and_development'];
  const family = roleFamily(title);
  switch (family) {
    case 'business_development':
      return ['business_development', 'partnerships'];
    case 'commercial':
      return ['commercial'];
    case 'clinical_operations':
      return ['clinical_operations'];
    case 'research_and_development':
      return ['research_and_development'];
    case 'regulatory_affairs':
      return ['regulatory_affairs', 'quality_and_compliance'];
    case 'manufacturing_and_cmc':
      return ['manufacturing_and_cmc'];
    case 'procurement':
      return ['procurement'];
    case 'technology_and_systems':
      return ['technology_and_systems', 'data_and_informatics'];
    default:
      return [];
  }
}

function isMateriallyRelevantContact(contact: HubSpotContactRecordById): boolean {
  const title = normalizeText(contact.properties.jobtitle ?? null);
  const email = normalizeText(contact.properties.email ?? null);
  return Boolean(title || email);
}

function resolveArcovaContact(
  hubspotContact: HubSpotContactRecordById,
  byEmail: Map<string, ArcovaContactRecord>,
  byId: Map<string, ArcovaContactRecord>
): ArcovaContactRecord | null {
  const pushedId = normalizeText(hubspotContact.properties.arcova_contact_id ?? null);
  if (pushedId && byId.has(pushedId)) return byId.get(pushedId) ?? null;

  const email = normalizeText(hubspotContact.properties.email ?? null);
  if (email && byEmail.has(email)) return byEmail.get(email) ?? null;

  return null;
}

function resolveContactTarget(
  hubspotContact: HubSpotContactRecordById,
  associatedCompanyRows: ContactAssociatedCompanyRow[],
  matchedArcovaContact: ArcovaContactRecord | null,
  arcovaCompanyById: Map<string, ArcovaCompanyRecord>,
  arcovaCompanyByDomain: Map<string, ArcovaCompanyRecord>
): ContactResolution {
  const matchedArcovaContactIds = matchedArcovaContact ? [matchedArcovaContact.id] : [];
  const directCompanyIds = uniqueNonNull(associatedCompanyRows.map((row) => row.arcovaCompanyId));
  const pushedArcovaCompanyId = normalizeText(hubspotContact.properties.arcova_company_id ?? null);
  const pushedArcovaCompany = pushedArcovaCompanyId ? arcovaCompanyById.get(pushedArcovaCompanyId) ?? null : null;

  if (matchedArcovaContact?.company_id) {
    const arcovaCompany = arcovaCompanyById.get(matchedArcovaContact.company_id) ?? null;
    const directMismatch =
      directCompanyIds.length > 0 && !directCompanyIds.includes(matchedArcovaContact.company_id);
    if (directMismatch) {
      return {
        companyId: matchedArcovaContact.company_id,
        arcovaContactId: matchedArcovaContact.id,
        arcovaCompanyId: matchedArcovaContact.company_id,
        arcovaCompanyName: matchedArcovaContact.resolved_current_company_name ?? matchedArcovaContact.company_name ?? arcovaCompany?.company_name ?? null,
        arcovaCompanyDomain: normalizeDomain(matchedArcovaContact.resolved_current_company_domain ?? matchedArcovaContact.company_domain ?? arcovaCompany?.domain ?? arcovaCompany?.website ?? null),
        resolutionStatus: 'crm_company_contact_mismatch',
        resolutionMethod: 'arcova_contact',
        suppressed: false,
        mismatchReason: 'HubSpot company context differs from Arcova current-company truth.',
        matchedArcovaContactIds,
      };
    }

    return {
      companyId: matchedArcovaContact.company_id,
      arcovaContactId: matchedArcovaContact.id,
      arcovaCompanyId: matchedArcovaContact.company_id,
      arcovaCompanyName: matchedArcovaContact.resolved_current_company_name ?? matchedArcovaContact.company_name ?? arcovaCompany?.company_name ?? null,
      arcovaCompanyDomain: normalizeDomain(matchedArcovaContact.resolved_current_company_domain ?? matchedArcovaContact.company_domain ?? arcovaCompany?.domain ?? arcovaCompany?.website ?? null),
      resolutionStatus: 'resolved_via_arcova_contact',
      resolutionMethod: 'arcova_contact',
      suppressed: false,
      mismatchReason: null,
      matchedArcovaContactIds,
    };
  }

  if (pushedArcovaCompany) {
    const directMismatch = directCompanyIds.length > 0 && !directCompanyIds.includes(pushedArcovaCompany.id);
    return {
      companyId: pushedArcovaCompany.id,
      arcovaContactId: matchedArcovaContact?.id ?? null,
      arcovaCompanyId: pushedArcovaCompany.id,
      arcovaCompanyName: hubspotContact.properties.arcova_company_name ?? pushedArcovaCompany.company_name ?? null,
      arcovaCompanyDomain: normalizeDomain(hubspotContact.properties.arcova_company_domain ?? pushedArcovaCompany.domain ?? pushedArcovaCompany.website ?? null),
      resolutionStatus: directMismatch ? 'crm_company_contact_mismatch' : 'resolved_via_hubspot_arcova_company',
      resolutionMethod: 'hubspot_arcova_company',
      suppressed: false,
      mismatchReason: directMismatch ? 'HubSpot company context differs from stored Arcova company anchors.' : null,
      matchedArcovaContactIds,
    };
  }

  if (directCompanyIds.length === 1) {
    const direct = arcovaCompanyById.get(directCompanyIds[0]) ?? null;
    return {
      companyId: direct?.id ?? null,
      arcovaContactId: matchedArcovaContact?.id ?? null,
      arcovaCompanyId: direct?.id ?? null,
      arcovaCompanyName: direct?.company_name ?? null,
      arcovaCompanyDomain: normalizeDomain(direct?.domain ?? direct?.website ?? null),
      resolutionStatus: 'direct_company_match',
      resolutionMethod: 'hubspot_company',
      suppressed: false,
      mismatchReason: null,
      matchedArcovaContactIds,
    };
  }

  if (directCompanyIds.length > 1) {
    return {
      companyId: null,
      arcovaContactId: matchedArcovaContact?.id ?? null,
      arcovaCompanyId: null,
      arcovaCompanyName: null,
      arcovaCompanyDomain: null,
      resolutionStatus: 'multiple_current_roles',
      resolutionMethod: 'ambiguous',
      suppressed: true,
      mismatchReason: 'HubSpot contact is associated to multiple Arcova companies.',
      matchedArcovaContactIds,
    };
  }

  const hintedDomain = normalizeDomain(hubspotContact.properties.arcova_company_domain ?? null);
  if (hintedDomain && arcovaCompanyByDomain.has(hintedDomain)) {
    const hinted = arcovaCompanyByDomain.get(hintedDomain) ?? null;
    return {
      companyId: hinted?.id ?? null,
      arcovaContactId: matchedArcovaContact?.id ?? null,
      arcovaCompanyId: hinted?.id ?? null,
      arcovaCompanyName: hubspotContact.properties.arcova_company_name ?? hinted?.company_name ?? null,
      arcovaCompanyDomain: hintedDomain,
      resolutionStatus: 'resolved_via_hubspot_arcova_company',
      resolutionMethod: 'hubspot_arcova_company',
      suppressed: false,
      mismatchReason: null,
      matchedArcovaContactIds,
    };
  }

  return {
    companyId: null,
    arcovaContactId: matchedArcovaContact?.id ?? null,
    arcovaCompanyId: null,
    arcovaCompanyName: null,
    arcovaCompanyDomain: null,
    resolutionStatus: 'ambiguous_unresolved',
    resolutionMethod: 'ambiguous',
    suppressed: true,
    mismatchReason: 'No trustworthy Arcova company could be resolved for this HubSpot contact.',
    matchedArcovaContactIds,
  };
}

function buildContactChangeEvents(
  previous: CrmContactMirrorRecord | null,
  current: HubSpotContactRecordById,
  resolution: ContactResolution,
  associatedCompanyRows: ContactAssociatedCompanyRow[],
  previousAssociatedCompanyIds: string[],
  nextAssociatedCompanyIds: string[],
  matchedArcovaContact: ArcovaContactRecord | null
): ContactChangeEvent[] {
  const events: ContactChangeEvent[] = [];
  const nextTitle = titleCaseWords(current.properties.jobtitle ?? null);
  const prevTitle = titleCaseWords(previous?.job_title ?? matchedArcovaContact?.job_title ?? null);
  const nextOwner = normalizeText(current.properties.hubspot_owner_id ?? null);
  const prevOwner = normalizeText(previous?.hubspot_owner_id ?? null);
  const nextEmail = normalizeText(current.properties.email ?? null);
  const prevEmail = normalizeText(previous?.email ?? matchedArcovaContact?.email ?? null);
  const directAssociatedArcovaCompanyIds = uniqueNonNull(associatedCompanyRows.map((row) => row.arcovaCompanyId));
  const nextArcovaCompanyId =
    directAssociatedArcovaCompanyIds.length === 1 ? directAssociatedArcovaCompanyIds[0] : resolution.companyId;
  const prevArcovaCompanyId = previous?.arcova_company_id ?? matchedArcovaContact?.company_id ?? null;
  const addedAssociation = nextAssociatedCompanyIds.some((id) => !previousAssociatedCompanyIds.includes(id));
  const removedAssociation = previousAssociatedCompanyIds.some((id) => !nextAssociatedCompanyIds.includes(id));
  const buyerFunctionsOverride = inferBuyerFunctions(nextTitle, matchedArcovaContact);
  const relevantNewContact = isMateriallyRelevantContact(current);
  const hasArcovaBaseline = !previous && Boolean(matchedArcovaContact);

  if (!previous && !hasArcovaBaseline) {
    if (!resolution.suppressed && resolution.companyId && relevantNewContact) {
      events.push({
        changeType: 'new_contact_added',
        sourceEventType: 'new_contact_added_in_crm',
        signalKeys: ['new_contact_added_in_crm'],
        title: 'New HubSpot contact added',
        summary: 'A new relevant contact was added to a tracked HubSpot account.',
        entityScope: 'company',
        companyId: resolution.companyId,
        contactId: resolution.arcovaContactId,
        buyerFunctionsOverride,
      });
    }
    return events;
  }

  if (!resolution.suppressed && resolution.companyId && addedAssociation && relevantNewContact) {
    events.push({
      changeType: 'account_association_added',
      sourceEventType: 'new_contact_added_in_crm',
      signalKeys: ['new_contact_added_in_crm'],
      title: 'Relevant HubSpot contact associated to account',
      summary: 'A relevant contact was newly associated to a tracked HubSpot account.',
      entityScope: 'company',
      companyId: resolution.companyId,
      contactId: resolution.arcovaContactId,
      buyerFunctionsOverride,
    });
  }

  if (removedAssociation) {
    events.push({
      changeType: 'contact_removed_from_account',
      sourceEventType: 'crm_contact_removed_from_account',
      signalKeys: [],
      title: 'HubSpot contact removed from account',
      summary: 'A contact was removed from one of its prior HubSpot account associations.',
      entityScope: 'contact',
      companyId: resolution.companyId,
      contactId: resolution.arcovaContactId,
      isContextOnly: true,
    });
  }

  if (prevOwner && nextOwner && prevOwner !== nextOwner) {
    events.push({
      changeType: 'owner_reassigned',
      sourceEventType: 'crm_owner_reassigned',
      signalKeys: [],
      title: 'HubSpot owner reassigned',
      summary: 'HubSpot changed the owner for this contact, which may affect route context.',
      entityScope: 'contact',
      companyId: resolution.companyId,
      contactId: resolution.arcovaContactId,
      isContextOnly: true,
    });
  }

  if (
    resolution.companyId &&
    prevArcovaCompanyId &&
    nextArcovaCompanyId &&
    prevArcovaCompanyId !== nextArcovaCompanyId &&
    (prevEmail === nextEmail || !prevEmail || !nextEmail)
  ) {
    events.push({
      changeType: 'recently_changed_company',
      sourceEventType: 'recently_changed_company',
      signalKeys: ['recently_changed_company'],
      title: 'HubSpot contact changed company context',
      summary: 'A tracked contact now points to a different company context.',
      entityScope: 'contact',
      companyId: resolution.companyId,
      contactId: resolution.arcovaContactId,
      buyerFunctionsOverride,
    });
    return events;
  }

  if (prevTitle && nextTitle && prevTitle !== nextTitle && resolution.companyId) {
    const prevRank = seniorityRank(prevTitle);
    const nextRank = seniorityRank(nextTitle);
    const prevRole = roleFamily(prevTitle);
    const nextRole = roleFamily(nextTitle);

    if (nextRank > prevRank && nextRank > 0) {
      events.push({
        changeType: 'recently_promoted',
        sourceEventType: 'recently_promoted',
        signalKeys: ['recently_promoted'],
        title: 'HubSpot contact promoted',
        summary: 'A tracked HubSpot contact appears to have been promoted internally.',
        entityScope: 'contact',
        companyId: resolution.companyId,
        contactId: resolution.arcovaContactId,
        buyerFunctionsOverride,
      });
    } else if (prevRole && nextRole && prevRole !== nextRole) {
      events.push({
        changeType: 'new_internal_role',
        sourceEventType: 'new_internal_role',
        signalKeys: ['new_internal_role'],
        title: 'HubSpot contact moved into a new internal role',
        summary: 'A tracked HubSpot contact appears to have changed function internally.',
        entityScope: 'contact',
        companyId: resolution.companyId,
        contactId: resolution.arcovaContactId,
        buyerFunctionsOverride,
      });
    } else {
      events.push({
        changeType: 'title_change',
        sourceEventType: 'title_change',
        signalKeys: ['title_change'],
        title: 'HubSpot contact title changed',
        summary: 'A tracked HubSpot contact has a materially different title.',
        entityScope: 'contact',
        companyId: resolution.companyId,
        contactId: resolution.arcovaContactId,
        buyerFunctionsOverride,
      });
    }
  }

  if (!previous && !events.length && !resolution.suppressed && resolution.companyId && relevantNewContact) {
    events.push({
      changeType: 'new_contact_added',
      sourceEventType: 'new_contact_added_in_crm',
      signalKeys: ['new_contact_added_in_crm'],
      title: 'New HubSpot contact added',
      summary: 'A new relevant contact was added to a tracked HubSpot account.',
      entityScope: 'company',
      companyId: resolution.companyId,
      contactId: resolution.arcovaContactId,
      buyerFunctionsOverride,
    });
  }

  return events;
}

function previousAssociatedCompanyIds(previous: CrmContactMirrorRecord | null): string[] {
  if (!previous) return [];
  return stringArrayFromUnknown(previous.raw_payload?.associated_hubspot_company_ids);
}

/** Lightweight per-contact summary for surfacing "which contacts" in the pull banner. */
export type CrmContactSyncItem = { name: string | null; company: string | null };

export type HubSpotContactReadinessSyncResult = {
  fetchedContacts: number;
  mirroredContacts: number;
  emittedEvents: number;
  recomputedCompanies: number;
  contextOnlyEvents: number;
  skippedUnresolvedCompanies: number;
  checkpoint: string | null;
  emittedSignalTypes: string[];
  contextOnlySignalTypes: string[];
  /** One entry per mirrored contact (name + primary associated company). */
  contactItems: CrmContactSyncItem[];
};

export async function syncHubSpotContactsIntoReadiness(
  supabase: DatabaseClient,
  input: {
    userId: string;
    accessToken?: string | null;
    nangoConnectionId?: string | null;
  }
): Promise<HubSpotContactReadinessSyncResult> {
  const checkpoint = await getCrmSyncCheckpoint(supabase, input.userId, HUBSPOT_CRM_PROVIDER, HUBSPOT_CONTACT_OBJECT_TYPE);

  try {
    const accessToken = input.accessToken;
    if (!accessToken) {
      throw new Error('HubSpot access token is required for contact readiness sync.');
    }

    const contacts = await fetchModifiedHubSpotContacts(accessToken, checkpoint?.last_synced_remote_at ?? null);
    if (!contacts.length) {
      const checkpointRecord = await upsertCrmSyncCheckpoint(supabase, {
        userId: input.userId,
        provider: HUBSPOT_CRM_PROVIDER,
        objectType: HUBSPOT_CONTACT_OBJECT_TYPE,
        lastSyncedRemoteAt: checkpoint?.last_synced_remote_at ?? null,
        lastSyncStatus: 'success',
        metadata: {
          fetched_contacts: 0,
          mirrored_contacts: 0,
          emitted_events: 0,
          recomputed_companies: 0,
          context_only_events: 0,
          skipped_unresolved_companies: 0,
        },
      });

      return {
        fetchedContacts: 0,
        mirroredContacts: 0,
        emittedEvents: 0,
        recomputedCompanies: 0,
        contextOnlyEvents: 0,
        skippedUnresolvedCompanies: 0,
        checkpoint: checkpointRecord.last_synced_remote_at,
        emittedSignalTypes: [],
        contextOnlySignalTypes: [],
        contactItems: [],
      };
    }

    const contactIds = contacts.map((contact) => String(contact.id));
    const companyIdsByContactId = await batchReadContactCompanyAssociations(accessToken, contactIds);
    const hubspotCompanyIds = uniqueNonNull(
      contactIds.flatMap((contactId) => (companyIdsByContactId.get(contactId) ?? []).map((id) => String(id)))
    );
    const hubspotCompanies = await batchReadCompaniesById(accessToken, hubspotCompanyIds);
    const hubspotCompanyById = new Map(hubspotCompanies.map((company) => [String(company.id), company]));
    const uniqueCompanyDomains = uniqueNonNull(
      hubspotCompanies.map((company) => normalizeDomain(company.properties.domain ?? company.properties.website ?? null))
    );
    const uniqueEmails = uniqueNonNull(contacts.map((contact) => normalizeText(contact.properties.email ?? null)));
    const pushedArcovaContactIds = uniqueNonNull(contacts.map((contact) => normalizeText(contact.properties.arcova_contact_id ?? null)));
    const pushedArcovaCompanyIds = uniqueNonNull(contacts.map((contact) => normalizeText(contact.properties.arcova_company_id ?? null)));

    const [previousContactsById, arcovaCompaniesByDomain, matchedContactsByEmail, matchedContactsById, arcovaCompaniesById] = await Promise.all([
      listCrmContactsByHubSpotIds(supabase, input.userId, contactIds),
      findArcovaCompaniesByDomains(supabase, input.userId, uniqueCompanyDomains),
      findArcovaContactsByEmails(supabase, input.userId, uniqueEmails),
      findArcovaContactsByIds(supabase, input.userId, pushedArcovaContactIds),
      findArcovaCompaniesByIds(supabase, input.userId, pushedArcovaCompanyIds),
    ]);

    const arcovaCompanyByDomain = new Map(
      arcovaCompaniesByDomain.flatMap((company) => {
        const entries: Array<[string, ArcovaCompanyRecord]> = [];
        const domain = normalizeDomain(company.domain ?? null);
        const website = normalizeDomain(company.website ?? null);
        if (domain) entries.push([domain, company]);
        if (website) entries.push([website, company]);
        return entries;
      })
    );
    const arcovaCompanyById = new Map(arcovaCompaniesById.concat(arcovaCompaniesByDomain).map((company) => [company.id, company]));
    const matchedContactByEmail = new Map(
      matchedContactsByEmail
        .map((contact) => {
          const email = normalizeText(contact.email ?? null);
          return email ? ([email, contact] as const) : null;
        })
        .filter((entry): entry is readonly [string, ArcovaContactRecord] => Boolean(entry))
    );
    const matchedContactById = new Map(matchedContactsById.map((contact) => [contact.id, contact]));

    let mirroredContacts = 0;
    let emittedEvents = 0;
    let contextOnlyEvents = 0;
    let skippedUnresolvedCompanies = 0;
    const affectedCompanyIds = new Set<string>();
    const emittedSignalTypes = new Set<string>();
    const contextOnlySignalTypes = new Set<string>();
    const contactItems: CrmContactSyncItem[] = [];

    for (const contact of contacts) {
      const hubspotContactId = String(contact.id);
      const previous = previousContactsById.get(hubspotContactId) ?? null;
      const hsLastModifiedDate = toIsoFromHubSpotDate(contact.properties.hs_lastmodifieddate ?? null);
      const matchedArcovaContact = resolveArcovaContact(contact, matchedContactByEmail, matchedContactById);
      const associatedCompanyRows: ContactAssociatedCompanyRow[] = (companyIdsByContactId.get(hubspotContactId) ?? []).map((hubspotCompanyId) => {
        const company = hubspotCompanyById.get(String(hubspotCompanyId));
        const domain = normalizeDomain(company?.properties.domain ?? company?.properties.website ?? null);
        const matchedCompany = domain ? arcovaCompanyByDomain.get(domain) : undefined;
        return {
          hubspotCompanyId: String(hubspotCompanyId),
          hubspotCompanyName: company?.properties.name ?? null,
          hubspotCompanyDomain: domain,
          arcovaCompanyId: matchedCompany?.id ?? null,
          hsLastModifiedDate: hsLastModifiedDate,
          rawPayload: {
            hubspot_company_name: company?.properties.name ?? null,
            hubspot_company_domain: domain,
          },
        };
      });

      const resolution = resolveContactTarget(contact, associatedCompanyRows, matchedArcovaContact, arcovaCompanyById, arcovaCompanyByDomain);
      const currentRawPayload: Record<string, unknown> = {
        associated_hubspot_company_ids: associatedCompanyRows.map((row) => row.hubspotCompanyId),
        associated_hubspot_company_domains: associatedCompanyRows.map((row) => row.hubspotCompanyDomain).filter(Boolean),
        associated_hubspot_company_names: associatedCompanyRows.map((row) => row.hubspotCompanyName).filter(Boolean),
        resolution_status: resolution.resolutionStatus,
        resolution_method: resolution.resolutionMethod,
        resolution_suppressed: resolution.suppressed,
        mismatch_reason: resolution.mismatchReason,
        matched_arcova_contact_ids: resolution.matchedArcovaContactIds,
      };

      await upsertCrmContact(supabase, {
        userId: input.userId,
        hubspotContactId,
        fullName: fullName(contact),
        email: normalizeText(contact.properties.email ?? null),
        jobTitle: titleCaseWords(contact.properties.jobtitle ?? null),
        hubspotOwnerId: normalizeText(contact.properties.hubspot_owner_id ?? null),
        arcovaContactId: matchedArcovaContact?.id ?? null,
        arcovaCompanyId: resolution.arcovaCompanyId,
        arcovaCompanyName: resolution.arcovaCompanyName,
        arcovaCompanyDomain: resolution.arcovaCompanyDomain,
        hsLastModifiedDate,
        rawPayload: currentRawPayload,
      });
      mirroredContacts += 1;
      contactItems.push({
        name: fullName(contact),
        company: associatedCompanyRows[0]?.hubspotCompanyName ?? null,
      });

      await replaceCrmContactCompanyLinks(supabase, {
        userId: input.userId,
        hubspotContactId,
        rows: associatedCompanyRows.map((row) => ({
          ...row,
          rawPayload: {
            ...row.rawPayload,
            resolution_status: resolution.resolutionStatus,
            resolution_method: resolution.resolutionMethod,
            resolution_suppressed: resolution.suppressed,
            mismatch_reason: resolution.mismatchReason,
            matched_arcova_contact_ids: resolution.matchedArcovaContactIds,
          },
        })),
      });

      const changes = buildContactChangeEvents(
        previous,
        contact,
        resolution,
        associatedCompanyRows,
        previousAssociatedCompanyIds(previous),
        associatedCompanyRows.map((row) => row.hubspotCompanyId),
        matchedArcovaContact
      );

      if (!changes.length) continue;
      if (resolution.suppressed) {
        skippedUnresolvedCompanies += changes.filter((change) => !change.isContextOnly).length;
      }

      for (const change of changes) {
        const effectiveCompanyId = change.companyId ?? resolution.companyId;
        const effectiveContactId = change.contactId ?? resolution.arcovaContactId;

        if (
          !change.isContextOnly &&
          (!effectiveCompanyId || resolution.suppressed || (change.entityScope === 'contact' && !effectiveContactId))
        ) {
          continue;
        }

        const sourceEventId = `hubspot:contact:${hubspotContactId}:${change.changeType}:${hsLastModifiedDate ?? 'unknown'}`;
        const alreadyExists = await sourceEventExists(supabase, input.userId, HUBSPOT_SIGNAL_SOURCE, sourceEventId);
        if (alreadyExists) continue;

        const ingest = await ingestSignalSourceEvent(supabase, {
          userId: input.userId,
          entityScope: change.entityScope,
          companyId: effectiveCompanyId,
          contactId: effectiveContactId,
          source: HUBSPOT_SIGNAL_SOURCE,
          sourceEventType: change.sourceEventType,
          sourceEventId,
          title: change.title,
          summary: change.summary,
          excerpt: change.summary,
          eventAt: hsLastModifiedDate,
          metadata: {
            crm_provider: HUBSPOT_CRM_PROVIDER,
            object_type: 'contact',
            object_id: hubspotContactId,
            previous_values: previous
              ? {
                  job_title: previous.job_title,
                  hubspot_owner_id: previous.hubspot_owner_id,
                  arcova_company_id: previous.arcova_company_id,
                  associated_hubspot_company_ids: previousAssociatedCompanyIds(previous),
                }
              : {},
            next_values: {
              job_title: titleCaseWords(contact.properties.jobtitle ?? null),
              hubspot_owner_id: normalizeText(contact.properties.hubspot_owner_id ?? null),
              arcova_company_id: resolution.arcovaCompanyId,
              associated_hubspot_company_ids: associatedCompanyRows.map((row) => row.hubspotCompanyId),
            },
            diff_rule: change.changeType,
            resolution_status: resolution.resolutionStatus,
            resolution_method: resolution.resolutionMethod,
            resolution_suppressed: resolution.suppressed,
            matched_arcova_contact_ids: resolution.matchedArcovaContactIds,
            arcova_company_name: resolution.arcovaCompanyName,
            arcova_company_domain: resolution.arcovaCompanyDomain,
            hubspot_company_names: associatedCompanyRows.map((row) => row.hubspotCompanyName).filter(Boolean),
            hubspot_company_domains: associatedCompanyRows.map((row) => row.hubspotCompanyDomain).filter(Boolean),
            crm_label: 'HubSpot CRM',
          },
        });

        if (change.signalKeys.length > 0 && effectiveCompanyId) {
          const rawEvent = {
            id: ingest.sourceEventId,
            userId: input.userId,
            entityId: change.entityScope === 'company' ? effectiveCompanyId : (effectiveContactId ?? ''),
            entityScope: change.entityScope,
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
              object_type: 'contact',
              object_id: hubspotContactId,
              diff_rule: change.changeType,
              resolution_status: resolution.resolutionStatus,
              resolution_method: resolution.resolutionMethod,
              resolution_suppressed: resolution.suppressed,
              matched_arcova_contact_ids: resolution.matchedArcovaContactIds,
              arcova_company_name: resolution.arcovaCompanyName,
              arcova_company_domain: resolution.arcovaCompanyDomain,
              hubspot_company_names: associatedCompanyRows.map((row) => row.hubspotCompanyName).filter(Boolean),
              hubspot_company_domains: associatedCompanyRows.map((row) => row.hubspotCompanyDomain).filter(Boolean),
              crm_label: 'HubSpot CRM',
            },
          } as const;

          await normalizeSignalSourceEvent(supabase, {
            userId: input.userId,
            rawEvent,
            signalKeys: change.signalKeys,
            buyerFunctionsOverride: change.buyerFunctionsOverride,
            companyId: effectiveCompanyId,
            contactId: effectiveContactId,
          });

          affectedCompanyIds.add(effectiveCompanyId);
          emittedEvents += 1;
          emittedSignalTypes.add(change.sourceEventType);
        } else {
          contextOnlyEvents += 1;
          contextOnlySignalTypes.add(change.sourceEventType);
        }
      }
    }

    for (const companyId of affectedCompanyIds) {
      await recomputeAccountReadiness(supabase, { userId: input.userId, companyId });
      await generateAccountReason(supabase, { userId: input.userId, companyId });
    }

    const maxModifiedAt = contacts
      .map((contact) => toIsoFromHubSpotDate(contact.properties.hs_lastmodifieddate ?? null))
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;

    const checkpointRecord = await upsertCrmSyncCheckpoint(supabase, {
      userId: input.userId,
      provider: HUBSPOT_CRM_PROVIDER,
      objectType: HUBSPOT_CONTACT_OBJECT_TYPE,
      lastSyncedRemoteAt: maxModifiedAt ?? checkpoint?.last_synced_remote_at ?? null,
      lastSyncStatus: 'success',
      metadata: {
        fetched_contacts: contacts.length,
        mirrored_contacts: mirroredContacts,
        emitted_events: emittedEvents,
        recomputed_companies: affectedCompanyIds.size,
        context_only_events: contextOnlyEvents,
        skipped_unresolved_companies: skippedUnresolvedCompanies,
      },
    });

    return {
      fetchedContacts: contacts.length,
      mirroredContacts,
      emittedEvents,
      recomputedCompanies: affectedCompanyIds.size,
      contextOnlyEvents,
      skippedUnresolvedCompanies,
      checkpoint: checkpointRecord.last_synced_remote_at,
      emittedSignalTypes: [...emittedSignalTypes],
      contextOnlySignalTypes: [...contextOnlySignalTypes],
      contactItems,
    };
  } catch (error) {
    await upsertCrmSyncCheckpoint(supabase, {
      userId: input.userId,
      provider: HUBSPOT_CRM_PROVIDER,
      objectType: HUBSPOT_CONTACT_OBJECT_TYPE,
      lastSyncedRemoteAt: checkpoint?.last_synced_remote_at ?? null,
      lastSyncStatus: 'error',
      lastSyncError: error instanceof Error ? error.message : String(error),
      metadata: {
        ...(checkpoint?.metadata ?? {}),
        failed_at: new Date().toISOString(),
      },
    });
    throw error;
  }
}
