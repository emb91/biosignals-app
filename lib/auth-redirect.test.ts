import test from 'node:test';
import assert from 'node:assert/strict';
import { safeRelativeRedirect } from './auth-redirect';

test('safeRelativeRedirect keeps same-origin relative paths with query intent', () => {
  assert.equal(
    safeRelativeRedirect('/settings/billing?plan=starter&billing=annual'),
    '/settings/billing?plan=starter&billing=annual',
  );
  assert.equal(safeRelativeRedirect('/today#top'), '/today#top');
});

test('safeRelativeRedirect rejects open redirect shapes', () => {
  for (const value of [
    'https://evil.example/settings/billing',
    '//evil.example/settings/billing',
    '/\\evil.example',
    'settings/billing',
    '   ',
    '/settings\\billing',
  ]) {
    assert.equal(safeRelativeRedirect(value, '/fallback'), '/fallback');
  }
});
