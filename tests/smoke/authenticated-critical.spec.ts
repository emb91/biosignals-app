import { expect, test, type Page } from '@playwright/test';

const owner = credentials('E2E_OWNER');
const member = credentials('E2E_MEMBER');

test.describe('authenticated launch journeys', () => {
  test.skip(!owner, 'Set E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD to run authenticated smoke tests');

  test('owner can load the critical workspace APIs', async ({ page }) => {
    await login(page, owner!);
    for (const path of ['/api/billing/summary', '/api/user-company', '/api/icps', '/api/contacts']) {
      const response = await page.request.get(path);
      expect(response.status(), path).toBe(200);
    }
  });

  test('settings and company surfaces render after login', async ({ page }) => {
    await login(page, owner!);
    await page.goto('/settings');
    await expect(page.getByText(/Team|Billing|Usage/).first()).toBeVisible();
    await page.goto('/my-company');
    await expect(page.locator('body')).toContainText(/company/i);
  });
});

test.describe('workspace role isolation', () => {
  test.skip(
    !owner || !member,
    'Set E2E_OWNER_* and E2E_MEMBER_* for users in the same workspace',
  );

  test('member sees shared setup but cannot edit the company profile', async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const memberContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const memberPage = await memberContext.newPage();

    await login(ownerPage, owner!);
    await login(memberPage, member!);

    const ownerCompany = await json(ownerPage, '/api/user-company');
    const memberCompany = await json(memberPage, '/api/user-company');
    const ownerRow = ownerCompany.analyses?.[0];
    const memberRow = memberCompany.analyses?.[0];
    expect(memberRow?.id).toBe(ownerRow?.id);

    if (memberRow?.id) {
      const update = await memberPage.request.put('/api/user-company', {
        data: memberRow,
      });
      expect(update.status()).toBe(403);
    }

    const ownerIcps = (await json(ownerPage, '/api/icps')).data ?? [];
    const memberIcps = (await json(memberPage, '/api/icps')).data ?? [];
    const sharedOwnerIds = ownerIcps
      .filter((row: { scope?: string }) => row.scope === 'org')
      .map((row: { id: string }) => row.id);
    const memberIds = new Set(memberIcps.map((row: { id: string }) => row.id));
    for (const id of sharedOwnerIds) expect(memberIds.has(id)).toBe(true);

    await ownerContext.close();
    await memberContext.close();
  });
});

async function login(page: Page, values: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(values.email);
  await page.getByLabel('Password').fill(values.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 20_000 });
}

async function json(page: Page, path: string) {
  const response = await page.request.get(path);
  expect(response.status(), path).toBe(200);
  return response.json();
}

function credentials(prefix: string) {
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  return email && password ? { email, password } : null;
}
