import test from 'node:test';
import assert from 'node:assert/strict';
import { firstCompanyDomain, normalizeCompanyDomain } from './domain-utils';

test('normalizeCompanyDomain preserves valid hyphenated domains for provider filters', () => {
  assert.equal(normalizeCompanyDomain('https://www.Moderna-TX.com/about'), 'moderna-tx.com');
});

test('firstCompanyDomain falls back through website and legacy company_website', () => {
  assert.equal(
    firstCompanyDomain(null, '', 'https://legacy-biotech.example/pipeline'),
    'legacy-biotech.example',
  );
});

test('firstCompanyDomain prefers canonical domain before URL fields', () => {
  assert.equal(
    firstCompanyDomain('canonical-biotech.com', 'https://website.example', 'https://legacy.example'),
    'canonical-biotech.com',
  );
});
