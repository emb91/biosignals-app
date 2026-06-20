import { Nango } from '@nangohq/node';

export const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

export const HUBSPOT_INTEGRATION_ID = 'hubspot';

export async function getNangoAccessToken(
  integrationId: string,
  connectionId: string,
): Promise<string> {
  const connection = await nango.getConnection(
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
