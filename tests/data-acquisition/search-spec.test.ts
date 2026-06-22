import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apolloOrganizationMatchesIcp,
  apolloOrganizationMatchesIcpKeywords,
  buildApolloCompanySearchRecipes,
  icpKeywordCorpus,
  type AcquisitionIcp,
} from '../../lib/data-acquisition/search-spec';

const oncologyIcp: AcquisitionIcp = {
  id: 'oncology',
  name: 'Clinical-Stage Oncology Biopharma',
  company_type: 'Biotech / Biopharma',
  platform_category: null,
  therapeutic_areas: ['Oncology'],
  modalities: ['Peptide', 'Biologic (Antibody)', 'ADC', 'Radiopharmaceutical', 'Imaging'],
  development_stages: ['Preclinical', 'Phase I', 'Phase II'],
  company_sizes: ['201–500'],
  funding_stages: ['Public'],
  target_customers: [
    'Large Pharmaceutical Companies',
    'Oncology-Focused Biotechs',
    'Academic Cancer Research Organizations',
    'Radiopharmaceutical Developers',
  ],
  buyer_types: ['Business Development', 'Commercial'],
};

test('Apollo recipes include both compound searches and broad backfill terms', () => {
  const recipes = buildApolloCompanySearchRecipes(oncologyIcp, 'expand_companies');
  assert.ok(recipes.some((recipe) => recipe.keywords.some((keyword) => keyword.includes('"'))));
  assert.ok(recipes.some((recipe) => recipe.keywords.some((keyword) => keyword.toLowerCase() === 'oncology')));
  assert.ok(recipes.some((recipe) => recipe.keywords.some((keyword) => keyword.toLowerCase() === 'biopharma')));
});

test('current local screen accepts legitimate oncology biopharma descriptions', () => {
  const keywords = icpKeywordCorpus(oncologyIcp);
  assert.equal(apolloOrganizationMatchesIcpKeywords({
    name: 'Example Therapeutics',
    short_description: 'Clinical-stage biopharma developing antibody-drug conjugates for oncology.',
    industry: 'Biotechnology',
  }, keywords), true);
});

test('current local screen also accepts obvious oncology media and nonprofit false positives', () => {
  const keywords = icpKeywordCorpus(oncologyIcp);
  assert.equal(apolloOrganizationMatchesIcpKeywords({
    name: 'Targeted Oncology',
    short_description: 'News, interviews and educational media for oncology professionals.',
    industry: 'Online Media',
  }, keywords), true);
  assert.equal(apolloOrganizationMatchesIcpKeywords({
    name: 'Oncology Nursing Society',
    short_description: 'A nonprofit professional association supporting oncology nurses.',
    industry: 'Non-profit Organizations',
  }, keywords), true);
});

test('quoted Apollo compound tags are not meaningfully evaluated by the local substring screen', () => {
  const onlyCompound = ['"biotech" "oncology"'];
  assert.equal(apolloOrganizationMatchesIcpKeywords({
    name: 'Example Oncology Biotech',
    short_description: 'A clinical-stage oncology biotechnology company.',
    industry: 'Biotechnology',
}, onlyCompound), false);
});

test('evidence-aware screen keeps oncology therapeutics and rejects media, nonprofits and CROs', () => {
  assert.equal(apolloOrganizationMatchesIcp({
    name: 'Summit Therapeutics',
    industry: 'Research',
    short_description: 'A biopharmaceutical company developing oncology therapies including a Phase III bispecific antibody.',
  }, oncologyIcp), true);
  assert.equal(apolloOrganizationMatchesIcp({
    name: 'ADC Therapeutics',
    industry: 'Research',
    short_description: 'A biotechnology company developing antibody-drug conjugates for cancer treatment.',
  }, oncologyIcp), true);
  assert.equal(apolloOrganizationMatchesIcp({
    name: 'Targeted Oncology',
    industry: 'Online Media',
    short_description: 'News, interviews and educational media for oncology professionals.',
  }, oncologyIcp), false);
  assert.equal(apolloOrganizationMatchesIcp({
    name: 'American Society of Clinical Oncology',
    industry: 'Nonprofit Organization Management',
    short_description: 'A professional association supporting oncology physicians.',
  }, oncologyIcp), false);
  assert.equal(apolloOrganizationMatchesIcp({
    name: 'DAVA Oncology',
    industry: 'Research Services',
    short_description: 'A contract research organization providing oncology clinical trial services.',
  }, oncologyIcp), false);
  assert.equal(apolloOrganizationMatchesIcp({
    name: 'Example Rare Disease Therapeutics',
    industry: 'Biotechnology',
    short_description: 'A clinical-stage biotechnology company with a Phase II rare-disease medicine.',
  }, oncologyIcp), false);
});

test('evidence-aware tools screen keeps instrument vendors and rejects unrelated enterprises', () => {
  const toolsIcp: AcquisitionIcp = {
    ...oncologyIcp,
    id: 'tools',
    name: 'Life Sciences Tools & Instruments Vendor',
    company_type: 'Life Science Tools & Instruments',
  };
  assert.equal(apolloOrganizationMatchesIcp({
    name: 'Agilent Technologies',
    industry: 'Research',
    short_description: 'Provides laboratory instruments, chromatography, mass spectrometry and genomics tools.',
  }, toolsIcp), true);
  assert.equal(apolloOrganizationMatchesIcp({
    name: 'Bruker',
    industry: 'Research',
    short_description: 'Manufacturer of high-performance scientific instruments for life sciences.',
  }, toolsIcp), true);
  assert.equal(apolloOrganizationMatchesIcp({
    name: 'Halliburton',
    industry: 'Oil and Gas',
    short_description: 'Provides products and services to the energy industry.',
  }, toolsIcp), false);
});
