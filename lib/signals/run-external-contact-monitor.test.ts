import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

const moduleLoader = Module as unknown as {
  _load: (this: unknown, request: string, parent: unknown, isMain: boolean) => unknown;
};

test('returns empty result without querying contacts when the user has no org', async () => {
  const originalLoad = moduleLoader._load;
  const originalWarn = console.warn;
  const queriedTables: string[] = [];
  const orgFilters: Record<string, unknown> = {};
  let pipelineCalls = 0;

  const admin = {
    from(table: string) {
      queriedTables.push(table);
      assert.equal(table, 'org_members', 'contacts should not be queried when no org_id exists');

      const builder = {
        select(columns: string) {
          assert.equal(columns, 'org_id');
          return builder;
        },
        eq(column: string, value: unknown) {
          orgFilters[column] = value;
          return builder;
        },
        async maybeSingle() {
          return { data: null, error: null };
        },
      };

      return builder;
    },
  };

  moduleLoader._load = function loadStub(
    this: unknown,
    request: string,
    parent: unknown,
    isMain: boolean,
  ): unknown {
    if (request === '@/lib/supabase-admin') {
      return { createAdminClient: () => admin };
    }
    if (request === '@/lib/enrichment-pipeline') {
      return {
        runContactResolutionPipelineForContact: async () => {
          pipelineCalls += 1;
          return {
            emittedSignalTypes: [],
            recomputedCompanyIds: [],
          };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  console.warn = () => undefined;

  try {
    delete require.cache[require.resolve('./run-external-contact-monitor')];
    const { runExternalContactMonitor } = require(
      './run-external-contact-monitor',
    ) as typeof import('./run-external-contact-monitor');

    const result = await runExternalContactMonitor({ userId: 'arcova-user' });

    assert.deepEqual(result, {
      processed: 0,
      skipped_running: 0,
      failed: 0,
      emitted_signal_types: [],
      recomputed_companies: [],
      failures: [],
    });
    assert.deepEqual(queriedTables, ['org_members']);
    assert.deepEqual(orgFilters, { user_id: 'arcova-user' });
    assert.equal(pipelineCalls, 0);
  } finally {
    moduleLoader._load = originalLoad;
    console.warn = originalWarn;
    delete require.cache[require.resolve('./run-external-contact-monitor')];
  }
});
