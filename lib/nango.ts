import { Nango } from '@nangohq/node';

let client: Nango | null = null;

export function getNangoClient(): Nango {
  const secretKey = process.env.NANGO_SECRET_KEY;
  if (!secretKey) {
    throw new Error('NANGO_SECRET_KEY is not configured');
  }
  if (!client) client = new Nango({ secretKey });
  return client;
}

export const HUBSPOT_INTEGRATION_ID = 'hubspot';

export async function getNangoAccessToken(
  integrationId: string,
  connectionId: string,
): Promise<string> {
  const connection = await getNangoClient().getConnection(
    integrationId,
    connectionId,
    true,
    true,
  );
  const credentials = connection.credentials;
  if (
    !credentials ||
    credentials.type !== 'OAUTH2' ||
    typeof credentials.access_token !== 'string' ||
    !credentials.access_token
  ) {
    throw new Error(`No OAuth access token available for ${integrationId}/${connectionId}`);
  }
  return credentials.access_token;
}
