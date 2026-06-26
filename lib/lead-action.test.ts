import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import test from 'node:test';

const originalResolveFilename = (Module as unknown as {
  _resolveFilename: (request: string, parent: unknown, isMain: boolean, options?: unknown) => string;
})._resolveFilename;

(Module as unknown as {
  _resolveFilename: (request: string, parent: unknown, isMain: boolean, options?: unknown) => string;
})._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request === '@/lib/effective-priority') {
    return path.join(__dirname, 'effective-priority.js');
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const { getAccountRowAction } = require('./lead-action') as typeof import('./lead-action');

test('zero-contact low-fit accounts are deprioritized instead of sourced', () => {
  assert.equal(
    getAccountRowAction({
      company_fit_score: 45,
      contact_count: 0,
      readiness_score: null,
      crm_status: 'none',
    }),
    'deprioritize',
  );
});

test('zero-contact high-fit accounts are sourced', () => {
  assert.equal(
    getAccountRowAction({
      company_fit_score: 95,
      contact_count: 0,
      readiness_score: null,
      crm_status: 'none',
    }),
    'source_contact',
  );
});

test('zero-contact high-fit accounts preserve current source precedence over CRM suppression', () => {
  assert.equal(
    getAccountRowAction({
      company_fit_score: 95,
      contact_count: 0,
      readiness_score: 1,
      crm_status: 'customer',
      crm_closed_at: '2099-01-01T00:00:00.000Z',
    }),
    'source_contact',
  );
});

test('CRM-suppressed accounts with contacts are still deprioritized', () => {
  assert.equal(
    getAccountRowAction({
      company_fit_score: 95,
      best_contact_fit: 95,
      contact_count: 2,
      readiness_score: 1,
      crm_status: 'customer',
      crm_closed_at: '2099-01-01T00:00:00.000Z',
    }),
    'deprioritize',
  );
});

test('accounts without readiness snapshots still use the legacy readiness fallback', () => {
  assert.equal(
    getAccountRowAction({
      company_fit_score: 95,
      best_contact_fit: 95,
      max_contact_readiness_score: 95,
      contact_count: 2,
      readiness_score: null,
      crm_status: 'none',
    }),
    'reach_out',
  );
});
