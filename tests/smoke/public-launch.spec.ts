import { expect, test } from '@playwright/test';

test('canonical landing page renders the promoted Arcova experience', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Arcova/);
  await expect(
    page.getByRole('heading', { name: /revenue engine built for life sciences/i }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /one workspace/i })).toContainText(
    /whole revenue team/i,
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    /^https:\/\/arcova\.bio\/?$/,
  );
});

test('public legal pages render current SaaS policies', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
  await expect(page.getByText('Last updated: June 20, 2026')).toBeVisible();

  await page.goto('/terms');
  await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
  await expect(page.getByText(/Arcova helps life science commercial teams/)).toBeVisible();
});

test('paid provider endpoint rejects anonymous requests', async ({ request }) => {
  const response = await request.post('/api/analyze-example-company', {
    data: { url: 'example.com' },
  });
  expect(response.status()).toBe(401);
});

test('responses include baseline security headers', async ({ request }) => {
  const response = await request.get('/');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['x-frame-options']).toBe('DENY');
  expect(response.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
});
