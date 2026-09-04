import { expect, test } from '@playwright/test';

test('development lab exposes bounded Focus, Gallery, and Profile compositions', async ({ page }) => {
  await page.goto('/?lab=multi-feature');
  await expect(page.getByRole('heading', { name: 'Multi-feature comparison UX lab' })).toBeVisible();
  await expect(page.getByText('Synthetic demonstration data', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Synthetic scenario')).toHaveValue('regional-5');
  await expect(page.locator('.comparison-lab__card[data-status="ready"]')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Gallery', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.getByLabel('Synthetic scenario').selectOption('agea-4345');
  await expect(page.locator('.comparison-lab__counts')).toContainText('4,345');
  await expect.poll(() => page.locator('.comparison-lab__card').count()).toBeGreaterThan(0);
  await expect.poll(() => page.locator('.comparison-lab__card').count()).toBeLessThan(25);

  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Focus', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.comparison-lab__card[data-status="ready"]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByLabel('Virtualized feature profile')).toBeVisible();
  await expect.poll(() => page.locator('.comparison-lab__profile-row').count()).toBeGreaterThan(0);
  await expect.poll(() => page.locator('.comparison-lab__profile-row').count()).toBeLessThan(30);
});

test('lab makes partial failure, missingness, zero variance, and compatibility visible', async ({ page }) => {
  await page.goto('/?lab=multi-feature');
  await page.getByLabel('Synthetic scenario').selectOption('edge-cases');
  const counts = page.locator('.comparison-lab__counts');
  await expect(counts).toContainText('Compatible7');
  await expect(counts).toContainText('Excluded1');
  await expect(page.locator('.comparison-lab__card[data-status="error"]')).toContainText('Synthetic request failure');
  await expect(page.getByText('Missing at the shared cursor', { exact: true })).toBeVisible();
  await expect(page.getByText('Zero variance → unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fine grid 0006' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Coarse grid 0007' })).toBeVisible();
});

test('changing scenarios while a slow request is active rejects stale results', async ({ page }) => {
  await page.goto('/?lab=multi-feature');
  await page.getByLabel('Synthetic scenario').selectOption('edge-cases');
  await expect(page.getByRole('heading', { name: 'Slow response 0002' })).toBeVisible();
  await page.getByLabel('Synthetic scenario').selectOption('regional-5');
  await expect(page.locator('.comparison-lab__card[data-status="ready"]')).toHaveCount(5);
  await page.waitForTimeout(400);
  await expect(page.getByText('Slow response 0002', { exact: true })).toHaveCount(0);
  await expect(page.locator('.comparison-lab__card[data-status="ready"]')).toHaveCount(5);
});

test('lab remains usable at a narrow phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?lab=multi-feature');
  await expect(page.getByLabel('Lab controls')).toBeVisible();
  await expect(page.getByLabel('Virtualized feature gallery')).toBeVisible();
  await expect(page.locator('.comparison-lab__card[data-status="ready"]')).toHaveCount(5);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
