import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyImportRowsForDedup, type InsertedImportRow } from './import-contact-dedup';

function row(overrides: Partial<InsertedImportRow>): InsertedImportRow {
  const rawData = {
    full_name: '',
    first_name: '',
    last_name: '',
    company_name: '',
    company_domain: '',
    job_title: '',
    email: '',
    linkedin_url: '',
    location: '',
    company_linkedin_url: '',
    ...(overrides.raw_data && typeof overrides.raw_data === 'object' ? overrides.raw_data : {}),
  };

  return {
    id: 'row-1',
    full_name: rawData.full_name,
    email: rawData.email,
    linkedin_url: rawData.linkedin_url,
    company_name: rawData.company_name,
    raw_data: rawData,
    ...overrides,
  };
}

test('marks rows duplicated by existing pending raw uploads in the same org', () => {
  const incoming = row({
    id: 'incoming',
    email: 'SREID@SwordBio.com',
    raw_data: {
      full_name: 'Seth Reid',
      first_name: 'Seth',
      last_name: 'Reid',
      company_name: 'Sword Bio',
      email: 'SREID@SwordBio.com',
    },
  });

  const result = classifyImportRowsForDedup({
    insertedRows: [incoming],
    existingContacts: [],
    pendingRawUploads: [
      {
        email: 'sreid@swordbio.com',
        full_name: 'Seth Reid',
        company_name: 'Sword Bio',
        raw_data: { first_name: 'Seth', last_name: 'Reid' },
      },
    ],
  });

  assert.deepEqual(result.pendingRows.map((pending) => pending.id), []);
  assert.deepEqual(result.duplicateIds, ['incoming']);
  assert.equal(result.duplicateReasons.get('incoming'), 'Duplicate email');
});

test('keeps the first row and marks later intra-batch duplicates', () => {
  const first = row({
    id: 'first',
    linkedin_url: 'https://linkedin.com/in/seth-reid',
    raw_data: {
      full_name: 'Seth Reid',
      first_name: 'Seth',
      last_name: 'Reid',
      company_name: 'Sword Bio',
      linkedin_url: 'https://linkedin.com/in/seth-reid',
    },
  });
  const second = row({
    id: 'second',
    linkedin_url: 'https://linkedin.com/in/seth-reid',
    raw_data: {
      full_name: 'Seth Reid',
      first_name: 'Seth',
      last_name: 'Reid',
      company_name: 'Sword Bio',
      linkedin_url: 'https://linkedin.com/in/seth-reid',
    },
  });

  const result = classifyImportRowsForDedup({
    insertedRows: [first, second],
    existingContacts: [],
    pendingRawUploads: [],
  });

  assert.deepEqual(result.pendingRows.map((pending) => pending.id), ['first']);
  assert.deepEqual(result.duplicateIds, ['second']);
  assert.equal(result.duplicateReasons.get('second'), 'Duplicate LinkedIn URL');
});

test('dedups against org-scope existing contact candidates by name and company', () => {
  const incoming = row({
    id: 'incoming',
    full_name: 'Seth Reid',
    company_name: 'Sword Bio',
    raw_data: {
      full_name: 'Seth Reid',
      first_name: 'Seth',
      last_name: 'Reid',
      company_name: 'Sword Bio',
    },
  });

  const result = classifyImportRowsForDedup({
    insertedRows: [incoming],
    existingContacts: [{ full_name: 'Seth Reid', company_name: 'Sword Bio' }],
    pendingRawUploads: [],
  });

  assert.deepEqual(result.duplicateIds, ['incoming']);
  assert.equal(result.duplicateReasons.get('incoming'), 'Duplicate name + company');
});

test('strips invalid email without using it as a duplicate key', () => {
  const incoming = row({
    id: 'incoming',
    email: 'not an email',
    raw_data: {
      full_name: 'Jane Candidate',
      first_name: 'Jane',
      last_name: 'Candidate',
      company_name: 'NewCo',
      email: 'not an email',
    },
  });

  const result = classifyImportRowsForDedup({
    insertedRows: [incoming],
    existingContacts: [{ email: 'not an email', first_name: 'Other', last_name: 'Person', company_name: 'Elsewhere' }],
    pendingRawUploads: [],
  });

  assert.deepEqual(result.pendingRows.map((pending) => pending.id), ['incoming']);
  assert.deepEqual(result.duplicateIds, []);
  assert.deepEqual(result.clearedEmailIds, ['incoming']);
  assert.equal(incoming.email, null);
});

test('does not suppress weak rows that lack email, linkedin, or matching name company', () => {
  const incoming = row({
    id: 'incoming',
    raw_data: {
      full_name: 'Pat Lee',
      first_name: 'Pat',
      last_name: 'Lee',
      company_name: 'NewCo',
    },
  });

  const result = classifyImportRowsForDedup({
    insertedRows: [incoming],
    existingContacts: [{ first_name: 'Pat', last_name: 'Lee', company_name: 'DifferentCo' }],
    pendingRawUploads: [{ full_name: 'Pat Lee', company_name: 'AnotherCo' }],
  });

  assert.deepEqual(result.pendingRows.map((pending) => pending.id), ['incoming']);
  assert.deepEqual(result.duplicateIds, []);
});
