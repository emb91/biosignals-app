import { HUBSPOT_INTEGRATION_ID, nango } from '@/lib/nango';

export const HUBSPOT_CRM_PROVIDER = 'hubspot';
export const HUBSPOT_DEAL_OBJECT_TYPE = 'deals';

const HUBSPOT_DEAL_PROPERTIES = [
  'dealname',
  'dealstage',
  'pipeline',
  'amount',
  'closedate',
  'createdate',
  'hs_lastmodifieddate',
  'hubspot_owner_id',
  'dealtype',
] as const;

const HUBSPOT_COMPANY_PROPERTIES = ['name', 'domain', 'website', 'arcova_company_id'] as const;
const HUBSPOT_CONTACT_PROPERTIES = [
  'firstname',
  'lastname',
  'email',
  'jobtitle',
  'hubspot_owner_id',
  'hs_lastmodifieddate',
  'arcova_contact_id',
  'arcova_company_id',
  'arcova_company_name',
  'arcova_company_domain',
] as const;

export const HUBSPOT_ACTIVE_DEAL_STAGES = new Set([
  'appointmentscheduled',
  'qualifiedtobuy',
  'presentationscheduled',
  'decisionmakerboughtin',
  'contractsent',
]);

export const HUBSPOT_CLOSED_DEAL_STAGES = new Set(['closedwon', 'closedlost']);

export type HubSpotDeal = {
  id: string;
  properties: Record<string, string | null>;
};

export type HubSpotCompanyRecord = {
  id: string;
  properties: Record<string, string | null>;
};

export type HubSpotContactRecordById = {
  id: string;
  properties: Record<string, string | null>;
};

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export function normalizeDomain(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const withoutProtocol = trimmed.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const host = withoutProtocol.split('/')[0]?.trim();
  return host || null;
}

export function toIsoFromHubSpotDate(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) return new Date(asNumber).toISOString();
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function toNullableNumber(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Number(String(value).replace(/[$,]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getHubSpotAccessTokenForConnection(connectionId: string): Promise<string> {
  return nango.getToken(HUBSPOT_INTEGRATION_ID, connectionId) as Promise<string>;
}

export async function fetchModifiedHubSpotDeals(accessToken: string, since?: string | null): Promise<HubSpotDeal[]> {
  const deals: HubSpotDeal[] = [];
  let after: string | undefined;

  do {
    const body: Record<string, unknown> = {
      properties: [...HUBSPOT_DEAL_PROPERTIES],
      limit: 100,
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
    };

    if (since) {
      body.filterGroups = [{ filters: [{ propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: String(new Date(since).getTime()) }] }];
    }

    if (after) body.after = after;

    const res = await fetch('https://api.hubapi.com/crm/v3/objects/deals/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`HubSpot deal search failed: ${res.status}`);

    const data = await res.json();
    deals.push(...(data.results ?? []));
    after = data.paging?.next?.after;
  } while (after);

  return deals;
}

export async function fetchModifiedHubSpotContacts(accessToken: string, since?: string | null): Promise<HubSpotContactRecordById[]> {
  const contacts: HubSpotContactRecordById[] = [];
  let after: string | undefined;

  do {
    const body: Record<string, unknown> = {
      properties: [...HUBSPOT_CONTACT_PROPERTIES],
      limit: 100,
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
    };

    if (since) {
      body.filterGroups = [{ filters: [{ propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: String(new Date(since).getTime()) }] }];
    }

    if (after) body.after = after;

    const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`HubSpot contact search failed: ${res.status}`);

    const data = await res.json();
    contacts.push(...(data.results ?? []));
    after = data.paging?.next?.after;
  } while (after);

  return contacts;
}

async function batchReadAssociations(
  accessToken: string,
  fromObjectType: 'deals' | 'contacts',
  toObjectType: 'companies' | 'contacts',
  ids: string[]
): Promise<Map<string, string[]>> {
  const resultMap = new Map<string, string[]>();
  const chunks = chunkArray(ids, 100);

  for (const chunk of chunks) {
    const res = await fetch(`https://api.hubapi.com/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/read`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id })) }),
    });

    if (!res.ok) throw new Error(`HubSpot ${fromObjectType}->${toObjectType} association read failed: ${res.status}`);

    const data = await res.json();
    for (const row of data.results ?? []) {
      const fromId = String(row.from?.id ?? '');
      if (!fromId) continue;
      const idsForRow = Array.isArray(row.to)
        ? row.to.map((item: { toObjectId?: string | number }) => String(item.toObjectId ?? '')).filter(Boolean)
        : [];
      resultMap.set(fromId, idsForRow);
    }
  }

  return resultMap;
}

export async function batchReadDealCompanyAssociations(accessToken: string, dealIds: string[]): Promise<Map<string, string[]>> {
  return batchReadAssociations(accessToken, 'deals', 'companies', dealIds);
}

export async function batchReadDealContactAssociations(accessToken: string, dealIds: string[]): Promise<Map<string, string[]>> {
  return batchReadAssociations(accessToken, 'deals', 'contacts', dealIds);
}

export async function batchReadContactCompanyAssociations(accessToken: string, contactIds: string[]): Promise<Map<string, string[]>> {
  return batchReadAssociations(accessToken, 'contacts', 'companies', contactIds);
}

export async function batchReadCompaniesById(accessToken: string, companyIds: string[]): Promise<HubSpotCompanyRecord[]> {
  const results: HubSpotCompanyRecord[] = [];
  const chunks = chunkArray(companyIds, 100);

  for (const chunk of chunks) {
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/batch/read', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id })), properties: [...HUBSPOT_COMPANY_PROPERTIES] }),
    });

    if (!res.ok) throw new Error(`HubSpot company batch read failed: ${res.status}`);
    const data = await res.json();
    results.push(...(data.results ?? []));
  }

  return results;
}

export async function batchReadContactsById(accessToken: string, contactIds: string[]): Promise<HubSpotContactRecordById[]> {
  const results: HubSpotContactRecordById[] = [];
  const chunks = chunkArray(contactIds, 100);

  for (const chunk of chunks) {
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/batch/read', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id })), properties: [...HUBSPOT_CONTACT_PROPERTIES] }),
    });

    if (!res.ok) throw new Error(`HubSpot contact batch read failed: ${res.status}`);
    const data = await res.json();
    results.push(...(data.results ?? []));
  }

  return results;
}
