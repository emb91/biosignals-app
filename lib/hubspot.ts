export type ArcovaContactProperties = {
  arcova_contact_fit_score: string;
  arcova_overall_fit_score: string;
  arcova_action: string;
  arcova_seniority: string;
  arcova_function: string;
  arcova_enriched: string;
  arcova_data_sourced_from: string;
  arcova_enriched_email: string;
  arcova_enriched_at: string;
  arcova_person_summary: string;
};

export type ArcovaCompanyProperties = {
  arcova_company_fit_score: string;
  arcova_modalities: string;
  arcova_therapeutic_areas: string;
  arcova_development_stages: string;
  arcova_company_type: string;
  arcova_platform_category: string;
  arcova_bio_summary: string;
  arcova_industry: string;
  arcova_employee_count: string;
  arcova_founded_year: string;
  arcova_hq_city: string;
  arcova_hq_state: string;
  arcova_hq_country: string;
};

type HubSpotPropertyDefinition = {
  name: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'datetime' | 'enumeration' | 'bool';
  fieldType: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'booleancheckbox';
  groupName: string;
};

const ARCOVA_CONTACT_PROPERTIES: HubSpotPropertyDefinition[] = [
  { name: 'arcova_contact_fit_score', label: 'Arcova: Contact Fit Score', type: 'number', fieldType: 'number', groupName: 'arcova_intelligence' },
  { name: 'arcova_overall_fit_score', label: 'Arcova: Overall Fit Score', type: 'number', fieldType: 'number', groupName: 'arcova_intelligence' },
  { name: 'arcova_action', label: 'Arcova: Recommended Action', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_seniority', label: 'Arcova: Seniority Level', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_function', label: 'Arcova: Business Function', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_enriched', label: 'Arcova: Enriched', type: 'bool', fieldType: 'booleancheckbox', groupName: 'arcova_intelligence' },
  { name: 'arcova_data_sourced_from', label: 'Arcova: Data Sourced From', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_enriched_email', label: 'Arcova: Enriched Email', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_enriched_at', label: 'Arcova: Enriched At', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_person_summary', label: 'Arcova: Person Summary', type: 'string', fieldType: 'textarea', groupName: 'arcova_intelligence' },
  { name: 'arcova_linkedin_url', label: 'Arcova: LinkedIn URL', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
];

const ARCOVA_COMPANY_PROPERTIES: HubSpotPropertyDefinition[] = [
  { name: 'arcova_company_fit_score', label: 'Arcova: Company Fit Score', type: 'number', fieldType: 'number', groupName: 'arcova_intelligence' },
  { name: 'arcova_modalities', label: 'Arcova: Modalities', type: 'string', fieldType: 'textarea', groupName: 'arcova_intelligence' },
  { name: 'arcova_therapeutic_areas', label: 'Arcova: Therapeutic Areas', type: 'string', fieldType: 'textarea', groupName: 'arcova_intelligence' },
  { name: 'arcova_development_stages', label: 'Arcova: Development Stages', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_company_type', label: 'Arcova: Company Type', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_platform_category', label: 'Arcova: Platform Category', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_bio_summary', label: 'Arcova: Bio Summary', type: 'string', fieldType: 'textarea', groupName: 'arcova_intelligence' },
  { name: 'arcova_industry', label: 'Arcova: Industry', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_employee_count', label: 'Arcova: Employee Count', type: 'number', fieldType: 'number', groupName: 'arcova_intelligence' },
  { name: 'arcova_founded_year', label: 'Arcova: Founded Year', type: 'number', fieldType: 'number', groupName: 'arcova_intelligence' },
  { name: 'arcova_hq_city', label: 'Arcova: HQ City', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_hq_state', label: 'Arcova: HQ State', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_hq_country', label: 'Arcova: HQ Country', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_linkedin_url', label: 'Arcova: LinkedIn URL', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_funding_stage', label: 'Arcova: Funding Stage', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_funding_status', label: 'Arcova: Funding Status', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_total_funding_usd', label: 'Arcova: Total Funding (USD)', type: 'number', fieldType: 'number', groupName: 'arcova_intelligence' },
];

async function ensurePropertyGroup(accessToken: string, objectType: 'contacts' | 'companies'): Promise<void> {
  await fetch(`https://api.hubapi.com/crm/v3/properties/${objectType}/groups`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'arcova_intelligence', label: 'Arcova Intelligence', displayOrder: -1 }),
  });
  // 409 = already exists, both cases are fine
}

async function ensureProperties(accessToken: string, objectType: 'contacts' | 'companies', properties: HubSpotPropertyDefinition[]): Promise<void> {
  await Promise.all(
    properties.map((prop) =>
      fetch(`https://api.hubapi.com/crm/v3/properties/${objectType}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(prop),
      })
    )
  );
  // Ignore 409s (already exist)
}

export async function ensureArcovaHubSpotProperties(accessToken: string): Promise<void> {
  await Promise.all([
    ensurePropertyGroup(accessToken, 'contacts'),
    ensurePropertyGroup(accessToken, 'companies'),
  ]);
  await Promise.all([
    ensureProperties(accessToken, 'contacts', ARCOVA_CONTACT_PROPERTIES),
    ensureProperties(accessToken, 'companies', ARCOVA_COMPANY_PROPERTIES),
  ]);
}

export type HubSpotContactRecord = {
  id: string;
  properties: Record<string, string | null>;
};

export async function batchReadContactsByEmail(
  accessToken: string,
  emails: string[]
): Promise<HubSpotContactRecord[]> {
  const standardProps = ['hs_linkedin_url', 'jobtitle', 'email'];
  const arcovaContactProps = ARCOVA_CONTACT_PROPERTIES.map((p) => p.name);
  const propertiesParam = [...standardProps, ...arcovaContactProps];

  const results: HubSpotContactRecord[] = [];
  const chunks = chunkArray(emails, 100);

  for (const chunk of chunks) {
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/batch/read', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idProperty: 'email',
        inputs: chunk.map((email) => ({ id: email })),
        properties: propertiesParam,
      }),
    });
    if (!res.ok) continue;
    const data = await res.json();
    results.push(...(data.results ?? []));
  }
  return results;
}

export async function batchUpdateContacts(
  accessToken: string,
  updates: Array<{ id: string; properties: Record<string, string> }>
): Promise<{ updated: number; errors: number }> {
  let updated = 0;
  let errors = 0;
  const chunks = chunkArray(updates, 100);

  for (const chunk of chunks) {
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/batch/update', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: chunk }),
    });
    if (res.ok || res.status === 207) {
      const data = await res.json();
      updated += (data.results ?? []).length;
      errors += (data.errors ?? []).length;
    } else {
      errors += chunk.length;
    }
  }
  return { updated, errors };
}

// Upsert contacts by email — creates if not exists, updates if exists.
// HubSpot batch upsert requires idProperty + id on each input.
export async function batchUpsertContacts(
  accessToken: string,
  upserts: Array<{ email: string; properties: Record<string, string> }>
): Promise<{ upserted: number; errors: number }> {
  let upserted = 0;
  let errors = 0;
  const chunks = chunkArray(upserts, 100);

  for (const chunk of chunks) {
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs: chunk.map(({ email, properties }) => ({
          idProperty: 'email',
          id: email,
          properties: { ...properties, email },
        })),
      }),
    });
    if (res.ok || res.status === 207) {
      const data = await res.json();
      upserted += (data.results ?? []).length;
      errors += (data.errors ?? []).length;
    } else {
      errors += chunk.length;
    }
  }
  return { upserted, errors };
}

export async function getContactAssociatedCompanyIds(
  accessToken: string,
  contactIds: string[]
): Promise<Map<string, string>> {
  // Returns Map<contactId, companyId>
  const contactToCompany = new Map<string, string>();
  const chunks = chunkArray(contactIds, 100);

  for (const chunk of chunks) {
    const res = await fetch('https://api.hubapi.com/crm/v4/associations/contacts/companies/batch/read', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id })) }),
    });
    if (!res.ok) continue;
    const data = await res.json();
    for (const result of data.results ?? []) {
      const firstAssoc = result.to?.[0];
      if (firstAssoc?.toObjectId) {
        contactToCompany.set(String(result.from.id), String(firstAssoc.toObjectId));
      }
    }
  }
  return contactToCompany;
}

export async function batchUpdateCompanies(
  accessToken: string,
  updates: Array<{ id: string; properties: Record<string, string> }>
): Promise<{ updated: number; errors: number }> {
  let updated = 0;
  let errors = 0;
  const chunks = chunkArray(updates, 100);

  for (const chunk of chunks) {
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/batch/update', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: chunk }),
    });
    if (res.ok || res.status === 207) {
      const data = await res.json();
      updated += (data.results ?? []).length;
      errors += (data.errors ?? []).length;
    } else {
      errors += chunk.length;
    }
  }
  return { updated, errors };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID!;
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET!;
const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/hubspot/callback`;
const SCOPES = 'oauth crm.objects.contacts.read crm.objects.contacts.write';

export type HubSpotContact = {
  id: string;
  properties: {
    firstname: string | null;
    lastname: string | null;
    email: string | null;
    jobtitle: string | null;
    company: string | null;
    website: string | null;
    hs_linkedin_url: string | null;
    city: string | null;
    country: string | null;
    phone: string | null;
  };
};

export function getHubSpotAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
  });
  return `https://app.hubspot.com/oauth/authorize?${params}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  hub_id: string;
  hub_domain: string;
}> {
  const res = await fetch('https://api.hubapi.com/oauth/v3/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code,
    }),
  });
  if (!res.ok) throw new Error(`HubSpot token exchange failed: ${res.status}`);
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const res = await fetch('https://api.hubapi.com/oauth/v3/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`HubSpot token refresh failed: ${res.status}`);
  return res.json();
}

export async function getValidAccessToken(userId: string, supabase: any): Promise<string> {
  const { data, error } = await supabase
    .from('hubspot_connections')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .single();

  if (error || !data) throw new Error('No HubSpot connection found');

  const expiresAt = new Date(data.expires_at);
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);

  if (expiresAt > fiveMinFromNow) return data.access_token;

  const tokens = await refreshAccessToken(data.refresh_token);
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase
    .from('hubspot_connections')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  return tokens.access_token;
}

/**
 * Fetch HubSpot contacts that have NOT yet been enriched by Arcova.
 * Uses the search API to filter contacts where arcova_enriched_at is not set.
 */
export async function fetchUnenrichedHubSpotContacts(accessToken: string): Promise<HubSpotContact[]> {
  const properties = ['firstname', 'lastname', 'email', 'jobtitle', 'company', 'website', 'hs_linkedin_url', 'city', 'country'];
  const contacts: HubSpotContact[] = [];
  let after: string | undefined;

  do {
    const body: Record<string, unknown> = {
      filterGroups: [{ filters: [{ propertyName: 'arcova_enriched_at', operator: 'NOT_HAS_PROPERTY' }] }],
      properties,
      limit: 100,
    };
    if (after) body.after = after;

    const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HubSpot unenriched contacts search failed: ${res.status}`);

    const data = await res.json();
    contacts.push(...(data.results ?? []));
    after = data.paging?.next?.after;
  } while (after);

  return contacts;
}

export async function fetchHubSpotContacts(accessToken: string): Promise<HubSpotContact[]> {
  const properties = 'firstname,lastname,email,jobtitle,company,website,hs_linkedin_url,city,country,phone';
  const contacts: HubSpotContact[] = [];
  let after: string | undefined;

  do {
    const params = new URLSearchParams({ limit: '100', properties });
    if (after) params.set('after', after);

    const res = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`HubSpot contacts fetch failed: ${res.status}`);

    const data = await res.json();
    contacts.push(...data.results);
    after = data.paging?.next?.after;
  } while (after);

  return contacts;
}
