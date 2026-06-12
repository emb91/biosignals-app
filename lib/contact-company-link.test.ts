import test from 'node:test';
import assert from 'node:assert/strict';
import { syncContactCompanyLink } from './contact-company-link';

/**
 * Minimal chainable Supabase mock. Every builder method returns the same
 * builder; the builder is awaitable and also exposes maybeSingle(). The
 * terminal result is decided by inspecting the recorded table + filters.
 */
function makeSupabase(opts: {
  ownedCompanyIds?: string[];
  companyByDomain?: Record<string, string>;
  userCompanyIds?: string[];
  companiesByName?: Array<{ id: string; company_name: string }>;
  onContactUpdate?: (payload: Record<string, unknown>) => void;
}) {
  const owned = new Set(opts.ownedCompanyIds ?? []);

  function builder(table: string) {
    const state: { filters: Record<string, unknown>; op: 'select' | 'update'; payload?: Record<string, unknown> } = {
      filters: {},
      op: 'select',
    };

    const resolve = () => {
      if (table === 'user_companies' && state.op === 'select') {
        if (state.filters.company_id !== undefined) {
          // userOwnsCompany lookup
          const id = String(state.filters.company_id);
          return { data: owned.has(id) ? { company_id: id } : null, error: null };
        }
        // list of company ids for the user
        return { data: (opts.userCompanyIds ?? []).map((company_id) => ({ company_id })), error: null };
      }
      if (table === 'companies' && state.op === 'select') {
        if (state.filters.domain !== undefined) {
          const id = opts.companyByDomain?.[String(state.filters.domain)];
          return { data: id ? { id } : null, error: null };
        }
        return { data: opts.companiesByName ?? [], error: null };
      }
      if (table === 'contacts' && state.op === 'update') {
        opts.onContactUpdate?.(state.payload ?? {});
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };

    const chain: Record<string, unknown> = {
      select: () => chain,
      update: (payload: Record<string, unknown>) => {
        state.op = 'update';
        state.payload = payload;
        return chain;
      },
      eq: (col: string, val: unknown) => {
        state.filters[col] = val;
        return chain;
      },
      in: () => chain,
      ilike: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve(resolve()),
      then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve(resolve()).then(onFulfilled),
    };
    return chain;
  }

  return { from: (table: string) => builder(table) };
}

test('syncContactCompanyLink retains the existing FK when no company resolves', async () => {
  let wrote = false;
  const supabase = makeSupabase({ onContactUpdate: () => (wrote = true) });
  const result = await syncContactCompanyLink(supabase as never, {
    userId: 'user-1',
    contactId: 'contact-1',
    resolvedCompanyName: 'Unknown Co',
    resolvedCompanyDomain: null,
    preferredCompanyId: null,
    currentCompanyId: 'old-company-id',
  });
  // The prior link must survive — never null it without a replacement.
  assert.equal(result, 'old-company-id');
  assert.equal(wrote, false, 'no write should occur when there is nothing new to link');
});

test('syncContactCompanyLink links by domain and writes the new FK', async () => {
  let written: Record<string, unknown> | null = null;
  const supabase = makeSupabase({
    ownedCompanyIds: ['sanguine-id'],
    companyByDomain: { 'sanguinebio.com': 'sanguine-id' },
    onContactUpdate: (p) => (written = p),
  });
  const result = await syncContactCompanyLink(supabase as never, {
    userId: 'user-1',
    contactId: 'contact-1',
    resolvedCompanyName: 'Sanguine Biosciences',
    resolvedCompanyDomain: 'sanguinebio.com',
    preferredCompanyId: null,
    currentCompanyId: null,
  });
  assert.equal(result, 'sanguine-id');
  assert.ok(written, 'a write should occur for a newly resolved link');
  assert.equal((written as Record<string, unknown>).company_id, 'sanguine-id');
});

test('syncContactCompanyLink is a no-op write when the link is already correct', async () => {
  let wrote = false;
  const supabase = makeSupabase({
    ownedCompanyIds: ['sanguine-id'],
    companyByDomain: { 'sanguinebio.com': 'sanguine-id' },
    onContactUpdate: () => (wrote = true),
  });
  const result = await syncContactCompanyLink(supabase as never, {
    userId: 'user-1',
    contactId: 'contact-1',
    resolvedCompanyName: 'Sanguine Biosciences',
    resolvedCompanyDomain: 'sanguinebio.com',
    preferredCompanyId: null,
    currentCompanyId: 'sanguine-id',
  });
  assert.equal(result, 'sanguine-id');
  assert.equal(wrote, false, 'should not re-write an already-correct FK');
});
