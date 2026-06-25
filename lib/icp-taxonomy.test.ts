import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeIcpTaxonomyPayload } from './icp-taxonomy';

test('normalizes ICP taxonomy payload aliases into canonical values', () => {
  const normalized = normalizeIcpTaxonomyPayload({
    companyType: 'biotech',
    therapeuticAreas: ['cancer', 'hematology', 'Not real'],
    modalities: ['cart', 'antibody drug conjugate', 'Not real'],
    developmentStages: ['Phase 1', 'phase ii', 'Approved', 'Not real'],
    customerTherapeuticAreas: ['kidney'],
    customerModalities: ['diagnostic'],
    customerDevelopmentStages: ['phase3'],
    companySizes: ['1-10', '51–200', 'not real'],
    liFollowerSizes: ['500-1,000', 'not real'],
    fundingStages: ['series_a', 'Series D+', 'grant-funded', 'not real'],
  });

  assert.deepEqual(normalized, {
    company_type: 'Biotech / Biopharma',
    therapeutic_areas: ['Oncology', 'Haematology'],
    modalities: ['CAR-T', 'ADC'],
    development_stages: ['Phase I', 'Phase II', 'Commercial'],
    customer_therapeutic_areas: ['Renal'],
    customer_modalities: ['Diagnostics'],
    customer_development_stages: ['Phase III'],
    company_sizes: ['1–10', '51–200'],
    li_follower_sizes: ['500–1,000'],
    funding_stages: ['Series A', 'Series D+', 'Grant-funded'],
  });
});

test('dedupes canonical ICP taxonomy values while preserving first occurrence', () => {
  const normalized = normalizeIcpTaxonomyPayload({
    companyType: 'SaaS',
    modalities: ['CAR-T', 'car t', 'mRNA', 'mrna'],
    developmentStages: ['Phase I', 'Phase 1'],
  });

  assert.deepEqual(normalized.modalities, ['CAR-T', 'mRNA']);
  assert.deepEqual(normalized.development_stages, ['Phase I']);
});
