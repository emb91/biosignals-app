import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import test from 'node:test';

const originalResolveFilename = (Module as unknown as {
  _resolveFilename: (request: string, parent: unknown, isMain: boolean, options?: unknown) => string;
})._resolveFilename;

(Module as unknown as {
  _resolveFilename: (request: string, parent: unknown, isMain: boolean, options?: unknown) => string;
})._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request === '@/lib/org-context') {
    return path.join(__dirname, 'org-context.test-stub.js');
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const {
  fetchOrgOutreachActivityByPerson,
  findFreshOrgOutreachBlocker,
  findFreshOwnLegacyContactOutreachBlocker,
  findFreshTeammateOutreachBlocker,
  isClaimFresh,
  orgOutreachBlockerPayload,
} = require('./org-outreach') as typeof import('./org-outreach');

type OutreachRow = {
  id: string;
  org_id: string;
  person_id: string | null;
  contact_id?: string | null;
  user_id: string;
  dispatch_status: string;
  last_status_at: string | null;
  created_at: string | null;
  claim_released_at: string | null;
};

type ProfileRow = {
  user_id: string;
  full_name: string | null;
  email: string | null;
};

type QueryLog = {
  table: string;
  op: 'select' | 'update';
  filters: Array<{ op: string; column: string; value: unknown }>;
  updateValues?: Record<string, unknown>;
};

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function makeClient(input: { outreach?: OutreachRow[]; profiles?: ProfileRow[] } = {}) {
  const outreach = [...(input.outreach ?? [])];
  const profiles = [...(input.profiles ?? [])];
  const logs: QueryLog[] = [];

  function rowsForTable(table: string) {
    if (table === 'outreach_sequences') return outreach;
    if (table === 'user_profiles') return profiles;
    return [];
  }

  function matches(row: Record<string, unknown>, filters: QueryLog['filters']): boolean {
    return filters.every((filter) => {
      const actual = row[filter.column];
      if (filter.op === 'eq') return actual === filter.value;
      if (filter.op === 'neq') return actual !== filter.value;
      if (filter.op === 'in') return Array.isArray(filter.value) && filter.value.includes(actual);
      if (filter.op === 'is') return actual === filter.value;
      throw new Error(`Unsupported filter ${filter.op}`);
    });
  }

  function applySelect(table: string, filters: QueryLog['filters']) {
    return rowsForTable(table).filter((row) => matches(row as Record<string, unknown>, filters));
  }

  function makeBuilder(table: string) {
    const filters: QueryLog['filters'] = [];
    let op: QueryLog['op'] = 'select';
    let updateValues: Record<string, unknown> | undefined;

    const builder = {
      select() {
        op = 'select';
        return builder;
      },
      update(values: Record<string, unknown>) {
        op = 'update';
        updateValues = values;
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push({ op: 'eq', column, value });
        return builder;
      },
      neq(column: string, value: unknown) {
        filters.push({ op: 'neq', column, value });
        return builder;
      },
      in(column: string, value: unknown[]) {
        filters.push({ op: 'in', column, value });
        return builder;
      },
      is(column: string, value: unknown) {
        filters.push({ op: 'is', column, value });
        return builder;
      },
      maybeSingle() {
        const data = applySelect(table, filters)[0] ?? null;
        logs.push({ table, op: 'select', filters: [...filters] });
        return Promise.resolve({ data, error: null });
      },
      then(resolve: (value: { data: unknown[] | null; error: null }) => void, reject?: (error: unknown) => void) {
        try {
          logs.push({ table, op, filters: [...filters], updateValues });
          if (op === 'update') {
            const selected = applySelect(table, filters) as Array<Record<string, unknown>>;
            for (const row of selected) Object.assign(row, updateValues);
            resolve({ data: selected, error: null });
            return;
          }
          resolve({ data: applySelect(table, filters), error: null });
        } catch (error) {
          reject?.(error);
        }
      },
    };
    return builder;
  }

  return {
    outreach,
    logs,
    client: {
      from(table: string) {
        return makeBuilder(table);
      },
    },
  };
}

function row(overrides: Partial<OutreachRow>): OutreachRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    org_id: overrides.org_id ?? 'org_1',
    person_id: Object.hasOwn(overrides, 'person_id') ? overrides.person_id ?? null : 'person_1',
    contact_id: overrides.contact_id ?? null,
    user_id: overrides.user_id ?? 'teammate_1',
    dispatch_status: overrides.dispatch_status ?? 'draft',
    last_status_at: overrides.last_status_at ?? daysAgo(1),
    created_at: overrides.created_at ?? daysAgo(1),
    claim_released_at: overrides.claim_released_at ?? null,
  };
}

test('teammate draft blocks paid generation or staging for the same canonical person', async () => {
  const db = makeClient({
    outreach: [row({ dispatch_status: 'draft', user_id: 'teammate_1' })],
    profiles: [{ user_id: 'teammate_1', full_name: 'Sarah', email: 'sarah@example.com' }],
  });

  const blocker = await findFreshOrgOutreachBlocker(db.client, {
    userId: 'user_1',
    orgId: 'org_1',
    personId: 'person_1',
  });

  assert.equal(blocker?.status, 'draft');
  assert.equal(blocker?.userName, 'Sarah');
  assert.equal(orgOutreachBlockerPayload(blocker!).code, 'org_outreach_collision');
});

