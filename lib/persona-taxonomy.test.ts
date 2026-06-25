import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePersonaTaxonomyPayload } from './persona-taxonomy';

test('normalizes persona taxonomy payload aliases into canonical values', () => {
  const normalized = normalizePersonaTaxonomyPayload({
    functions: ['BD', 'clinical ops', 'R&D', 'QA', 'not real'],
    seniorityLevels: ['VP', 'C-Suite', 'Senior', 'Associate', 'not real'],
  });

  assert.deepEqual(normalized, {
    functions: [
      'Business Development',
      'Clinical Operations',
      'Research & Development',
      'Quality & Compliance',
    ],
    seniority_levels: [
      'VP / SVP',
      'C-Level',
      'Head of / Senior Manager',
      'Individual Contributor',
    ],
  });
});

test('dedupes canonical persona taxonomy values while preserving first occurrence', () => {
  const normalized = normalizePersonaTaxonomyPayload({
    functions: ['Business Development', 'bd', 'AI', 'AI & Machine Learning'],
    seniorityLevels: ['Director', 'director', 'VP / SVP', 'vp'],
  });

  assert.deepEqual(normalized.functions, ['Business Development', 'AI & Machine Learning']);
  assert.deepEqual(normalized.seniority_levels, ['Director', 'VP / SVP']);
});

test('extracts seniority from title-like seniority inputs', () => {
  const normalized = normalizePersonaTaxonomyPayload({
    seniorityLevels: ['VP Sales', 'Senior Director, Clinical Operations', 'Head of BD', 'Sales Manager'],
  });

  assert.deepEqual(normalized.seniority_levels, [
    'VP / SVP',
    'Director',
    'Head of / Senior Manager',
    'Manager',
  ]);
});
