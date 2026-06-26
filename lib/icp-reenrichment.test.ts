import assert from 'node:assert/strict';
import test from 'node:test';

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean,
) => unknown;

type MutableModule = typeof import('node:module') & {
  _load: ModuleLoader;
};

const moduleLoader = require('node:module') as MutableModule;
const originalLoad = moduleLoader._load;

moduleLoader._load = function patchedLoad(
  this: unknown,
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean,
): unknown {
  if (request.startsWith('@/')) return {};
  return originalLoad.call(this, request, parent, isMain);
};

let summarizeError: (error: unknown) => string;

try {
  ({ summarizeError } = require('./icp-reenrichment') as {
    summarizeError(error: unknown): string;
  });
} finally {
  moduleLoader._load = originalLoad;
}

test('summarizeError keeps PostgREST plain-object diagnostics', () => {
  const summary = summarizeError({
    code: '42703',
    message: 'column personas.signals does not exist',
  });

  assert.notEqual(summary, 'Unknown error');
  assert.match(summary, /column personas\.signals does not exist/);
  assert.match(summary, /42703/);
});
