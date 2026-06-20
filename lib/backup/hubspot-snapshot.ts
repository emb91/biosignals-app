import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { orgIdForUser } from '@/lib/org-context';
import { isR2Configured, putObject } from '@/lib/backup/r2';

/**
 * HubSpot → Cloudflare R2 backup engine.
 *
 *  - ensureBaselineSnapshot(): the GUARD. Runs before any Arcova write touches a customer's
 *    HubSpot. If no immutable baseline exists for that CRM yet, it captures one first and refuses
 *    to let the write proceed until it succeeds. This is the "you can always get back to the
 *    original" guarantee.
 *  - captureSnapshot(): a full export of contacts + companies (all properties), gzipped NDJSON,
 *    uploaded to R2. Used for both the baseline and the daily rolling backups.
 *
 * Failure policy: backups are fail-CLOSED by default — if the vault can't be written, the write
 * is blocked. Set HUBSPOT_BACKUP_REQUIRED=false to fail-open in an emergency.
 */

type MinimalSupabase = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const HUBSPOT_API = 'https://api.hubapi.com';

export type SnapshotKind = 'baseline' | 'rolling';

export type CaptureResult = {
  snapshotId: string;
  scopeKey: string;
  kind: SnapshotKind;
  contactsCount: number;
  companiesCount: number;
  bytes: number;
  contactsKey: string;
  companiesKey: string;
  manifestKey: string;
};

function backupsRequired(): boolean {
  return process.env.HUBSPOT_BACKUP_REQUIRED !== 'false';
}

export async function scopeKeyForUser(
  client: MinimalSupabase,
  userId: string,
): Promise<{ scopeKey: string; orgId: string | null }> {
  const orgId = await orgIdForUser(client, userId);
  return { scopeKey: orgId ? `org:${orgId}` : `user:${userId}`, orgId };
}

// ── HubSpot full export ─────────────────────────────────────────────────────

