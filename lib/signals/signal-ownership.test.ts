import test from 'node:test';
import assert from 'node:assert/strict';
import { assertUserOwnsSignalEntity } from './signal-ownership';

type MockRow = Record<string, unknown> | null;

function mockSupabase(input: {
  ownedCompany?: MockRow;
  ownedContact?: MockRow;
}) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        is(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        async maybeSingle() {
          if (table === 'user_companies') {
            return { data: input.ownedCompany, error: null };
          }
          if (table === 'contacts') {
            return { data: input.ownedContact, error: null };
          }
          return { data: null, error: new Error(`unexpected table ${table}`) };
        },
      };
      return builder;
    },
  } as any;
}

test('admits separately owned company and contact when strict company match is not required', async () => {
  const result = await assertUserOwnsSignalEntity(mockSupabase({
    ownedCompany: { company_id: 'company-new' },
    ownedContact: { id: 'contact-1', company_id: 'company-old' },
  }), {
    userId: 'user-1',
    companyId: 'company-new',
    contactId: 'contact-1',
  });

  assert.equal(result.ok, true);
});

test('rejects contact/company cross-wiring when strict company match is required', async () => {
  const result = await assertUserOwnsSignalEntity(mockSupabase({
    ownedCompany: { company_id: 'company-b' },
    ownedContact: { id: 'contact-1', company_id: 'company-a' },
  }), {
    userId: 'user-1',
    companyId: 'company-b',
    contactId: 'contact-1',
    requireContactCompanyMatch: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'contact is not associated with the target company');
});

test('admits strict contact/company ownership when contact belongs to target company', async () => {
  const result = await assertUserOwnsSignalEntity(mockSupabase({
    ownedCompany: { company_id: 'company-a' },
    ownedContact: { id: 'contact-1', company_id: 'company-a' },
  }), {
    userId: 'user-1',
    companyId: 'company-a',
    contactId: 'contact-1',
    requireContactCompanyMatch: true,
  });

  assert.equal(result.ok, true);
});
