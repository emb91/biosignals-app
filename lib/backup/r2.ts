import { AwsClient } from 'aws4fetch';

/**
 * Minimal Cloudflare R2 client (S3-compatible) for the HubSpot backup vault.
 *
 * Uses aws4fetch for SigV4 signing — tiny, fetch-based, runs fine in Vercel Node functions.
 * We only need put / get / list; deletes are handled by the bucket's lifecycle rule (rolling/)
 * and forbidden by the bucket lock rule (baseline/), so there is deliberately no delete here.
 */

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}

let cached: { client: AwsClient; baseUrl: string; bucket: string } | null = null;

function r2(): { client: AwsClient; baseUrl: string; bucket: string } {
  if (cached) return cached;
  const accountId = env('R2_ACCOUNT_ID');
  const bucket = env('R2_BUCKET');
  const client = new AwsClient({
    accessKeyId: env('R2_ACCESS_KEY_ID'),
    secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    region: 'auto',
    service: 's3',
  });
  cached = { client, baseUrl: `https://${accountId}.r2.cloudflarestorage.com`, bucket };
  return cached;
}

function objectUrl(key: string): string {
  const { baseUrl, bucket } = r2();
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  return `${baseUrl}/${bucket}/${encodedKey}`;
}

export async function putObject(
  key: string,
  body: Uint8Array | string,
  contentType = 'application/octet-stream',
): Promise<void> {
  const { client } = r2();
  const contentLength =
    typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.byteLength;
  const res = await client.fetch(objectUrl(key), {
    method: 'PUT',
    body,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(contentLength),
    },
  });
  if (!res.ok) {
    throw new Error(`R2 PUT ${key} failed: ${res.status} ${await res.text().catch(() => '')}`.trim());
  }
}

/** Returns the object bytes, or null if it does not exist (404). */
export async function getObject(key: string): Promise<Uint8Array | null> {
  const { client } = r2();
  const res = await client.fetch(objectUrl(key), { method: 'GET' });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`R2 GET ${key} failed: ${res.status} ${await res.text().catch(() => '')}`.trim());
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** List object keys under a prefix (handles continuation). For audits/tooling. */
export async function listObjects(prefix: string): Promise<string[]> {
  const { client, baseUrl, bucket } = r2();
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const params = new URLSearchParams({ 'list-type': '2', prefix });
    if (continuationToken) params.set('continuation-token', continuationToken);
    const res = await client.fetch(`${baseUrl}/${bucket}?${params.toString()}`, { method: 'GET' });
    if (!res.ok) {
      throw new Error(`R2 LIST ${prefix} failed: ${res.status}`);
    }
    const xml = await res.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    continuationToken = truncated
      ? xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1]
      : undefined;
  } while (continuationToken);
  return keys;
}