async function fetchAllPropertyNames(
  accessToken: string,
  objectType: 'contacts' | 'companies',
): Promise<string[]> {
  const res = await fetch(`${HUBSPOT_API}/crm/v3/properties/${objectType}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HubSpot property schema fetch (${objectType}) failed: ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ name?: string }> };
  return (data.results ?? []).map((p) => p.name).filter((n): n is string => Boolean(n));
}

type ExportedObject = { id: string; properties: Record<string, unknown> };

/**
 * Export every object of a type with ALL properties. Two-step (list ids, then batch-read full
 * properties) so we never truncate the property set on a long URL — a backup must be complete.
 */
async function exportAllObjects(
  accessToken: string,
  objectType: 'contacts' | 'companies',
): Promise<ExportedObject[]> {
  const propertyNames = await fetchAllPropertyNames(accessToken, objectType);

  // 1) page all ids
  const ids: string[] = [];
  let after: string | undefined;
  do {
    const params = new URLSearchParams({ limit: '100' });
    if (after) params.set('after', after);
    const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/${objectType}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HubSpot list ${objectType} failed: ${res.status}`);
    const data = (await res.json()) as { results?: Array<{ id: string }>; paging?: { next?: { after?: string } } };
    for (const r of data.results ?? []) ids.push(r.id);
    after = data.paging?.next?.after;
  } while (after);

  // 2) batch-read full properties, 100 at a time
  const out: ExportedObject[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/${objectType}/batch/read`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id })), properties: propertyNames }),
    });
    if (!res.ok && res.status !== 207) {
      throw new Error(`HubSpot batch-read ${objectType} failed: ${res.status}`);
    }
    const data = (await res.json()) as { results?: Array<{ id: string; properties: Record<string, unknown> }> };
    for (const r of data.results ?? []) out.push({ id: r.id, properties: r.properties ?? {} });
  }
  return out;
}

function toNdjsonGz(objects: ExportedObject[]): Uint8Array {
  const ndjson = objects.map((o) => JSON.stringify(o)).join('\n');
  return gzipSync(Buffer.from(ndjson, 'utf8'));
}

// ── Capture ─────────────────────────────────────────────────────────────────

/**
 * Capture a full snapshot to R2. Each snapshot lives under a unique snapshot-id path, so a
 * failed attempt can never clobber a good one (important: the baseline/ prefix is WORM-locked,
 * objects there can't be overwritten). The canonical snapshot is the row in hubspot_backups.
 */
export async function captureSnapshot(
  admin: MinimalSupabase,
  args: { userId: string; accessToken: string; kind: SnapshotKind; scopeKey: string; orgId: string | null; rowId: string },
): Promise<CaptureResult> {
  const { userId, accessToken, kind, scopeKey, orgId, rowId } = args;
  const snapshotId = randomUUID();
  const dateKey = new Date().toISOString().slice(0, 10);
  const safeScope = scopeKey.replace(/[^a-z0-9:_-]/gi, '_');
  const prefix =
    kind === 'baseline'
      ? `baseline/${safeScope}/${snapshotId}`
      : `rolling/${safeScope}/${dateKey}/${snapshotId}`;

  const [contacts, companies] = await Promise.all([
    exportAllObjects(accessToken, 'contacts'),
    exportAllObjects(accessToken, 'companies'),
  ]);

  const contactsGz = toNdjsonGz(contacts);
  const companiesGz = toNdjsonGz(companies);
  const contactsKey = `${prefix}/contacts.ndjson.gz`;
  const companiesKey = `${prefix}/companies.ndjson.gz`;
  const manifestKey = `${prefix}/manifest.json`;
  const bytes = contactsGz.byteLength + companiesGz.byteLength;

  const manifest = {
    snapshotId,
    scopeKey,
    orgId,
    userId,
    kind,
    takenAt: new Date().toISOString(),
    contactsCount: contacts.length,
    companiesCount: companies.length,
    contactsKey,
    companiesKey,
    format: 'gzipped-ndjson',
    schema: 'hubspot-object-{id,properties}',
  };

  await putObject(contactsKey, contactsGz, 'application/gzip');
  await putObject(companiesKey, companiesGz, 'application/gzip');
  await putObject(manifestKey, JSON.stringify(manifest, null, 2), 'application/json');

  await admin
    .from('hubspot_backups')
    .update({
      status: 'complete',
      snapshot_id: snapshotId,
      date_key: dateKey,
      contacts_key: contactsKey,
      companies_key: companiesKey,
      manifest_key: manifestKey,
      contacts_count: contacts.length,
      companies_count: companies.length,
      bytes,
      completed_at: new Date().toISOString(),
    })
    .eq('id', rowId);

  return {
    snapshotId,
    scopeKey,
    kind,
    contactsCount: contacts.length,
    companiesCount: companies.length,
    bytes,
    contactsKey,
    companiesKey,
    manifestKey,
  };
}

// ── Baseline guard ────────────────────────────────────────────────────────────

export type BaselineGuardResult =
  | { ok: true; created: boolean; skipped?: 'already-exists' | 'not-configured' }
  | { ok: false; reason: string };

/**
 * Ensure an immutable baseline exists for this CRM before any Arcova write. Returns ok:false
 * when backups are required but couldn't be made — callers MUST abort the write in that case.
 */
export async function ensureBaselineSnapshot(
  admin: MinimalSupabase,
  args: { userId: string; accessToken: string },
): Promise<BaselineGuardResult> {
  const { userId, accessToken } = args;
  const { scopeKey, orgId } = await scopeKeyForUser(admin, userId);

  // Fast path: baseline already complete.
  const { data: existing } = await admin
    .from('hubspot_backups')
    .select('id,status')
    .eq('scope_key', scopeKey)
    .eq('kind', 'baseline')
    .maybeSingle();

  if (existing?.status === 'complete') return { ok: true, created: false, skipped: 'already-exists' };

  if (!isR2Configured()) {
    if (backupsRequired()) {
      return { ok: false, reason: 'Backup vault (R2) is not configured; refusing to write to HubSpot.' };
    }
    return { ok: true, created: false, skipped: 'not-configured' };
  }

  // Claim the baseline slot. Unique index on (scope_key) where kind='baseline' serializes this.
  if (existing?.status === 'pending') {
    // Someone else is mid-capture (or a prior crash). Block this write to stay safe.
    return { ok: false, reason: 'Baseline capture already in progress; retry shortly.' };
  }

  const { data: claimed, error: claimErr } = await admin
    .from('hubspot_backups')
    .insert({
      scope_key: scopeKey,
      org_id: orgId,
      user_id: userId,
      kind: 'baseline',
      status: 'pending',
      snapshot_id: randomUUID(),
    })
    .select('id')
    .maybeSingle();

  if (claimErr || !claimed) {
    // Lost the race to another concurrent first-write. Re-check; proceed only if it completed.
    const { data: recheck } = await admin
      .from('hubspot_backups')
      .select('status')
      .eq('scope_key', scopeKey)
      .eq('kind', 'baseline')
      .maybeSingle();
    if (recheck?.status === 'complete') return { ok: true, created: false, skipped: 'already-exists' };
    return { ok: false, reason: 'Baseline capture is being created by another process; retry shortly.' };
  }
  const rowId: string = claimed.id as string;

  try {
    await captureSnapshot(admin, { userId, accessToken, kind: 'baseline', scopeKey, orgId, rowId });
    return { ok: true, created: true };
  } catch (err) {
    // Free the slot so a later write can retry. Orphaned R2 objects (if any) are harmless.
    await admin.from('hubspot_backups').delete().eq('id', rowId);
    const reason = err instanceof Error ? err.message : String(err);
    if (!backupsRequired()) return { ok: true, created: false, skipped: 'not-configured' };
    return { ok: false, reason: `Baseline capture failed: ${reason}` };
  }
}

/** Capture a rolling snapshot for a scope, unless one already exists for today. */
export async function captureRollingSnapshot(
  admin: MinimalSupabase,
  args: { userId: string; accessToken: string },
): Promise<CaptureResult | { skipped: 'already-today' | 'not-configured' }> {
  const { userId, accessToken } = args;
  if (!isR2Configured()) return { skipped: 'not-configured' };
  const { scopeKey, orgId } = await scopeKeyForUser(admin, userId);
  const dateKey = new Date().toISOString().slice(0, 10);

  const { data: today } = await admin
    .from('hubspot_backups')
    .select('id')
    .eq('scope_key', scopeKey)
    .eq('kind', 'rolling')
    .eq('status', 'complete')
    .eq('date_key', dateKey)
    .maybeSingle();
  if (today) return { skipped: 'already-today' };

  const { data: row } = await admin
    .from('hubspot_backups')
    .insert({
      scope_key: scopeKey,
      org_id: orgId,
      user_id: userId,
      kind: 'rolling',
      status: 'pending',
      snapshot_id: randomUUID(),
      date_key: dateKey,
    })
    .select('id')
    .maybeSingle();
  if (!row) return { skipped: 'already-today' };

  try {
    return await captureSnapshot(admin, { userId, accessToken, kind: 'rolling', scopeKey, orgId, rowId: row.id });
  } catch (err) {
    await admin
      .from('hubspot_backups')
      .update({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
      .eq('id', row.id);
    throw err;
  }
}
