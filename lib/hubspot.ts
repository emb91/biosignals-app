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
