import { expect, test } from '@playwright/test';

test('landing routes into the viewer and the viewer title returns home', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Electrophysiology');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('context.');
  await page.getByRole('link', { name: 'Open atlas' }).first().click();
  await expect(page).toHaveURL(/\/app\/$/);
  await expect(page.locator('.atlas-app')).toBeVisible();
  await page.getByRole('link', { name: 'Ephys Atlas home' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('[data-landing]')).toBeVisible();
});

test('landing user-guide links open the existing guide in the viewer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Read the user guide' })).toHaveAttribute('href', '/app/#help');
  await page.goto('/app/#help');
  await expect(page.getByRole('dialog', { name: 'Help & getting started' })).toBeVisible();
});

for (const width of [320, 390]) {
  test(`landing keeps its primary action usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Open atlas' }).first()).toBeVisible();
    await expect(page.locator('.landing-hero__visual')).toBeVisible();
    expect(await page.locator('body').evaluate((node) => node.scrollWidth)).toBe(width);
  });
}

test('viewer startup reports loading, then reveals either the ready app or its catalog failure', async ({ page }) => {
  let releaseCatalog: (() => void) | undefined;
  const catalogGate = new Promise<void>((resolve) => { releaseCatalog = resolve; });
  await page.route('**/__real-data/catalog.json', async (route) => {
    await catalogGate;
    await route.continue();
  });

  await page.goto('/app/', { waitUntil: 'domcontentloaded' });
  const status = page.locator('#app-bootstrap-status');
  await expect(page.locator('.atlas-app')).toBeVisible();
  await expect(status).toBeHidden();
  await expect(page.locator('[data-context-field="data"]')).toContainText('Loading datasets…');

  releaseCatalog?.();
  await expect(page.locator('[data-context-field="data"]')).not.toContainText('Loading datasets…');

  await page.route('**/__real-data/catalog.json', route => route.fulfill({ status: 503, body: 'catalog unavailable' }));
  await page.reload();
  await expect(page.locator('.atlas-app')).toBeVisible();
  await expect(page.locator('#app-bootstrap-status')).toBeHidden();
  await expect(page.locator('[data-context-field="data"]')).toContainText(/Data unavailable|catalog unavailable/i);
});
