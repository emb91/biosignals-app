import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findPendingTriageRowForOrg,
  listPendingTriageRowsForOrg,
  updatePendingTriageRowForOrg,
  type RawTriageRow,
} from './triage-pending-rows';

type RawUploadRecord = RawTriageRow & { org_id: string | null };
type Operation = {
  table: string;
  type: 'select' | 'update';
  filters: Record<string, unknown>;
  inFilters: Record<string, readonly unknown[]>;
  limitValue: number | null;
  values?: Record<string, unknown>;
};

class FakeSupabase {
  readonly rawUploads: RawUploadRecord[] = [];
  readonly operations: Operation[] = [];

  from(table: string) {
    return new FakeQuery(this, table);
  }
}

class FakeQuery {
  private readonly filters: Record<string, unknown> = {};
  private readonly inFilters: Record<string, readonly unknown[]> = {};
  private values: Record<string, unknown> | null = null;
  private type: Operation['type'] = 'select';
  private limitValue: number | null = null;

  constructor(private readonly db: FakeSupabase, private readonly table: string) {}

  select(_columns: string) {
    this.type = 'select';
    return this;
  }

  update(values: Record<string, unknown>) {
    this.type = 'update';
    this.values = values;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    this.inFilters[column] = values;
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  async maybeSingle(): Promise<{ data: RawUploadRecord | null; error: null }> {
    this.record();
    return { data: this.matchRows()[0] ?? null, error: null };
  }

  then: Promise<{ data: RawUploadRecord[] | null; error: null }>['then'] = (onfulfilled, onrejected) =>
    this.execute().then(onfulfilled, onrejected);

  private async execute(): Promise<{ data: RawUploadRecord[] | null; error: null }> {
    this.record();
    const rows = this.matchRows();
    if (this.type === 'update' && this.values) {
      for (const row of rows) Object.assign(row, this.values);
      return { data: null, error: null };
    }
    return { data: this.limitValue == null ? rows : rows.slice(0, this.limitValue), error: null };
  }

  private matchRows() {
    return this.table === 'raw_uploads'
      ? this.db.rawUploads.filter((row) => {
          for (const [column, value] of Object.entries(this.filters)) {
            if ((row as Record<string, unknown>)[column] !== value) return false;
          }
          for (const [column, values] of Object.entries(this.inFilters)) {
            if (!values.includes((row as Record<string, unknown>)[column])) return false;
          }
          return true;
        })
      : [];
  }

  private record() {
    this.db.operations.push({
      table: this.table,
      type: this.type,
      filters: { ...this.filters },
      inFilters: { ...this.inFilters },
      limitValue: this.limitValue,
      values: this.values ? { ...this.values } : undefined,
    });
  }
}

function rawUpload(overrides: Partial<RawUploadRecord>): RawUploadRecord {
  return {
    id: 'raw-1',
    user_id: 'user-1',
    org_id: 'org-1',
    batch_id: null,
    full_name: null,
    email: null,
    linkedin_url: null,
    company_name: null,
    status: 'awaiting_triage',
    raw_data: {},
    uploaded_at: null,
    triage_group: null,
    triage_override_group: null,
    triage_version: null,
    triage_scored_at: null,
    triage_overridden_by: null,
    triage_overridden_at: null,
    pinned_at: null,
    pinned_by: null,
    ...overrides,
  };
}

test('pending triage list scopes service-role raw uploads by org_id', async () => {
  const db = new FakeSupabase();
  db.rawUploads.push(
    rawUpload({ id: 'stale-org-row', user_id: 'shared-user', org_id: 'org-a' }),
    rawUpload({ id: 'current-org-row', user_id: 'shared-user', org_id: 'org-b' }),
    rawUpload({ id: 'completed-row', user_id: 'shared-user', org_id: 'org-b', status: 'enriched' }),
  );

  const result = await listPendingTriageRowsForOrg(db, 'org-b');

  assert.equal(result.error, null);
  assert.deepEqual(result.data.map((row) => row.id), ['current-org-row']);
  assert.equal(db.operations[0].filters.org_id, 'org-b');
  assert.equal('user_id' in db.operations[0].filters, false);
  assert.deepEqual(db.operations[0].inFilters.status, ['awaiting_triage', 'awaiting_enrichment']);
});

test('pending triage lookup and update reject stale rows from another org', async () => {
  const db = new FakeSupabase();
  db.rawUploads.push(
    rawUpload({ id: 'stale-org-row', user_id: 'shared-user', org_id: 'org-a' }),
    rawUpload({ id: 'current-org-row', user_id: 'shared-user', org_id: 'org-b' }),
  );

  const staleLookup = await findPendingTriageRowForOrg(db, 'org-b', 'stale-org-row');
  await updatePendingTriageRowForOrg(db, 'org-b', 'stale-org-row', { triage_override_group: 'low' });
  const currentLookup = await findPendingTriageRowForOrg(db, 'org-b', 'current-org-row');
  await updatePendingTriageRowForOrg(db, 'org-b', 'current-org-row', { triage_override_group: 'high' });

  assert.equal(staleLookup.data, null);
  assert.equal(currentLookup.data?.id, 'current-org-row');
  assert.equal(db.rawUploads.find((row) => row.id === 'stale-org-row')?.triage_override_group, null);
  assert.equal(db.rawUploads.find((row) => row.id === 'current-org-row')?.triage_override_group, 'high');

  const updateOperations = db.operations.filter((operation) => operation.type === 'update');
  assert.deepEqual(updateOperations.map((operation) => operation.filters), [
    { id: 'stale-org-row', org_id: 'org-b' },
    { id: 'current-org-row', org_id: 'org-b' },
  ]);
  assert.deepEqual(updateOperations[0].inFilters.status, ['awaiting_triage', 'awaiting_enrichment']);
});