test('teammate queued sent and replied claims block generation, with strongest state winning', async () => {
  const db = makeClient({
    outreach: [
      row({ id: 'queued', dispatch_status: 'queued', user_id: 'teammate_queued' }),
      row({ id: 'sent', dispatch_status: 'sent', user_id: 'teammate_sent' }),
      row({ id: 'replied', dispatch_status: 'replied', user_id: 'teammate_replied' }),
    ],
    profiles: [{ user_id: 'teammate_replied', full_name: 'Priya', email: 'priya@example.com' }],
  });

  const blocker = await findFreshOrgOutreachBlocker(db.client, {
    userId: 'user_1',
    orgId: 'org_1',
    personId: 'person_1',
  });

  assert.equal(blocker?.status, 'replied');
  assert.equal(blocker?.userName, 'Priya');
  assert.equal(blocker?.customerFacing, true);
});

test('expired in-flight claims are released and no longer block new outreach', async () => {
  const db = makeClient({
    outreach: [row({ id: 'old_sent', dispatch_status: 'sent', last_status_at: daysAgo(45), created_at: daysAgo(45) })],
  });

  const blocker = await findFreshOrgOutreachBlocker(db.client, {
    userId: 'user_1',
    orgId: 'org_1',
    personId: 'person_1',
  });

  assert.equal(blocker, null);
  assert.ok(db.outreach[0].claim_released_at);
  assert.equal(db.logs.some((entry) => entry.op === 'update' && entry.table === 'outreach_sequences'), true);
});

test('released or stale claims are not fresh', () => {
  assert.equal(isClaimFresh(row({ dispatch_status: 'draft', last_status_at: daysAgo(20) })), false);
  assert.equal(isClaimFresh(row({ dispatch_status: 'sent', last_status_at: daysAgo(45) })), false);
  assert.equal(isClaimFresh(row({ dispatch_status: 'sent', claim_released_at: daysAgo(1) })), false);
  assert.equal(isClaimFresh(row({ dispatch_status: 'replied', last_status_at: daysAgo(10) })), true);
});

test('own active draft blocks another paid generated draft', async () => {
  const db = makeClient({
    outreach: [row({ dispatch_status: 'draft', user_id: 'user_1' })],
  });

  const blocker = await findFreshOrgOutreachBlocker(db.client, {
    userId: 'user_1',
    orgId: 'org_1',
    personId: 'person_1',
  });

  assert.equal(blocker?.status, 'draft');
  assert.equal(blocker?.userName, 'You');
  assert.equal(orgOutreachBlockerPayload(blocker!).message, 'You already have an active sequence with this contact.');
});

test('own legacy contact-keyed draft blocks another paid generated draft', async () => {
  const db = makeClient({
    outreach: [row({ contact_id: 'contact_1', dispatch_status: 'draft', person_id: null, user_id: 'user_1' })],
  });

  const blocker = await findFreshOwnLegacyContactOutreachBlocker(db.client, {
    userId: 'user_1',
    personId: 'person_1',
    contactIds: ['contact_1'],
  });

  assert.equal(blocker?.status, 'draft');
  assert.equal(blocker?.userName, 'You');
  assert.equal(blocker?.personId, 'person_1');
});

test('dispatch gate allows the caller to send their own draft but blocks teammate drafts', async () => {
  const ownDraft = makeClient({
    outreach: [row({ dispatch_status: 'draft', user_id: 'user_1' })],
  });
  assert.equal(
    await findFreshTeammateOutreachBlocker(ownDraft.client, {
      userId: 'user_1',
      orgId: 'org_1',
      personId: 'person_1',
    }),
    null,
  );

  const teammateDraft = makeClient({
    outreach: [row({ dispatch_status: 'draft', user_id: 'teammate_1' })],
    profiles: [{ user_id: 'teammate_1', full_name: 'Sarah', email: 'sarah@example.com' }],
  });
  const blocker = await findFreshTeammateOutreachBlocker(teammateDraft.client, {
    userId: 'user_1',
    orgId: 'org_1',
    personId: 'person_1',
  });
  assert.equal(blocker?.status, 'draft');
  assert.equal(blocker?.userName, 'Sarah');
});

test('org read surface returns teammate activity by canonical person id', async () => {
  const db = makeClient({
    outreach: [row({ dispatch_status: 'sent', user_id: 'teammate_1' })],
    profiles: [{ user_id: 'teammate_1', full_name: 'Sarah', email: 'sarah@example.com' }],
  });

  const activity = await fetchOrgOutreachActivityByPerson(db.client, {
    userId: 'user_1',
    personIds: ['person_1'],
  });

  assert.equal(activity.get('person_1')?.status, 'sent');
  assert.equal(activity.get('person_1')?.userName, 'Sarah');
});

test('sequence generation route blocks before credit reservation or LLM work and uses org/person credit identity', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/api/outreach/sequence/route.ts'), 'utf8');

  const blockerIndex = source.indexOf('const blocker = await findFreshOrgOutreachBlocker');
  const reserveIndex = source.indexOf('const reservation = await reserveCreditsWithIncludedAllowance');
  const llmIndex = source.indexOf('const completion = await completeLlm');
  assert.ok(blockerIndex > -1, 'expected generation route to check org outreach blocker');
  assert.ok(reserveIndex > -1, 'expected generation route to reserve credits');
  assert.ok(llmIndex > -1, 'expected generation route to call LLM');
  assert.ok(blockerIndex < reserveIndex, 'collision check should happen before reserving credits');
  assert.ok(blockerIndex < llmIndex, 'collision check should happen before LLM work');
  assert.match(source, /orgId:\s*ctx\.orgId/);
  assert.match(source, /entityId:\s*access\.personId/);
  assert.match(source, /org_id:\s*ctx\.orgId/);
  assert.match(source, /person_id:\s*access\.personId/);
});
