import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto('/');
});

test('desktop panels resize within bounds and reset to their responsive defaults', async ({ page }) => {
  const regions = page.locator('.region-pane');
  const regionHandle = page.getByRole('separator', { name: 'Resize brain regions panel' });
  const initialWidth = (await regions.boundingBox())!.width;
  const handleBounds = await regionHandle.boundingBox();
  expect(handleBounds).not.toBeNull();

  await page.mouse.move(handleBounds!.x + handleBounds!.width / 2, handleBounds!.y + 80);
  await page.mouse.down();
  await page.mouse.move(handleBounds!.x + handleBounds!.width / 2 + 42, handleBounds!.y + 80);
  await page.mouse.up();
  await expect.poll(async () => (await regions.boundingBox())!.width).toBeCloseTo(initialWidth + 42, 0);

  await regionHandle.press('End');
  await expect.poll(async () => (await regions.boundingBox())!.width).toBe(420);
  await expect.poll(() => page.evaluate(() => JSON.parse(
    localStorage.getItem('ibl-ephys-atlas:layout:v1') ?? '{}',
  ).regionsWidth)).toBe(420);

  await regionHandle.press('Home');
  await expect.poll(async () => (await regions.boundingBox())!.width).toBe(250);
  const browserBounds = await page.locator('.region-pane__browser').boundingBox();
  const minimumHandleBounds = await regionHandle.boundingBox();
  expect(browserBounds).not.toBeNull();
  expect(minimumHandleBounds).not.toBeNull();
  expect(browserBounds!.x + browserBounds!.width).toBeLessThanOrEqual(minimumHandleBounds!.x + .5);

  await regionHandle.dblclick();
  await expect.poll(async () => (await regions.boundingBox())!.width).toBeCloseTo(initialWidth, 0);
  await expect.poll(() => page.evaluate(() => JSON.parse(
    localStorage.getItem('ibl-ephys-atlas:layout:v1') ?? '{}',
  ).regionsWidth)).toBeNull();

  const settings = page.locator('.settings-pane');
  const settingsHandle = page.getByRole('separator', { name: 'Resize visualization settings panel' });
  await settingsHandle.press('End');
  await expect.poll(async () => (await settings.boundingBox())!.width).toBe(440);
  await settingsHandle.press('ArrowRight');
  await expect.poll(async () => (await settings.boundingBox())!.width).toBe(428);
  await settingsHandle.dblclick();
});

test('both desktop panels collapse, restore, and persist outside the share URL', async ({ page }) => {
  const app = page.locator('.atlas-app');
  const workspace = page.locator('.workspace');
  const initialWorkspaceWidth = (await workspace.boundingBox())!.width;
  const initialUrl = page.url();

  await page.getByRole('button', { name: 'Hide Brain regions' }).click();
  await expect(app).toHaveAttribute('data-region-panel-collapsed', 'true');
  await expect(page.locator('.region-pane')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByRole('button', { name: 'Show Brain regions' })).toBeVisible();
  await expect.poll(async () => (await workspace.boundingBox())!.width).toBeGreaterThan(initialWorkspaceWidth + 250);

  await page.keyboard.press(']');
  await expect(app).toHaveAttribute('data-settings-panel-collapsed', 'true');
  await expect(page.getByRole('button', { name: 'Show Visualization settings' })).toBeVisible();
  expect(page.url()).toBe(initialUrl);

  await page.reload();
  await expect(app).toHaveAttribute('data-region-panel-collapsed', 'true');
  await expect(app).toHaveAttribute('data-settings-panel-collapsed', 'true');

  await page.keyboard.press('[');
  await page.keyboard.press(']');
  await expect(app).toHaveAttribute('data-region-panel-collapsed', 'false');
  await expect(app).toHaveAttribute('data-settings-panel-collapsed', 'false');
  await expect(page.locator('.region-pane')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('.settings-pane')).toHaveAttribute('aria-hidden', 'false');
});

test('panel shortcuts retain the existing drawer composition below inline breakpoints', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('.atlas-app')).toHaveAttribute('data-layout', 'narrow');

  await page.keyboard.press('[');
  await expect(page.locator('.region-pane')).toHaveAttribute('data-open', 'true');
  await expect(page.locator('.atlas-app')).toHaveAttribute('data-drawer-open', 'regions');
  await page.keyboard.press('[');
  await expect(page.locator('.region-pane')).toHaveAttribute('data-open', 'false');

  await page.keyboard.press(']');
  await expect(page.locator('.settings-pane')).toHaveAttribute('data-open', 'true');
  await expect(page.locator('.atlas-app')).toHaveAttribute('data-drawer-open', 'settings');
  await expect(page.getByRole('separator')).toHaveCount(0);
});
