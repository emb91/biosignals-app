import { gunzipSync } from 'node:zlib';
import { getObject } from '@/lib/backup/r2';
import {
  batchUpdateContacts,
  batchUpdateCompanies,
  ARCOVA_CONTACT_PROPERTY_NAMES,
  ARCOVA_COMPANY_PROPERTY_NAMES,
  ARCOVA_WRITTEN_NATIVE_CONTACT_FIELDS,
} from '@/lib/hubspot';

/**
 * Restore a HubSpot account from a snapshot in R2.
 *
 * Scopes (what to put back):
 *  - 'arcova' (default): only the properties Arcova ever writes, set back to their snapshot
 *    values — clears the ones that were empty at snapshot time. Surgically undoes Arcova's
 *    impact without touching anything the customer owns. This is the everyday rollback.
 *  - 'native': only the native fields Arcova overwrites (jobtitle, hs_linkedin_url,
 *    lifecyclestage). Use to undo just the scary overwrites and keep the enrichment.
 *  - 'full': every writable property from the snapshot, conservative (only non-empty values
 *    are written back; nothing is cleared). For true disaster recovery.
 *
 * Restore is property-level on objects that existed at snapshot time. It does not delete objects
 * or tasks created after the snapshot — that is intentional and safe.
 */

type MinimalSupabase = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type RestoreScope = 'arcova' | 'native' | 'full';

type SnapshotObject = { id: string; properties: Record<string, unknown> };

const HUBSPOT_API = 'https://api.hubapi.com';

function parseNdjsonGz(bytes: Uint8Array | null): SnapshotObject[] {
  if (!bytes) return [];
  const text = gunzipSync(Buffer.from(bytes)).toString('utf8');
  if (!text.trim()) return [];
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SnapshotObject);
}

async function fetchWritablePropertyNames(
  accessToken: string,
  objectType: 'contacts' | 'companies',
): Promise<Set<string>> {
  const res = await fetch(`${HUBSPOT_API}/crm/v3/properties/${objectType}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HubSpot property schema fetch (${objectType}) failed: ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<{ name?: string; modificationMetadata?: { readOnlyValue?: boolean }; calculated?: boolean }>;
  };
  const writable = new Set<string>();
  for (const p of data.results ?? []) {
    if (!p.name) continue;
    if (p.calculated) continue;
    if (p.modificationMetadata?.readOnlyValue) continue;
    writable.add(p.name);
  }
  return writable;
}

function toStringValue(v: unknown): string {
  if (v == null) return '';
  return typeof v === 'string' ? v : String(v);
}

/**
 * Build the {id, properties} update list for a set of snapshot objects, given the property names
 * we're allowed to touch and whether empty snapshot values should clear the live value.
 */
function buildUpdates(
  objects: SnapshotObject[],
  allowed: Set<string>,
  { clearEmpty }: { clearEmpty: boolean },
): Array<{ id: string; properties: Record<string, string> }> {
  const updates: Array<{ id: string; properties: Record<string, string> }> = [];
  for (const obj of objects) {
    const properties: Record<string, string> = {};
    for (const name of allowed) {
      const raw = obj.properties[name];
      const value = toStringValue(raw);
      if (value === '') {
        if (clearEmpty) properties[name] = '';
      } else {
        properties[name] = value;
      }
    }
    if (Object.keys(properties).length > 0) updates.push({ id: obj.id, properties });
  }
  return updates;
}

export type RestoreResult = {
  scope: RestoreScope;
  dryRun: boolean;
  contacts: { objects: number; updates: number; updated?: number; errors?: number };
  companies: { objects: number; updates: number; updated?: number; errors?: number };
  errorDetails: string[];
};

export async function restoreFromSnapshot(
  admin: MinimalSupabase,
  args: {
    accessToken: string;
    snapshotId: string;
    scope?: RestoreScope;
    dryRun?: boolean;
    /** Restrict restore to a single object type. */
    objectTypes?: Array<'contacts' | 'companies'>;
  },
): Promise<RestoreResult> {
  const scope: RestoreScope = args.scope ?? 'arcova';
  const dryRun = args.dryRun ?? true;
  const objectTypes = args.objectTypes ?? ['contacts', 'companies'];

  const { data: row } = await admin
    .from('hubspot_backups')
    .select('contacts_key,companies_key,status')
    .eq('snapshot_id', args.snapshotId)
    .maybeSingle();
  if (!row) throw new Error(`No backup found for snapshot ${args.snapshotId}`);
  if (row.status !== 'complete') throw new Error(`Snapshot ${args.snapshotId} is ${row.status}, not complete`);

  // Resolve allowed property sets per scope.
  let contactAllowed = new Set<string>();
  let companyAllowed = new Set<string>();
  let clearEmpty = false;

  if (scope === 'arcova') {
    contactAllowed = new Set([...ARCOVA_CONTACT_PROPERTY_NAMES, ...ARCOVA_WRITTEN_NATIVE_CONTACT_FIELDS]);
    companyAllowed = new Set(ARCOVA_COMPANY_PROPERTY_NAMES);
    clearEmpty = true; // undo Arcova writes, including clearing fields that were empty originally
  } else if (scope === 'native') {
    contactAllowed = new Set(ARCOVA_WRITTEN_NATIVE_CONTACT_FIELDS);
    companyAllowed = new Set<string>();
    clearEmpty = true;
  } else {
    // 'full' — every writable property, conservative (never clears)
    if (objectTypes.includes('contacts')) contactAllowed = await fetchWritablePropertyNames(args.accessToken, 'contacts');
    if (objectTypes.includes('companies')) companyAllowed = await fetchWritablePropertyNames(args.accessToken, 'companies');
    clearEmpty = false;
  }

  const result: RestoreResult = {
    scope,
    dryRun,
    contacts: { objects: 0, updates: 0 },
    companies: { objects: 0, updates: 0 },
    errorDetails: [],
  };

  if (objectTypes.includes('contacts') && contactAllowed.size > 0) {
    const objects = parseNdjsonGz(await getObject(row.contacts_key));
    const updates = buildUpdates(objects, contactAllowed, { clearEmpty });
    result.contacts.objects = objects.length;
    result.contacts.updates = updates.length;
    if (!dryRun && updates.length > 0) {
      const r = await batchUpdateContacts(args.accessToken, updates);
      result.contacts.updated = r.updated;
      result.contacts.errors = r.errors;
      result.errorDetails.push(...r.errorDetails);
    }
  }

  if (objectTypes.includes('companies') && companyAllowed.size > 0) {
    const objects = parseNdjsonGz(await getObject(row.companies_key));
    const updates = buildUpdates(objects, companyAllowed, { clearEmpty });
    result.companies.objects = objects.length;
    result.companies.updates = updates.length;
    if (!dryRun && updates.length > 0) {
      const r = await batchUpdateCompanies(args.accessToken, updates);
      result.companies.updated = r.updated;
      result.companies.errors = r.errors;
      result.errorDetails.push(...r.errorDetails);
    }
  }

  return result;
}
