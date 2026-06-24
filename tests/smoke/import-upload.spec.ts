import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

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
