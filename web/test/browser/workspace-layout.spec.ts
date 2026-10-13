import { expect, test } from '@playwright/test';

test('desktop workspace keeps projections compact enough for feature context', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/');
  await expect(page.locator('.atlas-app')).toBeVisible();

  await page.locator('.feature-summary-panel > summary').click();
  const projections = await page.locator('.slice-strip').boundingBox();
  const context = await page.locator('.context-strip').boundingBox();

  expect(projections).not.toBeNull();
  expect(context).not.toBeNull();
  expect(projections!.height).toBeLessThanOrEqual(405);
  expect(context!.height).toBeGreaterThanOrEqual(215);
  expect(context!.y).toBeGreaterThan(projections!.y + projections!.height);
});

test('tall desktop workspace gives excess height to feature context', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/app/');
  await expect(page.locator('.atlas-app')).toBeVisible();

  await page.locator('.feature-summary-panel > summary').click();
  const projections = await page.locator('.slice-strip').boundingBox();
  const context = await page.locator('.context-strip').boundingBox();

  expect(projections).not.toBeNull();
  expect(context).not.toBeNull();
  expect(projections!.height).toBeLessThanOrEqual(545);
  expect(context!.height).toBeGreaterThanOrEqual(360);
});

test('low browser zoom keeps feature context from overwhelming projections', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1600 });
  await page.goto('/app/');
  await expect(page.locator('.atlas-app')).toBeVisible();

  await page.locator('.feature-summary-panel > summary').click();
  const projections = await page.locator('.slice-strip').boundingBox();
  const context = await page.locator('.context-strip').boundingBox();

  expect(projections).not.toBeNull();
  expect(context).not.toBeNull();
  expect(context!.height).toBeLessThanOrEqual(projections!.height);
});

test('feature summary spans the workspace below context with expandable details', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/');
  const panel = page.locator('.feature-summary-panel');
  await expect(panel).toHaveAttribute('open');
  await expect(panel.locator('.feature-summary__item')).toHaveCount(4);
  const panelBounds = await panel.boundingBox();
  const contextBounds = await page.locator('.context-strip').boundingBox();
  expect(panelBounds!.width).toBeCloseTo(contextBounds!.width, 0);
  expect(panelBounds!.y).toBeGreaterThanOrEqual(contextBounds!.y + contextBounds!.height);
  await expect(panel.locator('.feature-summary__description')).toBeVisible();
  await panel.locator('summary').click();
  await expect(panel.locator('.feature-summary__description')).toBeHidden();
  await panel.locator('summary').click();
  await expect(panel.locator('.feature-summary__description')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Context view' })).toHaveValue('top');
  await expect(page.getByRole('combobox', { name: 'Context view' }).locator('option')).toHaveText(['Top', 'Swanson', '3-D']);
});
