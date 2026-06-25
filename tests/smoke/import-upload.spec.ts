import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { ROUTES } from '../../lib/routes';

const owner = credentials('E2E_OWNER');

test.describe('import CSV upload methods', () => {
  test.skip(!owner, 'Set E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD to run authenticated import upload tests');

  test('contact CSV upload reaches column mapping without spending credits', async ({ page }) => {
    await login(page, owner!);
    await openCleanImportPage(page);

    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByText('Upload contacts', { exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(fixturePath('import-contacts.csv'));

    await expect(page.getByRole('heading', { name: 'Map your columns' })).toBeVisible();
    await expect(page.getByText(/import-contacts\.csv.*1 rows/)).toBeVisible();
    await expect(page.getByText('Ada Lovelace')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm import' })).toBeEnabled();
  });

  test('company CSV upload reaches cost-review step without spending credits', async ({ page }) => {
    await login(page, owner!);
    await openCleanImportPage(page);

    const uploadCompanies = page.getByText('Upload companies', { exact: true });
    test.skip(await uploadCompanies.count() === 0, 'Company CSV upload card is not enabled in this build');

    const chooserPromise = page.waitForEvent('filechooser');
    await uploadCompanies.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(fixturePath('import-companies.csv'));

    await expect(page.getByRole('heading', { name: 'Map your columns' })).toBeVisible();
    await expect(page.getByText(/import-companies\.csv.*1 rows/)).toBeVisible();
    await expect(page.getByText('Arcova QA Labs')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review cost' })).toBeEnabled();
  });

  test('completed contact CSV import routes triaged rows without paid enrichment CTA', async ({ page }) => {
    await login(page, owner!);
    await stubCompletedContactTriageBatch(page);

    await page.goto('/import');
    await page.evaluate(() => {
      localStorage.setItem('arcova_current_batch_id', 'batch-contact-triage');
      localStorage.setItem('arcova_current_batch_mode', 'contacts');
    });
    await page.reload();

    await expect(page.getByRole('heading', { name: 'Import analyzed' })).toBeVisible();
    await expect(page.getByText('Triaged for included import')).toBeVisible();
    await expect(page.getByText('2 records are prioritized for the monthly included import flow.')).toBeVisible();
    await expect(page.getByText(/Enrich 2 best matches/)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Review triaged leads' }).first()).toHaveAttribute('href', ROUTES.triage);
  });
});

async function login(page: Page, values: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(values.email);
  await page.getByLabel('Password').fill(values.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 20_000 });
}

async function openCleanImportPage(page: Page) {
  await page.goto('/import');
  await page.evaluate(() => {
    localStorage.removeItem('arcova_current_batch_id');
    localStorage.removeItem('arcova_current_batch_mode');
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: /Import contacts|Import companies/ })).toBeVisible();
}

function fixturePath(filename: string) {
  return path.join(process.cwd(), 'tests', 'fixtures', filename);
}

function credentials(prefix: string) {
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  return email && password ? { email, password } : null;
}

async function stubCompletedContactTriageBatch(page: Page) {
  await page.route('**/api/import-status?**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        total: 2,
        processed: 2,
        remaining: 0,
        duplicates: 0,
        enriching: 0,
        pending: 0,
        enriched: 0,
        not_enriched: 0,
        batch_status: 'complete',
      }),
    });
  });

  await page.route('**/api/import-history/batch-contact-triage', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        failedRows: [],
        duplicateRows: [],
        enrichedRows: [],
        allRows: [
          {
            id: 'raw-1',
            status: 'awaiting_enrichment',
            full_name: 'Ada Lovelace',
            email: 'ada@example.com',
            linkedin_url: '',
            company_name: 'Analytical Engines Ltd',
            company_domain: 'analytical.example',
            job_title: 'VP Biology',
            triage_group: 'high',
          },
          {
            id: 'raw-2',
            status: 'awaiting_enrichment',
            full_name: 'Grace Hopper',
            email: 'grace@example.com',
            linkedin_url: '',
            company_name: 'Compiler Bio',
            company_domain: 'compiler.example',
            job_title: 'Head of Platform',
            triage_group: 'medium',
          },
        ],
      }),
    });
  });
}
