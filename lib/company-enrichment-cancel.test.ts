import assert from 'node:assert/strict';
import test from 'node:test';
import { cancelCompanyEnrichmentForUser } from './company-enrichment-cancel';

type DbResult = { data: unknown; error: { message?: string } | null };
type Operation = {
  table: string;
  type: 'select' | 'update';
  filters: Record<string, unknown>;
  values?: Record<string, unknown>;
};

class FakeSupabase {
  readonly orgMembers: Array<{ user_id: string; org_id: string }> = [];
  readonly userCompanies: Array<{ user_id: string; company_id: string }> = [];
  readonly companies: Array<{
    id: string;
    enrichment_refresh_status: string | null;
    enrichment_refresh_finished_at?: string;
    updated_at?: string;
  }> = [];
  readonly operations: Operation[] = [];

  from(table: string) {
    return new FakeQuery(this, table);
  }
}

class FakeQuery {
  private readonly filters: Record<string, unknown> = {};
  private values: Record<string, unknown> | null = null;
  private type: Operation['type'] = 'select';

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

  is(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  async maybeSingle(): Promise<DbResult> {
    this.record();
    if (this.table === 'user_companies') {
      return {
        data: this.db.userCompanies.find(
          (row) =>
            row.user_id === this.filters.user_id &&
            row.company_id === this.filters.company_id,
        ) ?? null,
        error: null,
      };
    }
    if (this.table === 'org_members') {
      return {
        data: this.db.orgMembers.find((row) => row.user_id === this.filters.user_id) ?? null,
        error: null,
      };
    }
    if (this.table === 'companies') {
      return {
        data: this.db.companies.find((row) => row.id === this.filters.id) ?? null,
        error: null,
      };
    }
    return { data: null, error: null };
  }

  then: Promise<DbResult>['then'] = (onfulfilled, onrejected) =>
    this.executeUpdate().then(onfulfilled, onrejected);

  private async executeUpdate(): Promise<DbResult> {
    this.record();
    if (this.table === 'companies' && this.values) {
      const row = this.db.companies.find((company) => company.id === this.filters.id);
      if (row) Object.assign(row, this.values);
    }
    return { data: null, error: null };
  }

  private record() {
    this.db.operations.push({
      table: this.table,
      type: this.type,
      filters: { ...this.filters },
      values: this.values ? { ...this.values } : undefined,
    });
  }
}

test('company enrichment cancellation does not touch companies without ownership', async () => {
  const db = new FakeSupabase();
  db.companies.push({ id: 'company-1', enrichment_refresh_status: 'running' });

  const result = await cancelCompanyEnrichmentForUser(db, 'user-1', 'company-1');

  assert.deepEqual(result, { found: false });
  assert.equal(db.companies[0].enrichment_refresh_status, 'running');
  assert.deepEqual(db.operations.map((operation) => operation.table), ['org_members', 'user_companies']);
});

test('company enrichment cancellation updates an owned running company', async () => {
  const db = new FakeSupabase();
  db.userCompanies.push({ user_id: 'user-1', company_id: 'company-1' });
  db.companies.push({ id: 'company-1', enrichment_refresh_status: 'running' });
  const finishedAt = new Date('2026-06-21T08:35:45.000Z');

  const result = await cancelCompanyEnrichmentForUser(db, 'user-1', 'company-1', () => finishedAt);

  assert.deepEqual(result, { found: true, status: 'cancelled', alreadyFinished: false });
  assert.equal(db.companies[0].enrichment_refresh_status, 'cancelled');
  assert.equal(db.companies[0].enrichment_refresh_finished_at, finishedAt.toISOString());
  assert.equal(db.companies[0].updated_at, finishedAt.toISOString());
  assert.deepEqual(db.operations.map((operation) => `${operation.table}:${operation.type}`), [
    'org_members:select',
    'user_companies:select',
    'companies:select',
    'companies:update',
  ]);
});
