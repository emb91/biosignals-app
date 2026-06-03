export type ArcovaContactProperties = {
  arcova_contact_id: string;
  arcova_company_id: string;
  arcova_company_name: string;
  arcova_company_domain: string;
  arcova_contact_fit_score: string;
  arcova_overall_fit_score: string;
  arcova_contact_readiness_score: string;
  arcova_contact_priority_score: string;
  arcova_action: string;
  arcova_seniority: string;
  arcova_function: string;
  arcova_enriched: string;
  arcova_data_sourced_from: string;
  arcova_enriched_email: string;
  arcova_enriched_at: string;
  arcova_person_summary: string;
  arcova_outreach_status: string;
  arcova_last_outreach_at: string;
  arcova_last_outreach_anchor: string;
  arcova_last_outreach_channel: string;
};

export type ArcovaCompanyProperties = {
  arcova_company_id: string;
  arcova_company_fit_score: string;
  arcova_company_readiness_score: string;
  arcova_company_priority_score: string;
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

/** HubSpot v3 rejects bool + booleancheckbox creates unless options include true/false. */
const HUBSPOT_BOOLEAN_PROPERTY_OPTIONS = [
  { label: 'Yes', value: 'true', displayOrder: 0 },
  { label: 'No', value: 'false', displayOrder: 1 },
] as const;

function hubSpotPropertyCreateBody(prop: HubSpotPropertyDefinition): Record<string, unknown> {
  if (prop.type === 'bool' && prop.fieldType === 'booleancheckbox') {
    return {
      name: prop.name,
      label: prop.label,
      type: prop.type,
      fieldType: prop.fieldType,
      groupName: prop.groupName,
      options: [...HUBSPOT_BOOLEAN_PROPERTY_OPTIONS],
    };
  }
  return { ...prop };
}

async function describeHubSpotError(res: Response): Promise<string> {
  const fallback = `HubSpot request failed (${res.status})`;

  try {
    const text = await res.text();
    if (!text) return fallback;

    try {
      const json = JSON.parse(text) as {
        message?: string;
        category?: string;
        errors?: Array<{ code?: string; message?: string }>;
      };
      const nested = Array.isArray(json.errors)
        ? json.errors
            .map((item) => [item.code, item.message].filter(Boolean).join(': '))
            .filter(Boolean)
            .join(' | ')
        : '';
      return [fallback, json.category, json.message, nested].filter(Boolean).join(' — ');
    } catch {
      return `${fallback} — ${text.slice(0, 500)}`;
    }
  } catch {
    return fallback;
  }
}

const ARCOVA_CONTACT_PROPERTIES: HubSpotPropertyDefinition[] = [
  { name: 'arcova_contact_id', label: 'Arcova: Contact ID', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_company_id', label: 'Arcova: Company ID', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_company_name', label: 'Arcova: Company Name', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_company_domain', label: 'Arcova: Company Domain', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_contact_fit_score', label: 'Arcova: Contact Fit Score', type: 'number', fieldType: 'number', groupName: 'arcova_intelligence' },
  { name: 'arcova_overall_fit_score', label: 'Arcova: Overall Fit Score', type: 'number', fieldType: 'number', groupName: 'arcova_intelligence' },
  { name: 'arcova_contact_readiness_score', label: 'Arcova: Contact Readiness Score', type: 'number', fieldType: 'number', groupName: 'arcova_intelligence' },
  { name: 'arcova_contact_priority_score', label: 'Arcova: Contact Priority Score', type: 'number', fieldType: 'number', groupName: 'arcova_intelligence' },
  { name: 'arcova_action', label: 'Arcova: Recommended Action', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_seniority', label: 'Arcova: Seniority Level', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_function', label: 'Arcova: Business Function', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_enriched', label: 'Arcova: Enriched', type: 'bool', fieldType: 'booleancheckbox', groupName: 'arcova_intelligence' },
  { name: 'arcova_data_sourced_from', label: 'Arcova: Data Sourced From', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_enriched_email', label: 'Arcova: Enriched Email', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_enriched_at', label: 'Arcova: Enriched At', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_person_summary', label: 'Arcova: Person Summary', type: 'string', fieldType: 'textarea', groupName: 'arcova_intelligence' },
  { name: 'arcova_linkedin_url', label: 'Arcova: LinkedIn URL', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  // Outreach lifecycle — updated by /api/outreach/lemlist/dispatch and the
  // reply webhook. Surfaces "we've reached out / they replied" inside HubSpot
  // so reps not in Arcova still see the state.
  { name: 'arcova_outreach_status', label: 'Arcova: Outreach Status', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_last_outreach_at', label: 'Arcova: Last Outreach At', type: 'datetime', fieldType: 'date', groupName: 'arcova_intelligence' },
  { name: 'arcova_last_outreach_anchor', label: 'Arcova: Last Outreach Anchor', type: 'string', fieldType: 'textarea', groupName: 'arcova_intelligence' },
  { name: 'arcova_last_outreach_channel', label: 'Arcova: Last Outreach Channel', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
];

const ARCOVA_COMPANY_PROPERTIES: HubSpotPropertyDefinition[] = [
  { name: 'arcova_company_id', label: 'Arcova: Company ID', type: 'string', fieldType: 'text', groupName: 'arcova_intelligence' },
  { name: 'arcova_company_fit_score', label: 'Arcova: Company Fit Score', type: 'number', fieldType: 'number', groupName: 'arcova_intelligence' },
  { name: 'arcova_company_readiness_score', label: 'Arcova: Company Readiness Score', type: 'number', fieldType: 'number', groupName: 'arcova_intelligence' },
  { name: 'arcova_company_priority_score', label: 'Arcova: Company Priority Score', type: 'number', fieldType: 'number', groupName: 'arcova_intelligence' },
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
  const res = await fetch(`https://api.hubapi.com/crm/v3/properties/${objectType}/groups`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'arcova_intelligence', label: 'Arcova Intelligence', displayOrder: -1 }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(await describeHubSpotError(res));
  }
}

async function ensureProperties(accessToken: string, objectType: 'contacts' | 'companies', properties: HubSpotPropertyDefinition[]): Promise<void> {
  await Promise.all(
    properties.map(async (prop) => {
      const res = await fetch(`https://api.hubapi.com/crm/v3/properties/${objectType}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(hubSpotPropertyCreateBody(prop)),
      });
      if (!res.ok && res.status !== 409) {
        throw new Error(
          `Failed to ensure HubSpot property "${prop.name}" on ${objectType}: ${await describeHubSpotError(res)}`
        );
      }
    })
  );
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
): Promise<{ updated: number; errors: number; errorDetails: string[] }> {
  let updated = 0;
  let errors = 0;
  const errorDetails: string[] = [];
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
      if (Array.isArray(data.errors)) {
        errorDetails.push(
          ...data.errors
            .map((item: { code?: string; message?: string }) => [item.code, item.message].filter(Boolean).join(': '))
            .filter(Boolean)
        );
      }
    } else {
      errors += chunk.length;
      errorDetails.push(await describeHubSpotError(res));
    }
  }
  return { updated, errors, errorDetails };
}

// Upsert contacts by email — creates if not exists, updates if exists.
// HubSpot batch upsert requires idProperty + id on each input.
export async function batchUpsertContacts(
  accessToken: string,
  upserts: Array<{ email: string; properties: Record<string, string> }>
): Promise<{ upserted: number; errors: number; errorDetails: string[] }> {
  let upserted = 0;
  let errors = 0;
  const errorDetails: string[] = [];
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
      if (Array.isArray(data.errors)) {
        errorDetails.push(
          ...data.errors
            .map((item: { code?: string; message?: string }) => [item.code, item.message].filter(Boolean).join(': '))
            .filter(Boolean)
        );
      }
    } else {
      errors += chunk.length;
      errorDetails.push(await describeHubSpotError(res));
    }
  }
  return { upserted, errors, errorDetails };
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
): Promise<{ updated: number; errors: number; errorDetails: string[] }> {
  let updated = 0;
  let errors = 0;
  const errorDetails: string[] = [];
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
      if (Array.isArray(data.errors)) {
        errorDetails.push(
          ...data.errors
            .map((item: { code?: string; message?: string }) => [item.code, item.message].filter(Boolean).join(': '))
            .filter(Boolean)
        );
      }
    } else {
      errors += chunk.length;
      errorDetails.push(await describeHubSpotError(res));
    }
  }
  return { updated, errors, errorDetails };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID!;
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET!;
const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/hubspot/callback`;
const SCOPES = [
  'oauth',
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.companies.read',
  'crm.objects.companies.write',
  'crm.objects.deals.read',
].join(' ');

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
    mobilephone: string | null;
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
  const properties = ['firstname', 'lastname', 'email', 'jobtitle', 'company', 'website', 'hs_linkedin_url', 'city', 'country', 'phone', 'mobilephone'];
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
  const properties = 'firstname,lastname,email,jobtitle,company,website,hs_linkedin_url,city,country,phone,mobilephone';
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

// ── Token helper for outreach side-effects ────────────────────────────────
// Tiny convenience for routes (dispatch, webhook) that need to push status
// to HubSpot as a side-effect. Returns null if the user hasn't connected
// HubSpot or the token fetch fails — callers treat HubSpot push as best-effort.
export async function getHubSpotTokenForUser(
  userId: string,
): Promise<string | null> {
  try {
    const { nango: nangoLib, HUBSPOT_INTEGRATION_ID: integrationId } = await import('./nango');
    const { createClient } = await import('./supabase-server');
    const supabase = await createClient();
    const { data: conn } = await supabase
      .from('nango_connections')
      .select('nango_connection_id')
      .eq('user_id', userId)
      .eq('integration_id', integrationId)
      .maybeSingle();
    const connRow = conn as { nango_connection_id?: string } | null;
    if (!connRow?.nango_connection_id) return null;
    return (await nangoLib.getToken(integrationId, connRow.nango_connection_id)) as string;
  } catch {
    return null;
  }
}

// ── Outreach status push ──────────────────────────────────────────────────
// Single-contact PATCH by email. Used after a lemlist dispatch (status='sent')
// and from the reply webhook (status='replied'|'failed'). Only updates
// contacts that already exist in HubSpot — we don't create new ones from
// outreach activity, which would pollute the CRM.

export type OutreachHubSpotUpdate = {
  email: string;
  status: 'sent' | 'replied' | 'failed' | 'paused';
  anchor?: string | null;
  channel?: string | null;
  /** ISO timestamp. Defaults to now. */
  at?: string;
};

/**
 * Push outreach lifecycle data for one contact to HubSpot.
 *
 * Returns 'updated' on success, 'not_found' if the contact isn't in HubSpot
 * (404, expected — we silently skip), or 'error' on any other failure.
 * Callers should treat this as best-effort and NEVER block dispatch on it.
 */
export async function pushOutreachStatusByEmail(
  accessToken: string,
  update: OutreachHubSpotUpdate,
): Promise<'updated' | 'not_found' | 'error'> {
  const at = update.at ?? new Date().toISOString();
  const properties: Record<string, string> = {
    arcova_outreach_status: update.status,
    arcova_last_outreach_at: at,
  };
  if (update.anchor) properties.arcova_last_outreach_anchor = update.anchor;
  if (update.channel) properties.arcova_last_outreach_channel = update.channel;

  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(update.email)}?idProperty=email`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties }),
    },
  );
  if (res.ok) return 'updated';
  if (res.status === 404) return 'not_found';
  return 'error';
}

// ── Reply handling — runs when a contact REPLIES to a sequence ─────────────
// Two effects beyond the status mirror: (1) advance the contact's lifecycle
// stage so the active conversation is visible in HubSpot's pipeline, and
// (2) drop a task in the rep's HubSpot queue so the reply gets a human
// response. Both best-effort; callers never block on them.

/**
 * Advance a contact's HubSpot lifecycle stage. HubSpot only moves a contact
 * FORWARD through the lifecycle by default (it ignores backward writes unless
 * the portal explicitly allows them), so setting 'salesqualifiedlead' on a
 * replied contact promotes a lead/MQL without regressing an opportunity or
 * customer. Returns the same tri-state as the status push.
 */
export async function bumpContactLifecycleStage(
  accessToken: string,
  email: string,
  stage: string = 'salesqualifiedlead',
): Promise<'updated' | 'not_found' | 'error'> {
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { lifecyclestage: stage } }),
    },
  );
  if (res.ok) return 'updated';
  if (res.status === 404) return 'not_found';
  return 'error';
}

export type ReplyTaskInput = {
  email: string;
  contactName?: string | null;
  anchor?: string | null;
  /** Due date as epoch ms. Defaults to now. */
  dueAtMs?: number;
};

/**
 * Create a HubSpot task for the rep to respond to a sequence reply, associated
 * to the contact. Looks the contact up by email to get its id first (tasks
 * associate by internal id, not email). Returns 'created', 'not_found' if the
 * contact isn't in HubSpot, or 'error'.
 */
export async function createReplyFollowUpTask(
  accessToken: string,
  input: ReplyTaskInput,
): Promise<'created' | 'not_found' | 'error'> {
  // 1. Resolve the contact's internal id by email.
  const lookup = await fetch(
    `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(input.email)}?idProperty=email&properties=email`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (lookup.status === 404) return 'not_found';
  if (!lookup.ok) return 'error';
  const contact = (await lookup.json().catch(() => null)) as { id?: string } | null;
  const contactId = contact?.id;
  if (!contactId) return 'error';

  // 2. Create the task associated to that contact. associationTypeId 204 =
  //    HubSpot-defined task→contact association.
  const who = input.contactName?.trim() || input.email;
  const subject = `Reply to ${who} — outreach sequence`;
  const bodyLines = [
    `${who} replied to an Arcova-generated outreach sequence. Take the conversation human from here.`,
    input.anchor ? `\nAnchor: ${input.anchor}` : '',
  ].join('');

  const res = await fetch('https://api.hubapi.com/crm/v3/objects/tasks', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: {
        hs_task_subject: subject,
        hs_task_body: bodyLines,
        hs_task_status: 'NOT_STARTED',
        hs_task_priority: 'HIGH',
        hs_timestamp: String(input.dueAtMs ?? Date.now()),
      },
      associations: [
        {
          to: { id: contactId },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 204 }],
        },
      ],
    }),
  });
  if (res.ok) return 'created';
  return 'error';
}

/**
 * Convenience: run both reply-side effects (lifecycle bump + follow-up task)
 * for one contact. Best-effort — settles all, never throws. The status mirror
 * (pushOutreachStatusByEmail with status='replied') is a separate call the
 * caller still makes.
 */
export async function applyReplyEffectsToHubSpot(
  accessToken: string,
  input: ReplyTaskInput,
): Promise<void> {
  await Promise.allSettled([
    bumpContactLifecycleStage(accessToken, input.email),
    createReplyFollowUpTask(accessToken, input),
  ]);
}
